/** Detect existing conda-family environments the desktop can bind without any provisioning. */

import { execFile } from 'node:child_process'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import { buildProvisioningEnv } from './provisioning.ts'

const execFileAsync = promisify(execFile)

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

/** Whether `path` exists and is a regular file, following symlinks (conda commonly symlinks `bin/python`). */
async function regularFileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/**
 * A root itself (the base environment) plus every immediate child of its
 * `envs/` directory (named environments created under that root).
 * @param root - a conventional root path; need not exist.
 * @returns candidate prefixes; existence is checked by the caller.
 */
async function rootAndChildren(root: string): Promise<readonly string[]> {
  const envsDir = join(root, 'envs')
  let children: readonly string[] = []
  try {
    const entries = await readdir(envsDir, { withFileTypes: true })
    children = entries.filter(entry => entry.isDirectory()).map(entry => join(envsDir, entry.name))
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error
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
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return content.split(/\r?\n/u).map(line => line.trim()).filter(line => line.length > 0 && isAbsolute(line))
}

/** Collapse candidate paths to their resolved real path, dropping duplicates and paths that no longer exist. */
async function dedupeByRealpath(paths: readonly string[]): Promise<readonly string[]> {
  const seen = new Set<string>()
  const result: string[] = []
  for (const path of paths) {
    let real: string
    try {
      real = await realpath(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
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
 * which interpreters it has if so: a regular `conda-meta/history` file
 * (written by conda/mamba/micromamba only on environment creation, so its
 * presence distinguishes a real environment from an arbitrary directory)
 * plus at least one of `bin/python` or `bin/Rscript` — the same POSIX layout
 * `staticInterpreter` (science-runtime) requires. Shared by full detection
 * and by the `desktop:bind` handler's TOCTOU re-check, so both apply
 * exactly this rule.
 * @param prefix - the candidate absolute prefix path.
 * @returns interpreter presence, or `undefined` if `prefix` does not qualify.
 */
export async function qualifyingInterpreters(prefix: string): Promise<InterpreterPresence | undefined> {
  if (!(await regularFileExists(join(prefix, 'conda-meta', 'history')))) return undefined
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
 * Test-only override for the home directory {@link detectCondaEnvironments}
 * scans under; production always uses the real home directory.
 */
export interface DetectionOptions {
  readonly home?: string
}

/**
 * Enumerate qualifying conda-family environments without any terminal or
 * conda invocation: scan {@link conventionalRoots} (each root plus its
 * `envs/*` children) and parse `~/.conda/environments.txt`, dedupe by real
 * path, then keep only prefixes {@link qualifyingInterpreters} accepts.
 * @param options - test-only home directory override; omit in production.
 * @returns qualifying candidates in root-scan order, environments.txt-only entries last.
 */
export async function detectCondaEnvironments(options: DetectionOptions = {}): Promise<readonly CondaCandidate[]> {
  const home = options.home ?? homedir()
  const fromRoots = (await Promise.all(conventionalRoots(home).map(rootAndChildren))).flat()
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
