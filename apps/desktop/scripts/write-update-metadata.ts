/** Write checksummed static metadata for the installers produced by Electron Builder. */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Installer extension to the platform it installs on, and the architectures
 * one complete build of that platform produces. A run is rejected unless it
 * wrote exactly this set, so a half-finished `electron-builder` invocation
 * cannot publish metadata that silently omits an architecture.
 */
const EXPECTED: Readonly<Record<string, { readonly platform: string; readonly arches: readonly string[] }>> = {
  '.dmg': { platform: 'darwin', arches: ['arm64', 'x64'] },
  '.exe': { platform: 'win32', arches: ['x64'] },
}

const desktopRoot = fileURLToPath(new URL('..', import.meta.url))
const release = join(desktopRoot, 'release')
const extension = process.argv[2] ?? ''
const expected = EXPECTED[extension]
if (expected === undefined) {
  throw new Error(`desktop update metadata: pass one installer extension (${Object.keys(EXPECTED).join(', ')})`)
}

// `release/` accumulates installers across versions on a development machine,
// and Electron Builder names each one after the version in this manifest, so
// only this version's files are this run's output.
const { version } = JSON.parse(await readFile(join(desktopRoot, 'package.json'), 'utf8')) as { version: string }
const thisRun = (name: string): boolean => name.endsWith(extension) && name.includes(`-${version}-`)

const artifacts = []
for (const name of (await readdir(release)).filter(thisRun).sort()) {
  const path = join(release, name)
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(path)) digest.update(chunk)
  const metadata = await stat(path)
  const arch = expected.arches.find(candidate => name.includes(`-${candidate}.`))
  if (arch === undefined) throw new Error(`desktop update metadata: cannot identify architecture in ${name}`)
  artifacts.push({ name, platform: expected.platform, arch, bytes: metadata.size, sha256: digest.digest('hex') })
}
const produced = artifacts.map(artifact => artifact.arch).sort().join(',')
if (produced !== [...expected.arches].sort().join(',')) {
  throw new Error(`desktop update metadata: ${expected.platform} ${version} expected ${expected.arches.join(', ')}, found ${produced || 'nothing'}`)
}
const output = join(release, `desktop-update.${expected.platform}.json`)
await writeFile(output, `${JSON.stringify({ version: 1, artifacts }, null, 2)}\n`)
process.stdout.write(`${output}\n`)
