/**
 * Copy the staged Host's `node_modules` into the packaged app.
 *
 * `extraResources` carries `.stage/host` into `Contents/Resources/host`, but
 * electron-builder drops `node_modules` from that copy — an explicit
 * `filter: ['**\/*']` does not bring it back. Without it the packaged Host
 * cannot resolve `@deepseek-ai/dsh-app-boot` and exits before readiness, which
 * the window reports as "Science Host needs attention". The staged closure is
 * already symlink-free and production-only (`stage-host.ts`), so a plain
 * recursive copy is the whole fix.
 */
import { cp } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * electron-builder `afterPack` hook.
 * @param context - the hook context electron-builder supplies.
 * @param context.appOutDir - directory holding the packaged application.
 * @param context.electronPlatformName - Electron's platform name for this build.
 * @param context.packager - the platform packager, used for the product file name.
 * @returns nothing; the copy is complete when the promise settles.
 */
export default async function afterPack({ appOutDir, electronPlatformName, packager }) {
  const resources = electronPlatformName === 'darwin'
    ? join(appOutDir, `${packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : join(appOutDir, 'resources')
  await cp(
    join(desktopRoot, '.stage/host/node_modules'),
    join(resources, 'host/node_modules'),
    { recursive: true, verbatimSymlinks: true },
  )
}
