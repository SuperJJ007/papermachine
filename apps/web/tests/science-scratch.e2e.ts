/** Science snapshot storage rejects canonical temporary roots before allocating a child. */
import { access, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createScienceScratch } from './science-scaffold.ts'

afterEach(() => { vi.unstubAllEnvs() })

it('allocates unique owned storage beneath the selected non-temporary parent', async () => {
  const directory = await createScienceScratch()
  try {
    expect(await realpath(directory)).toBe(directory)
    await expect(access(directory)).resolves.toBeUndefined()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
  await expect(access(directory)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('rejects explicit temporary roots and canonical aliases before allocation', async () => {
  const directory = await createScienceScratch()
  try {
    const alias = join(directory, 'temporary-alias')
    await symlink(tmpdir(), alias, 'dir')
    for (const parent of ['/tmp', await realpath('/tmp'), tmpdir(), alias]) {
      vi.stubEnv('DSH_WEB_SCIENCE_SCRATCH_PARENT', parent)
      await expect(createScienceScratch()).rejects.toThrow('outside /tmp and os.tmpdir()')
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
