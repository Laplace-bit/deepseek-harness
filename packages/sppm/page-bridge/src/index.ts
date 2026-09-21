/**
 * Typed contract between the SPPM Vue host and Harness page-operation tools.
 * This package contains no DOM selectors and no JavaScript execution surface.
 */

/** The actions understood by protocol version 1, in wire and tool-list order. */
export const SPPM_PAGE_BRIDGE_ACTIONS = [
  'readPageContext',
  'searchRoutes',
  'navigateTo',
  'openDialog',
  'fillForm',
  'requestConfirmation',
  'readBusinessContext',
  'queryRecords',
  'validateDraft',
  'submitForm',
] as const

export type PageActionName = typeof SPPM_PAGE_BRIDGE_ACTIONS[number]

/** Bumped whenever the browser page bridge wire contract changes. */
export const SPPM_PAGE_BRIDGE_PROTOCOL_VERSION = 1

export interface PageContext {
  /** The wire version emitted by the page adapter. */
  protocolVersion?: number
  /** Opaque id assigned to one browser tab by the Web host. */
  browserInstanceId: string
  /** Stable id of the registered page adapter. */
  pageId: string
  /** Monotonic version of every value exposed by this context. */
  contextVersion: number
  /** Current full Web route, including its query string. */
  route: string
  /** Localized page title. */
  title: string
  /** Page-owned selection or query summary. */
  selection?: Record<string, string | number | boolean | null>
  /** Page-owned form summary; this is not a complete server object. */
  form?: Record<string, unknown>
  /** Field definitions exposed by the active business adapter. */
  fieldSchema?: PageFieldDefinition[]
  /** Concrete forms that the active page can fill. */
  forms?: PageFormDefinition[]
  /** Actions that the active page adapter can execute. */
  capabilities: PageActionName[]
}

export interface PageFieldDefinition {
  key: string
  label: string
  type?: string
  unit?: string
  required?: boolean
  options?: Array<{ value: string | number | boolean; label: string }>
  moduleCode?: string | number
  stageCode?: string | number
}

export interface PageFormDefinition {
  formId: string
  formVersion: number
  title: string
  operation: 'create' | 'edit'
  draftSchema: string
  /** Optional business workflow phase used to select the correct form. */
  phase?: 'header' | 'parameters' | (string & {})
  /** Business object id when an edit/parameter form is bound to one object. */
  objectId?: string | number
}

export interface PageActionRequest {
  commandId: string
  userId: string
  sessionId: string
  browserInstanceId: string
  targetPageId: string
  contextVersion: number
  action: PageActionName
  args: Record<string, unknown>
  issuedAt: number
  expiresAt: number
}

export type PageActionReceiptState =
  | 'succeeded'
  | 'failed'
  | 'waiting_user'
  | 'cancelled'
  | 'expired'

