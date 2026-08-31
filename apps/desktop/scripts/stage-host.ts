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

// `pnpm deploy --prod` resolves dependencies but never peers, and this
// repository routes most cross-package wiring through `workspace:^` peers: 19
// of them are unsatisfied in a freshly deployed closure, starting with
// `@deepseek-ai/cordis-plugin-group` under `dsh-app-boot`. A workspace install
// hides this because pnpm links peers from the workspace root; the packaged
// Host has no such root and exits before readiness on the first bare import.
// Copy every unsatisfied non-optional peer that is itself a workspace package,
// to a fixpoint, since a copied package can introduce peers of its own.
await closeWorkspacePeers(join(staging, 'node_modules'))

/**
 * Copy unsatisfied non-optional workspace peers into a staged closure until
 * none remain.
 * @param modules - the closure's `node_modules` directory.
 * @throws when a required peer names no workspace package, which means the
 *   closure can never be completed by copying and the manifest is wrong.
 */
async function closeWorkspacePeers(modules: string): Promise<void> {
  const workspace = await workspacePackages()
  for (;;) {
    const present = new Set(await installedPackages(modules))
    const missing = new Set<string>()
    for (const name of present) {
      const manifestPath = join(modules, name, 'package.json')
      if (!existsSync(manifestPath)) continue
      const packageManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
        readonly peerDependencies?: Readonly<Record<string, string>>
        readonly peerDependenciesMeta?: Readonly<Record<string, { readonly optional?: boolean }>>
      }
      for (const peer of Object.keys(packageManifest.peerDependencies ?? {})) {
        if (packageManifest.peerDependenciesMeta?.[peer]?.optional === true) continue
        if (!present.has(peer)) missing.add(peer)
      }
    }
    if (missing.size === 0) return
    for (const name of missing) {
      const source = workspace.get(name)
      if (source === undefined) throw new Error(`desktop host staging: peer ${name} is not a workspace package`)
      await cp(source, join(modules, name), {
        recursive: true,
        dereference: true,
        filter: path => !path.split(sep).includes('node_modules') && !path.endsWith('.tsbuildinfo'),
      })
    }
  }
}

/**
 * List the packages a closure already carries, scope directories included.
 * @param modules - the closure's `node_modules` directory.
 * @returns package names as they are imported (`@scope/name` or `name`).
 */
async function installedPackages(modules: string): Promise<readonly string[]> {
  const names: string[] = []
  for (const entry of await readdir(modules, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || !entry.isDirectory()) continue
    if (!entry.name.startsWith('@')) { names.push(entry.name); continue }
    for (const scoped of await readdir(join(modules, entry.name), { withFileTypes: true })) {
      if (scoped.isDirectory()) names.push(`${entry.name}/${scoped.name}`)
    }
  }
  return names
}

/**
 * Index every workspace package by its declared name.
 * @returns a map from package name to its directory in this repository.
 */
async function workspacePackages(): Promise<ReadonlyMap<string, string>> {
  const index = new Map<string, string>()
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (['node_modules', 'lib', 'tests', 'src', '.stage', 'release', '.git'].includes(entry.name)) continue
      const child = join(directory, entry.name)
      const manifestPath = join(child, 'package.json')
      if (existsSync(manifestPath)) {
        const { name } = JSON.parse(await readFile(manifestPath, 'utf8')) as { readonly name?: string }
        if (name !== undefined) index.set(name, child)
      }
      await walk(child)
    }
  }
  for (const root of ['packages', 'vendor', 'apps', 'native']) await walk(join(repositoryRoot, root))
  return index
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
