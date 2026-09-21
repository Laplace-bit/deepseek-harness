import { mkdir } from 'node:fs/promises'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_MAX_HARNESS_REQUEST_BODY_BYTES, HarnessInstanceManager, SppmGateway, type HarnessInstanceFactory, type ManagedHarnessInstance } from './index.ts'
import { parseSppmIdentity } from './identity.ts'
import { installSppmDefaultSkills } from './default-skills.ts'

const instanceRoot = process.env.SPPM_INSTANCE_ROOT
  ?? (process.env.NODE_ENV === 'production' ? '/var/lib/sppm/harness' : join(process.cwd(), '.data', 'sppm-harness'))
const harnessEntry = process.env.SPPM_HARNESS_ENTRY
if (harnessEntry === undefined || harnessEntry.trim() === '') throw new Error('SPPM_HARNESS_ENTRY must point to the pinned Harness entry')
const authIntrospectionUrl = process.env.SPPM_AUTH_INTROSPECTION_URL
const sppmProfilePatch = new URL('../../profile/cordis.patch.yml', import.meta.url).pathname
// Instances run from their private DSH_HOME, so a bare `tsx/esm` specifier
// would be resolved against that directory and the child would exit before it
// can announce the Harness URL. Resolve the loader from this fixed install.
const tsxLoader = createRequire(import.meta.url).resolve('tsx/esm')
const harnessRoot = fileURLToPath(new URL('../../../..', import.meta.url))
const gatewayInternalUrl = process.env.SPPM_GATEWAY_INTERNAL_URL ?? `http://127.0.0.1:${String(Number(process.env.SPPM_GATEWAY_PORT ?? 3180))}`
const maxHarnessRequestBodyBytes = Number(process.env.SPPM_MAX_HARNESS_REQUEST_BODY_BYTES ?? DEFAULT_MAX_HARNESS_REQUEST_BODY_BYTES)
if (!Number.isSafeInteger(maxHarnessRequestBodyBytes) || maxHarnessRequestBodyBytes <= 0) {
  throw new Error('SPPM_MAX_HARNESS_REQUEST_BODY_BYTES must be a positive safe integer')
}

const HARNESS_READY_TIMEOUT_MS = 90_000
const children = new Set<ChildProcess>()
let shuttingDown = false

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => { child.kill('SIGKILL') }, 5_000)
    child.once('exit', () => { clearTimeout(timer); resolve() })
    child.kill('SIGTERM')
  })
}

function resolveAuthorization(request: import('node:http').IncomingMessage): string | undefined {
  const direct = typeof request.headers.authorization === 'string'
    ? request.headers.authorization.trim()
    : ''
  if (direct !== '') return /^Bearer\s+/iu.test(direct) ? direct : `Bearer ${direct}`

  const legacyHeader = typeof request.headers['x-access-token'] === 'string'
    ? request.headers['x-access-token'].trim()
    : ''
  if (legacyHeader !== '') return /^Bearer\s+/iu.test(legacyHeader) ? legacyHeader : `Bearer ${legacyHeader}`

  // The Vue host stores the SPPM login token in Admin-Token.  Browsers do not
  // consistently expose that cookie to an embedded request's JavaScript, but
  // they do send it to the same-origin gateway.  Translate it server-side so
  // the Java introspection endpoint receives the same Bearer contract as the
  // rest of the SPPM API.
  const cookieHeader = typeof request.headers.cookie === 'string' ? request.headers.cookie : ''
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0 || part.slice(0, separator).trim() !== 'Admin-Token') continue
    const value = part.slice(separator + 1).trim()
    if (value === '') return undefined
    try {
      const token = decodeURIComponent(value)
      return `Bearer ${token}`
    } catch {
      return `Bearer ${value}`
    }
  }
  return undefined
}

function redactHarnessOutput(value: string): string {
  return value.replace(/([?&]token=)[^\s)]+/gu, '$1<redacted>')
}

/**
 * `dsh web` deliberately mints a browser cookie from a one-time launch URL.
 * The child is private to the gateway, so exchange that URL once and keep the
 * resulting cookie in memory for all subsequent HTTP and WebSocket proxying.
 */
async function waitForHarnessCookie(child: ChildProcess, port: number): Promise<string> {
  let output = ''
  let launchSeen = false
  let settled = false
  const append = (chunk: Buffer | string): void => {
    output = `${output}${String(chunk)}`.slice(-32_000)
    if (settled || launchSeen) return
    const match = /dsh web:\s+(http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s)]+)/u.exec(output)
    if (match?.[1] === undefined) return
    let launch: URL
    try {
      launch = new URL(match[1])
    } catch {
      return
    }
    if (launch.hostname !== '127.0.0.1' || Number(launch.port) !== port || launch.searchParams.get('token') === null) return
    launchSeen = true
    void (async (): Promise<void> => {
      try {
        const exchange = await fetch(launch, { redirect: 'manual' })
        if (exchange.status !== 303 && exchange.status !== 302) {
          throw new Error(`Harness browser authentication returned HTTP ${String(exchange.status)}`)
        }
        const setCookie = exchange.headers.get('set-cookie')
        const cookie = setCookie?.split(';', 1)[0]?.trim()
        if (cookie === undefined || cookie.length < 1) throw new Error('Harness browser authentication did not set a cookie')
        if (settled) return
        settled = true
        clearTimeout(timer)
        child.stdout?.off('data', append)
        child.stderr?.off('data', append)
        resolveCookie?.(cookie)
      } catch (error) {
        if (settled) return
        settled = true
        clearTimeout(timer)
        child.stdout?.off('data', append)
        child.stderr?.off('data', append)
        rejectCookie?.(error instanceof Error ? error : new Error(String(error)))
      }
    })()
  }

  let resolveCookie: ((cookie: string) => void) | undefined
  let rejectCookie: ((error: Error) => void) | undefined
  const promise = new Promise<string>((resolve, reject) => {
    resolveCookie = resolve
    rejectCookie = reject
  })
  const fail = (error: Error): void => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    child.stdout?.off('data', append)
    child.stderr?.off('data', append)
    rejectCookie?.(error)
  }
  const timer = setTimeout(() => {
    fail(new Error(`Harness did not announce its authenticated URL within ${String(HARNESS_READY_TIMEOUT_MS)}ms:\n${redactHarnessOutput(output)}`))
  }, HARNESS_READY_TIMEOUT_MS)
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', append)
  child.stderr?.on('data', append)
  child.once('error', (error) => { fail(error) })
  child.once('exit', (code) => { fail(new Error(`Harness exited before readiness (code ${String(code)}):\n${redactHarnessOutput(output)}`)) })
  return promise
}

