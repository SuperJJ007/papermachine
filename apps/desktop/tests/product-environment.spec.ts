import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { ProductEnvironment } from '../src/product-environment.ts'
import { writeEnvironmentBinding } from '../src/environment-binding.ts'
const roots: string[] = []
const resources = fileURLToPath(new URL('../resources', import.meta.url))
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'desktop-environment-')); roots.push(home)
  const environment = new ProductEnvironment(home, resources)
  return { home, environment }
}
it('allows an unbound staged health probe but refuses an unbound workspace launch', async () => {
  const { home, environment } = await setup()
  await expect(environment.writeOverlay(join(home, 'staging'), true)).resolves.toBeUndefined()
  await expect(environment.writeOverlay(join(home, 'active'))).rejects.toThrow('not installed')
})
it('writes identical machine configuration into staged and active profiles without restoring obsolete product rows', async () => {
  const { home, environment } = await setup()
  const prefix = join(home, 'desktop-environments/environments/general/current')
  const bin = process.platform === 'win32' ? prefix : join(prefix, 'bin')
  await mkdir(bin, { recursive: true }); await mkdir(join(prefix, 'conda-meta'))
  await writeFile(join(prefix, 'conda-meta/history'), 'conda')
  await writeFile(join(bin, process.platform === 'win32' ? 'python.exe' : 'python'), '')
  await writeEnvironmentBinding(home, { pythonPrefix: prefix, sourceId: 'official', boundAt: 1 })
  for (const name of ['staging', 'active']) await environment.writeOverlay(join(home, name))
  const text = await readFile(join(home, 'active/cordis.patch.yml'), 'utf8')
  expect(text).toBe(await readFile(join(home, 'staging/cordis.patch.yml'), 'utf8'))
  const rows = JSON.parse(text) as Array<{ id: string; config: { profiles?: { science: unknown }; bundledSkillDir?: string } }>
  expect(rows.map((row: { id: string }) => row.id)).toEqual(['science-runtime', 'skill-filesystem'])
  expect(rows[0]?.config.profiles?.science).toEqual({ pythonPrefix: prefix })
  expect(rows[1]?.config.bundledSkillDir).toBe(join(resources, 'skills'))
  await rm(join(bin, process.platform === 'win32' ? 'python.exe' : 'python'))
  expect(await environment.status()).toMatchObject({ kind: 'invalid' })
})
it('rejects a source absent from the packaged declaration before spawning a package installer', async () => {
  const { environment } = await setup()
  await expect(environment.install('untrusted-source', undefined, new AbortController().signal, () => {})).rejects.toThrow('unknown package source')
})
