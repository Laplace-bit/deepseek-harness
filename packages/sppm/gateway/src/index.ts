import { createHmac, randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Server } from 'node:http'
import type { WebSocketServer as WsWebSocketServer } from 'ws'
import { isPageActionReceipt, isPageActionRequest, SPPM_PAGE_BRIDGE_ACTIONS, SPPM_PAGE_BRIDGE_PROTOCOL_VERSION } from '@deepseek-ai/dsh-sppm-page-bridge'

export interface SppmPrincipal {
  userId: string
  displayName?: string
  roles: string[]
}

export interface ManagedHarnessInstance {
  userId: string
  instanceId: string
  endpoint: string
  /** Secret shared only by the fixed-profile child and this gateway. */
  internalToken: string
  /** Browser-auth cookie minted for this fixed-profile child.  It never leaves the gateway. */
  harnessCookie: string
  stop(): Promise<void>
}

export type HarnessInstanceFactory = (principal: SppmPrincipal) => Promise<ManagedHarnessInstance>

export class InstanceCapacityError extends Error {
  constructor(public readonly limit: number) {
    super(`AI 实例容量已满（上限 ${limit}）`)
    this.name = 'InstanceCapacityError'
  }
}

/** Keeps one fixed-profile Harness process per SPPM user. */
export class HarnessInstanceManager {
  private readonly instances = new Map<string, ManagedHarnessInstance>()

  constructor(private readonly maxInstances: number, private readonly factory: HarnessInstanceFactory) {}

  async acquire(principal: SppmPrincipal): Promise<ManagedHarnessInstance> {
    const existing = this.instances.get(principal.userId)
    if (existing !== undefined) return existing
    if (this.instances.size >= this.maxInstances) throw new InstanceCapacityError(this.maxInstances)
    const instance = await this.factory(principal)
    this.instances.set(principal.userId, instance)
    return instance
  }

  async release(userId: string): Promise<void> {
    const instance = this.instances.get(userId)
    if (instance === undefined) return
    this.instances.delete(userId)
    await instance.stop()
  }

  size(): number { return this.instances.size }

  findByInternalToken(token: string): ManagedHarnessInstance | undefined {
    for (const instance of this.instances.values()) if (instance.internalToken === token) return instance
    return undefined
  }
}

export interface GatewayConfig {
  host?: string
  port?: number
  cookieName?: string
  cookieSecret: string
  secureCookie?: boolean
  maxInstances?: number
  /** Maximum encoded request size accepted when proxying a Harness API call. */
  maxHarnessRequestBodyBytes?: number
  allowedOrigins?: string[]
  authenticate(request: IncomingMessage): Promise<SppmPrincipal | null>
  instances: HarnessInstanceManager
}

interface BrowserSession {
  token: string
  principal: SppmPrincipal
  authorization?: string
  userId: string
  instanceId: string
  expiresAt: number
}

const SESSION_TTL_MS = 15 * 60 * 1000
/**
 * Harness' attachment defaults allow a 200 MiB aggregate image payload. JSON
 * base64 encoding plus the request envelope needs roughly 268 MiB, so keep
 * the gateway aligned with the connection layer's 300 MiB default instead of
 * rejecting ordinary image prompts at the proxy boundary.
 */
export const DEFAULT_MAX_HARNESS_REQUEST_BODY_BYTES = 300 * 1024 * 1024
const DEFAULT_CONTROL_REQUEST_BODY_BYTES = 256 * 1024
const STRIPPED_UPSTREAM_HEADERS = new Set(['connection', 'transfer-encoding', 'content-length', 'content-encoding', 'set-cookie'])

class RequestBodyTooLargeError extends Error {
  constructor(public readonly limit: number) {
    super(`request body exceeds ${String(limit)} bytes`)
    this.name = 'RequestBodyTooLargeError'
  }
}

function json(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(body)
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (header === undefined) return {}
  return Object.fromEntries(header.split(';').flatMap((part) => {
    const index = part.indexOf('=')
    if (index < 0) return []
    return [[part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())]]
  }))
}

function sign(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url')
}

function setSessionCookie(response: ServerResponse, name: string, token: string, signature: string, secure: boolean): void {
  response.setHeader('set-cookie', `${name}=${encodeURIComponent(`${token}.${signature}`)}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`)
}

/**
 * Some embedded Harness builds resolve their native `/api/*` endpoints from
 * the configured gateway base instead of the document origin.  Accept that
 * namespaced form at the seam and forward only the child Harness path.  The
 * canonical form remains `/api/*`, so direct and same-origin clients share
 * one proxy implementation.
 */
