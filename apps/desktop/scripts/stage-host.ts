/** Produce a symlink-free production deployment of the existing dsh Host. */

import { spawn } from 'node:child_process'
import { cp, lstat, mkdir, readFile, readdir, realpath, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopRoot = fileURLToPath(new URL('..', import.meta.url))
const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url))
const staging = join(desktopRoot, '.stage/host')

async function run(command: string, args: readonly string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd: repositoryRoot, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      code === 0 ? resolve() : reject(new Error(`desktop host staging stopped (${String(code ?? signal)})`))
    })
  })
}

async function firstLink(directory: string): Promise<string | undefined> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink()) return path
    if (metadata.isDirectory()) {
      const nested = await firstLink(path)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

if (!staging.startsWith(join(desktopRoot, '.stage') + sep)) throw new Error('desktop host staging escaped its owned directory')
await rm(staging, { recursive: true, force: true })
await run('pnpm', [
  '--offline', '--ignore-scripts', '--filter', '@deepseek-ai/dsh', 'deploy', '--prod',
  '--config.node-linker=hoisted',
  '--config.inject-workspace-packages=true', '--config.link-workspace-packages=true', staging,
])

const manifest = JSON.parse(await readFile(join(staging, 'package.json'), 'utf8')) as {
  readonly dependencies?: Readonly<Record<string, string>>
}
for (const dependency of Object.keys(manifest.dependencies ?? {})) {
  const destination = join(staging, 'node_modules', dependency)
  if (existsSync(destination)) continue
  const source = join(repositoryRoot, 'apps/cli/node_modules', dependency)
  if (!existsSync(source)) throw new Error(`desktop host staging: missing dependency ${dependency}`)
  await mkdir(dirname(destination), { recursive: true })
  await cp(source, destination, { recursive: true, dereference: true })
}

const nodeModules = join(staging, 'node_modules')
let link = await firstLink(nodeModules)
while (link !== undefined) {
  const segments = link.slice(nodeModules.length + 1).split(sep)
  const binIndex = segments.lastIndexOf('.bin')
  if (binIndex >= 0) {
    await rm(join(nodeModules, ...segments.slice(0, binIndex + 1)), { recursive: true, force: true })
    link = await firstLink(nodeModules)
    continue
  }
  const source = await realpath(link)
  await rm(link, { recursive: true, force: true })
  await cp(source, link, { recursive: true, dereference: true })
  link = await firstLink(nodeModules)
}

await run(process.execPath, [
  join(staging, 'node_modules/@deepseek-ai/dsh-subprocess-local/scripts/ensure-spawn-helper.mjs'),
])
