import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { zipSync } from 'fflate'
import { pack } from 'tar-stream'
import { describe, expect, it } from 'vitest'
import { extractCondaPackageFiles, writeCondaPackageFiles } from '../scripts/conda-package.ts'

/** Pack `entries` into a tar buffer using the same library the module under test extracts with. */
async function packTar(entries: readonly { readonly name: string; readonly data: Buffer }[]): Promise<Buffer> {
  const packer = pack()
  for (const entry of entries) packer.entry({ name: entry.name }, entry.data)
  packer.finalize()
  const chunks: Buffer[] = []
  for await (const chunk of packer) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

/**
 * Synthesize a minimal `.conda` file: a zip container (fflate) holding one
 * `pkg-fixture-1.0-0.tar.zst` member — a zstd-compressed tar (tar-stream)
 * carrying `entries` — matching the real format's zip(pkg-tar.zst) nesting.
 */
async function buildFixtureConda(entries: readonly { readonly name: string; readonly data: Buffer }[]): Promise<Buffer> {
  const tarBuffer = await packTar(entries)
  const tarZst = zstdCompressSync(tarBuffer)
  return Buffer.from(zipSync({ 'pkg-fixture-1.0-0.tar.zst': tarZst }, { level: 0 }))
}

const rootA = Buffer.from('root-a-bytes')
const rootB = Buffer.from('root-b-bytes')
const libBinA = Buffer.from('library-bin-a-bytes-different-from-root')

describe('extractCondaPackageFiles', () => {
  it('extracts only the requested root-directory files', async () => {
    const conda = await buildFixtureConda([
      { name: 'a.dll', data: rootA },
      { name: 'b.dll', data: rootB },
      { name: 'Library/bin/a.dll', data: libBinA },
    ])
    const files = await extractCondaPackageFiles(conda, ['a.dll', 'b.dll'])
    expect(files).toEqual([
      { name: 'a.dll', data: rootA },
      { name: 'b.dll', data: rootB },
    ])
  })

  it('ignores a Library/bin/ copy of a requested name, extracting only the root copy', async () => {
    const conda = await buildFixtureConda([
      { name: 'a.dll', data: rootA },
      { name: 'Library/bin/a.dll', data: libBinA },
    ])
    const files = await extractCondaPackageFiles(conda, ['a.dll'])
    expect(files).toEqual([{ name: 'a.dll', data: rootA }])
  })

  it('throws when a requested name is absent from the package root', async () => {
    const conda = await buildFixtureConda([
      { name: 'a.dll', data: rootA },
      { name: 'Library/bin/missing.dll', data: libBinA },
    ])
    // 'missing.dll' exists only under Library/bin/, never at the root — the
    // root-only match rule means this counts as absent, not found.
    await expect(extractCondaPackageFiles(conda, ['missing.dll'])).rejects.toThrow(/missing from package root: missing\.dll/)
  })

  it('throws when the archive has no pkg-*.tar.zst member', async () => {
    const conda = Buffer.from(zipSync({ 'info-fixture-1.0-0.tar.zst': new Uint8Array(0) }, { level: 0 }))
    await expect(extractCondaPackageFiles(conda, ['a.dll'])).rejects.toThrow(/no pkg-\*\.tar\.zst member/)
  })
})

describe('writeCondaPackageFiles', () => {
  it('writes every requested file into targetDir', async () => {
    const conda = await buildFixtureConda([
      { name: 'a.dll', data: rootA },
      { name: 'b.dll', data: rootB },
      { name: 'Library/bin/a.dll', data: libBinA },
    ])
    const targetDir = await mkdtemp(join(tmpdir(), 'conda-package-'))
    const paths = await writeCondaPackageFiles(conda, ['a.dll', 'b.dll'], targetDir)
    expect(paths).toEqual([join(targetDir, 'a.dll'), join(targetDir, 'b.dll')])
    await expect(readFile(join(targetDir, 'a.dll'))).resolves.toEqual(rootA)
    await expect(readFile(join(targetDir, 'b.dll'))).resolves.toEqual(rootB)
    expect((await readdir(targetDir)).sort()).toEqual(['a.dll', 'b.dll'])
  })

  it('leaves targetDir with no half-written file when a requested name is missing', async () => {
    const conda = await buildFixtureConda([{ name: 'a.dll', data: rootA }])
    const targetDir = await mkdtemp(join(tmpdir(), 'conda-package-'))
    await expect(writeCondaPackageFiles(conda, ['a.dll', 'missing.dll'], targetDir)).rejects.toThrow(/missing from package root: missing\.dll/)
    expect(await readdir(targetDir)).toEqual([])
  })
})
