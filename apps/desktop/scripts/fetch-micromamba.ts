/** Download the pinned micromamba asset, and win32's app-local CRT DLLs, used by one desktop architecture. */

import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDesktopPlatform, micromambaExecutableName } from '../src/environment-declaration.ts'
import { writeCondaPackageFiles } from './conda-package.ts'

interface RuntimeAsset {
  readonly url: string
  readonly sha256: string
  /** Exact file names to extract from the package's root directory; see {@link extractCondaPackageFiles}. */
  readonly files: readonly string[]
}
interface Asset {
  readonly url: string
  readonly sha256: string
  /** win32 only: the conda-forge `vc14_runtime` package this platform's app-local MSVC CRT DLLs come from. */
  readonly runtime?: RuntimeAsset
}
type Manifest = Readonly<Record<string, string | Asset>>

/**
 * Download `url`, verify its SHA-256 against `sha256`, and return the bytes.
 * @param label - what is being downloaded, for the error message on a checksum mismatch or failed request.
 * @param url - the HTTPS URL to fetch.
 * @param sha256 - the expected lowercase hex digest.
 * @returns the verified response bytes.
 * @throws when the request fails, or the downloaded bytes' digest does not match `sha256`.
 */
async function downloadVerified(label: string, url: string, sha256: string): Promise<Buffer> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`micromamba: ${label} download failed with HTTP ${String(response.status)}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest !== sha256) throw new Error(`micromamba: checksum mismatch for ${label}`)
  return bytes
}

/**
 * Write `data` at `path` atomically: the temporary sibling this writes first
 * keeps a crashed or killed run from leaving a half-written file at `path`.
 * @param path - the final destination.
 * @param data - the bytes to write.
 * @param mode - the file mode for the written file.
 */
async function writeAtomic(path: string, data: Uint8Array, mode: number): Promise<void> {
  const temporary = `${path}.download`
  await mkdir(dirname(path), { recursive: true })
  await writeFile(temporary, data, { mode })
  await chmod(temporary, mode)
  await rename(temporary, path)
}

const desktopRoot = fileURLToPath(new URL('..', import.meta.url))
const manifest = JSON.parse(await readFile(join(desktopRoot, 'resources/micromamba.json'), 'utf8')) as Manifest
const target = process.argv[2] ?? `${process.platform}-${process.arch}`
if (!isDesktopPlatform(target)) throw new Error(`micromamba: ${target} is not a shipped desktop platform`)
const asset = manifest[target]
if (typeof asset !== 'object') throw new Error(`micromamba: no pinned asset for ${target}`)
// win32 dynamically links the MSVC CRT and ships it app-local (see the
// accompanying Agent Note); a manifest entry for a win32 target missing its
// `runtime` block would otherwise fetch micromamba.exe alone and produce a
// package that fails to start with STATUS_DLL_NOT_FOUND on a bare host, with
// no signal at fetch time.
if (target.startsWith('win32-') && asset.runtime === undefined) {
  throw new Error(`micromamba: ${target} manifest entry in resources/micromamba.json is missing its runtime (app-local CRT) block`)
}

const binDir = join(desktopRoot, 'resources/bin', target)
const executableBytes = await downloadVerified(`micromamba (${target})`, asset.url, asset.sha256)
const executablePath = join(binDir, micromambaExecutableName(target))
await writeAtomic(executablePath, executableBytes, 0o755)
process.stdout.write(`${executablePath}\n`)

// win32 only: micromamba.exe dynamically links the MSVC CRT, and a bare
// Windows host has none of it — see the accompanying Agent Note. The DLLs
// ship app-local, next to the executable, rather than through the system
// installer this application deliberately keeps unelevated.
if (asset.runtime !== undefined) {
  const { runtime } = asset
  const packageBytes = await downloadVerified(`vc14_runtime (${target})`, runtime.url, runtime.sha256)
  const paths = await writeCondaPackageFiles(packageBytes, runtime.files, binDir)
  for (const path of paths) process.stdout.write(`${path}\n`)
}