const factory: HarnessInstanceFactory = async (principal): Promise<ManagedHarnessInstance> => {
  if (shuttingDown) throw new Error('SPPM gateway is shutting down')
  const safeUser = principal.userId.replace(/[^a-zA-Z0-9_-]/g, '_')
  const dataDirectory = join(instanceRoot, safeUser)
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 })
  await installSppmDefaultSkills(dataDirectory)
  if (shuttingDown) throw new Error('SPPM gateway is shutting down')
  const port = 3400 + Math.floor(Math.random() * 1000)
  const internalToken = randomUUID()
  const child = spawn(process.execPath, [
    '--import', tsxLoader, harnessEntry, '--profile', 'web', '--patch', sppmProfilePatch,
    '--no-open', '--host', '127.0.0.1', '--port', String(port),
  ], {
    cwd: dataDirectory,
    env: {
      ...process.env,
      DSH_HOME: dataDirectory,
      DSH_WEB_PORT: String(port),
      SPPM_USER_ID: principal.userId,
      SPPM_INSTANCE_TOKEN: internalToken,
      SPPM_PAGE_ACTION_URL: `${gatewayInternalUrl}/api/sppm/v1/page-actions`,
      SPPM_PAGE_CONTEXT_URL: `${gatewayInternalUrl}/api/sppm/v1/page-context`,
      // Deliberately do not inject DEEPSEEK_* model credentials here. The
      // native Harness settings and credential store are the sole model
      // configuration source for this private instance.
      // Keep the source checkout's path aliases active even though the
      // process cwd is the user's private DSH_HOME. Without this, tsx loads
      // the prebuilt Cordis package, whose const-enum FiberState is not a
      // runtime export, and the child exits before Web startup.
      TSX_TSCONFIG_PATH: join(harnessRoot, 'tsconfig.json'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.add(child)
  child.once('exit', () => { children.delete(child) })
  child.once('error', () => { if (child.pid === undefined) children.delete(child) })
  try {
    const harnessCookie = await waitForHarnessCookie(child, port)
    if (shuttingDown) throw new Error('SPPM gateway is shutting down')
    return {
      userId: principal.userId,
      instanceId: `harness-${safeUser}-${child.pid ?? Date.now()}`,
      endpoint: `http://127.0.0.1:${port}`,
      internalToken,
      harnessCookie,
      stop: () => stopChild(child),
    }
  } catch (error) {
    await stopChild(child)
    throw error
  }
}

const instances = new HarnessInstanceManager(10, factory)
const gatewayConfig = {
  host: process.env.SPPM_GATEWAY_HOST ?? '127.0.0.1',
  port: Number(process.env.SPPM_GATEWAY_PORT ?? 3180),
  cookieSecret: process.env.SPPM_GATEWAY_COOKIE_SECRET ?? '',
  secureCookie: process.env.SPPM_SECURE_COOKIE !== 'false',
  maxHarnessRequestBodyBytes,
  allowedOrigins: (process.env.SPPM_ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean),
  instances,
  authenticate: async (request) => {
    const authorization = resolveAuthorization(request)
    if (authorization !== undefined) request.headers.authorization = authorization
    const token = authorization?.replace(/^Bearer\s+/i, '').trim()
    if (!token || !authIntrospectionUrl) return null
    try {
      const response = await fetch(authIntrospectionUrl, { headers: { authorization: `Bearer ${token}` } })
      if (!response.ok) return null
      return parseSppmIdentity(await response.json())
    } catch (_error) {
      return null
    }
  },
} satisfies ConstructorParameters<typeof SppmGateway>[0]
const gateway = new SppmGateway(gatewayConfig)

if (!process.env.SPPM_GATEWAY_COOKIE_SECRET) throw new Error('SPPM_GATEWAY_COOKIE_SECRET must be configured')
await gateway.listen()
async function shutdown(): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  const deadline = setTimeout(() => {
    for (const child of children) child.kill('SIGKILL')
    console.error('SPPM shutdown timed out')
    process.exit(1)
  }, 8_000)
  try {
    await Promise.all([...children].map(stopChild))
    await gateway.close()
    clearTimeout(deadline)
    process.exit(0)
  } catch (error) {
    clearTimeout(deadline)
    console.error('SPPM shutdown failed', error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
process.on('SIGINT', () => { void shutdown() })
process.on('SIGTERM', () => { void shutdown() })
console.log(`SPPM gateway listening on ${process.env.SPPM_GATEWAY_HOST ?? '127.0.0.1'}:${process.env.SPPM_GATEWAY_PORT ?? '3180'}`)
