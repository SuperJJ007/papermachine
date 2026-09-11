import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareProductResources } from '../scripts/prepare-product-resources.ts'

const roots: string[] = []
const binary = Buffer.from('test micromamba executable')
const sha256 = createHash('sha256').update(binary).digest('hex')
async function fixture(url = 'https://github.com/mamba-org/micromamba-releases/releases/download/2.9.0-0/micromamba-osx-arm64'): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'desktop-resources-'))
  roots.push(root)
  await mkdir(join(root, 'resources/environments'), { recursive: true })
  await mkdir(join(root, 'resources/skills/example'), { recursive: true })
  await writeFile(join(root, 'resources/environments/general.json'), '{}')
  await writeFile(join(root, 'resources/host.json'), '{}')
  await writeFile(join(root, 'resources/micromamba.json'), JSON.stringify({ 'darwin-arm64': { url, sha256 } }))
  return root
}
afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
describe('desktop product resources', () => {
  it('publishes verified executable bytes and reuses the verified cache without a request', async () => {
    const root = await fixture()
    const fetch = vi.fn().mockResolvedValue(new Response(binary))
    vi.stubGlobal('fetch', fetch)
    const executable = await prepareProductResources('darwin-arm64', root)
    expect(await readFile(executable)).toEqual(binary)
    if (process.platform !== 'win32') expect((await stat(executable)).mode & 0o111).not.toBe(0)
    await prepareProductResources('darwin-arm64', root)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('rejects downloaded checksum mismatches without replacing an existing executable', async () => {
    const root = await fixture()
    const executable = join(root, 'resources/bin/darwin-arm64/micromamba')
    await mkdir(join(root, 'resources/bin/darwin-arm64'), { recursive: true })
    await writeFile(executable, 'existing invalid cache')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('corrupt download')))
    await expect(prepareProductResources('darwin-arm64', root)).rejects.toThrow('checksum mismatch')
    expect(await readFile(executable, 'utf8')).toBe('existing invalid cache')
  })
  it('rejects unofficial URLs and unsupported targets before any request', async () => {
    const root = await fixture('https://untrusted.example/micromamba')
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(prepareProductResources('darwin-arm64', root)).rejects.toThrow('official HTTPS origin')
    await expect(prepareProductResources('linux-arm64', root)).rejects.toThrow('unsupported target')
    expect(fetch).not.toHaveBeenCalled()
  })
})
