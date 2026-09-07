/** Produce a symlink-free production deployment of the existing dsh Host. */

import { spawn } from 'node:child_process'
import { cp, lstat, mkdir, readFile, readdir, realpath, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pnpmInvocation } from '../../../scripts/pnpm-invocation.ts'
import { DESKTOP_PLATFORMS } from '../src/environment-declaration.ts'
import { NATIVE_MODULE_SCOPES, selectNativeModuleTargets } from './native-module-targets.mjs'

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
// `pnpm deploy` resolves its own closure independently of whatever this
// workspace's own `node_modules` already has linked — it re-derives which
// optional native-module variant to include per family from the *current*
// `supportedArchitectures` config, the same as a fresh `pnpm install` would.
// So this deploy call needs the same `--os`/`--cpu`/`--libc` widening the
// install step before it used (`apps/desktop/README.md`,
// `.github/workflows/desktop-release.yml`) to pull every desktop target's
// sharp/koffi variant into the deployed closure, not just this deploy
// call's own machine's — that install step only guarantees the content is
// in the local store for this `--offline` deploy to find, not which
// variant deploy's own resolution picks.
// Resolved through `npm_execpath` rather than spawned by name: on Windows
// pnpm is a `.cmd` shim, which a shell-free `spawn` cannot execute.
const deploy = pnpmInvocation([
  '--offline', '--ignore-scripts', '--filter', '@deepseek-ai/dsh', 'deploy', '--prod',
  '--config.node-linker=hoisted',
  '--config.inject-workspace-packages=true', '--config.link-workspace-packages=true',
  '--os=darwin', '--os=win32', '--os=linux', '--cpu=x64', '--cpu=arm64', '--libc=glibc',
  staging,
])
await run(deploy.command, deploy.args)

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

await assertNativeModulesForEveryDesktopTarget(nodeModules)

await run(process.execPath, [
  join(staging, 'node_modules/@deepseek-ai/dsh-subprocess-local/scripts/ensure-spawn-helper.mjs'),
])

/**
 * Assert the staged closure carries every desktop packaging target's own
 * sharp/koffi native module variant, not just the machine that ran `pnpm
 * install`'s own. `after-pack.mjs` prunes this same closure down to one
 * target per packaged build; a runner missing a target's variant here would
 * silently produce a Host that exits before readiness on that target only,
 * discovered on the packaged machine rather than at staging time. A scope
 * directory missing entirely (every package under it failed to install) is
 * an error here rather than an empty entry list: reading it as `[]` would
 * let `selectNativeModuleTargets` reject the case it exists to catch, and
 * the scope directory's own absence is itself the most direct signal of
 * what went wrong.
 * @param modules - the staged closure's `node_modules` directory.
 * @throws when a `NATIVE_MODULE_SCOPES` directory does not exist, or a
 *   desktop target's sharp or koffi native module variant is missing,
 *   naming the fix: `pnpm install --os=darwin --os=win32 --os=linux --cpu=x64
 *   --cpu=arm64 --libc=glibc` (see `apps/desktop/README.md`).
 */
async function assertNativeModulesForEveryDesktopTarget(modules: string): Promise<void> {
  const scopes = new Map<string, readonly string[]>()
  for (const scope of NATIVE_MODULE_SCOPES) {
    const scopeDir = join(modules, scope)
    if (!existsSync(scopeDir)) {
      throw new Error(
        `desktop host staging: ${scopeDir} does not exist — the staged closure never installed ${scope}'s native ` +
        'module packages. Run `pnpm install --os=darwin --os=win32 --os=linux --cpu=x64 --cpu=arm64 ' +
        '--libc=glibc` (see apps/desktop/README.md), then reinstall.',
      )
    }
    scopes.set(scope, await readdir(scopeDir))
  }
  for (const platform of DESKTOP_PLATFORMS) {
    // `platform.split('-')` types its elements `string | undefined` under
    // `noUncheckedIndexedAccess`; `indexOf`/`slice` stay `string` throughout
    // since every `DESKTOP_PLATFORMS` entry is a fixed `<os>-<arch>` pair.
    const separator = platform.indexOf('-')
    const os = platform.slice(0, separator)
    const arch = platform.slice(separator + 1)
    for (const [scope, entries] of scopes) {
      try {
        selectNativeModuleTargets(scope, { os, arch }, entries)
      } catch (cause) {
        throw new Error(
          `desktop host staging: ${scope} is missing the ${platform} native module variant a packaged Host for ` +
          `that target needs (${(cause as Error).message}). Run \`pnpm install --os=darwin --os=win32 --os=linux ` +
          '--cpu=x64 --cpu=arm64 --libc=glibc\` (see apps/desktop/README.md).',
        )
      }
    }
  }
}
