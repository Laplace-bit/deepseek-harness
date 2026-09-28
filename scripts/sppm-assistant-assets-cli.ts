import { syncSppmAssistantAssets, verifySppmAssistantAssets } from './sppm-assistant-assets.ts'

const mode = process.argv[2] ?? '--verify'
try {
  if (mode === '--sync') await syncSppmAssistantAssets()
  else if (mode === '--verify') await verifySppmAssistantAssets()
  else throw new Error(`Unknown mode ${JSON.stringify(mode)}; use --verify or --sync.`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