export interface PageActionReceipt {
  commandId: string
  state: PageActionReceiptState
  contextVersion: number
  message?: string
  data?: Record<string, unknown>
  issues?: Array<{ code: string; field?: string; message: string; suggestion?: string }>
  nextAction?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isJsonValue(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object') return false
  if (ancestors.has(value)) return false
  ancestors.add(value)
  const valid = Array.isArray(value)
    ? value.every(item => isJsonValue(item, ancestors))
    : Object.values(value as Record<string, unknown>).every(item => isJsonValue(item, ancestors))
  ancestors.delete(value)
  return valid
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && isJsonValue(value)
}

/** Validate a semantic request before it reaches a page adapter. */
export function isPageActionRequest(value: unknown): value is PageActionRequest {
  if (!isRecord(value)) return false
  if (typeof value.commandId !== 'string' || value.commandId.length === 0) return false
  if (typeof value.userId !== 'string' || value.userId.length === 0) return false
  if (typeof value.sessionId !== 'string') return false
  if (value.sessionId.length === 0 && !(value.action === 'readPageContext' && value.contextVersion === -1)) return false
  if (typeof value.browserInstanceId !== 'string' || value.browserInstanceId.length === 0) return false
  if (typeof value.targetPageId !== 'string') return false
  if (typeof value.contextVersion !== 'number' || !Number.isInteger(value.contextVersion) || value.contextVersion < -1) return false
  if (typeof value.action !== 'string' || !SPPM_PAGE_BRIDGE_ACTIONS.includes(value.action as PageActionName)) return false
  const discovery = value.action === 'readPageContext' && value.targetPageId === '' && value.contextVersion === -1
  if (value.action === 'readPageContext') {
    if (!discovery && (value.targetPageId === '' || value.contextVersion < 0)) return false
  } else if (value.targetPageId === '' || value.contextVersion < 0) {
    return false
  }
  if (discovery && value.sessionId !== '') return false
  if (!isJsonRecord(value.args)) return false
  if (typeof value.issuedAt !== 'number' || !Number.isFinite(value.issuedAt)) return false
  if (typeof value.expiresAt !== 'number' || !Number.isFinite(value.expiresAt)) return false
  if (value.expiresAt < value.issuedAt) return false
  return true
}

/** Validate a semantic receipt before it is returned to the Harness caller. */
export function isPageActionReceipt(value: unknown): value is PageActionReceipt {
  if (!isRecord(value)) return false
  if (typeof value.commandId !== 'string' || value.commandId.length === 0) return false
  if (typeof value.state !== 'string' || !['succeeded', 'failed', 'waiting_user', 'cancelled', 'expired'].includes(value.state)) return false
  if (typeof value.contextVersion !== 'number' || !Number.isInteger(value.contextVersion) || value.contextVersion < -1) return false
  if (value.message !== undefined && typeof value.message !== 'string') return false
  if (value.nextAction !== undefined && typeof value.nextAction !== 'string') return false
  if (value.data !== undefined && !isJsonRecord(value.data)) return false
  if (value.issues !== undefined && (!Array.isArray(value.issues) || value.issues.some((issue) => {
    if (!isRecord(issue) || typeof issue.code !== 'string' || typeof issue.message !== 'string') return true
    return issue.field !== undefined && typeof issue.field !== 'string'
      || issue.suggestion !== undefined && typeof issue.suggestion !== 'string'
  }))) return false
  return true
}

/** Validate the JSON fields required before a page context crosses the wire. */
export function isPageContext(value: unknown): value is PageContext {
  if (!isRecord(value)) return false
  if (typeof value.browserInstanceId !== 'string' || value.browserInstanceId.length === 0) return false
  if (typeof value.pageId !== 'string' || value.pageId.length === 0) return false
  if (typeof value.contextVersion !== 'number' || !Number.isInteger(value.contextVersion) || value.contextVersion < 0) return false
  if (typeof value.route !== 'string' || typeof value.title !== 'string') return false
  if (value.protocolVersion !== undefined && (typeof value.protocolVersion !== 'number' || !Number.isInteger(value.protocolVersion) || value.protocolVersion < 1)) return false
  if (!Array.isArray(value.capabilities)
    || value.capabilities.some(action => !SPPM_PAGE_BRIDGE_ACTIONS.includes(action as PageActionName))) return false
  if (value.selection !== undefined && (!isJsonRecord(value.selection) || Object.values(value.selection).some(item => item !== null && !['string', 'number', 'boolean'].includes(typeof item)))) return false
  if (value.form !== undefined && !isJsonRecord(value.form)) return false
  if (value.fieldSchema !== undefined && (!Array.isArray(value.fieldSchema) || value.fieldSchema.some((field) => {
    if (!isRecord(field) || typeof field.key !== 'string' || typeof field.label !== 'string') return true
    if (field.type !== undefined && typeof field.type !== 'string') return true
    if (field.unit !== undefined && typeof field.unit !== 'string') return true
    if (field.required !== undefined && typeof field.required !== 'boolean') return true
    if (field.moduleCode !== undefined && !['string', 'number'].includes(typeof field.moduleCode)) return true
    if (field.stageCode !== undefined && !['string', 'number'].includes(typeof field.stageCode)) return true
    return field.options !== undefined && (!Array.isArray(field.options) || field.options.some(option => !isRecord(option)
      || !['string', 'number', 'boolean'].includes(typeof option.value) || typeof option.label !== 'string'))
  }))) return false
  if (value.forms !== undefined && (!Array.isArray(value.forms) || value.forms.some((form) => {
    if (!isRecord(form) || typeof form.formId !== 'string' || form.formId.length === 0) return true
    if (typeof form.formVersion !== 'number' || !Number.isInteger(form.formVersion) || form.formVersion < 1) return true
    if (typeof form.title !== 'string' || !['create', 'edit'].includes(form.operation as string)) return true
    if (typeof form.draftSchema !== 'string' || form.draftSchema.length === 0) return true
    if (form.phase !== undefined && typeof form.phase !== 'string') return true
    return form.objectId !== undefined && !['string', 'number'].includes(typeof form.objectId)
  }))) return false
  return true
}

export interface PageCapabilityDefinition {
  pageId: string
  readContext: () => PageContext
  /** Resolve when the page adapter has loaded dictionaries and form metadata. */
  waitForReady?: (request: PageActionRequest) => Promise<void> | void
  execute: (request: PageActionRequest) => Promise<PageActionReceipt>
}

export interface PageCapabilityRegistry {
  register(definition: PageCapabilityDefinition): () => void
  read(pageId: string): PageContext | undefined
  execute(request: PageActionRequest): Promise<PageActionReceipt>
  invalidate(pageId: string): void
}

const TERMINAL_STATES = new Set<PageActionReceiptState>([
  'succeeded', 'failed', 'cancelled', 'expired',
])
const GLOBAL_ACTIONS = new Set<PageActionName>(['searchRoutes', 'navigateTo'])

/**
 * Create a registry with duplicate, stale-context, and expiry protection.
 * A `readPageContext` request resolves the page registered for the requesting
 * browser instance even when the caller does not know its page id or context
 * version yet, which is how a caller discovers both before acting. Route search
 * and navigation are global actions: when the host page is registered they use
 * its live menu/router context and do not wait for a business form. Every other
 * action requires the registered target page, a matching browser instance, the
 * current context version, and the advertised capability.
 */
export function createPageCapabilityRegistry(now: () => number = Date.now): PageCapabilityRegistry {
  const definitions = new Map<string, PageCapabilityDefinition>()
  const seenCommands = new Set<string>()

  const definitionForBrowser = (browserInstanceId: string): PageCapabilityDefinition | undefined => {
    for (const definition of definitions.values()) {
      try {
        if (definition.readContext().browserInstanceId === browserInstanceId) return definition
      } catch {
        // A page can be between keep-alive activation and disposal. Ignore it
        // during discovery and let the caller receive a deterministic failure
        // if no ready page remains.
      }
    }
    return undefined
  }

  return {
    register(definition) {
      definitions.set(definition.pageId, definition)
      return () => {
        if (definitions.get(definition.pageId) === definition) definitions.delete(definition.pageId)
      }
    },

    read(pageId) {
      return definitions.get(pageId)?.readContext()
    },

    async execute(request) {
      if (!isPageActionRequest(request as unknown)) {
        return {
          commandId: typeof request?.commandId === 'string' ? request.commandId : '',
          state: 'failed',
          contextVersion: typeof request?.contextVersion === 'number' && Number.isInteger(request.contextVersion) ? request.contextVersion : -1,
          message: '页面指令格式无效',
        }
      }
      if (seenCommands.has(request.commandId)) {
        return { commandId: request.commandId, state: 'failed', contextVersion: request.contextVersion, message: '指令已执行或正在执行' }
      }
      if (request.expiresAt <= now()) {
        return { commandId: request.commandId, state: 'expired', contextVersion: request.contextVersion, message: '页面指令已过期' }
      }
      const isGlobalAction = GLOBAL_ACTIONS.has(request.action)
      const definition = (isGlobalAction ? definitions.get('sppmHost') : undefined)
        ?? definitions.get(request.targetPageId)
        ?? (request.action === 'readPageContext' ? definitionForBrowser(request.browserInstanceId) : undefined)
      if (definition === undefined) {
        return { commandId: request.commandId, state: 'failed', contextVersion: request.contextVersion, message: '需要打开目标页面' }
      }
      let context: PageContext
      try {
        context = definition.readContext()
      } catch (error) {
        seenCommands.delete(request.commandId)
        return { commandId: request.commandId, state: 'failed', contextVersion: request.contextVersion, message: error instanceof Error ? error.message : '页面上下文读取失败' }
      }
      if (!isPageContext(context as unknown)) {
        seenCommands.delete(request.commandId)
        return { commandId: request.commandId, state: 'failed', contextVersion: request.contextVersion, message: '页面上下文格式无效' }
      }
      if (context.protocolVersion !== undefined && context.protocolVersion !== SPPM_PAGE_BRIDGE_PROTOCOL_VERSION) {
        return { commandId: request.commandId, state: 'failed', contextVersion: context.contextVersion, message: '页面桥接协议版本不匹配，请刷新页面', nextAction: '刷新 Web 页面并重新连接 Agent' }
      }
      if (!isGlobalAction && typeof definition.waitForReady === 'function') {
        try {
          await definition.waitForReady(request)
          context = definition.readContext()
          if (!isPageContext(context as unknown)) throw new Error('页面上下文格式无效')
        } catch (error) {
          seenCommands.delete(request.commandId)
          return { commandId: request.commandId, state: 'failed', contextVersion: context.contextVersion, message: error instanceof Error ? error.message : '页面业务依赖尚未就绪', nextAction: '等待页面加载完成后重新读取上下文' }
        }
      }
      if (context.browserInstanceId !== request.browserInstanceId) {
        return { commandId: request.commandId, state: 'expired', contextVersion: context.contextVersion, message: '浏览器页面绑定已变化，请重新发现页面' }
      }
      if (request.action === 'readPageContext') {
        if (request.contextVersion >= 0 && context.contextVersion !== request.contextVersion) {
          return { commandId: request.commandId, state: 'expired', contextVersion: context.contextVersion, message: '页面上下文已变化，请重新读取' }
        }
        seenCommands.add(request.commandId)
        return { commandId: request.commandId, state: 'succeeded', contextVersion: context.contextVersion, data: { context } }
      }
      if (!isGlobalAction && context.contextVersion !== request.contextVersion) {
        return { commandId: request.commandId, state: 'expired', contextVersion: context.contextVersion, message: '页面上下文已变化，请重新确认' }
      }
      if (!context.capabilities.includes(request.action)) {
        return { commandId: request.commandId, state: 'failed', contextVersion: context.contextVersion, message: '当前页面不支持此操作' }
      }
      seenCommands.add(request.commandId)
      let receipt: PageActionReceipt
      try {
        receipt = await definition.execute(request)
      } catch (error) {
        seenCommands.delete(request.commandId)
        return { commandId: request.commandId, state: 'failed', contextVersion: context.contextVersion, message: error instanceof Error ? error.message : '页面操作失败' }
      }
      if (!isPageActionReceipt({
        ...receipt,
        commandId: request.commandId,
        contextVersion: receipt.contextVersion ?? context.contextVersion,
      })) {
        seenCommands.delete(request.commandId)
        return { commandId: request.commandId, state: 'failed', contextVersion: context.contextVersion, message: '页面返回了无效操作回执' }
      }
      if (!TERMINAL_STATES.has(receipt.state)) seenCommands.delete(request.commandId)
      return { ...receipt, commandId: request.commandId, contextVersion: receipt.contextVersion ?? context.contextVersion }
    },

    invalidate(pageId) {
      definitions.delete(pageId)
    },
  }
}
