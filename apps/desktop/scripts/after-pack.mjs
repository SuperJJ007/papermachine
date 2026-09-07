/**
 * Copy the staged Host's `node_modules` into the packaged app, drop every
 * sharp/koffi native module variant that is not this build's own platform
 * and architecture, assert the packaged output actually carries the
 * bundled micromamba runtime `resources/bin` needs (win32's app-local MSVC
 * CRT DLLs included), then (darwin only) ad-hoc deep-sign the packaged app —
 * see `sign-mac-app.mjs` for why.
 *
 * `extraResources` carries `.stage/host` into `Contents/Resources/host`, but
 * electron-builder drops `node_modules` from that copy — an explicit
 * `filter: ['**\/*']` does not bring it back. Without it the packaged Host
 * cannot resolve `@deepseek-ai/dsh-app-boot` and exits before readiness, which
 * the window reports as "Science Host needs attention". The staged closure is
 * already symlink-free and production-only (`stage-host.ts`), so a plain
 * recursive copy is the whole fix for that part.
 *
 * `pnpm deploy --prod --offline` (`stage-host.ts`) carries every desktop
 * packaging target's sharp/koffi native module variant — the `pnpm install`
 * step immediately before packaging widens `--os`/`--cpu`/`--libc` for
 * exactly this reason (`.github/workflows/desktop-release.yml`,
 * `apps/desktop/README.md`) — because staging runs once
 * per host machine, not once per packaging target, and `stage-host.ts`
 * itself asserts all three targets are present before packaging ever
 * reaches this hook. Left in place, an x64 DMG built on an arm64 mac (or a
 * Windows package cross-built on a mac) would ship the host machine's own
 * darwin-arm64 sharp/koffi binaries under an x64 or win32 app, which fail to
 * load at runtime with no signal at build time. This hook prunes down to the
 * one variant this electron-builder invocation is building for.
 *
 * `electron-builder.yml`'s `win.extraResources`/`mac.extraResources` copy
 * `resources/bin/<os>-<arch>` into the package through app-builder-lib's own
 * `${arch}` macro expansion, which warns rather than throws when its `from`
 * does not exist — a broken macro, a renamed directory, or a packaging run
 * that skipped `fetch:micromamba` would otherwise produce a package missing
 * micromamba (and win32's app-local CRT DLLs) with a green build. This hook
 * runs after that copy (app-builder-lib calls `afterPack` once
 * `extraResources` is already on disk), so it is the one place that can
 * assert the packaged output itself carries what `resources/micromamba.json`
 * pins, not just what `fetch:micromamba` wrote into the source tree.
 */
import { existsSync } from 'node:fs'
import { cp, readdir, readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Arch } from 'electron-builder'
import { NATIVE_MODULE_SCOPES, selectForeignPlatformEntries, selectNativeModuleTargets } from './native-module-targets.mjs'
import { maybeSignMacApp } from './sign-mac-app.mjs'

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * electron-builder `afterPack` hook.
 * @param context - the hook context electron-builder supplies.
 * @param context.appOutDir - directory holding the packaged application.
 * @param context.electronPlatformName - Electron's platform name for this build (`darwin`/`win32`/`linux`).
 * @param context.arch - this build's `Arch` enum value (`Arch.x64 === 1`, `Arch.arm64 === 3`).
 * @param context.packager - the platform packager, used for the product file name.
 * @returns nothing; pruning, verification, and (darwin only) signing are complete when the promise settles.
 */
export default async function afterPack({ appOutDir, electronPlatformName, arch, packager }) {
  const appPath = join(appOutDir, `${packager.appInfo.productFilename}.app`)
  const resources = electronPlatformName === 'darwin'
    ? join(appPath, 'Contents', 'Resources')
    : join(appOutDir, 'resources')
  const target = { os: electronPlatformName, arch: Arch[arch] }
  const hostModules = join(resources, 'host/node_modules')
  await cp(join(desktopRoot, '.stage/host/node_modules'), hostModules, { recursive: true, verbatimSymlinks: true })
  await pruneNativeModules(hostModules, target)
  await pruneForeignPlatformVariants(hostModules, target)
  await assertBundledRuntimePresent(resources, target)
  await maybeSignMacApp(electronPlatformName, appPath)
}

/**
 * Delete every sharp/koffi native module variant that does not belong to
 * `target`. `selectNativeModuleTargets` throws if `target`'s own variant is
 * itself missing, so a packaging run that started from an incomplete staged
 * closure fails here rather than shipping a Host that cannot load sharp or
 * koffi.
 * @param modules - the packaged app's `host/node_modules` directory.
 * @param target - this electron-builder run's platform and architecture, in
 *   the `{os, arch}` naming {@link selectNativeModuleTargets} expects.
 * @returns nothing; every non-matching directory is removed when the
 *   promise settles.
 */
