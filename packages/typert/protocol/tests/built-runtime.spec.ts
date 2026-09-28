import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const builtProtocol = fileURLToPath(new URL('../lib/index.js', import.meta.url))

describe.skipIf(!existsSync(builtProtocol))('Typert protocol built runtime', () => {
  it('exports owned-value helpers from the package root', async () => {
    const runtime = await import(pathToFileURL(builtProtocol).href) as Record<string, unknown>

    expect(typeof runtime.isTypertOwnedValue).toBe('function')
    expect(typeof runtime.typertOwnedValue).toBe('function')
  })
})