function normalizeHarnessPath(pathname: string): string {
  const prefix = '/api/sppm/v1'
  return pathname.startsWith(`${prefix}/api/`) ? pathname.slice(prefix.length) : pathname
}

/**
 * Node's fetch transparently decodes compressed upstream bodies. Forwarding
 * the original encoding or length would make the browser reject the embedded
 * Harness document with `ERR_CONTENT_DECODING_FAILED`.
 */
function forwardUpstreamHeaders(response: ServerResponse, upstream: Response): void {
  upstream.headers.forEach((value, key) => {
    if (!STRIPPED_UPSTREAM_HEADERS.has(key)) response.setHeader(key, value)
  })
}

/**
 * Minimal same-origin gateway seam. The Harness HTTP/WebSocket routes are
 * attached by deployment code after this authenticator and instance manager
 * have established the user boundary.
 */
export class SppmGateway {
  private readonly sessions = new Map<string, BrowserSession>()
  private readonly cookieName: string
  private readonly maxHarnessRequestBodyBytes: number
  private readonly server: Server
  private websocketServer: WsWebSocketServer | undefined
  private readonly pageBridges = new Map<string, Map<string, Set<import('ws').WebSocket>>>()

  constructor(private readonly config: GatewayConfig) {
    this.cookieName = config.cookieName ?? 'sppm_ai_session'
    this.maxHarnessRequestBodyBytes = config.maxHarnessRequestBodyBytes ?? DEFAULT_MAX_HARNESS_REQUEST_BODY_BYTES
    if (!Number.isSafeInteger(this.maxHarnessRequestBodyBytes) || this.maxHarnessRequestBodyBytes <= 0) {
      throw new Error('maxHarnessRequestBodyBytes must be a positive safe integer')
    }
    this.server = createServer((request, response) => { void this.handle(request, response) })
    this.server.on('upgrade', (request, socket, head) => { void this.handleUpgrade(request, socket, head) })
  }

  listen(): Promise<Server> {
    const host = this.config.host ?? '127.0.0.1'
    const port = this.config.port ?? 3180
    return new Promise((resolve, reject) => {
      const onError = (error: Error): void => { this.server.off('listening', onListening); reject(error) }
      const onListening = (): void => { this.server.off('error', onError); resolve(this.server) }
      this.server.once('error', onError)
      this.server.once('listening', onListening)
      this.server.listen(port, host)
    })
  }

