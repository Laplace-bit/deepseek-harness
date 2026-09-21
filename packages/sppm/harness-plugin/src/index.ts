import { Context, Service } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { defineTool, type ToolExecution } from '@deepseek-ai/dsh-tools'
import { isPageActionReceipt, isPageContext, SPPM_PAGE_BRIDGE_ACTIONS, type PageActionName, type PageActionReceipt, type PageActionRequest, type PageContext } from '@deepseek-ai/dsh-sppm-page-bridge'

export interface PageActionTransport {
  execute(request: PageActionRequest): Promise<PageActionReceipt>
  /** Read the page context of the active browser instance, optionally pinned to one instance. */
  resolveContext(request: { browserInstanceId?: string }): Promise<PageActionReceipt>
}

export interface Config {
  transport?: PageActionTransport
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    sppmPageActions: SppmPageActionService
  }
}

/** Cordis service exposed to SPPM tools; it has no arbitrary script surface. */
export class SppmPageActionService extends Service {
  constructor(ctx: Context, private readonly transport: PageActionTransport) {
    super(ctx, 'sppmPageActions')
  }

  /**
   * Run one page action in the browser.
   * @param request - page-bound action command.
   * @returns the browser receipt.
   */
  execute(request: PageActionRequest): Promise<PageActionReceipt> {
    return this.transport.execute(request).then(receipt => normalizeReceipt(receipt, request.commandId, request.contextVersion))
  }

  /**
   * Read the page context of the active browser instance.
   * @param request - optional browser instance to pin resolution to.
   * @returns a receipt whose `data.context` is the resolved page context.
   */
  resolveContext(request: { browserInstanceId?: string }): Promise<PageActionReceipt> {
    return this.transport.resolveContext(request).then(receipt => normalizeReceipt(receipt, '', -1))
  }
}

/** POST one request to a gateway page route and normalize transport failures into a receipt. */
async function postPageAction(
  endpoint: string | undefined,
  token: string | undefined,
  body: unknown,
  commandId: string,
  contextVersion: number,
): Promise<PageActionReceipt> {
  if (endpoint === undefined || token === undefined) {
    return { commandId: commandId || randomUUID(), state: 'failed', contextVersion, message: '页面桥接未连接' }
  }
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sppm-instance-token': token },
      body: JSON.stringify(body),
    })
    let value: unknown
    try {
      value = await response.json() as unknown
    } catch {
      value = {}
    }
    if (!response.ok) {
      const message = isRecord(value) && typeof value.message === 'string' ? value.message : `页面桥接请求失败（${String(response.status)}）`
      return { commandId: commandId || randomUUID(), state: 'failed', contextVersion, message, nextAction: response.status === 401 ? '重新登录后重试' : '检查页面桥接和网关状态后重试' }
    }
    if (!isPageActionReceipt(value)) return { commandId: commandId || randomUUID(), state: 'failed', contextVersion, message: '页面桥接返回格式无效', nextAction: '刷新 Web 页面并重新连接 Agent' }
    if (commandId !== '' && value.commandId !== commandId) return { commandId, state: 'failed', contextVersion, message: '页面桥接回执与指令不匹配', nextAction: '复用操作 ID 查询结果或重新读取页面上下文' }
    return value
  } catch (error) {
    return { commandId: commandId || randomUUID(), state: 'failed', contextVersion, message: error instanceof Error ? `页面桥接连接失败：${error.message}` : '页面桥接连接失败', nextAction: '检查页面是否仍打开，恢复后复用操作 ID重试' }
  }
}

