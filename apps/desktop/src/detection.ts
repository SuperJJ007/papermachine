/** Detect existing conda-family environments the desktop can bind without any provisioning. */

import { execFile } from 'node:child_process'
import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import { buildProvisioningEnv } from './provisioning.ts'

const execFileAsync = promisify(execFile)

/**
 * Whether `error` is a Node filesystem errno failure (has a string `code`),
 * as opposed to a programming defect that must still surface. Every
 * per-root and per-candidate filesystem probe in this module treats an
 * errno failure — ENOENT/ENOTDIR/ELOOP alike, but broadened past the
 * `missingPathError` precedent (science-runtime's `environment.ts`) to
 * include EACCES and every other errno — as "this item is unusable", never
 * as a reason to abort the rest of the scan: an unreadable root, a symlink
 * loop, or a root that turns out to be a plain file must drop only that
 * root or candidate.
 * @param error - the value caught from a filesystem call.
 */
function isFilesystemError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && typeof (error as { readonly code?: unknown }).code === 'string'
}

/**
 * Conda-family install roots this module scans by OS/vendor convention:
 * Anaconda, Miniconda, Miniforge, Mambaforge, and Micromamba's default
 * per-user prefixes, plus the two common system-wide Miniconda/Anaconda
 * locations and the Homebrew Cask miniconda prefix. These are fixed
 * install-location conventions, not a deployment-varying tunable, and
 * apps/desktop has no existing settings/config seam to source additional
 * roots from — a real seam (a validated desktop settings field) should
 * carry any future additions instead of growing this list ad hoc.
 * @param home - the home directory to root the per-user prefixes under.
 * @returns absolute candidate root paths; existence is checked by the caller.
 */
function conventionalRoots(home: string): readonly string[] {
  return [
    join(home, 'anaconda3'),
    join(home, 'miniconda3'),
    join(home, 'miniforge3'),
    join(home, 'mambaforge'),
    join(home, 'micromamba'),
    '/opt/anaconda3',
    '/opt/miniconda3',
    '/opt/homebrew/Caskroom/miniconda/base',
  ]
}

/**
 * Whether `path` exists and is a regular file, following symlinks (conda
 * commonly symlinks `bin/python`). Any filesystem error (missing,
 * unreadable, or a broken path) reports absence rather than aborting the
 * caller's scan.
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
 * (science-runtime's `environment.ts`) so a candidate this module qualifies
 * is one the Runtime would also accept. Any filesystem error reports
 * absence rather than aborting the caller's scan.
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
 * A root itself (the base environment) plus every immediate child of its
 * `envs/` directory (named environments created under that root),
 * including a symlinked child — {@link dedupeByRealpath} resolves it to its
 * real path along with everything else, so admitting it here cannot
 * introduce a duplicate. A root or `envs/` directory this process cannot
 * read (missing, a plain file, unreadable, or a symlink loop) contributes
 * no children rather than aborting the whole scan; the root path itself is
 * still returned so the caller's later qualification check decides its
 * fate.
 * @param root - a conventional root path; need not exist.
 * @returns candidate prefixes; existence is checked by the caller.
 */
async function rootAndChildren(root: string): Promise<readonly string[]> {
  const envsDir = join(root, 'envs')
  let children: readonly string[] = []
  try {
    const entries = await readdir(envsDir, { withFileTypes: true })
    children = entries.filter(entry => entry.isDirectory() || entry.isSymbolicLink()).map(entry => join(envsDir, entry.name))
  } catch (error) {
    if (!isFilesystemError(error)) throw error
  }
  return [root, ...children]
}

/**
 * Absolute prefixes listed one per line in `~/.conda/environments.txt`, as
 * conda itself writes on `conda create`.
 * @param home - the home directory `.conda/environments.txt` is read from.
 */
async function environmentsTxtPrefixes(home: string): Promise<readonly string[]> {
  let content: string
  try {
    content = await readFile(join(home, '.conda', 'environments.txt'), 'utf8')
  } catch (error) {
    if (isFilesystemError(error)) return []
    throw error
  }
  return content.split(/\r?\n/u).map(line => line.trim()).filter(line => line.length > 0 && isAbsolute(line))
}

/**
 * Collapse candidate paths to their resolved real path, dropping
 * duplicates and any path this process cannot resolve — missing, a broken
 * symlink, a symlink loop (`ELOOP`), or one it lacks permission to
 * traverse (`EACCES`) — rather than aborting the rest of the scan.
 */