async function pruneNativeModules(modules, target) {
  for (const scope of NATIVE_MODULE_SCOPES) {
    const scopeDir = join(modules, scope)
    let entries
    try {
      entries = await readdir(scopeDir)
    } catch (cause) {
      throw new Error(
        `after-pack: ${scopeDir} does not exist — the staged closure never installed ${scope}'s native module ` +
        `packages (${cause instanceof Error ? cause.message : String(cause)}).`,
      )
    }
    const { remove } = selectNativeModuleTargets(scope, target, entries)
    for (const name of remove) await rm(join(scopeDir, name), { recursive: true, force: true })
  }
}

/**
 * Delete every other-platform variant of a per-platform-optionalDependency
 * package found anywhere under `modules`, outside `@img`/`@koromix` (already
 * pruned precisely by {@link pruneNativeModules}). The `pnpm install` step
 * before packaging widens `--os`/`--cpu`/`--libc` for the whole workspace,
 * so every native-binary package with per-platform variants — ripgrep,
 * `node-addon-require-builtin`, the Landlock launcher, and others — gets
 * every platform's variant staged into the Host closure alongside
 * sharp/koffi. Left unpruned, a packaged installer ships tens of megabytes
 * of native binaries for platforms it will never run on.
 * @param modules - the packaged app's `host/node_modules` directory.
 * @param target - this electron-builder run's platform and architecture.
 * @returns nothing; every non-matching directory found is removed when the
 *   promise settles.
 */
async function pruneForeignPlatformVariants(modules, target) {
  const candidates = []
  for (const entry of await readdir(modules, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || NATIVE_MODULE_SCOPES.includes(entry.name)) continue
    if (!entry.name.startsWith('@')) {
      candidates.push({ alias: entry.name, path: join(modules, entry.name) })
      continue
    }
    const scopeDir = join(modules, entry.name)
    for (const scoped of await readdir(scopeDir, { withFileTypes: true })) {
      if (scoped.isDirectory()) candidates.push({ alias: `${entry.name}/${scoped.name}`, path: join(scopeDir, scoped.name) })
    }
  }
  const remove = new Set(selectForeignPlatformEntries(target, candidates.map(candidate => candidate.alias)))
  for (const candidate of candidates) {
    if (remove.has(candidate.alias)) await rm(candidate.path, { recursive: true, force: true })
  }
}

/**
 * Assert the packaged app's `resources/bin/<os>-<arch>` carries the
 * micromamba executable `resources/micromamba.json` pins for `target`, and
 * (win32 only) every app-local MSVC CRT DLL its `runtime.files` list names.
 * Checking the packaged output rather than the source tree `fetch:micromamba`
 * wrote into catches a broken `electron-builder.yml` `extraResources` entry
 * (a bad `${arch}` macro, a renamed directory) that a source-tree-only check
 * cannot see, since app-builder-lib only warns, never throws, when an
 * `extraResources` `from` path does not exist.
 * @param resources - the packaged app's `Resources` (darwin) or `resources`
 *   (win32) directory.
 * @param target - this electron-builder run's platform and architecture.
 * @returns nothing; resolves once every pinned file is confirmed present.
 * @throws when `resources/micromamba.json` pins no asset for `target`, or
 *   the packaged `resources/bin/<os>-<arch>` is missing the executable or
 *   any pinned CRT DLL.
 */
async function assertBundledRuntimePresent(resources, target) {
  const platform = `${target.os}-${target.arch}`
  const manifest = JSON.parse(await readFile(join(desktopRoot, 'resources/micromamba.json'), 'utf8'))
  const asset = manifest[platform]
  if (typeof asset !== 'object' || asset === null) {
    throw new Error(`after-pack: resources/micromamba.json has no pinned asset for ${platform}`)
  }
  const binDir = join(resources, 'bin', platform)
  const executableName = target.os === 'win32' ? 'micromamba.exe' : 'micromamba'
  const executablePath = join(binDir, executableName)
  if (!existsSync(executablePath)) {
    throw new Error(
      `after-pack: packaged app is missing ${executablePath} — fetch:micromamba ${platform} did not run before ` +
      'packaging, or electron-builder.yml\'s extraResources entry for resources/bin did not copy it.',
    )
  }
  for (const name of asset.runtime?.files ?? []) {
    const path = join(binDir, name)
    if (!existsSync(path)) {
      throw new Error(
        `after-pack: packaged app is missing app-local CRT DLL ${path}, pinned by resources/micromamba.json's ` +
        `runtime.files for ${platform}.`,
      )
    }
  }
}