  async close(): Promise<void> {
    for (const session of this.sessions.values()) await this.config.instances.release(session.userId)
    this.sessions.clear()
    await new Promise<void>((resolve, reject) => this.server.close(error => error === undefined ? resolve() : reject(error)))
    this.websocketServer?.close()
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method === 'OPTIONS') {
      this.writeCors(request, response)
      response.statusCode = 204
      response.end()
      return
    }
    this.writeCors(request, response)
    const url = new URL(request.url ?? '/', 'http://sppm-gateway.local')
    if (url.pathname === '/health') {
      json(response, 200, { status: 'ok', activeInstances: this.config.instances.size() })
      return
    }
    const isRuntimeRoute = url.pathname.startsWith('/api/sppm/v1/runtime')
    const isPageActionRoute = url.pathname === '/api/sppm/v1/page-actions'
    const isPageContextRoute = url.pathname === '/api/sppm/v1/page-context'
    const harnessPath = normalizeHarnessPath(url.pathname)
    const isHarnessRoute = harnessPath.startsWith('/api/') && !harnessPath.startsWith('/api/sppm/')
    if (isPageContextRoute) {
      await this.handlePageContext(request, response)
      return
    }
    if (isPageActionRoute) {
      await this.handlePageAction(request, response)
      return
    }
    if (!isRuntimeRoute && !isHarnessRoute && url.pathname !== '/api/sppm/v1/session' && url.pathname !== '/api/sppm/v1/capabilities') {
      json(response, 404, { error: 'not_found' })
      return
    }
    const session = this.readSession(request)
    let principal = session === undefined
      ? await this.config.authenticate(request)
      : await this.revalidateSession(session, request)
    // A browser can keep the AI session cookie while the user signs in again
    // and receives a fresh SPPM credential.  Revalidation intentionally
    // rejects the old bearer for ordinary Harness requests, but the session
    // endpoint is the explicit renewal boundary: authenticate the current
    // request, discard the stale AI session, and issue a new one.
    if (principal === null && session !== undefined && url.pathname === '/api/sppm/v1/session') {
      principal = await this.config.authenticate(request)
    }
    if (principal === null) {
      json(response, 401, { error: 'unauthorized' })
      return
    }
    if (isRuntimeRoute) {
      await this.proxyHarnessRuntime(request, response, url)
      return
    }
    if (isHarnessRoute) {
      await this.proxyHarnessRequest(request, response, url, harnessPath)
      return
    }
    try {
      const instance = await this.config.instances.acquire(principal)
      if (url.pathname.endsWith('/capabilities')) {
        json(response, 200, {
          protocolVersion: SPPM_PAGE_BRIDGE_PROTOCOL_VERSION,
          userId: principal.userId,
          instanceId: instance.instanceId,
          actions: [...SPPM_PAGE_BRIDGE_ACTIONS],
          terminal: false,
          serverFiles: false,
        })
        return
      }
      const browserSession = this.issueSession(principal, instance, request.headers.authorization)
      setSessionCookie(
        response,
        this.cookieName,
        browserSession.token,
        sign(browserSession.token, this.config.cookieSecret),
        this.config.secureCookie !== false,
      )
      json(response, 200, {
        sessionId: browserSession.token,
        userId: principal.userId,
        instanceId: instance.instanceId,
        endpoint: instance.endpoint,
        expiresAt: browserSession.expiresAt,
      })
    } catch (error) {
      if (error instanceof InstanceCapacityError) {
        json(response, 429, { error: 'capacity_exhausted', message: error.message, limit: error.limit })
        return
      }
      // Keep the client response generic while retaining a bounded startup
      // diagnostic for operators; child output is already token-redacted by
      // the instance factory.
      console.error('sppm-gateway: Harness instance unavailable', error instanceof Error ? error.message : String(error))
      json(response, 503, { error: 'instance_unavailable' })
    }
  }

  private async proxyHarnessRequest(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    harnessPath = url.pathname,
  ): Promise<void> {
    const session = this.readSession(request)
    if (session === undefined) { json(response, 401, { error: 'harness_session_required' }); return }
    try {
      const instance = await this.config.instances.acquire(session.principal)
      const body = request.method === 'GET' || request.method === 'HEAD'
        ? undefined
        : await readRequestBody(request, this.maxHarnessRequestBodyBytes)
      const init: RequestInit = {
        method: request.method ?? 'GET',
        headers: {
          ...(request.headers['content-type'] === undefined ? {} : { 'content-type': request.headers['content-type'] }),
          // The browser is authenticated at the SPPM gateway.  Harness has a
          // separate authority-bound browser cookie, so forwarding the SPPM
          // cookie would make the embedded page receive a 401.
          cookie: instance.harnessCookie,
        },
      }
      if (body !== undefined) init.body = body
      const upstream = await fetch(`${instance.endpoint}${harnessPath}${url.search}`, init)
      response.statusCode = upstream.status
      forwardUpstreamHeaders(response, upstream)
      response.end(Buffer.from(await upstream.arrayBuffer()))
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        json(response, 413, { error: 'request_body_too_large', limit: error.limit })
        return
      }
      json(response, 503, { error: 'harness_unavailable' })
    }
  }

  /** Proxy the Harness web shell and revisioned client bundles under a stable namespace.
   * The namespace prevents Harness `/plugins` and `/assets` paths from colliding
   * with the Vue application's own static resources while keeping the browser
   * on the gateway origin and inside the same authenticated session.
   */
  private async proxyHarnessRuntime(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    const session = this.readSession(request)
    if (session === undefined) { json(response, 401, { error: 'harness_session_required' }); return }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.statusCode = 405
      response.setHeader('allow', 'GET, HEAD')
      response.end()
      return
    }
    try {
      const instance = await this.config.instances.acquire(session.principal)
      const prefix = '/api/sppm/v1/runtime'
      const suffix = url.pathname.slice(prefix.length) || '/'
      const upstream = await fetch(`${instance.endpoint}${suffix}${url.search}`, {
        method: request.method,
        headers: { cookie: instance.harnessCookie },
      })
      response.statusCode = upstream.status
      forwardUpstreamHeaders(response, upstream)
      response.end(request.method === 'HEAD' ? undefined : Buffer.from(await upstream.arrayBuffer()))
    } catch (_error) {
      json(response, 503, { error: 'harness_runtime_unavailable' })
    }
  }

  private async handleUpgrade(request: IncomingMessage, socket: import('node:stream').Duplex, head: Buffer): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://sppm-gateway.local')
    const harnessPath = normalizeHarnessPath(url.pathname)
    if (!harnessPath.startsWith('/api/')) { socket.destroy(); return }
    const session = this.readSession(request)
    if (session === undefined) {
      socket.destroy(); return
    }
    if (await this.revalidateSession(session, request) === null) {
      socket.destroy(); return
    }
    try {
      const { WebSocket, WebSocketServer } = await import('ws')
      if (url.pathname === '/api/sppm/v1/page-bridge') {
        const browserInstanceId = url.searchParams.get('browserInstanceId')
        if (browserInstanceId === null || browserInstanceId.length < 1 || browserInstanceId.length > 128) {
          socket.destroy(); return
        }
        // Keep compression disabled at both hops.  The embedded Vue dev proxy
        // is a byte-for-byte WebSocket tunnel and cannot safely renegotiate
        // permessage-deflate between the browser and the private Harness
        // child.  Sending uncompressed frames avoids RSV1 mismatches after a
        // proxy or ingress strips the extension response header.
        this.websocketServer ??= new WebSocketServer({ noServer: true, perMessageDeflate: false } as unknown as { noServer: boolean })
        this.websocketServer.handleUpgrade(request, socket, head, (client) => {
          const byBrowser = this.pageBridges.get(session.userId) ?? new Map<string, Set<import('ws').WebSocket>>()
          const bridges = byBrowser.get(browserInstanceId) ?? new Set<import('ws').WebSocket>()
          bridges.add(client)
          byBrowser.set(browserInstanceId, bridges)
          this.pageBridges.set(session.userId, byBrowser)
          client.on('close', () => {
            bridges.delete(client)
            if (bridges.size === 0) byBrowser.delete(browserInstanceId)
            if (byBrowser.size === 0) this.pageBridges.delete(session.userId)
          })
        })
        return
      }
      const instance = await this.config.instances.acquire(session.principal)
      this.websocketServer ??= new WebSocketServer({ noServer: true, perMessageDeflate: false } as unknown as { noServer: boolean })
      this.websocketServer.handleUpgrade(request, socket, head, (client) => {
        const upstream = new WebSocket(`${instance.endpoint.replace(/^http/, 'ws')}${harnessPath}${url.search}`, {
          perMessageDeflate: false,
          headers: { cookie: instance.harnessCookie },
        } as unknown as { headers?: Record<string, string> })
        // `ws` delivers the payload as a Buffer for both text and binary
        // frames.  Preserve the `isBinary` bit across the two hops: the
        // Harness mux deliberately rejects binary control messages, and
        // blindly forwarding a Buffer turns every browser text frame into a
        // binary frame (close code 1003).
        client.on('message', ((data: Buffer, isBinary: boolean) => {
          if (upstream.readyState !== WebSocket.OPEN) return
          upstream.send(isBinary ? data : data.toString('utf8'))
        }) as unknown as (data: Buffer) => void)
        upstream.on('message', ((data: Buffer, isBinary: boolean) => {
          if (client.readyState !== WebSocket.OPEN) return
          client.send(isBinary ? data : data.toString('utf8'))
        }) as unknown as (data: Buffer) => void)
        client.on('close', () => { if (upstream.readyState === WebSocket.OPEN) upstream.close() })
        upstream.on('close', (function () {
          if (client.readyState === WebSocket.OPEN) client.close()
        }) as unknown as () => void)
        upstream.on('error', (function () {
          console.error('sppm-gateway: Harness WebSocket unavailable')
          if (client.readyState === WebSocket.OPEN) client.close(1011, 'harness unavailable')
          else client.close()
        }) as unknown as () => void)
      })
    } catch (error) {
      console.error('sppm-gateway: Harness upgrade unavailable', error instanceof Error ? error.message : String(error))
      socket.destroy()
    }
  }

  /** Deliver one semantic action from the Harness child to the originating tab. */
  private async handlePageAction(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== 'POST') { response.statusCode = 405; response.setHeader('allow', 'POST'); response.end(); return }
    const token = request.headers['x-sppm-instance-token']
    const instance = typeof token === 'string' ? this.config.instances.findByInternalToken(token) : undefined
    if (instance === undefined) { json(response, 401, { error: 'instance_not_authorized' }); return }
    try {
      const body = JSON.parse(await readRequestBody(request)) as unknown
      if (!isPageActionRequest(body)) {
        json(response, 400, { error: 'invalid_command', message: '页面指令格式无效' }); return
      }
      if (body.userId !== undefined && body.userId !== instance.userId && body.userId !== 'unknown') {
        json(response, 403, { error: 'user_mismatch' }); return
      }
      const { browserInstanceId, commandId } = body
      if (typeof browserInstanceId !== 'string' || browserInstanceId.length < 1 || browserInstanceId.length > 128) {
        json(response, 400, { error: 'invalid_browser_instance' }); return
      }
      if (typeof commandId !== 'string' || commandId.length < 1 || commandId.length > 128) {
        json(response, 400, { error: 'invalid_command' }); return
      }
      if (!this.pageBridges.get(instance.userId)?.has(browserInstanceId)) {
        json(response, 409, { error: 'page_bridge_unavailable', message: '需要打开目标业务页面' }); return
      }
      // The page action tool cannot know the authenticated SPPM principal from
      // its fixed Harness instance token. The gateway is that authority, so it
      // replaces the plugin's placeholder with the instance owner before the
      // request crosses into the browser page.
      json(response, 200, await this.deliverToBridge(instance.userId, browserInstanceId, {
        ...body,
        userId: instance.userId,
        commandId,
        browserInstanceId,
      }))
    } catch (_error) {
      json(response, 400, { error: 'invalid_command' })
    }
  }

  /**
   * Resolve the page context of the user's active browser instance for the
   * fixed-profile child. With several open tabs the target is ambiguous, so the
   * caller must pass a browser instance instead.
   */
  private async handlePageContext(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== 'POST') { response.statusCode = 405; response.setHeader('allow', 'POST'); response.end(); return }
    const token = request.headers['x-sppm-instance-token']
    const instance = typeof token === 'string' ? this.config.instances.findByInternalToken(token) : undefined
    if (instance === undefined) { json(response, 401, { error: 'instance_not_authorized' }); return }
    let requested: unknown
    try {
      requested = (JSON.parse(await readRequestBody(request)) as { browserInstanceId?: unknown }).browserInstanceId
    } catch (_error) {
      json(response, 400, { error: 'invalid_request' }); return
    }
    const byBrowser = this.pageBridges.get(instance.userId)
    let browserInstanceId: string
    if (typeof requested === 'string' && requested.length > 0) {
      if (byBrowser?.has(requested) !== true) { json(response, 409, { error: 'page_bridge_unavailable', message: '需要打开目标业务页面' }); return }
      browserInstanceId = requested
    } else {
      const active = [...(byBrowser?.keys() ?? [])]
      if (active.length === 0) { json(response, 409, { error: 'page_bridge_unavailable', message: '需要打开目标业务页面' }); return }
      if (active.length > 1) { json(response, 409, { error: 'ambiguous_browser_instance', message: '存在多个浏览器标签页，请指定 browserInstanceId', browserInstanceIds: active }); return }
      const only = active[0]
      if (only === undefined) { json(response, 409, { error: 'page_bridge_unavailable', message: '需要打开目标业务页面' }); return }
      browserInstanceId = only
    }
    const issuedAt = Date.now()
    const discovery = {
      commandId: randomUUID(),
      userId: instance.userId,
      sessionId: '',
      browserInstanceId,
      targetPageId: '',
      contextVersion: -1,
      action: 'readPageContext',
      args: {},
      issuedAt,
      expiresAt: issuedAt + 30_000,
    }
    json(response, 200, await this.deliverToBridge(instance.userId, browserInstanceId, discovery))
  }

  /** Send one request to every socket of a browser instance and resolve with the first matching receipt. */
  private deliverToBridge(
    userId: string,
    browserInstanceId: string,
    payload: { commandId: string; [key: string]: unknown },
  ): Promise<unknown> {
    const bridges = this.pageBridges.get(userId)?.get(browserInstanceId)
    if (bridges === undefined || bridges.size === 0) {
      return Promise.resolve({ commandId: payload.commandId, state: 'failed', contextVersion: typeof payload.contextVersion === 'number' ? payload.contextVersion : -1, message: '需要打开目标业务页面' })
    }
    return new Promise<unknown>((resolve) => {
      const action = typeof payload.action === 'string' ? payload.action : ''
      const timeoutMs = action === 'requestConfirmation' || action === 'submitForm'
        ? 5 * 60_000
        : action === 'queryRecords' ? 2 * 60_000 : 30_000
      const timeout = setTimeout(() => {
        cleanup()
        resolve({ commandId: payload.commandId, state: 'expired', contextVersion: typeof payload.contextVersion === 'number' ? payload.contextVersion : -1, message: '页面指令等待超时' })
      }, timeoutMs)
      const cleanup = (): void => {
        clearTimeout(timeout)
        for (const bridge of bridges) bridge.off('message', onMessage)
      }
      const onMessage = (raw: import('ws').RawData): void => {
        try {
          const value = JSON.parse(raw.toString()) as unknown
          if (!isPageActionReceipt(value) || value.commandId !== payload.commandId) {
            if (isPageActionReceipt(value) && value.commandId !== payload.commandId) return
            cleanup()
            resolve({ commandId: payload.commandId, state: 'failed', contextVersion: typeof payload.contextVersion === 'number' ? payload.contextVersion : -1, message: '页面返回了无效操作回执' })
            return
          }
          cleanup()
          resolve(value)
        } catch {
          cleanup()
          resolve({ commandId: payload.commandId, state: 'failed', contextVersion: typeof payload.contextVersion === 'number' ? payload.contextVersion : -1, message: '页面返回了无效操作回执' })
        }
      }
      for (const bridge of bridges) {
        bridge.on('message', onMessage)
        if (bridge.readyState === 1) bridge.send(JSON.stringify(payload))
      }
    })
  }

  private issueSession(principal: SppmPrincipal, instance: ManagedHarnessInstance, authorization?: string): BrowserSession {
    const token = randomUUID()
    const session: BrowserSession = {
      token,
      principal,
      ...(authorization === undefined ? {} : { authorization }),
      userId: principal.userId,
      instanceId: instance.instanceId,
      expiresAt: Date.now() + SESSION_TTL_MS,
    }
    this.sessions.set(token, session)
    return session
  }

  /** Re-check the signed-in SPPM identity before serving a cookie-authenticated request. */
  private async revalidateSession(session: BrowserSession, request: IncomingMessage): Promise<SppmPrincipal | null> {
    if (session.authorization === undefined) return session.principal
    const previousAuthorization = request.headers.authorization
    request.headers.authorization = session.authorization
    let principal: SppmPrincipal | null
    try {
      principal = await this.config.authenticate(request)
    } finally {
      if (previousAuthorization === undefined) delete request.headers.authorization
      else request.headers.authorization = previousAuthorization
    }
    if (principal === null || principal.userId !== session.userId) {
      await this.revokeSession(session)
      return null
    }
    session.principal = principal
    return principal
  }

  /** Revoke one browser session and stop its user instance when no tab remains. */
  private async revokeSession(session: BrowserSession): Promise<void> {
    this.sessions.delete(session.token)
    if ([...this.sessions.values()].some(candidate => candidate.userId === session.userId)) return
    await this.config.instances.release(session.userId)
    const byBrowser = this.pageBridges.get(session.userId)
    if (byBrowser !== undefined) {
      for (const bridges of byBrowser.values()) for (const bridge of bridges) bridge.close(1008, 'session revoked')
      this.pageBridges.delete(session.userId)
    }
  }

  private readSession(request: IncomingMessage): BrowserSession | undefined {
    const raw = parseCookies(request.headers.cookie)[this.cookieName]
    if (raw === undefined) return undefined
    const separator = raw.lastIndexOf('.')
    if (separator <= 0) return undefined
    const token = raw.slice(0, separator)
    const signature = raw.slice(separator + 1)
    if (sign(token, this.config.cookieSecret) !== signature) return undefined
    const session = this.sessions.get(token)
    if (session === undefined || session.expiresAt <= Date.now()) {
      this.sessions.delete(token)
      return undefined
    }
    return session
  }

  private writeCors(request: IncomingMessage, response: ServerResponse): void {
    const origin = request.headers.origin
    if (origin !== undefined && this.config.allowedOrigins?.includes(origin)) {
      response.setHeader('access-control-allow-origin', origin)
      response.setHeader('access-control-allow-credentials', 'true')
      response.setHeader('vary', 'origin')
    }
    response.setHeader('access-control-allow-methods', 'GET,POST,PUT,DELETE,OPTIONS')
    response.setHeader('access-control-allow-headers', 'content-type, authorization, idempotency-key, x-sppm-instance-token, x-sppm-operation-id')
  }
}

async function readRequestBody(request: IncomingMessage, maxBytes = DEFAULT_CONTROL_REQUEST_BODY_BYTES): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += value.length
    if (size > maxBytes) {
      // Continue consuming the socket so a rejected request does not poison a
      // keep-alive connection that the browser may reuse for the next prompt.
      request.resume()
      throw new RequestBodyTooLargeError(maxBytes)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}
