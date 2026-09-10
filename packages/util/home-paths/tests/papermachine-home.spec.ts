import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveDshHome, resolvePaperMachineHome } from '@deepseek-ai/dsh-home-paths'

const world = vi.hoisted(() => ({ home: '' }))
vi.mock('node:os', async importOriginal => ({
  ...await importOriginal<typeof import('node:os')>(),
  homedir: () => world.home,
}))

beforeEach(async () => {
  world.home = await realpath(await mkdtemp(join(tmpdir(), 'papermachine-home-')))
  vi.stubEnv('PAPERMACHINE_HOME', undefined)
  vi.stubEnv('DSH_HOME', join(world.home, '.dsh'))
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(world.home, { recursive: true, force: true })
})

describe('PaperMachine installation home', () => {
  it('uses the current user home without changing official DSH resolution or creating files', async () => {
    expect(await resolvePaperMachineHome()).toBe(join(world.home, '.papermachine'))
    expect(resolveDshHome()).toBe(join(world.home, '.dsh'))
    const { readdir } = await import('node:fs/promises')
    expect(await readdir(world.home)).toEqual([])
  })

  it('preserves a saved custom location and lets an explicit development root override it', async () => {
    const saved = join(world.home, 'Saved PaperMachine')
    await writeFile(join(world.home, '.papermachine-home'), `${saved}\n`)
    expect(await resolvePaperMachineHome()).toBe(saved)
    vi.stubEnv('PAPERMACHINE_HOME', '~/PaperMachine 测试')
    expect(await resolvePaperMachineHome()).toBe(join(world.home, 'PaperMachine 测试'))
    expect(await resolvePaperMachineHome(join(world.home, 'development'))).toBe(join(world.home, 'development'))
  })

  it.each(['', '   ', 'relative/home'])('refuses invalid product override %j', async (value) => {
    vi.stubEnv('PAPERMACHINE_HOME', value)
    await expect(resolvePaperMachineHome()).rejects.toThrow('non-empty absolute path')
  })

  it('refuses invalid or unreadable saved locations', async () => {
    const pointer = join(world.home, '.papermachine-home')
    await writeFile(pointer, 'relative/path\n')
    await expect(resolvePaperMachineHome()).rejects.toThrow('non-empty absolute path')
    await rm(pointer)
    await mkdir(pointer)
    await expect(resolvePaperMachineHome()).rejects.toThrow()
  })

  it.each(['.dsh', '.dsh/inside', '.'])('refuses overlap with official data: %s', async (suffix) => {
    await expect(resolvePaperMachineHome(join(world.home, suffix))).rejects.toThrow('must not overlap')
  })

  it('refuses a symlink or junction into official data', async () => {
    const official = join(world.home, '.dsh')
    await mkdir(official)
    const alias = join(world.home, 'alias')
    await symlink(official, alias, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(resolvePaperMachineHome(join(alias, 'nested'))).rejects.toThrow('must not overlap')
  })
})
