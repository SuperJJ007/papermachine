/** Write checksummed static metadata for the DMGs produced by Electron Builder. */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopRoot = fileURLToPath(new URL('..', import.meta.url))
const release = join(desktopRoot, 'release')
const artifacts = []
for (const name of (await readdir(release)).filter(name => name.endsWith('.dmg')).sort()) {
  const path = join(release, name)
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(path)) digest.update(chunk)
  const metadata = await stat(path)
  const arch = name.includes('-arm64.') ? 'arm64' : name.includes('-x64.') ? 'x64' : undefined
  if (arch === undefined) throw new Error(`desktop update metadata: cannot identify architecture in ${name}`)
  artifacts.push({ name, arch, bytes: metadata.size, sha256: digest.digest('hex') })
}
if (artifacts.length !== 2) throw new Error('desktop update metadata: expected one arm64 and one x64 DMG')
await writeFile(join(release, 'desktop-update.json'), `${JSON.stringify({ version: 1, artifacts }, null, 2)}\n`)
