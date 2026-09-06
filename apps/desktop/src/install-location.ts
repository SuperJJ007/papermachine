/**
 * Persisted, user-chosen Harness home location: a pointer file directly
 * under the OS home directory, read by `main.ts`'s `harnessHome()` and
 * written by the `desktop:choose-install-location` /
 * `desktop:reset-install-location` IPC handlers. The pointer supplies
 * `resolveHarnessHome`'s `customHomeDir` argument (`harness-home.ts`), the
 * only precedence tier a GUI user can set without an environment variable.
 */

import { readFile, rm } from 'node:fs/promises'
import { basename, isAbsolute, join, win32 as win32Path } from 'node:path'
import { writeFileAtomic } from './atomic-write.ts'
import { HarnessHomeSpaceError } from './harness-home.ts'

/** ASCII-only filename so the pointer stays readable even when the OS home path itself is otherwise problematic. */
const POINTER_FILE_NAME = '.papermachine-home'

/**
 * Fixed subdirectory name {@link resolveChosenInstallLocationPath} appends
 * under a directory the install-location picker returns, rather than
 * handing the chosen directory itself to `resolveHarnessHome`.
 */
const INSTALL_LOCATION_SUBDIRECTORY_NAME = 'PaperMachine'

/**
 * Path to the install-location pointer file under `osHomeDir`.
 * @param osHomeDir - the OS user home directory (Electron's `app.getPath('home')`).
 * @returns the absolute pointer file path.
 */
export function installLocationPointerPath(osHomeDir: string): string {
  return join(osHomeDir, POINTER_FILE_NAME)
}

/**
 * Read the persisted install location, if any. A pointer file that exists
 * but is empty, whitespace-only, or names a relative path fails loud rather
 * than falling back to the default Harness home silently — the same
 * misconfiguration-fails-loud rule `resolveHarnessHome` applies to a
 * space-containing candidate.
 * @param osHomeDir - the OS user home directory the pointer file lives under.
 * @returns the trimmed absolute path the pointer names, or `undefined` when no pointer file exists.
 * @throws when the pointer file exists but is unreadable, empty, whitespace-only, or names a non-absolute path.
 */
export async function readInstallLocationPointer(osHomeDir: string): Promise<string | undefined> {
  const file = installLocationPointerPath(osHomeDir)
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new Error(`desktop install location: cannot read ${file} (${String((error as NodeJS.ErrnoException).code ?? error)})`)
  }
  const value = raw.trim()
  if (value.length === 0) throw new Error(`desktop install location: ${file} is empty`)
  if (!isAbsolute(value)) throw new Error(`desktop install location: ${file} must contain an absolute path, got ${JSON.stringify(value)}`)
  return value
}

/**
 * Persist `path` as the install location, replacing any existing pointer
 * atomically ({@link writeFileAtomic}) so a crash or concurrent read never
 * observes a partially written file.
 * @param osHomeDir - the OS user home directory the pointer file lives under.
 * @param path - the absolute Harness home path to persist.
 */
export async function writeInstallLocationPointer(osHomeDir: string, path: string): Promise<void> {
  await writeFileAtomic(installLocationPointerPath(osHomeDir), `${path}\n`, { mode: 0o600 })
}

/**
 * Remove the install-location pointer, reverting `resolveHarnessHome` to its
 * `PAPERMACHINE_HOME`/`DSH_HOME`/default precedence. A missing pointer file
 * is not an error.
 * @param osHomeDir - the OS user home directory the pointer file lives under.
 */
export async function clearInstallLocationPointer(osHomeDir: string): Promise<void> {
  await rm(installLocationPointerPath(osHomeDir), { force: true })
}

/**
 * Whether `path` contains a character outside the ASCII range — an
 * unconfirmed risk for some conda and R packages, warned about rather than
 * rejected.
 * @param path - the path to inspect.
 * @returns `true` when any character in `path` is outside ASCII.
 */
export function hasNonAsciiCharacters(path: string): boolean {
  for (let index = 0; index < path.length; index += 1) {
    if (path.charCodeAt(index) > 0x7f) return true
  }
  return false
}