async function dedupeByRealpath(paths: readonly string[]): Promise<readonly string[]> {
  const seen = new Set<string>()
  const result: string[] = []
  for (const path of paths) {
    let real: string
    try {
      real = await realpath(path)
    } catch (error) {
      if (isFilesystemError(error)) continue
      throw error
    }
    if (seen.has(real)) continue
    seen.add(real)
    result.push(real)
  }
  return result
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
 * the same POSIX layout `staticInterpreter` requires. Shared by full
 * detection and by the `desktop:bind` handler's TOCTOU re-check, so both
 * apply exactly this rule.
 * @param prefix - the candidate absolute prefix path.
 * @returns interpreter presence, or `undefined` if `prefix` does not qualify.
 */
export async function qualifyingInterpreters(prefix: string): Promise<InterpreterPresence | undefined> {
  if (!(await regularFileExistsNoSymlink(join(prefix, 'conda-meta', 'history')))) return undefined
  const python = await regularFileExists(join(prefix, 'bin', 'python'))
  const r = await regularFileExists(join(prefix, 'bin', 'Rscript'))
  return python || r ? { python, r } : undefined
}

// Local `--version` output is expected near-instantly; this only bounds a
// broken or hung interpreter from blocking detection, not a legitimate
// startup cost, so it is a fixed internal timing constant rather than a
// configurable field (parallel to KILL_GRACE_MS in provisioning.ts).
const PROBE_TIMEOUT_MS = 5_000

/**
 * Run `executable --version` with a scrubbed environment and a short
 * timeout, returning its trimmed output. A probe failure (missing
 * executable, non-zero exit, or timeout) marks that interpreter's version as
 * unavailable rather than failing detection for the whole prefix — the
 * qualification check above, not this probe, decides whether the prefix is
 * usable.
 * @param executable - absolute path to the interpreter binary.
 * @returns trimmed `--version` output, or `undefined` on any probe failure.
 */
async function probeVersion(executable: string): Promise<string | undefined> {
  const result = await execFileAsync(executable, ['--version'], {
    env: buildProvisioningEnv(),
    timeout: PROBE_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  }).catch(() => undefined)
  if (result === undefined) return undefined
  const text = result.stdout.trim() || result.stderr.trim()
  return text.length > 0 ? text : undefined
}

/** One qualifying conda-family environment found on disk, with best-effort interpreter versions. */
export interface CondaCandidate {
  readonly prefix: string
  readonly pythonVersion?: string
  readonly rVersion?: string
}

/**
 * Test-only overrides for {@link detectCondaEnvironments}; production always
 * scans the real home directory and {@link conventionalRoots}.
 */
export interface DetectionOptions {
  /** Overrides the home directory scanned for conventional roots and `.conda/environments.txt`. */
  readonly home?: string
  /**
   * Overrides the list of roots scanned (each root plus its `envs/*`
   * children), replacing {@link conventionalRoots}. Lets a test scan only
   * paths it created instead of this machine's real `/opt/...` and per-user
   * install locations, which would otherwise make detection nondeterministic
   * and spawn real interpreters found there.
   */
  readonly roots?: readonly string[]
}

/**
 * Enumerate qualifying conda-family environments without any terminal or
 * conda invocation: scan the roots (each root plus its `envs/*` children)
 * and parse `~/.conda/environments.txt`, dedupe by real path, then keep
 * only prefixes {@link qualifyingInterpreters} accepts. A failure scanning
 * one root or qualifying one candidate drops that root or candidate; this
 * function itself never rejects for a filesystem condition.
 * @param options - test-only home directory and root-list overrides; omit both in production.
 * @returns qualifying candidates in root-scan order, environments.txt-only entries last.
 */
export async function detectCondaEnvironments(options: DetectionOptions = {}): Promise<readonly CondaCandidate[]> {
  const home = options.home ?? homedir()
  const roots = options.roots ?? conventionalRoots(home)
  const fromRoots = (await Promise.all(roots.map(rootAndChildren))).flat()
  const fromEnvironmentsTxt = await environmentsTxtPrefixes(home)
  const deduped = await dedupeByRealpath([...fromRoots, ...fromEnvironmentsTxt])
  const described = await Promise.all(deduped.map(async (prefix): Promise<CondaCandidate | undefined> => {
    const presence = await qualifyingInterpreters(prefix)
    if (presence === undefined) return undefined
    const pythonVersion = presence.python ? await probeVersion(join(prefix, 'bin', 'python')) : undefined
    const rVersion = presence.r ? await probeVersion(join(prefix, 'bin', 'Rscript')) : undefined
    return {
      prefix,
      ...(pythonVersion === undefined ? {} : { pythonVersion }),
      ...(rVersion === undefined ? {} : { rVersion }),
    }
  }))
  return described.filter((candidate): candidate is CondaCandidate => candidate !== undefined)
}
