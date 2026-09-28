import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { SPPM_PAGE_BRIDGE_ACTIONS } from '@deepseek-ai/dsh-sppm-page-bridge'
import { apply, type PageActionTransport } from '../src/index.ts'


function fakeHarness(): {
  context: Context
  tools: Map<string, ToolDefinition>
  skills: Map<string, unknown>
} {
  const tools = new Map<string, ToolDefinition>()
  const skills = new Map<string, unknown>()
  const context = {
    reflect: { provide: () => undefined },
    tools: {
      register: (tool: ToolDefinition) => {
        tools.set(tool.name, tool)
        return () => { tools.delete(tool.name) }
      },
    },
  }
  return { context: context as unknown as Context, tools, skills }
}

function toolNamed(tools: Map<string, ToolDefinition>, name: string): ToolDefinition {
  const tool = tools.get(name)
  if (tool === undefined) throw new Error(`missing tool ${name}`)
  return tool
}

function execution(): ToolRunContext {
  return { agent: { id: 'agent-1' } } as unknown as ToolRunContext
}

function contextReceipt(capabilities: string[] = ['readPageContext']) {
  return {
    commandId: 'resolution',
    state: 'succeeded' as const,
    contextVersion: 3,
    data: {
      context: { browserInstanceId: 'browser-1', pageId: 'cardMgmt', contextVersion: 3, route: '/cards', title: 'Cards', capabilities },
    },
  }
}

