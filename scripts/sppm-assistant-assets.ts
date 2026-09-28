import { copyFile, mkdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const REQUIRED_ASSISTANT_MARKER = 'registerFactory'
const ASSET_NAMES = ['assistant.js', 'style.css'] as const

export interface SppmAssistantAssetOptions {
  /** Harness repository root containing packages/sppm/ui-embed/lib. */
  harnessRoot?: string
  /** Frontend repository root containing public/ai-harness. */
  frontendRoot?: string
}

interface AssetPaths {
  sourceDir: string
  targetDir: string
}

const defaultHarnessRoot = resolve(import.meta.dirname, '..')

function assetPaths(options: SppmAssistantAssetOptions = {}): AssetPaths {
  const harnessRoot = resolve(options.harnessRoot ?? defaultHarnessRoot)
  const frontendRoot = resolve(options.frontendRoot ?? join(harnessRoot, '..', 'frontend'))
  return {
    sourceDir: join(harnessRoot, 'packages', 'sppm', 'ui-embed', 'lib'),
    targetDir: join(frontendRoot, 'public', 'ai-harness'),
  }
}

async function requireDirectory(path: string, description: string): Promise<void> {
  try {
    if (!(await stat(path)).isDirectory()) throw new Error('not a directory')
  } catch (error) {
    throw new Error(`${description} does not exist: ${path}`, { cause: error })
  }
}

async function readAsset(path: string, description: string): Promise<Buffer> {
  try {
    return await readFile(path)
  } catch (error) {
    throw new Error(`${description} does not exist: ${path}`, { cause: error })
  }
}

async function readSourceAssets(paths: AssetPaths): Promise<Map<string, Buffer>> {
  await requireDirectory(paths.sourceDir, 'SPPM UI embed build output')
  const assets = new Map<string, Buffer>()
  for (const name of ASSET_NAMES) {
    const asset = await readAsset(join(paths.sourceDir, name), 'SPPM UI embed build asset')
    if (name === 'assistant.js' && !asset.toString('utf8').includes(REQUIRED_ASSISTANT_MARKER)) {
      throw new Error(
        'SPPM UI embed assistant.js is missing the SlotCore factory API; rebuild with \'pnpm run bundle:sppm-assistant\'',
      )
    }
    assets.set(name, asset)
  }
  return assets
}

/**
 * Check that the Vue host serves the exact UI embed assets built by Harness.
 * @param options - optional repository roots for tests or non-standard workspaces.
 * @returns a resolved target directory when all assets match.
 * @throws when an asset is missing or differs from the current embed build.
 */
export async function verifySppmAssistantAssets(options: SppmAssistantAssetOptions = {}): Promise<string> {
  const paths = assetPaths(options)
  const sourceAssets = await readSourceAssets(paths)
  await requireDirectory(paths.targetDir, 'SPPM frontend assistant asset directory')
  const mismatches: string[] = []
  for (const [name, source] of sourceAssets) {
    const target = await readAsset(join(paths.targetDir, name), 'SPPM frontend assistant asset')
    if (name === 'assistant.js' && !target.toString('utf8').includes(REQUIRED_ASSISTANT_MARKER)) {
      mismatches.push(`${name} is from an older UI embed build (missing ${REQUIRED_ASSISTANT_MARKER})`)
    } else if (!source.equals(target)) {
      mismatches.push(`${name} differs from packages/sppm/ui-embed/lib/${name}`)
    }
  }
  if (mismatches.length > 0) {
    throw new Error(
      `SPPM frontend assistant assets are stale:\n- ${mismatches.join('\n- ')}\nRun 'pnpm run bundle:sppm-assistant' from the Harness repository.`,
    )
  }
  return paths.targetDir
}

/**
 * Copy the current UI embed assets into the Vue host and verify byte equality.
 * @param options - optional repository roots for tests or non-standard workspaces.
 * @returns the target directory after synchronization.
 */
export async function syncSppmAssistantAssets(options: SppmAssistantAssetOptions = {}): Promise<string> {
  const paths = assetPaths(options)
  const sourceAssets = await readSourceAssets(paths)
  await requireDirectory(resolve(paths.targetDir, '..', '..'), 'SPPM frontend repository root')
  await mkdir(paths.targetDir, { recursive: true })
  let changed = false
  for (const [name, source] of sourceAssets) {
    const targetPath = join(paths.targetDir, name)
    let target: Buffer | undefined
    try {
      target = await readFile(targetPath)
    } catch {
      // A clean frontend checkout has no generated asset yet; copy it below.
    }
    if (target?.equals(source) === true) continue
    await copyFile(join(paths.sourceDir, name), targetPath)
    changed = true
  }
  await verifySppmAssistantAssets(options)
  if (changed) console.log(`SPPM assistant assets synchronized to ${paths.targetDir}`)
  return paths.targetDir
}
