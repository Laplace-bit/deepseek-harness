import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const builtClient = fileURLToPath(new URL('../lib/client.js', import.meta.url))

describe.skipIf(!existsSync(builtClient))('api-remotes built contract', () => {
  it('bundles factory-based strict codecs for agent preset remotes', () => {
    const source = readFileSync(builtClient, 'utf8')
    const start = source.indexOf('id: "@deepseek-ai/dsh-agent-presets#agentPresets/copy"')
    const end = source.indexOf('id: "@deepseek-ai/dsh-agent-presets#agentPresets/deletePreset"')
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)

    const copyDescriptor = source.slice(start, end)
    expect(copyDescriptor).toContain('create:')
    expect(copyDescriptor).not.toContain('schema:')
  })
})
