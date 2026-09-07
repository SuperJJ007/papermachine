/**
 * Copy the staged Host's `node_modules` into the packaged app, then drop
 * every sharp/koffi native module variant that is not this build's own
 * platform and architecture.
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
 * packaging target's sharp/koffi native module variant — that is the whole
 * point of `pnpm-workspace.yaml`'s `supportedArchitectures` — because
 * staging runs once per host machine, not once per packaging target, and
 * `stage-host.ts` itself asserts all three targets are present before
 * packaging ever reaches this hook. Left in place, an x64 DMG built on an
 * arm64 mac (or a Windows package cross-built on a mac) would ship the host
 * machine's own darwin-arm64 sharp/koffi binaries under an x64 or win32 app,
 * which fail to load at runtime with no signal at build time. This hook
 * prunes down to the one variant this electron-builder invocation is
 * building for.
 */
import { cp, readdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Arch } from 'electron-builder'
import { selectNativeModuleTargets } from './native-module-targets.mjs'

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/** `node_modules` scope directories that carry platform-specific sharp/koffi native modules. */
const NATIVE_MODULE_SCOPES = Object.freeze(['@img', '@koromix'])

/**
 * electron-builder `afterPack` hook.
 * @param context - the hook context electron-builder supplies.
 * @param context.appOutDir - directory holding the packaged application.
 * @param context.electronPlatformName - Electron's platform name for this build (`darwin`/`win32`/`linux`).
 * @param context.arch - this build's `Arch` enum value (`Arch.x64 === 1`, `Arch.arm64 === 3`).
 * @param context.packager - the platform packager, used for the product file name.
 * @returns nothing; pruning is complete when the promise settles.
 */
export default async function afterPack({ appOutDir, electronPlatformName, arch, packager }) {
  const resources = electronPlatformName === 'darwin'
    ? join(appOutDir, `${packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : join(appOutDir, 'resources')
  const hostModules = join(resources, 'host/node_modules')
  await cp(join(desktopRoot, '.stage/host/node_modules'), hostModules, { recursive: true, verbatimSymlinks: true })
  await pruneNativeModules(hostModules, { os: electronPlatformName, arch: Arch[arch] })
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
    const entries = await readdir(scopeDir)
    const { remove } = selectNativeModuleTargets(target, entries)
    for (const name of remove) await rm(join(scopeDir, name), { recursive: true, force: true })
  }
}
