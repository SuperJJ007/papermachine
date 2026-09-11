/** Prepare pinned product executables without building, installing packages, or starting the app. */
import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import extractZip from 'extract-zip'
import { x as extractTar } from 'tar'
import { isDesktopPlatform, micromambaExecutableName } from '../src/environment-declaration.ts'

const APP_ROOT = resolve(import.meta.dirname, '..')
interface Asset { readonly url: string; readonly sha256: string }
interface RuntimeAsset extends Asset { readonly files: readonly string[] }
interface ExecutableAsset extends Asset { readonly runtime?: RuntimeAsset }

function parseAsset(value: unknown, origin: string): Asset {
  if (typeof value !== 'object' || value === null || !('url' in value) || !('sha256' in value)
    || typeof value.url !== 'string' || typeof value.sha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.sha256)) throw new Error('product resources: invalid pinned asset')
  const url = new URL(value.url)
  if (url.origin !== origin || url.username || url.password || url.search || url.hash) {
    throw new Error('product resources: asset must use its official HTTPS origin')
  }
  return { url: url.href, sha256: value.sha256 }
}

function executableAsset(manifest: unknown, target: string): ExecutableAsset {
  if (typeof manifest !== 'object' || manifest === null || !(target in manifest)) {
    throw new Error(`product resources: no pinned asset for ${target}`)
  }
  const value: unknown = Reflect.get(manifest, target)
  const asset = parseAsset(value, 'https://github.com')
  if (!new URL(asset.url).pathname.startsWith('/mamba-org/micromamba-releases/releases/download/')) {
    throw new Error('product resources: expected the official micromamba release repository')
  }
  if (!target.startsWith('win32-')) return asset
  const runtimeValue: unknown = Reflect.get(value as object, 'runtime')
  const runtime = parseAsset(runtimeValue, 'https://conda.anaconda.org')
  const files: unknown = Reflect.get(runtimeValue as object, 'files')
  if (!new URL(runtime.url).pathname.startsWith('/conda-forge/win-64/') || !Array.isArray(files)
    || files.length === 0 || !files.every((name: unknown) => typeof name === 'string' && /^[a-zA-Z0-9_]+\.dll$/.test(name))) {
    throw new Error('product resources: invalid app-local runtime files')
  }
  return { ...asset, runtime: { ...runtime, files } }
}

function digest(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex') }

async function cachedBytes(path: string): Promise<Buffer | undefined> {
  try { return await readFile(path) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return undefined
  }
}

async function writeAtomic(path: string, bytes: Uint8Array, mode: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.download`
  try {
    await writeFile(temporary, bytes, { mode, flag: 'wx' })
    await chmod(temporary, mode)
    await rename(temporary, path)
  } finally { await rm(temporary, { force: true }) }
}

async function prepareAsset(asset: Asset, destination: string, mode: number): Promise<void> {
  const cached = await cachedBytes(destination)
  if (cached !== undefined && digest(cached) === asset.sha256) {
    await chmod(destination, mode)
    return
  }
  const response = await fetch(asset.url, { signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new Error(`product resources: HTTP ${String(response.status)} for ${asset.url}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (digest(bytes) !== asset.sha256) throw new Error(`product resources: checksum mismatch for ${asset.url}`)
  await writeAtomic(destination, bytes, mode)
}

async function prepareRuntime(runtime: RuntimeAsset, binDir: string, appRoot: string): Promise<void> {
  const cache = join(appRoot, '.desktop-build', 'product-downloads')
  const archive = join(cache, `${runtime.sha256}.conda`)
  await prepareAsset(runtime, archive, 0o644)
  const temporary = await mkdtemp(join(cache, 'runtime-'))
  try {
    await extractZip(archive, { dir: temporary })
    const payloads = (await readdir(temporary)).filter(name => /^pkg-.*\.tar\.zst$/.test(name))
    if (payloads.length !== 1) throw new Error('product resources: expected one conda package payload')
    const tarPath = join(temporary, 'runtime.tar')
    await writeFile(tarPath, zstdDecompressSync(await readFile(join(temporary, payloads[0]!))))
    const output = join(temporary, 'files')
    await mkdir(output)
    await extractTar({ file: tarPath, cwd: output, filter: (name, entry) => runtime.files.includes(name) && 'type' in entry && entry.type === 'File' })
    // Read every required file before publishing any of the runtime.
    const files = await Promise.all(runtime.files.map(async name => ({ name, bytes: await readFile(join(output, name)) })))
    for (const file of files) await writeAtomic(join(binDir, file.name), file.bytes, 0o644)
  } finally { await rm(temporary, { recursive: true, force: true }) }
}

/**
 * Verify cached executables or download the existing official assets pinned by SHA-256.
 * @param target - Platform/architecture present in the shipped micromamba manifest.
 * @param appRoot - Desktop application directory containing product resources.
 * @returns The prepared micromamba executable path.
 */
export async function prepareProductResources(
  target = `${process.platform}-${process.arch}`,
  appRoot = APP_ROOT,
): Promise<string> {
  if (!isDesktopPlatform(target)) throw new Error(`product resources: unsupported target ${target}`)
  const resources = join(appRoot, 'resources')
  const manifest: unknown = JSON.parse(await readFile(join(resources, 'micromamba.json'), 'utf8'))
  const asset = executableAsset(manifest, target)
  for (const name of ['environments/general.json', 'host.json', 'skills']) await readdirOrRead(resources, name)
  const binDir = join(resources, 'bin', target)
  if (asset.runtime !== undefined) await prepareRuntime(asset.runtime, binDir, appRoot)
  const executable = join(binDir, micromambaExecutableName(target))
  await prepareAsset(asset, executable, 0o755)
  return executable
}

async function readdirOrRead(resources: string, name: string): Promise<void> {
  if (name === 'skills') {
    if ((await readdir(join(resources, name))).length === 0) throw new Error('product resources: bundled skills are empty')
  } else { JSON.parse(await readFile(join(resources, name), 'utf8')) }
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  if (process.argv.length > 3) throw new Error('product resources: expected at most one platform-architecture argument')
  console.log(await prepareProductResources(process.argv[2]))
}
