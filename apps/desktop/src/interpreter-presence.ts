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
 * plus at least one of `bin/python` or `bin/Rscript`, following symlinks —
 * the same POSIX layout `staticInterpreter` requires. `bindProvisionedPrefix`
 * (`main.ts`) calls this to re-validate a prefix this application just
 * provisioned, immediately before writing the binding that names it.
 * @param prefix - the candidate absolute prefix path.
 * @returns interpreter presence, or `undefined` if `prefix` does not qualify.
 */
export async function qualifyingInterpreters(prefix: string): Promise<InterpreterPresence | undefined> {
  if (!(await regularFileExistsNoSymlink(join(prefix, 'conda-meta', 'history')))) return undefined
  const python = await regularFileExists(join(prefix, 'bin', 'python'))
  const r = await regularFileExists(join(prefix, 'bin', 'Rscript'))
  return python || r ? { python, r } : undefined
}