/**
 * Compute the Harness home path from a directory the install-location
 * picker returned. The picker's `defaultPath` is the current Harness home's
 * own parent directory, so confirming it without navigating anywhere would
 * otherwise reuse that parent directory itself — `~` by default, or a
 * Windows drive root such as `D:\` — as the new Harness home outright,
 * scattering `environments/`, `micromamba/`, and every session file
 * directly into it. Appending {@link INSTALL_LOCATION_SUBDIRECTORY_NAME}
 * turns every such choice into a dedicated subdirectory instead, skipped
 * only when `chosen` already ends in one — an existing `PaperMachine`
 * directory under the chosen location is reused as-is rather than
 * duplicated — so this is idempotent: calling it again on its own return
 * value returns that value unchanged.
 * @param chosen - the directory `dialog.showOpenDialog` returned.
 * @param platform - `process.platform`; darwin's and win32's default
 *   filesystems are case-insensitive, so the basename comparison on those
 *   platforms ignores case, and win32 paths are parsed with `node:path`'s
 *   `win32` module regardless of the host this runs on.
 * @returns the path to validate and, if accepted, persist as the new Harness home.
 */
export function resolveChosenInstallLocationPath(chosen: string, platform: NodeJS.Platform): string {
  const isWindows = platform === 'win32'
  const name = isWindows ? win32Path.basename(chosen) : basename(chosen)
  const caseInsensitive = isWindows || platform === 'darwin'
  const alreadyNamed = caseInsensitive
    ? name.toLowerCase() === INSTALL_LOCATION_SUBDIRECTORY_NAME.toLowerCase()
    : name === INSTALL_LOCATION_SUBDIRECTORY_NAME
  if (alreadyNamed) return chosen
  return isWindows ? win32Path.join(chosen, INSTALL_LOCATION_SUBDIRECTORY_NAME) : join(chosen, INSTALL_LOCATION_SUBDIRECTORY_NAME)
}

/** `dialog.showMessageBox` options built by {@link installLocationConfirmationDialog}. */
export interface InstallLocationConfirmationDialog {
  readonly message: string
  readonly detail: string
  readonly buttons: readonly [string, string]
  readonly defaultId: 0
  readonly cancelId: 1
}

/**
 * Build the confirmation dialog `desktop:choose-install-location` shows
 * after the picker and its validation, immediately before writing the
 * pointer and relaunching: naming the exact resolved path (already
 * including any subdirectory {@link resolveChosenInstallLocationPath}
 * appended) so a user is shown, and can decline, what would otherwise
 * become the new Harness home without further confirmation.
 * @param target - the resolved Harness home path {@link resolveChosenInstallLocationPath} returned.
 * @returns the `dialog.showMessageBox` options this confirmation renders.
 */
export function installLocationConfirmationDialog(target: string): InstallLocationConfirmationDialog {
  return {
    message: '确认安装位置 · Confirm install location',
    detail: `PaperMachine 将安装到以下目录：\n${target}\n\nPaperMachine will install to the following directory:\n${target}`,
    buttons: ['确定 · OK', '取消 · Cancel'],
    defaultId: 0,
    cancelId: 1,
  }
}

/**
 * Whether a response index from {@link installLocationConfirmationDialog}'s
 * dialog confirms writing the pointer and relaunching. Declining leaves the
 * pointer file — and everything else — untouched, reported the same
 * `cancelled` result a dismissed picker or a declined non-ASCII warning
 * already report.
 * @param response - `dialog.showMessageBox`'s `response` field: the index
 *   of the button the user chose.
 * @returns `true` only for the dialog's first ("确定 · OK") button.
 */
export function confirmsInstallLocation(response: number): boolean {
  return response === 0
}

