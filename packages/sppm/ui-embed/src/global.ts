import { mountAssistant } from './index.ts'

declare global {
  interface Window {
    SppmHarnessAssistant?: { mountAssistant: typeof mountAssistant }
  }
}

/** Browser entry used by the Vue host's `/ai-harness/assistant.js` asset. */
window.SppmHarnessAssistant = { mountAssistant }