function environmentTransport(): PageActionTransport {
  return {
    execute(request) {
      return postPageAction(
        process.env.SPPM_PAGE_ACTION_URL,
        process.env.SPPM_INSTANCE_TOKEN,
        request,
        request.commandId,
        request.contextVersion,
      )
    },
    resolveContext(request) {
      // The dedicated route URL wins; deriving it from the sibling action route
      // keeps a deployment that only configures SPPM_PAGE_ACTION_URL working.
      const endpoint = process.env.SPPM_PAGE_CONTEXT_URL
        ?? process.env.SPPM_PAGE_ACTION_URL?.replace(/\/page-actions$/u, '/page-context')
      const body: Record<string, unknown> = {}
      if (request.browserInstanceId !== undefined) body.browserInstanceId = request.browserInstanceId
      return postPageAction(endpoint, process.env.SPPM_INSTANCE_TOKEN, body, '', -1)
    },
  }
}

/** Read the page context carried by a successful resolution receipt. */
function pageContextFromReceipt(receipt: PageActionReceipt): PageContext | undefined {
  const context = receipt.data?.context
  return isPageContext(context) ? context : undefined
}

function normalizeReceipt(receipt: PageActionReceipt, commandId: string, contextVersion: number): PageActionReceipt {
  if (!isPageActionReceipt(receipt)) return { commandId: commandId || randomUUID(), state: 'failed', contextVersion, message: '页面桥接返回格式无效', nextAction: '刷新 Web 页面并重新连接 Agent' }
  if (commandId !== '' && receipt.commandId !== commandId) return { commandId, state: 'failed', contextVersion, message: '页面桥接回执与指令不匹配', nextAction: '复用操作 ID 查询结果或重新读取页面上下文' }
  return receipt
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

const ACTION_ARGUMENTS: Record<PageActionName, readonly string[]> = {
  readPageContext: [],
  searchRoutes: ['query', 'limit'],
  navigateTo: ['route', 'routeVersion'],
  openDialog: ['dialog'],
  fillForm: ['formId', 'formVersion', 'values'],
  requestConfirmation: ['message', 'operationId'],
  readBusinessContext: ['query', 'limit', 'includeDraft'],
  queryRecords: ['filters', 'limit'],
  validateDraft: ['formId', 'formVersion', 'values'],
  submitForm: ['formId', 'formVersion', 'values', 'message', 'operationId'],
}

function unknownActionArguments(action: PageActionName, args: Record<string, unknown>): string[] {
  const allowed = new Set(['targetPageId', 'browserInstanceId', 'contextVersion', ...ACTION_ARGUMENTS[action]])
  return Object.keys(args).filter(key => !allowed.has(key))
}

export const name = 'sppm-harness-plugin'
// The page-action service is constructed during apply(), so declaring it as an
// injection would create an impossible self-dependency and leave this plugin
// pending forever. The constructor registers it on the same Cordis context
// before the tools below are exposed.
export const inject = ['tools']

export function apply(ctx: Context, config: Config = {}): void {
  const service = new SppmPageActionService(ctx, config.transport ?? environmentTransport())
  // A Harness agent can issue several tool calls over one conversation. Keep
  // the first resolved browser tab bound to that agent so opening another tab
  // does not silently retarget later actions or make them ambiguous.
  const browserBindings = new Map<string, string>()
  // PTC calls usually carry all identifiers from the previous receipt. Keep
  // the validated context too, so those calls still receive local capability
  // preflight without an unnecessary bridge round trip.
  const contextBindings = new Map<string, PageContext>()
  const targetParameters = {
    targetPageId: { type: 'string', description: '仅使用最近一次 sppm_readPageContext 返回的 pageId；不要猜测；省略时自动发现' },
    browserInstanceId: { type: 'string', description: '仅使用运行时绑定或页面上下文返回的标签页实例；不要猜测；省略时自动发现' },
    contextVersion: { type: 'integer', description: '仅使用最近一次页面上下文返回的 contextVersion；省略时自动发现' },
  } as const
  const actionParameters = {
    readPageContext: {},
    searchRoutes: { query: { type: 'string', description: '菜单名称、路由名称或路径关键词；留空返回可见菜单树。无需先调用 sppm_readPageContext，工具会自动绑定当前标签页' }, limit: { type: 'integer', description: '最多返回的可导航路由数，默认 30，最大 100' } },
    navigateTo: { route: { type: 'string', required: true, description: '必须使用 searchRoutes 返回的 href；不要猜测路由路径' }, routeVersion: { type: 'string', description: 'searchRoutes 返回的菜单版本；提供后菜单变化会使导航失败并要求重新搜索' } },
    openDialog: { dialog: { type: 'string', required: true, enum: ['createCard', 'createTemplate', 'editCardParameters'], description: '要打开的业务界面；创建工艺卡后使用 editCardParameters 进入参数编辑' } },
    fillForm: {
      formId: { type: 'string', required: true, description: '必须使用 readPageContext 或 readBusinessContext 返回的表单 formId；不要猜测' },
      formVersion: { type: 'integer', required: true, description: '必须使用表单目录返回的 formVersion；表单定义变化后需要重新读取' },
      values: { type: 'json', required: true, description: '当前 formId 对应的业务值：process-card-header 使用 {config} 只填写表头；process-card-parameters 使用 {config,moduleDtoList} 填写模块/工段/参数；必须保留目录标识，不能发送顶层 fields 或 templateStandards' },
    },
    requestConfirmation: { message: { type: 'string', required: true, description: '展示给用户确认的实际变更说明' }, operationId: { type: 'string', description: '重试时复用的确认操作 ID' } },
    readBusinessContext: { query: { type: 'string', description: '按编号或名称查询；省略时读取当前业务数据' }, limit: { type: 'integer', description: '最多返回的业务对象数量，默认 10' }, includeDraft: { type: 'boolean', description: '需要填充或校验时才设为 true；默认只返回摘要和字段目录，避免把完整参数草稿加载到上下文' } },
    queryRecords: { filters: { type: 'json', description: '记录筛选条件，支持时间、设备、工艺卡和参数条件' }, limit: { type: 'integer', description: '最多分析的记录数，默认 50，最大 1000' } },
    validateDraft: { formId: { type: 'string', required: true, description: '顶层参数；必须使用当前页面表单目录返回的 formId，不能放入 draft 内' }, formVersion: { type: 'integer', required: true, description: '顶层参数；必须使用表单目录返回的 formVersion，不能放入 draft 内' }, values: { type: 'json', required: true, description: '顶层参数；process-card-header 使用 {config}，process-card-parameters 使用 {config,moduleDtoList}；不得传 draft、扁平化 fields 或顶层 templateStandards' } },
    submitForm: { formId: { type: 'string', description: '当前页面表单目录返回的 formId；省略 values 恢复操作时仍需提供' }, formVersion: { type: 'integer', description: '当前表单目录返回的 formVersion' }, values: { type: 'json', description: '已校验的当前表单 values：process-card-header 使用 {config}，process-card-parameters 使用 {config,moduleDtoList}。提交前展示实际差异并等待用户确认；仅查询已提交结果时可省略。表头成功后必须重新读取上下文并进入参数阶段' }, message: { type: 'string', description: '确认弹窗中的变更说明' }, operationId: { type: 'string', description: '确认恢复或查询结果时复用的客户端操作 ID；首次调用可省略' } },
  } as const
  const actionDescriptions = {
    readPageContext: '读取当前浏览器页面上下文和可用能力。',
    searchRoutes: '通过当前登录用户的 Web 菜单权限搜索可用路由，返回保留父子关系的 JSON 树。仅返回当前用户可见的菜单项；分组、重定向和外链节点不能直接导航。请在 navigateTo 前调用此工具，并使用结果中的 targetable=true、href 和 routeVersion。该工具只读，不修改页面或业务数据。',
    navigateTo: '使用 searchRoutes 返回的 href 和 routeVersion 导航，并在 Web 菜单目录中校验目标。',
    openDialog: '打开当前业务页面声明的业务弹窗或工艺卡参数编辑界面。创建工艺卡任务先使用 createCard；表头保存成功并确认列表刷新后，再使用 editCardParameters。',
    fillForm: '先读取表单目录，再使用对应的 formId、formVersion 和 values 填写当前表单。工艺卡分为 process-card-header 表头阶段和 process-card-parameters 参数阶段；不会猜测字段，也不会持久化数据。',
    requestConfirmation: '向用户展示待确认的业务变更。',
    readBusinessContext: '读取当前业务页面的数据和字段上下文。',
    queryRecords: '按业务条件查询并分析参数记录。',
    validateDraft: '只接受顶层 formId、formVersion、values 三个参数来校验草稿；表头阶段传入 {config}，参数阶段传入 {config,moduleDtoList}，绝不使用 draft 包裹。返回字段级问题。',
    submitForm: '提交当前表单的 values 草稿，要求用户确认，并等待保存回读核验。工艺卡表头提交成功后必须重新读取上下文并进入参数阶段，不能把表头成功当作整张工艺卡完成。',
  } as const
  const execute = async (action: PageActionRequest['action'], args: Record<string, unknown>, exec: ToolExecution): Promise<PageActionReceipt> => {
    if (exec.agent === undefined) throw new Error('页面操作需要 Agent 会话')
    const commandId = randomUUID()
    const unknown = unknownActionArguments(action, args)
    if (unknown.length > 0) return { commandId, state: 'failed', contextVersion: -1, message: '工具参数未在协议中定义', issues: unknown.map(field => ({ code: 'unknown_argument', field, message: `参数 ${field} 不属于 ${action}`, suggestion: '读取工具参数定义后重试' })) }
    const bindingKey = String(exec.agent.id)
    const explicitBrowserInstanceId = typeof args.browserInstanceId === 'string' ? args.browserInstanceId : ''
    let browserInstanceId = explicitBrowserInstanceId || browserBindings.get(bindingKey) || ''
    let targetPageId = typeof args.targetPageId === 'string' ? args.targetPageId : ''
    let contextVersion = typeof args.contextVersion === 'number' ? args.contextVersion : -1
    if (browserInstanceId === '' || targetPageId === '' || contextVersion < 0) {
      let resolution: PageActionReceipt
      try {
        resolution = await service.resolveContext(browserInstanceId === '' ? {} : { browserInstanceId })
      } catch (error) {
        return { commandId, state: 'failed', contextVersion, message: error instanceof Error ? `页面上下文解析失败：${error.message}` : '页面上下文解析失败', nextAction: '检查页面是否仍打开，恢复后重试' }
      }
      const context = pageContextFromReceipt(resolution)
      if (resolution.state !== 'succeeded' || context === undefined) {
        if (explicitBrowserInstanceId === '') {
          browserBindings.delete(bindingKey)
          contextBindings.delete(bindingKey)
        }
        return {
          commandId,
          state: resolution.state === 'expired' ? 'expired' : 'failed',
          contextVersion: resolution.contextVersion ?? contextVersion,
          message: resolution.message ?? '无法解析当前页面',
          nextAction: resolution.state === 'expired' ? '页面发现已超时，重新读取当前页面后重试' : '打开目标业务页面或关闭多余标签页后重试',
        }
      }
      browserInstanceId = context.browserInstanceId
      browserBindings.set(bindingKey, browserInstanceId)
      contextBindings.set(bindingKey, context)
      targetPageId = context.pageId
      contextVersion = context.contextVersion
      if (action !== 'readPageContext' && !context.capabilities.includes(action)) {
        const routeHint = action === 'queryRecords'
          ? '先调用 sppm_searchRoutes 搜索点检记录页面，再使用返回的 href 和 routeVersion 调用 sppm_navigateTo'
          : '先调用 sppm_readPageContext 确认当前页面能力，再切换到声明该动作的业务页面'
        return {
          commandId,
          state: 'failed',
          contextVersion,
          message: `当前页面不支持 ${action}`,
          data: {
            pageId: context.pageId,
            route: context.route,
            title: context.title,
            capabilities: context.capabilities,
            requiredAction: action,
          },
          nextAction: routeHint,
        }
      }
      // The resolution receipt already carries the full page context, so a
      // context read needs no second round trip to the browser.
      if (action === 'readPageContext') return resolution
    }
    const cachedContext = contextBindings.get(bindingKey)
    if (cachedContext !== undefined
      && cachedContext.browserInstanceId === browserInstanceId
      && cachedContext.pageId === targetPageId
      && cachedContext.contextVersion === contextVersion
      && action !== 'readPageContext'
      && !cachedContext.capabilities.includes(action)) {
      const routeHint = action === 'queryRecords'
        ? '先调用 sppm_searchRoutes 搜索点检记录页面，再使用返回的 href 和 routeVersion 调用 sppm_navigateTo'
        : '先调用 sppm_readPageContext 确认当前页面能力，再切换到声明该动作的业务页面'
      return {
        commandId,
        state: 'failed',
        contextVersion: cachedContext.contextVersion,
        message: `当前页面不支持 ${action}`,
        data: {
          pageId: cachedContext.pageId,
          route: cachedContext.route,
          title: cachedContext.title,
          capabilities: cachedContext.capabilities,
          requiredAction: action,
        },
        nextAction: routeHint,
      }
    }
    const suppliedOperationId = typeof args.operationId === 'string' && args.operationId.trim() !== '' ? args.operationId : undefined
    const request: PageActionRequest = {
      commandId,
      userId: process.env.SPPM_USER_ID ?? 'unknown',
      sessionId: String(exec.agent.id),
      browserInstanceId,
      targetPageId,
      contextVersion,
      action,
      args: Object.fromEntries([
        ...Object.entries(args).filter(([key]) => !['targetPageId', 'browserInstanceId', 'contextVersion'].includes(key)),
        ...(action === 'submitForm' && suppliedOperationId === undefined ? [['operationId', commandId] as const] : []),
      ]),
      issuedAt: Date.now(),
      // Confirmation and save actions may legitimately wait for a human. The
      // gateway uses the same deadline, so these must outlive a normal page
      // request without allowing an old command to remain valid indefinitely.
      expiresAt: Date.now() + (action === 'requestConfirmation' || action === 'submitForm'
        ? 5 * 60_000
        : action === 'queryRecords' ? 2 * 60_000 : 30_000),
    }
    try {
      const result = await service.execute(request)
      if (result.state !== 'failed' && result.state !== 'expired') {
        browserBindings.set(bindingKey, browserInstanceId)
        const returnedContext = pageContextFromReceipt(result)
        if (returnedContext !== undefined) contextBindings.set(bindingKey, returnedContext)
        else if (cachedContext !== undefined
          && cachedContext.browserInstanceId === browserInstanceId
          && cachedContext.pageId === targetPageId
          && result.contextVersion >= 0) {
          contextBindings.set(bindingKey, { ...cachedContext, contextVersion: result.contextVersion })
        }
      }
      return result
    } catch (error) {
      return {
        commandId,
        state: 'failed',
        contextVersion,
        message: error instanceof Error ? `页面桥接执行失败：${error.message}` : '页面桥接执行失败',
        nextAction: '检查页面是否仍打开，恢复后复用操作 ID重试',
      }
    }
  }
  const output = { schema: { type: 'json' as const }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] }
  for (const action of SPPM_PAGE_BRIDGE_ACTIONS) {
    const description = action === 'searchRoutes'
      ? actionDescriptions[action]
      : `通过 SPPM 页面桥接${actionDescriptions[action]}该工具只使用业务字段和当前注册页面，不接受 CSS 选择器或任意脚本。写入操作会先校验、展示变更并等待用户确认；只有回读核验成功才报告完成。`
    ctx.tools.register(defineTool({
      name: `sppm_${action}`,
      description,
      parameters: {
        ...targetParameters,
        ...actionParameters[action],
      },
      output,
      execute: async (args, exec) => JSON.parse(JSON.stringify(await execute(action, isRecord(args) ? args : {}, exec))),
    }))
  }
}