/**
 * Whether a Harness-home resolution failure is a pointer's target becoming
 * unreachable (an unplugged drive, an unmounted network share, a permission
 * change) — the case `main.ts`'s `boot()` routes to
 * `installLocationUnavailableErrorPage` instead of the general launch-error
 * page, because restarting the Host against the same pointer cannot help
 * and the fix is to fall back to the default Harness home. `false` both
 * when no pointer is in effect (the default location itself failed, which
 * a pointer cannot rescue) and for {@link HarnessHomeSpaceError}, which
 * {@link classifyBootInstallLocationFailure} classifies as `'space'` and
 * routes to its own recovery page (`harnessHomeSpaceErrorPage`, offering
 * "choose another location" rather than "use the default location" — the
 * default location is exactly what just failed) before this function is
 * ever consulted.
 * @param pointer - the install-location pointer this launch read, or
 *   `undefined` when none is in effect.
 * @param error - the error `resolveHarnessHome` threw for `pointer`.
 * @returns whether `error` should route to the install-location-unavailable recovery page.
 */
export function isInstallLocationUnavailable(pointer: string | undefined, error: unknown): pointer is string {
  return pointer !== undefined && !(error instanceof HarnessHomeSpaceError)
}

/**
 * Placeholder target {@link classifyBootInstallLocationFailure} returns for
 * a pointer file that could not be read at all — there is no resolved path
 * to name, only a pointer in effect that this launch cannot use.
 */
export const UNREADABLE_INSTALL_LOCATION_POINTER_TARGET = '(unknown — the install-location pointer file could not be read)'

/**
 * Which of `main.ts`'s two install-location recovery windows
 * {@link classifyBootInstallLocationFailure} routes a boot failure to:
 * `'space'` for a {@link HarnessHomeSpaceError} on any candidate — a
 * pointer's target, or the default `<osHomeDir>/.papermachine` (a Windows
 * account name containing a space is the common real case) — carrying the
 * error itself so the recovery page can name the offending path; or
 * `'unavailable-pointer'` for a pointer this launch cannot use at all,
 * carrying the target to name ({@link UNREADABLE_INSTALL_LOCATION_POINTER_TARGET}
 * when the pointer file itself could not be read).
 */
export type BootInstallLocationFailure =
  | { readonly kind: 'space'; readonly error: HarnessHomeSpaceError }
  | { readonly kind: 'unavailable-pointer'; readonly target: string }

/**
 * Classify a failure in `main.ts`'s `boot()`'s very first Harness-home
 * resolution into which recovery window, if any, it should open. A
 * {@link HarnessHomeSpaceError} always classifies as `'space'`, regardless
 * of whether a pointer is in effect: choosing a different install location
 * is the fix either way, and the space-error recovery page's own
 * "choose another location" action offers exactly that (unlike the
 * install-location-unavailable page's "use the default location", which
 * cannot help when the default location is what just failed). A pointer
 * file that exists but cannot be read or parsed — `pointerUnreadable` — is
 * otherwise always recoverable as `'unavailable-pointer'`: a pointer is in
 * effect (that is why reading it failed) and the fix, clearing it, is the
 * same one {@link isInstallLocationUnavailable}'s cases use. `undefined`
 * only when no pointer is in effect and the failure is not a space error —
 * the default location's own unrecoverable failure, which rethrows
 * unchanged.
 * @param pointer - the install-location pointer this launch read, or
 *   `undefined` when reading it failed or no pointer file exists.
 * @param pointerUnreadable - whether `readInstallLocationPointer` itself
 *   threw, rather than `resolveHarnessHome`.
 * @param error - the error thrown by whichever of those two calls failed.
 * @returns which recovery window to open, or `undefined` to rethrow `error` unchanged.
 */
export function classifyBootInstallLocationFailure(
  pointer: string | undefined,
  pointerUnreadable: boolean,
  error: unknown,
): BootInstallLocationFailure | undefined {
  if (error instanceof HarnessHomeSpaceError) return { kind: 'space', error }
  if (pointerUnreadable) return { kind: 'unavailable-pointer', target: UNREADABLE_INSTALL_LOCATION_POINTER_TARGET }
  return isInstallLocationUnavailable(pointer, error) ? { kind: 'unavailable-pointer', target: pointer } : undefined
}
