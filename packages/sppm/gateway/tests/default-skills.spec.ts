import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { installSppmDefaultSkills } from '../src/default-skills.ts'

describe('SPPM default Harness skills', () => {
  it('installs a valid skill bundle in DSH_HOME/skills and is idempotent', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sppm-default-skills-'))
    const [path] = await installSppmDefaultSkills(home)
    expect(path).toBe(join(home, 'skills', 'sppm-process-card-create', 'SKILL.md'))
    const first = await readFile(path!, 'utf8')
    expect(first).toMatch(/^---\nname: sppm-process-card-create\n/u)
    expect(first).toContain('process-card-header')
    expect((await stat(path!)).mode & 0o777).toBe(0o600)
    const second = await installSppmDefaultSkills(home)
    expect(second).toEqual([path])
    expect(await readFile(path!, 'utf8')).toBe(first)
  })
})
