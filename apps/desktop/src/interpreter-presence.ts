/** Whether a filesystem prefix has the POSIX layout Science Runtime accepts as a conda-family environment. */

import { lstat, stat } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Whether `error` is a Node filesystem errno failure (has a string `code`),
 * as opposed to a programming defect that must still surface.
 * @param error - the value caught from a filesystem call.
 */
function isFilesystemError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && typeof (error as { readonly code?: unknown }).code === 'string'
}

/**
 * Whether `path` exists and is a regular file, following symlinks (conda
 * commonly symlinks `bin/python`). Any filesystem error (missing,
 * unreadable, or a broken path) reports absence rather than throwing.
 */
async function regularFileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch (error) {
    if (isFilesystemError(error)) return false
    throw error
  }
}

/**
 * Whether `path` exists as a regular, non-symlinked file — `lstat`
 * semantics, matching `staticInterpreter`'s own `conda-meta/history` check
 * (science-runtime's `environment.ts`) so a prefix this module qualifies is
 * one the Runtime would also accept. Any filesystem error reports absence
 * rather than throwing.
 */
async function regularFileExistsNoSymlink(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isFile()
  } catch (error) {
    if (isFilesystemError(error)) return false
    throw error
  }
}

/**
 * Where the two interpreters sit inside a conda prefix on this platform.
 * Mirrors `EXECUTABLE_LAYOUTS` in science-runtime's `environment.ts`, which
 * this carrier cannot import: the Host that owns that table runs as a
 * separate process staged into the package. The two must name the same
 * files, or a prefix this application accepts fails to bind in the Host.
 */
const INTERPRETER_LAYOUT = process.platform === 'win32'
  ? { python: ['python.exe'], r: ['Scripts', 'Rscript.exe'] } as const
  : { python: ['bin', 'python'], r: ['bin', 'Rscript'] } as const

/** Which of the two Science interpreters a qualifying prefix has present. */
export interface InterpreterPresence {
  readonly python: boolean
  readonly r: boolean
}

/**
 * Whether `prefix` qualifies as a conda-family Science environment, and
 * which interpreters it has if so: a regular, non-symlinked
 * `conda-meta/history` file (written by conda/mamba/micromamba only on
 * environment creation, so its presence distinguishes a real environment
 * from an arbitrary directory — checked with `lstat` semantics, matching
 * `staticInterpreter` (science-runtime), which rejects a symlinked history)
 * plus at least one of the two interpreters at {@link INTERPRETER_LAYOUT},
 * following symlinks — the same per-platform layout `staticInterpreter`
 * requires. `bindProvisionedPrefix` (`main.ts`) calls this to re-validate a
 * prefix this application just provisioned, immediately before writing the
 * binding that names it.
 * @param prefix - the candidate absolute prefix path.
 * @returns interpreter presence, or `undefined` if `prefix` does not qualify.
 */
export async function qualifyingInterpreters(prefix: string): Promise<InterpreterPresence | undefined> {
  if (!(await regularFileExistsNoSymlink(join(prefix, 'conda-meta', 'history')))) return undefined
  const python = await regularFileExists(join(prefix, ...INTERPRETER_LAYOUT.python))
  const r = await regularFileExists(join(prefix, ...INTERPRETER_LAYOUT.r))
  return python || r ? { python, r } : undefined
}