describe('SPPM page action tools', () => {
  it('does not register a runtime skill provider or semantic pre-step loader', () => {
    const transport: PageActionTransport = {
      execute: async request => ({ commandId: request.commandId, state: 'succeeded', contextVersion: request.contextVersion }),
      resolveContext: async () => contextReceipt(),
    }
    const { context, skills } = fakeHarness()
    apply(context, { transport })
    expect(skills.size).toBe(0)
  })

  it('registers exactly the protocol action list and rejects generic arguments', async () => {
    let executed = 0
    const transport: PageActionTransport = {
      execute: async (request) => { executed += 1; return { commandId: request.commandId, state: 'succeeded', contextVersion: request.contextVersion } },
      resolveContext: async () => contextReceipt(['searchRoutes']),
    }
    const { context, tools } = fakeHarness()
    apply(context, { transport })
    expect([...tools.keys()].sort()).toEqual(SPPM_PAGE_BRIDGE_ACTIONS.map(action => `sppm_${action}`).sort())
    await expect(toolNamed(tools, 'sppm_searchRoutes').execute({ payload: { query: '工艺卡' } }, execution())).resolves.toMatchObject({ state: 'failed', message: '工具参数未在协议中定义' })
    expect(executed).toBe(0)
  })

  it('rejects malformed transport receipts before returning them to the Agent', async () => {
    const transport: PageActionTransport = {
      execute: async () => ({ commandId: 'wrong', state: 'succeeded', contextVersion: 1 } as never),
      resolveContext: async () => contextReceipt(['readBusinessContext']),
    }
    const { context, tools } = fakeHarness()
    apply(context, { transport })
    await expect(toolNamed(tools, 'sppm_readBusinessContext').execute({}, execution())).resolves.toMatchObject({ state: 'failed', message: '页面桥接回执与指令不匹配' })
  })

  it('resolves the current page when the model omits its identifiers', async () => {
    const requests: unknown[] = []
    const transport: PageActionTransport = {
      execute: async (request) => {
        requests.push(request)
        return { commandId: request.commandId, state: 'succeeded', contextVersion: request.contextVersion }
      },
      resolveContext: async () => contextReceipt(['readBusinessContext']),
    }
    const { context, tools } = fakeHarness()
    apply(context, { transport })
    const result = await toolNamed(tools, 'sppm_readBusinessContext').execute({}, execution())
    expect(result).toMatchObject({ state: 'succeeded' })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ action: 'readBusinessContext', browserInstanceId: 'browser-1', targetPageId: 'cardMgmt', contextVersion: 3 })
  })

  it('returns the resolved context for readPageContext without a second round trip', async () => {
    let executed = 0
    const transport: PageActionTransport = {
      execute: async (request) => { executed += 1; return { commandId: request.commandId, state: 'succeeded', contextVersion: request.contextVersion } },
      resolveContext: async () => contextReceipt(),
    }
    const { context, tools } = fakeHarness()
    apply(context, { transport })
    const result = await toolNamed(tools, 'sppm_readPageContext').execute({}, execution())
    expect(result).toMatchObject({ data: { context: { pageId: 'cardMgmt' } } })
    expect(executed).toBe(0)
  })

  it('returns a structured failure when current-page discovery is unavailable', async () => {
    const transport: PageActionTransport = {
      execute: async () => ({ commandId: '', state: 'failed', contextVersion: -1 }),
      resolveContext: async () => ({ commandId: 'resolution', state: 'failed', contextVersion: -1, message: '需要打开目标业务页面' }),
    }
    const { context, tools } = fakeHarness()
    apply(context, { transport })
    await expect(toolNamed(tools, 'sppm_readBusinessContext').execute({}, execution())).resolves.toMatchObject({
      state: 'failed',
      message: '需要打开目标业务页面',
      nextAction: '打开目标业务页面或关闭多余标签页后重试',
    })
  })

  it('preflights unsupported actions and points the Agent to the required page', async () => {
    let executed = 0
    const transport: PageActionTransport = {
      execute: async (request) => {
        executed += 1
        return { commandId: request.commandId, state: 'succeeded', contextVersion: request.contextVersion }
      },
      resolveContext: async () => contextReceipt(['readPageContext']),
    }
    const { context, tools } = fakeHarness()
    apply(context, { transport })
    await expect(toolNamed(tools, 'sppm_queryRecords').execute({ limit: 10 }, execution())).resolves.toMatchObject({
      state: 'failed',
      message: '当前页面不支持 queryRecords',
      data: { pageId: 'cardMgmt', capabilities: ['readPageContext'], requiredAction: 'queryRecords' },
      nextAction: '先调用 sppm_searchRoutes 搜索点检记录页面，再使用返回的 href 和 routeVersion 调用 sppm_navigateTo',
    })
    expect(executed).toBe(0)
  })

  it('rejects a malformed discovered context before forwarding any action', async () => {
    let executed = 0
    const transport: PageActionTransport = {
      execute: async () => { executed += 1; return { commandId: '', state: 'succeeded', contextVersion: 1 } },
      resolveContext: async () => ({ commandId: 'resolution', state: 'succeeded', contextVersion: 1, data: { context: { pageId: 'cardMgmt', browserInstanceId: 'browser-1', contextVersion: 1 } } }),
    }
    const { context, tools } = fakeHarness()
    apply(context, { transport })
    await expect(toolNamed(tools, 'sppm_readPageContext').execute({}, execution())).resolves.toMatchObject({
      state: 'failed',
      message: '无法解析当前页面',
    })
    expect(executed).toBe(0)
  })

  it('keeps explicitly supplied identifiers without resolving', async () => {
    let resolved = 0
    const transport: PageActionTransport = {
      execute: async request => ({ commandId: request.commandId, state: 'succeeded', contextVersion: request.contextVersion }),
      resolveContext: async () => { resolved += 1; return { commandId: '', state: 'failed', contextVersion: -1 } },
    }
    const { context, tools } = fakeHarness()
    apply(context, { transport })
    const result = await toolNamed(tools, 'sppm_navigateTo').execute(
      { browserInstanceId: 'browser-2', targetPageId: 'other', contextVersion: 5, route: '/x' },
      execution(),
    )
    expect(result).toMatchObject({ state: 'succeeded' })
    expect(resolved).toBe(0)
  })

  it('preflights explicit identifiers from the cached page context', async () => {
    let executed = 0
    const transport: PageActionTransport = {
      execute: async (request) => {
        executed += 1
        return { commandId: request.commandId, state: 'succeeded', contextVersion: request.contextVersion }
      },
      resolveContext: async () => contextReceipt(['readPageContext']),
    }
    const { context, tools } = fakeHarness()
    apply(context, { transport })
    await toolNamed(tools, 'sppm_readPageContext').execute({}, execution())
    await expect(toolNamed(tools, 'sppm_queryRecords').execute({
      browserInstanceId: 'browser-1', targetPageId: 'cardMgmt', contextVersion: 3, limit: 1,
    }, execution())).resolves.toMatchObject({
      state: 'failed',
      message: '当前页面不支持 queryRecords',
      data: { requiredAction: 'queryRecords' },
    })
    expect(executed).toBe(0)
  })

  it('publishes business-specific parameters and forwards them without a generic payload wrapper', async () => {
    const requests: unknown[] = []
    const transport: PageActionTransport = {
      execute: async (request) => {
        requests.push(request)
        return { commandId: request.commandId, state: 'succeeded', contextVersion: request.contextVersion }
      },
      resolveContext: async () => contextReceipt(['queryRecords']),
    }
    const { context, tools } = fakeHarness()
    apply(context, { transport })
    expect(toolNamed(tools, 'sppm_queryRecords').parameters.properties).toMatchObject({
      filters: { description: '记录筛选条件，支持时间、设备、工艺卡和参数条件' },
      limit: { type: 'integer' },
    })
    const fillProperties = toolNamed(tools, 'sppm_fillForm').parameters.properties as Record<string, { description?: string }>
    expect(fillProperties.formId?.description).toContain('formId')
    expect(fillProperties.formVersion?.description).toContain('formVersion')
    expect(fillProperties.values?.description).toContain('process-card-header')
    const validationProperties = toolNamed(tools, 'sppm_validateDraft').parameters.properties as Record<string, { description?: string }>
    expect(validationProperties.formId?.description).toContain('顶层参数')
    expect(validationProperties.formVersion?.description).toContain('顶层参数')
    expect(validationProperties.values?.description).toContain('不得传 draft')
    const businessProperties = toolNamed(tools, 'sppm_readBusinessContext').parameters.properties as Record<string, unknown>
    expect((businessProperties.includeDraft as { description?: string }).description).toContain('默认只返回摘要')
    await toolNamed(tools, 'sppm_queryRecords').execute({ filters: { deviceCode: 'D-1' }, limit: 120 }, execution())
    expect(requests[0]).toMatchObject({ action: 'queryRecords', args: { filters: { deviceCode: 'D-1' }, limit: 120 } })
  })

  it('publishes the route search contract and forwards the search request', async () => {
    const requests: unknown[] = []
    const transport: PageActionTransport = {
      execute: async (request) => {
        requests.push(request)
        return { commandId: request.commandId, state: 'succeeded', contextVersion: request.contextVersion }
      },
      resolveContext: async () => contextReceipt(['searchRoutes']),
    }
    const { context, tools } = fakeHarness()
    apply(context, { transport })
    expect(toolNamed(tools, 'sppm_searchRoutes').description).toBe('通过当前登录用户的 Web 菜单权限搜索可用路由，返回保留父子关系的 JSON 树。仅返回当前用户可见的菜单项；分组、重定向和外链节点不能直接导航。请在 navigateTo 前调用此工具，并使用结果中的 targetable=true、href 和 routeVersion。该工具只读，不修改页面或业务数据。')
    expect(toolNamed(tools, 'sppm_searchRoutes').parameters.properties).toMatchObject({
      query: { type: 'string' },
      limit: { type: 'integer' },
    })
    const navigateParameters = toolNamed(tools, 'sppm_navigateTo').parameters as { properties: Record<string, unknown> }
    expect(navigateParameters.properties.routeVersion).toMatchObject({ type: 'string' })
    await toolNamed(tools, 'sppm_searchRoutes').execute({ query: '工艺卡', limit: 10 }, execution())
    expect(requests[0]).toMatchObject({ action: 'searchRoutes', args: { query: '工艺卡', limit: 10 } })
  })

  it('gives a submit a reusable client operation id when the model omits one', async () => {
    const requests: Array<{ commandId: string; args: Record<string, unknown> }> = []
    const transport: PageActionTransport = {
      execute: async (request) => {
        requests.push(request)
        return { commandId: request.commandId, state: 'succeeded', contextVersion: request.contextVersion }
      },
      resolveContext: async () => contextReceipt(['submitForm']),
    }
    const { context, tools } = fakeHarness()
    apply(context, { transport })
    await toolNamed(tools, 'sppm_submitForm').execute({ formId: 'process-card', formVersion: 1, values: { config: {}, moduleDtoList: [] } }, execution())
    const request = requests[0]
    expect(request).toBeDefined()
    expect(request!.args.operationId).toBe(request!.commandId)
  })

  it('normalizes bridge network failures into a structured tool receipt', async () => {
    const transport: PageActionTransport = {
      execute: async () => { throw new Error('socket closed') },
      resolveContext: async () => contextReceipt(['navigateTo']),
    }
    const { context, tools } = fakeHarness()
    apply(context, { transport })
    await expect(toolNamed(tools, 'sppm_navigateTo').execute({ route: '/cards' }, execution())).resolves.toMatchObject({
      state: 'failed',
      message: '页面桥接执行失败：socket closed',
    })
  })
})
