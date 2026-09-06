/** Extract named root-directory files from a conda-forge `.conda` package. */

import { zstdDecompressSync } from 'node:zlib'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { extract } from 'tar-stream'

/** One file extracted from a conda package's root directory. */
export interface CondaPackageFile {
  readonly name: string
  readonly data: Uint8Array
}

/**
 * Extract `fileNames` from the root directory of a conda-forge `.conda`
 * package's file payload.
 *
 * `.conda` is a zip container (conda-forge's own builder stores entries
 * uncompressed) holding `pkg-<name>.tar.zst` — the package's files, as a
 * zstd-compressed tar — and `info-<name>.tar.zst` — package metadata this
 * repository has no use for. A file is matched by its exact tar entry name
 * with no path separator: some conda-forge packages (`vc14_runtime` among
 * them) also ship a `Library/bin/<name>` copy of every root file for
 * POSIX-style conda environments, and that copy is deliberately not matched,
 * since only the root copy sits next to `micromamba.exe` where Windows' DLL
 * search order looks first.
 * @param condaBytes - the raw `.conda` file contents.
 * @param fileNames - exact root-directory file names to extract.
 * @returns the requested files, in the order `fileNames` was given.
 * @throws when `condaBytes` has no `pkg-*.tar.zst` member, or when any name
 * in `fileNames` is absent from that member's root directory — this
 * extraction has no partial-success mode.
 */
export async function extractCondaPackageFiles(
  condaBytes: Uint8Array,
  fileNames: readonly string[],
): Promise<readonly CondaPackageFile[]> {
  const zip = unzipSync(condaBytes)
  const pkgEntryName = Object.keys(zip).find(name => /^pkg-.*\.tar\.zst$/.test(name))
  if (pkgEntryName === undefined) throw new Error('conda-package: no pkg-*.tar.zst member found')
  const pkgEntry = zip[pkgEntryName]
  if (pkgEntry === undefined) throw new Error('conda-package: no pkg-*.tar.zst member found')
  const tarBytes = zstdDecompressSync(Buffer.from(pkgEntry))

  const wanted = new Set(fileNames)
  const found = new Map<string, Uint8Array>()
  const extractor = extract()
  extractor.end(tarBytes)
  for await (const entry of extractor) {
    const { header } = entry
    if (header.type === 'file' && !header.name.includes('/') && wanted.has(header.name)) {
      const chunks: Buffer[] = []
      for await (const chunk of entry) chunks.push(chunk as Buffer)
      found.set(header.name, Buffer.concat(chunks))
    } else {
      for await (const _chunk of entry) { /* discard: not a requested root file */ }
    }
  }

  const missing = fileNames.filter(name => !found.has(name))
  if (missing.length > 0) throw new Error(`conda-package: missing from package root: ${missing.join(', ')}`)
  return fileNames.map(name => ({ name, data: found.get(name) as Uint8Array }))
}

/**
 * Extract `fileNames` from `condaBytes` (see {@link extractCondaPackageFiles})
 * and write them into `targetDir`, alongside whatever else lives there
 * (typically `micromamba.exe`). Every file is written to a
 * `.download`-suffixed temporary path and renamed into place only after
 * extraction has confirmed every requested name is present — a missing file
 * throws before this function writes anything, so a failed call leaves
 * `targetDir` exactly as it found it rather than holding a half-written DLL.
 * @param condaBytes - the raw `.conda` file contents.
 * @param fileNames - exact root-directory file names to extract and write.
 * @param targetDir - the directory to write the files into; created if absent.
 * @returns the written files' absolute paths, in the order `fileNames` was given.
 * @throws whatever {@link extractCondaPackageFiles} throws, before any file in `targetDir` is touched.
 */
export async function writeCondaPackageFiles(
  condaBytes: Uint8Array,
  fileNames: readonly string[],
  targetDir: string,
): Promise<readonly string[]> {
  const files = await extractCondaPackageFiles(condaBytes, fileNames)
  await mkdir(targetDir, { recursive: true })
  const paths: string[] = []
  for (const file of files) {
    const finalPath = join(targetDir, file.name)
    const temporaryPath = `${finalPath}.download`
    await writeFile(temporaryPath, file.data, { mode: 0o644 })
    await rename(temporaryPath, finalPath)
    paths.push(finalPath)
  }
  return paths
}
