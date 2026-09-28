import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { syncSppmAssistantAssets, verifySppmAssistantAssets } from './sppm-assistant-assets.ts'

async function fixtureRoots(): Promise<{ harnessRoot: string; frontendRoot: string }> {
  const harnessRoot = await mkdtemp(join(tmpdir(), 'sppm-assistant-harness-'))
  const frontendRoot = await mkdtemp(join(tmpdir(), 'sppm-assistant-frontend-'))
  return { harnessRoot, frontendRoot }
}

async function writeFixture(root: string, assistant: string, style = 'body{}'): Promise<void> {
  await mkdir(join(root, 'packages', 'sppm', 'ui-embed', 'lib'), { recursive: true })
  await writeFile(join(root, 'packages', 'sppm', 'ui-embed', 'lib', 'assistant.js'), assistant)
  await writeFile(join(root, 'packages', 'sppm', 'ui-embed', 'lib', 'style.css'), style)
}

async function writeTargetFixture(root: string, assistant: string, style = 'body{}'): Promise<void> {
  const target = join(root, 'public', 'ai-harness')
  await mkdir(target, { recursive: true })
  await writeFile(join(target, 'assistant.js'), assistant)
  await writeFile(join(target, 'style.css'), style)
}

describe('SPPM assistant asset synchronization', () => {
  it('copies the built assets and verifies exact equality', async () => {
    const roots = await fixtureRoots()
    try {
      await writeFixture(roots.harnessRoot, 'window.registerFactory = true')
      await syncSppmAssistantAssets(roots)
      await expect(verifySppmAssistantAssets(roots)).resolves.toContain('ai-harness')
      await expect(readFile(join(roots.frontendRoot, 'public', 'ai-harness', 'assistant.js'), 'utf8'))
        .resolves.toBe('window.registerFactory = true')
    } finally {
      await Promise.all([rm(roots.harnessRoot, { recursive: true, force: true }), rm(roots.frontendRoot, { recursive: true, force: true })])
    }
  })

  it('rejects an older static bundle even when it is otherwise present', async () => {
    const roots = await fixtureRoots()
    try {
      await writeFixture(roots.harnessRoot, 'window.registerFactory = true')
      await writeTargetFixture(roots.frontendRoot, 'window.oldSlotCore = true')
      await expect(verifySppmAssistantAssets(roots)).rejects.toThrow(/missing registerFactory/u)
    } finally {
      await Promise.all([rm(roots.harnessRoot, { recursive: true, force: true }), rm(roots.frontendRoot, { recursive: true, force: true })])
    }
  })

  it('rejects a stale target with the rebuild command', async () => {
    const roots = await fixtureRoots()
    try {
      await writeFixture(roots.harnessRoot, 'window.registerFactory = true')
      await writeTargetFixture(roots.frontendRoot, 'window.registerFactory = false')
      await expect(verifySppmAssistantAssets(roots)).rejects.toThrow(/pnpm run bundle:sppm-assistant/u)
    } finally {
      await Promise.all([rm(roots.harnessRoot, { recursive: true, force: true }), rm(roots.frontendRoot, { recursive: true, force: true })])
    }
  })
})
