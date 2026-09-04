/** Download the pinned micromamba asset used by one desktop architecture. */

import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDesktopPlatform, micromambaExecutableName } from '../src/environment-declaration.ts'

interface Asset { readonly url: string; readonly sha256: string }
type Manifest = Readonly<Record<string, string | Asset>>

const desktopRoot = fileURLToPath(new URL('..', import.meta.url))
const manifest = JSON.parse(await readFile(join(desktopRoot, 'resources/micromamba.json'), 'utf8')) as Manifest
const target = process.argv[2] ?? `${process.platform}-${process.arch}`
if (!isDesktopPlatform(target)) throw new Error(`micromamba: ${target} is not a shipped desktop platform`)
const asset = manifest[target]
if (typeof asset !== 'object') throw new Error(`micromamba: no pinned asset for ${target}`)

const response = await fetch(asset.url)
if (!response.ok) throw new Error(`micromamba: download failed with HTTP ${String(response.status)}`)
const bytes = Buffer.from(await response.arrayBuffer())
const digest = createHash('sha256').update(bytes).digest('hex')
if (digest !== asset.sha256) throw new Error(`micromamba: checksum mismatch for ${target}`)

const output = join(desktopRoot, 'resources/bin', target, micromambaExecutableName(target))
const temporary = `${output}.download`
await mkdir(dirname(output), { recursive: true })
await writeFile(temporary, bytes, { mode: 0o755 })
await chmod(temporary, 0o755)
await rename(temporary, output)
process.stdout.write(`${output}\n`)
