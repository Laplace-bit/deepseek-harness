import { describe, expect, it } from 'vitest'
import { createPageCapabilityRegistry, isPageActionReceipt, isPageActionRequest, isPageContext } from '../src/index.ts'

describe('page capability registry', () => {
  it('accepts a JSON page context and rejects malformed wire data', () => {
    expect(isPageContext({
      protocolVersion: 1,
      browserInstanceId: 'browser-1',
      pageId: 'cardMgmt',
      contextVersion: 2,
      route: '/cards',
      title: 'Cards',
      capabilities: ['readPageContext'],
      fieldSchema: [{ key: 'deviceCode', label: 'Device' }],
      forms: [{ formId: 'process-card-header', formVersion: 1, title: 'Process card header', operation: 'create', draftSchema: 'sppm.process-card.header.v1', phase: 'header' }, { formId: 'process-card-parameters', formVersion: 1, title: 'Process card parameters', operation: 'edit', draftSchema: 'sppm.process-card.parameters.v1', phase: 'parameters', objectId: 42 }],
    })).toBe(true)
    expect(isPageContext({ browserInstanceId: 'browser-1', pageId: 'cardMgmt', contextVersion: 2, route: '/cards', title: 'Cards', capabilities: ['unknown'] })).toBe(false)
    expect(isPageContext({ browserInstanceId: 'browser-1', pageId: 'cardMgmt', contextVersion: -1, route: '/cards', title: 'Cards', capabilities: [] })).toBe(false)
    expect(isPageContext({ browserInstanceId: 'browser-1', pageId: 'cardMgmt', contextVersion: 2, route: '/cards', title: 'Cards', selection: { timeRange: ['start', 'end'] }, capabilities: [] })).toBe(false)
    expect(isPageContext({ browserInstanceId: 'browser-1', pageId: 'cardMgmt', contextVersion: 2, route: '/cards', title: 'Cards', forms: [{ formId: 'process-card', formVersion: 0, title: 'Process card', operation: 'create', draftSchema: 'sppm.process-card.v1' }], capabilities: [] })).toBe(false)
    expect(isPageContext({ browserInstanceId: 'browser-1', pageId: 'cardMgmt', contextVersion: 2, route: '/cards', title: 'Cards', forms: [{ formId: 'process-card', formVersion: 1, title: 'Process card', operation: 'edit', draftSchema: 'sppm.process-card.v1', objectId: {} }], capabilities: [] })).toBe(false)
  })

  it('validates discovery requests and structured receipts', () => {
    expect(isPageActionRequest({
      commandId: 'discover-1',
      userId: 'u-1',
      sessionId: '',
      browserInstanceId: 'browser-1',
      targetPageId: '',
      contextVersion: -1,
      action: 'readPageContext',
      args: {},
      issuedAt: 0,
      expiresAt: 100,
    })).toBe(true)
    expect(isPageActionRequest({
      commandId: 'write-1', userId: 'u-1', sessionId: '', browserInstanceId: 'browser-1', targetPageId: 'cardMgmt', contextVersion: 1, action: 'fillForm', args: {}, issuedAt: 0, expiresAt: 100,
    })).toBe(false)
    expect(isPageActionReceipt({ commandId: 'write-1', state: 'succeeded', contextVersion: 1, data: { saved: true } })).toBe(true)
    expect(isPageActionReceipt({ commandId: 'write-1', state: 'succeeded', contextVersion: 1, data: { circular: undefined } })).toBe(false)
  })

  it('routes Web-owned business actions only when the active page advertises them', async () => {
    const registry = createPageCapabilityRegistry(() => 100)
    let submitted = 0
    registry.register({
      pageId: 'cardMgmt',
      readContext: () => ({ browserInstanceId: 'browser-1', pageId: 'cardMgmt', contextVersion: 2, route: '/cards', title: 'Cards', capabilities: ['readBusinessContext', 'validateDraft', 'submitForm'] }),
      execute: async (request) => {
        if (request.action === 'submitForm') submitted += 1
        return { commandId: request.commandId, state: 'succeeded', contextVersion: 2 }
      },
    })
    const request = { commandId: 'business-1', userId: 'u-1', sessionId: 's-1', browserInstanceId: 'browser-1', targetPageId: 'cardMgmt', contextVersion: 2, action: 'submitForm' as const, args: {}, issuedAt: 0, expiresAt: 200 }
    await expect(registry.execute(request)).resolves.toMatchObject({ state: 'succeeded' })
    expect(submitted).toBe(1)
    await expect(registry.execute({ ...request, commandId: 'business-2', action: 'queryRecords' })).resolves.toMatchObject({ state: 'failed' })
  })

  it('resolves the current page context before the caller knows its page id or version', async () => {
    const registry = createPageCapabilityRegistry(() => 100)
    let executed = 0
    registry.register({
      pageId: 'cardMgmt',
      readContext: () => ({ browserInstanceId: 'browser-1', pageId: 'cardMgmt', contextVersion: 9, route: '/cards', title: 'Cards', capabilities: ['readBusinessContext'] }),
      execute: async (request) => { executed += 1; return { commandId: request.commandId, state: 'succeeded', contextVersion: 9 } },
    })
    const request = { commandId: 'ctx-1', userId: 'u-1', sessionId: '', browserInstanceId: 'browser-1', targetPageId: '', contextVersion: -1, action: 'readPageContext' as const, args: {}, issuedAt: 0, expiresAt: 200 }
    await expect(registry.execute(request)).resolves.toMatchObject({
      state: 'succeeded',
      contextVersion: 9,
      data: { context: { pageId: 'cardMgmt', browserInstanceId: 'browser-1', contextVersion: 9 } },
    })
    expect(executed).toBe(0)
  })

  it('fails context resolution when no registered page matches the browser instance', async () => {
    const registry = createPageCapabilityRegistry(() => 100)
    registry.register({
      pageId: 'cardMgmt',
      readContext: () => ({ browserInstanceId: 'browser-2', pageId: 'cardMgmt', contextVersion: 9, route: '/cards', title: 'Cards', capabilities: [] }),
      execute: async request => ({ commandId: request.commandId, state: 'succeeded', contextVersion: 9 }),
    })
    const request = { commandId: 'ctx-2', userId: 'u-1', sessionId: '', browserInstanceId: 'browser-1', targetPageId: '', contextVersion: -1, action: 'readPageContext' as const, args: {}, issuedAt: 0, expiresAt: 200 }
    await expect(registry.execute(request)).resolves.toMatchObject({ state: 'failed', message: '需要打开目标页面' })
  })

  it('rejects stale and duplicate commands before reaching a page', async () => {
    const registry = createPageCapabilityRegistry(() => 100)
    let calls = 0
    registry.register({
      pageId: 'cardMgmt',
      readContext: () => ({ browserInstanceId: 'browser-1', pageId: 'cardMgmt', contextVersion: 4, route: '/cards', title: 'Cards', capabilities: ['fillForm'] }),
      execute: async (request) => { calls += 1; return { commandId: request.commandId, state: 'succeeded', contextVersion: 4 } },
    })
    const request = { commandId: 'cmd-1', userId: 'u-1', sessionId: 's-1', browserInstanceId: 'browser-1', targetPageId: 'cardMgmt', contextVersion: 4, action: 'fillForm' as const, args: {}, issuedAt: 0, expiresAt: 200 }
    await expect(registry.execute(request)).resolves.toMatchObject({ state: 'succeeded' })
    await expect(registry.execute(request)).resolves.toMatchObject({ state: 'failed' })
    expect(calls).toBe(1)
    await expect(registry.execute({ ...request, commandId: 'cmd-2', contextVersion: 3 })).resolves.toMatchObject({ state: 'expired', contextVersion: 4 })
  })

  it('turns adapter exceptions and malformed receipts into explicit failures', async () => {
    const registry = createPageCapabilityRegistry(() => 100)
    registry.register({
      pageId: 'broken',
      readContext: () => ({ browserInstanceId: 'browser-1', pageId: 'broken', contextVersion: 1, route: '/broken', title: 'Broken', capabilities: ['fillForm'] }),
      execute: async () => { throw new Error('adapter unavailable') },
    })
    const request = { commandId: 'broken-1', userId: 'u-1', sessionId: 's-1', browserInstanceId: 'browser-1', targetPageId: 'broken', contextVersion: 1, action: 'fillForm' as const, args: {}, issuedAt: 0, expiresAt: 200 }
    await expect(registry.execute(request)).resolves.toMatchObject({ state: 'failed', message: 'adapter unavailable' })
    registry.invalidate('broken')
    registry.register({
      pageId: 'broken',
      readContext: () => ({ browserInstanceId: 'browser-1', pageId: 'broken', contextVersion: 1, route: '/broken', title: 'Broken', capabilities: ['fillForm'] }),
      execute: async () => ({ commandId: 'wrong', state: 'unknown' as never, contextVersion: 1 }),
    })
    await expect(registry.execute({ ...request, commandId: 'broken-2' })).resolves.toMatchObject({ state: 'failed', message: '页面返回了无效操作回执' })
  })

  it('rejects malformed contexts before invoking a page adapter', async () => {
    const registry = createPageCapabilityRegistry(() => 100)
    let calls = 0
    registry.register({
      pageId: 'malformed',
      readContext: () => ({ browserInstanceId: 'browser-1', pageId: 'malformed', contextVersion: 1, route: '/malformed', title: 'Malformed', capabilities: ['fillForm'], form: { invalid: undefined } }) as never,
      execute: async () => { calls += 1; return { commandId: 'malformed-1', state: 'succeeded', contextVersion: 1 } },
    })
    await expect(registry.execute({ commandId: 'malformed-1', userId: 'u-1', sessionId: 's-1', browserInstanceId: 'browser-1', targetPageId: 'malformed', contextVersion: 1, action: 'fillForm', args: {}, issuedAt: 0, expiresAt: 200 })).resolves.toMatchObject({ state: 'failed', message: '页面上下文格式无效' })
    expect(calls).toBe(0)
  })

  it('fails closed when a page advertises an incompatible protocol version', async () => {
    const registry = createPageCapabilityRegistry(() => 100)
    registry.register({
      pageId: 'old-page',
      readContext: () => ({ protocolVersion: 99, browserInstanceId: 'browser-1', pageId: 'old-page', contextVersion: 1, route: '/old', title: 'Old', capabilities: ['fillForm'] }),
      execute: async request => ({ commandId: request.commandId, state: 'succeeded', contextVersion: 1 }),
    })
    await expect(registry.execute({ commandId: 'version-1', userId: 'u-1', sessionId: 's-1', browserInstanceId: 'browser-1', targetPageId: 'old-page', contextVersion: 1, action: 'fillForm', args: {}, issuedAt: 0, expiresAt: 200 })).resolves.toMatchObject({
      state: 'failed',
      message: '页面桥接协议版本不匹配，请刷新页面',
    })
  })
  it('waits for the page adapter before reading context or executing an action', async () => {
    const registry = createPageCapabilityRegistry(() => 100)
    let ready = false
    let calls = 0
    registry.register({
      pageId: 'slow-page',
      readContext: () => ({ browserInstanceId: 'browser-1', pageId: 'slow-page', contextVersion: ready ? 2 : 1, route: '/slow', title: 'Slow', capabilities: ['fillForm'] }),
      waitForReady: async () => { ready = true },
      execute: async () => { calls += 1; return { commandId: 'ignored', state: 'succeeded', contextVersion: 2 } },
    })
    const request = { commandId: 'ready-1', userId: 'u-1', sessionId: 's-1', browserInstanceId: 'browser-1', targetPageId: 'slow-page', contextVersion: 2, action: 'fillForm' as const, args: {}, issuedAt: 0, expiresAt: 200 }
    await expect(registry.execute(request)).resolves.toMatchObject({ state: 'succeeded', contextVersion: 2 })
    expect(calls).toBe(1)
  })

  it('routes global menu actions through the host without waiting for a business form', async () => {
    const registry = createPageCapabilityRegistry(() => 100)
    let hostCalls = 0
    registry.register({
      pageId: 'sppmHost',
      readContext: () => ({ browserInstanceId: 'browser-1', pageId: 'sppmHost', contextVersion: 8, route: '/cards', title: 'SPPM', capabilities: ['searchRoutes', 'navigateTo'] }),
      execute: async (request) => { hostCalls += 1; return { commandId: request.commandId, state: 'succeeded', contextVersion: 8 } },
    })
    registry.register({
      pageId: 'cardMgmt',
      readContext: () => ({ browserInstanceId: 'browser-1', pageId: 'cardMgmt', contextVersion: 2, route: '/cards', title: 'Cards', capabilities: ['searchRoutes'] }),
      waitForReady: async () => { throw new Error('form is still loading') },
      execute: async request => ({ commandId: request.commandId, state: 'succeeded', contextVersion: 2 }),
    })
    const request = { commandId: 'routes-1', userId: 'u-1', sessionId: 's-1', browserInstanceId: 'browser-1', targetPageId: 'cardMgmt', contextVersion: 2, action: 'searchRoutes' as const, args: { query: '工艺卡' }, issuedAt: 0, expiresAt: 200 }
    await expect(registry.execute(request)).resolves.toMatchObject({ state: 'succeeded', contextVersion: 8 })
    expect(hostCalls).toBe(1)
    await expect(registry.execute({ ...request, commandId: 'routes-2', browserInstanceId: 'browser-2' })).resolves.toMatchObject({ state: 'expired' })
  })
})
