import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Skills shipped by the SPPM product and installed into Harness's DSH_HOME. */
export const SPPM_DEFAULT_SKILLS = ['sppm-process-card-create'] as const

const SKILL_SOURCE_LOCATIONS = SPPM_DEFAULT_SKILLS.map(name => ({
  name,
  candidates: [
    new URL(`../../harness-plugin/skills/${name}/SKILL.md`, import.meta.url),
    // The second location is used by the compiled gateway output under lib/types.
    new URL(`../../../harness-plugin/skills/${name}/SKILL.md`, import.meta.url),
  ],
}))

/**
 * Install product skills into the Harness default user root.
 *
 * `dsh-skill-filesystem` discovers `${DSH_HOME}/skills` at rank 400. Keeping
 * the file there means SPPM uses the same parser, watcher, validation and
 * model-facing loader as every other Harness skill. Installation is atomic and
 * idempotent so a partially written file can never be discovered.
 */
export async function installSppmDefaultSkills(dshHome: string): Promise<readonly string[]> {
  const installed: string[] = []
  for (const skill of SKILL_SOURCE_LOCATIONS) {
    const source = await readFirstAvailable(skill.candidates)
    const directory = join(dshHome, 'skills', skill.name)
    const destination = join(directory, 'SKILL.md')
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await chmod(directory, 0o700)
    const current = await readOptional(destination)
    if (current !== source) {
      const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, source, { encoding: 'utf8', mode: 0o600 })
        await rename(temporary, destination)
      } finally {
        await unlink(temporary).catch(() => undefined)
      }
    }
    // Keep product instructions private to the SPPM instance while allowing
    // the Harness process to read them.
    await chmod(destination, 0o600)
    installed.push(destination)
  }
  return installed
}

async function readFirstAvailable(locations: readonly URL[]): Promise<string> {
  let lastError: unknown
  for (const location of locations) {
    try {
      return await readFile(fileURLToPath(location), { encoding: 'utf8' })
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(`SPPM packaged skill is unavailable: ${String(lastError)}`)
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, { encoding: 'utf8' })
  } catch {
    return undefined
  }
}
