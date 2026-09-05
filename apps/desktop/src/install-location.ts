/**
 * Persisted, user-chosen Harness home location: a pointer file directly
 * under the OS home directory, read by `main.ts`'s `harnessHome()` and
 * written by the `desktop:choose-install-location` /
 * `desktop:reset-install-location` IPC handlers. The pointer supplies
 * `resolveHarnessHome`'s `customHomeDir` argument (`harness-home.ts`), the
 * only precedence tier a GUI user can set without an environment variable.
 */

import { readFile, rm } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { writeFileAtomic } from './atomic-write.ts'

/** ASCII-only filename so the pointer stays readable even when the OS home path itself is otherwise problematic. */
const POINTER_FILE_NAME = '.papermachine-home'

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
