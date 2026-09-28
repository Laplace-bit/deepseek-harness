import { AppWebEntry } from '@deepseek-ai/dsh-client-web'
import type { PageContext } from '@deepseek-ai/dsh-sppm-page-bridge'

declare global {
  interface Window {
    __ModuleLoader__?: unknown
    __DSH_BOOT__?: unknown
  }
}

/** Host values and callbacks required to mount the embedded Harness client. */
export interface AssistantOptions {
  locale: 'zh-CN' | 'en' | 'vi'
  theme?: 'light' | 'dark' | 'system'
  gatewayUrl: string
  browserInstanceId: string
  pageBridge?: {
    readContext: () => PageContext | undefined
    sendReceipt: (receipt: unknown) => void
  }
}

/** Controls and disposes one embedded Harness client instance. */
export interface AssistantHandle {
  show(): void
  hide(): void
  updateContext(context: PageContext | undefined): void
  destroy(): Promise<void>
}

const entryByContainer = new WeakMap<HTMLElement, AppWebEntry>()
const optionsByContainer = new WeakMap<HTMLElement, AssistantOptions>()
const bootstrapByRuntime = new Map<string, Promise<void>>()

/** Resolve a Harness path through the gateway's namespaced runtime proxy. */
function runtimeUrl(runtimeBase: string, resource: string): string {
  const base = runtimeBase.endsWith('/') ? runtimeBase.slice(0, -1) : runtimeBase
  const parsed = new URL(resource, window.location.origin)
  return `${base}${parsed.pathname}${parsed.search}`
}

/** Execute one index injection script in document order. */
function loadBootstrapScript(runtimeBase: string, element: HTMLScriptElement): Promise<void> {
  const source = element.getAttribute('src')
  // The shell entry would mount a second application into #root. The embed
  // owns AppWebEntry itself, so only the loader/bootstrap injections run here.
  if (source !== null && (element.type === 'module' || /(?:^|\/)index-[^/]+\.js(?:$|\?)/u.test(source))) {
    return Promise.resolve()
  }
  const script = document.createElement('script')
  script.type = element.type
  if (source !== null) {
    script.src = runtimeUrl(runtimeBase, source)
    script.async = false
    return new Promise((resolve, reject) => {
      script.addEventListener('load', () => { resolve() }, { once: true })
      script.addEventListener('error', () => { reject(new Error(`Harness bootstrap script failed: ${source}`)) }, { once: true })
      document.head.append(script)
    })
  }
  script.textContent = element.textContent
  document.head.append(script)
  script.remove()
  return Promise.resolve()
}

/**
 * Harness normally receives these globals as server-side HTML injections. In
 * embedded mode the gateway exposes that same index under `/runtime`; replay
 * its loader scripts in order, then let AppWebEntry mount into our root.
 */
async function ensureHarnessBootstrap(runtimeBase: string): Promise<void> {
  const existing = bootstrapByRuntime.get(runtimeBase)
  if (existing !== undefined) return existing
  const pending = (async () => {
    const response = await fetch(`${runtimeBase}/`, { credentials: 'include' })
    if (!response.ok) throw new Error(`Harness runtime bootstrap failed (${response.status})`)
    const html = await response.text()
    const parsed = new DOMParser().parseFromString(html, 'text/html')
    const scripts = [...parsed.querySelectorAll('script')]
    for (const script of scripts) await loadBootstrapScript(runtimeBase, script)
    if (typeof window.__ModuleLoader__ === 'undefined' || typeof window.__DSH_BOOT__ === 'undefined') {
      throw new Error('Harness runtime bootstrap did not expose the module graph')
    }
  })()
  bootstrapByRuntime.set(runtimeBase, pending)
  try {
    await pending
  } catch (error) {
    bootstrapByRuntime.delete(runtimeBase)
    throw error
  }
}

/**
 * Mount the pinned Harness React application directly into a Vue-owned DOM
 * node. Harness still owns its HTTP RPC/WebSocket connection and React tree;
 * Vue only controls the surrounding window and page bridge.
 * @param container Vue-owned DOM node that receives the assistant.
 * @param options Gateway, browser, locale, and optional page-bridge settings.
 * @returns Controls for the mounted assistant.
 */
export async function mountAssistant(container: HTMLElement, options: AssistantOptions): Promise<AssistantHandle> {
  const mountPoint = document.createElement('div')
  mountPoint.className = 'sppm-harness-assistant-root'
  mountPoint.dataset.gatewayUrl = options.gatewayUrl
  mountPoint.dataset.browserInstanceId = options.browserInstanceId
  mountPoint.dataset.locale = options.locale
  container.replaceChildren(mountPoint)
  optionsByContainer.set(mountPoint, options)

  const runtimeBase = `${options.gatewayUrl.replace(/\/$/u, '')}/runtime`
  await ensureHarnessBootstrap(runtimeBase)
  const entry = new AppWebEntry(mountPoint, {
    loadBundle: (resource: string) => new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.async = true
      script.src = runtimeUrl(runtimeBase, resource)
      script.addEventListener('load', () => { script.remove(); resolve() }, { once: true })
      script.addEventListener('error', () => { script.remove(); reject(new Error(`Harness bundle failed: ${resource}`)) }, { once: true })
      document.head.append(script)
    }),
  })
  entryByContainer.set(container, entry)
  await entry.run()

  return {
    show() { container.hidden = false },
    hide() { container.hidden = true },
    updateContext(context) {
      const current = optionsByContainer.get(mountPoint)
      if (current === undefined) return
      const next = { ...current }
      if (current.pageBridge !== undefined) next.pageBridge = { ...current.pageBridge, readContext: () => context }
      optionsByContainer.set(mountPoint, next)
      mountPoint.dispatchEvent(new CustomEvent('sppm:assistant-context', { detail: context }))
    },
    async destroy() {
      await entry.dispose()
      optionsByContainer.delete(mountPoint)
      entryByContainer.delete(container)
      mountPoint.remove()
    },
  }
}

/** Read options for SPPM plugins that need to configure the gateway transport.
 * @param container Container passed to {@link mountAssistant}.
 * @returns The mount options, or undefined when the container is not mounted.
 */
export function getAssistantOptions(container: HTMLElement): AssistantOptions | undefined {
  return optionsByContainer.get(container)
}
