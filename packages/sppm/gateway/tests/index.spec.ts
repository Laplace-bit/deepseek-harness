import { describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocket } from 'ws'
import { HarnessInstanceManager, InstanceCapacityError, SppmGateway } from '../src/index.ts'

describe('HarnessInstanceManager', () => {
  it('shares one instance per user and enforces the trial capacity', async () => {
    let started = 0
    const manager = new HarnessInstanceManager(1, async principal => ({
      userId: principal.userId,
      instanceId: `i-${++started}`,
      endpoint: 'http://127.0.0.1:1',
      internalToken: `token-${started}`,
      harnessCookie: `dsh-auth-test-${started}=cookie`,
      stop: async () => undefined,
    }))
    const principal = { userId: 'u-1', roles: [] }
    expect(await manager.acquire(principal)).toMatchObject({ instanceId: 'i-1' })
    expect(await manager.acquire(principal)).toMatchObject({ instanceId: 'i-1' })
    await expect(manager.acquire({ userId: 'u-2', roles: [] })).rejects.toBeInstanceOf(InstanceCapacityError)
    expect(manager.size()).toBe(1)
  })

  it('renews a stale browser session after the SPPM bearer changes', async () => {
    let acceptedBearer = 'old-token'
    const instances = new HarnessInstanceManager(1, async principal => ({
      userId: principal.userId,
      instanceId: 'i-1',
      endpoint: 'http://127.0.0.1:1',
      internalToken: 'internal',
      harnessCookie: 'dsh-auth-test=cookie',
      stop: async () => undefined,
    }))
    const gateway = new SppmGateway({
      host: '127.0.0.1',
      port: 0,
      cookieSecret: 'test-cookie-secret',
      instances,
      authenticate: async request => request.headers.authorization === `Bearer ${acceptedBearer}`
        ? { userId: 'u-1', roles: [] }
        : null,
    })
    const server = await gateway.listen()
    const address = server.address() as AddressInfo
    const endpoint = `http://127.0.0.1:${String(address.port)}/api/sppm/v1/session`
    try {
      const initial = await fetch(endpoint, { method: 'POST', headers: { authorization: 'Bearer old-token' } })
      expect(initial.status).toBe(200)
      const cookie = initial.headers.get('set-cookie')?.split(';', 1)[0]
      expect(cookie).toBeDefined()

      acceptedBearer = 'new-token'
      const renewed = await fetch(endpoint, {
        method: 'POST',
        headers: { authorization: 'Bearer new-token', cookie: cookie as string },
      })
      expect(renewed.status).toBe(200)
      expect((await renewed.json() as { userId?: string }).userId).toBe('u-1')
    } finally {
      await gateway.close()
    }
  })

  it('does not expose model configuration or model-provider proxy routes', async () => {
    const gateway = new SppmGateway({
      host: '127.0.0.1',
      port: 0,
      cookieSecret: 'test-cookie-secret',
      instances: new HarnessInstanceManager(1, async principal => ({
        userId: principal.userId,
        instanceId: 'i-1',
        endpoint: 'http://127.0.0.1:1',
        internalToken: 'internal',
        harnessCookie: 'dsh-auth-test=cookie',
        stop: async () => undefined,
      })),
      authenticate: async () => null,
    })
    const server = await gateway.listen()
    const address = server.address() as AddressInfo
    try {
      for (const path of ['/api/sppm/v1/admin/models', '/api/sppm/v1/model/chat/completions', '/api/sppm/v1/business/context']) {
        const response = await fetch(`http://127.0.0.1:${String(address.port)}${path}`)
        expect(response.status).toBe(404)
      }
    } finally {
      await gateway.close()
    }
  })

  it('forwards image-sized Harness requests instead of treating them as unavailable', async () => {
    let upstreamHits = 0
    const upstream = createServer((request, response) => {
      upstreamHits += 1
      request.resume()
      response.end('upstream reached')
    })
    await new Promise<void>((resolve, reject) => {
      upstream.once('error', reject)
      upstream.listen(0, '127.0.0.1', () => { resolve() })
    })
    const upstreamAddress = upstream.address() as AddressInfo
    const instances = new HarnessInstanceManager(1, async principal => ({
      userId: principal.userId,
      instanceId: 'i-1',
      endpoint: `http://127.0.0.1:${String(upstreamAddress.port)}`,
      internalToken: 'internal',
      harnessCookie: 'dsh-auth-test=cookie',
      stop: async () => undefined,
    }))
    const gateway = new SppmGateway({
      host: '127.0.0.1',
      port: 0,
      cookieSecret: 'test-cookie-secret',
      instances,
      authenticate: async () => ({ userId: 'u-1', roles: [] }),
    })
    const server = await gateway.listen()
    const address = server.address() as AddressInfo
    try {
      const session = await fetch(`http://127.0.0.1:${String(address.port)}/api/sppm/v1/session`, { method: 'POST' })
      const cookie = session.headers.get('set-cookie')?.split(';', 1)[0]
      expect(cookie).toBeDefined()

      const response = await fetch(`http://127.0.0.1:${String(address.port)}/api/chat`, {
        method: 'POST',
        headers: { cookie: cookie as string, 'content-type': 'application/json' },
        body: JSON.stringify({ image: 'x'.repeat(300 * 1024) }),
      })
      expect(response.status).toBe(200)
      await expect(response.text()).resolves.toBe('upstream reached')
      expect(upstreamHits).toBe(1)
    } finally {
      await gateway.close()
      await new Promise<void>((resolve, reject) => { upstream.close(error => error === undefined ? resolve() : reject(error)) })
    }
  })

  it('reports an oversized Harness request as 413 without contacting the child', async () => {
    let upstreamHits = 0
    const upstream = createServer((_request, response) => {
      upstreamHits += 1
      response.end('upstream reached')
    })
    await new Promise<void>((resolve, reject) => {
      upstream.once('error', reject)
      upstream.listen(0, '127.0.0.1', () => { resolve() })
    })
    const upstreamAddress = upstream.address() as AddressInfo
    const gateway = new SppmGateway({
      host: '127.0.0.1',
      port: 0,
      cookieSecret: 'test-cookie-secret',
      maxHarnessRequestBodyBytes: 1024,
      instances: new HarnessInstanceManager(1, async principal => ({
        userId: principal.userId,
        instanceId: 'i-1',
        endpoint: `http://127.0.0.1:${String(upstreamAddress.port)}`,
        internalToken: 'internal',
        harnessCookie: 'dsh-auth-test=cookie',
        stop: async () => undefined,
      })),
      authenticate: async () => ({ userId: 'u-1', roles: [] }),
    })
    const server = await gateway.listen()
    const address = server.address() as AddressInfo
    try {
      const session = await fetch(`http://127.0.0.1:${String(address.port)}/api/sppm/v1/session`, { method: 'POST' })
      const cookie = session.headers.get('set-cookie')?.split(';', 1)[0]
      expect(cookie).toBeDefined()

      const response = await fetch(`http://127.0.0.1:${String(address.port)}/api/chat`, {
        method: 'POST',
        headers: { cookie: cookie as string, 'content-type': 'application/json' },
        body: 'x'.repeat(2048),
      })
      expect(response.status).toBe(413)
      await expect(response.json()).resolves.toMatchObject({ error: 'request_body_too_large', limit: 1024 })
      expect(upstreamHits).toBe(0)
    } finally {
      await gateway.close()
      await new Promise<void>((resolve, reject) => { upstream.close(error => error === undefined ? resolve() : reject(error)) })
    }
  })

  it('advertises the global route capabilities to the Web host', async () => {
    const gateway = new SppmGateway({
      host: '127.0.0.1',
      port: 0,
      cookieSecret: 'test-cookie-secret',
      instances: new HarnessInstanceManager(1, async principal => ({
        userId: principal.userId,
        instanceId: 'i-1',
        endpoint: 'http://127.0.0.1:1',
        internalToken: 'internal',
        harnessCookie: 'dsh-auth-test=cookie',
        stop: async () => undefined,
      })),
      authenticate: async request => request.headers.authorization === 'Bearer sp-token' ? { userId: 'u-1', roles: [] } : null,
    })
    const server = await gateway.listen()
    const address = server.address() as AddressInfo
    try {
      const response = await fetch(`http://127.0.0.1:${String(address.port)}/api/sppm/v1/capabilities`, { headers: { authorization: 'Bearer sp-token' } })
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({ actions: expect.arrayContaining(['searchRoutes', 'navigateTo']) })
    } finally {
      await gateway.close()
    }
  })

  it('resolves the active page context through the browser bridge', async () => {
    const instances = new HarnessInstanceManager(1, async principal => ({
      userId: principal.userId,
      instanceId: 'i-1',
      endpoint: 'http://127.0.0.1:1',
      internalToken: 'internal',
      harnessCookie: 'dsh-auth-test=cookie',
      stop: async () => undefined,
    }))
    const gateway = new SppmGateway({
      host: '127.0.0.1',
      port: 0,
      cookieSecret: 'test-cookie-secret',
      instances,
      authenticate: async request => request.headers.authorization === 'Bearer sp-token'
        ? { userId: 'u-1', roles: [] }
        : null,
    })
    const server = await gateway.listen()
    const address = server.address() as AddressInfo
    const base = `http://127.0.0.1:${String(address.port)}`
    let bridge: WebSocket | undefined
    try {
      const session = await fetch(`${base}/api/sppm/v1/session`, { method: 'POST', headers: { authorization: 'Bearer sp-token' } })
      const cookie = session.headers.get('set-cookie')?.split(';', 1)[0] as string
      bridge = new WebSocket(`${base.replace('http', 'ws')}/api/sppm/v1/page-bridge?browserInstanceId=browser-1`, { headers: { cookie } })
      bridge.on('message', ((raw: Buffer) => {
        const request = JSON.parse(raw.toString()) as { commandId: string }
        expect(request).toMatchObject({ action: 'readPageContext', browserInstanceId: 'browser-1' })
        bridge?.send(JSON.stringify({
          commandId: request.commandId,
          state: 'succeeded',
          contextVersion: 6,
          data: { context: { browserInstanceId: 'browser-1', pageId: 'cardMgmt', contextVersion: 6, route: '/cards', title: 'Cards', capabilities: ['readPageContext'] } },
        }))
      }) as (data: import('ws').RawData) => void)
      await new Promise<void>((resolve, reject) => {
        bridge?.once('open', () => { resolve() })
        bridge?.once('error', reject)
      })
      const response = await fetch(`${base}/api/sppm/v1/page-context`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-sppm-instance-token': 'internal' },
        body: '{}',
      })
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({ state: 'succeeded', contextVersion: 6, data: { context: { pageId: 'cardMgmt' } } })
    } finally {
      bridge?.close()
      await gateway.close()
    }
  })

  it('rejects page context resolution without an active browser bridge', async () => {
    const instances = new HarnessInstanceManager(1, async principal => ({
      userId: principal.userId,
      instanceId: 'i-1',
      endpoint: 'http://127.0.0.1:1',
      internalToken: 'internal',
      harnessCookie: 'dsh-auth-test=cookie',
      stop: async () => undefined,
    }))
    await instances.acquire({ userId: 'u-1', roles: [] })
    const gateway = new SppmGateway({
      host: '127.0.0.1',
      port: 0,
      cookieSecret: 'test-cookie-secret',
      instances,
      authenticate: async () => null,
    })
    const server = await gateway.listen()
    const address = server.address() as AddressInfo
    try {
      const response = await fetch(`http://127.0.0.1:${String(address.port)}/api/sppm/v1/page-context`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-sppm-instance-token': 'internal' },
        body: '{}',
      })
      expect(response.status).toBe(409)
      await expect(response.json()).resolves.toMatchObject({ error: 'page_bridge_unavailable' })
    } finally {
      await gateway.close()
    }
  })

  it('rejects malformed receipts from the browser bridge', async () => {
    const instances = new HarnessInstanceManager(1, async principal => ({
      userId: principal.userId,
      instanceId: 'i-1',
      endpoint: 'http://127.0.0.1:1',
      internalToken: 'internal',
      harnessCookie: 'dsh-auth-test=cookie',
      stop: async () => undefined,
    }))
    const gateway = new SppmGateway({
      host: '127.0.0.1',
      port: 0,
      cookieSecret: 'test-cookie-secret',
      instances,
      authenticate: async request => request.headers.authorization === 'Bearer sp-token' ? { userId: 'u-1', roles: [] } : null,
    })
    const server = await gateway.listen()
    const address = server.address() as AddressInfo
    const base = `http://127.0.0.1:${String(address.port)}`
    let bridge: WebSocket | undefined
    try {
      const session = await fetch(`${base}/api/sppm/v1/session`, { method: 'POST', headers: { authorization: 'Bearer sp-token' } })
      const cookie = session.headers.get('set-cookie')?.split(';', 1)[0] as string
      bridge = new WebSocket(`${base.replace('http', 'ws')}/api/sppm/v1/page-bridge?browserInstanceId=browser-1`, { headers: { cookie } })
      bridge.on('message', ((raw: Buffer) => {
        const request = JSON.parse(raw.toString()) as { commandId: string }
        expect(request).toMatchObject({ userId: 'u-1' })
        bridge?.send(JSON.stringify({ commandId: request.commandId, state: 'succeeded' }))
      }) as (data: import('ws').RawData) => void)
      await new Promise<void>((resolve, reject) => {
        bridge?.once('open', () => { resolve() })
        bridge?.once('error', reject)
      })
      const response = await fetch(`${base}/api/sppm/v1/page-actions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-sppm-instance-token': 'internal' },
        body: JSON.stringify({ commandId: 'malformed-1', userId: 'unknown', sessionId: '', browserInstanceId: 'browser-1', targetPageId: '', contextVersion: -1, action: 'readPageContext', args: {}, issuedAt: Date.now(), expiresAt: Date.now() + 1000 }),
      })
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({ state: 'failed', message: '页面返回了无效操作回执' })
    } finally {
      bridge?.close()
      await gateway.close()
    }
  })
})
