/** Private Host scratch ownership for one Science Session. */

import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rm,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { canonicalizeWatchPath, resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { canonicalPath } from '@deepseek-ai/dsh-sandbox'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ScienceLanguage, ScienceRunId } from '@deepseek-ai/dsh-science-session'

/** Private directories and marker paths for one exact Session identity. */
export interface ScienceSessionScratch {
  /** Canonical Session root that is the run sandbox workspace. */
  readonly root: string
  /** Private home forwarded to child programs. */
  readonly home: string
  /** Private durable state directory forwarded to child programs. */
  readonly state: string
  /** Private published-run directory parent. */
  readonly runs: string
  /** Private unpublished-observation directory parent. */
  readonly probes: string
  /** Private persistent-kernel directory parent. */
  readonly kernels: string
}

/** Exact ownership created or verified by one pre-publication operation. */
export interface ScienceSessionScratchPreparation {
  /** Planned paths that were materialized or already existed. */
  readonly scratch: ScienceSessionScratch
  /** Whether this operation created the exact owner marker and Session root. */
  readonly created: boolean
  /** Private owner marker that must still match before rollback. */
  readonly marker: string
  /** Exact marker bytes written or verified for this Session. */
  readonly owner: string
}

/** Private paths prepared for one published run. */
export interface ScienceRunScratch {
  /** Session-relative durable directory reference. */
  readonly ref: string
  /** Host-only run directory. */
  readonly directory: string
  /** Exact source file path. */
  readonly source: string
  /** Owned artifact directory. */
  readonly artifacts: string
  /** Reserved artifact-input directory, absent until a run requests inputs. */
  readonly inputs: string
  /** Per-run stdout capture file path the RUN frame names. */
  readonly stdout: string
  /** Per-run stderr capture file path the RUN frame names. */
  readonly stderr: string
}

/** Private paths prepared for one unpublished interpreter probe. */
export interface ScienceProbeScratch {
  /** Host-only observation root and probe cwd. */
  readonly directory: string
  /** Owned HOME forwarded to the probe. */
  readonly home: string
  /** Owned TMPDIR forwarded to the probe. */
  readonly tmp: string
}

/** Private paths prepared for one persistent kernel process. */
export interface ScienceKernelScratch {
  /** Session-relative durable directory reference. */
  readonly ref: string
  /** Host-only kernel directory: spawn cwd and response-FIFO location. */
  readonly directory: string
  /** Owned baseline TMPDIR; the driver overrides it per run and restores it after. */
  readonly tmp: string
  /**
   * Owned per-kernel user-install base: forwarded as `PYTHONUSERBASE` for a
   * Python kernel (subdirectory `pyuser`) or `R_LIBS_USER` for an R kernel
   * (subdirectory `rlibs`) so an inline `pip install`/`install.packages()`
   * lands somewhere writable and importable within this kernel process —
   * scoped to this exact kernel instance and never carried to a same-language
   * successor kernel (idle restart, crash, or environment-rebound).
   */
  readonly userLibrary: string
}

const OWNER_VERSION = 1

/**
 * Compute one lower-case SHA-256 digest.
 * @param value - Exact byte sequence or UTF-8 string to hash.
 * @returns Lower-case hexadecimal SHA-256 digest.
 */
export function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * Derive the collision-resistant Session key for private scratch ownership.
 * @param session - Exact Session object whose opaque ID owns the key.
 * @returns Lower-case deterministic Session scratch key.
 */
export function sessionScratchKey(session: Session): string {
  return sha256(`dsh-science-session-v1\0${String(session.id)}`)
}

/**
 * Check boundary-aware containment over absolute canonical paths.
 * @param parent - Canonical path proposed as the containing directory.
 * @param child - Canonical path proposed as the contained path.
 * @returns Whether `child` is equal to or below `parent` at a path boundary.
 */
export function containsPath(parent: string, child: string): boolean {
  const delta = relative(parent, child)
  return delta === '' || (!delta.startsWith(`..${sep}`) && delta !== '..' && !isAbsolute(delta))
}

/**
 * Return whether either path includes the other.
 * @param first - First canonical path.
 * @param second - Second canonical path.
 * @returns Whether either canonical path contains the other.
 */
export function pathsOverlap(first: string, second: string): boolean {
  return containsPath(first, second) || containsPath(second, first)
}

/** Resolve an existing path without following an unexpected final symlink. */
async function privateDirectory(path: string): Promise<void> {
  const entry = await lstat(path)
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new Error(`science-runtime: managed path ${JSON.stringify(path)} must be a private directory`)
  }
  if ((entry.mode & 0o077) !== 0) {
    throw new Error(`science-runtime: managed directory ${JSON.stringify(path)} is not private`)
  }
}

/** Create a provider-owned private directory, then verify its exact kind and mode. */
async function createPrivateDirectory(path: string): Promise<void> {
  try {
    await mkdir(path, { mode: 0o700 })
    await chmod(path, 0o700)
  } catch (error: unknown) {
    if (typeof error !== 'object' || error === null || (error as { readonly code?: unknown }).code !== 'EEXIST') throw error
  }
  await privateDirectory(path)
}

/** Create every provider-owned segment beneath one already-resolved Harness home. */
async function createPrivateTree(home: string, segments: readonly string[]): Promise<string> {
  let current = home
  for (const segment of segments) {
    current = join(current, segment)
    await createPrivateDirectory(current)
  }
  return current
}

/** Require a regular private managed file. */
async function privateFile(path: string): Promise<void> {
  const entry = await lstat(path)
  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw new Error(`science-runtime: managed path ${JSON.stringify(path)} must be a regular file`)
  }
  if ((entry.mode & 0o077) !== 0) {
    throw new Error(`science-runtime: managed file ${JSON.stringify(path)} is not private`)
  }
}

/** Synchronize one directory entry after a durable managed-file creation. */
async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY)
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/** Write one new mode-0600 managed file with durable contents. */
async function writePrivateFile(path: string, data: Uint8Array | string): Promise<void> {
  const handle = await open(path, 'wx', 0o600)
  try {
    await handle.writeFile(data)
    await handle.sync()
  } finally {
    await handle.close()
  }
  await privateFile(path)
  await syncDirectory(dirname(path))
}

/** Derive and reject a Session root that would fall under a generic sandbox temp grant. */
async function rootForSession(dshHome: string | undefined, session: Session): Promise<{
  readonly home: string
  readonly root: string
  readonly marker: string
  readonly key: string
}> {
  const home = await canonicalizeWatchPath(resolveDshHome(dshHome))
  const key = sessionScratchKey(session)
  const root = await canonicalizeWatchPath(resolve(home, 'science', 'v1', 'sessions', key))
  const marker = await canonicalizeWatchPath(resolve(home, 'science', 'v1', 'owners', `${key}.json`))
  for (const temp of ['/tmp', tmpdir()]) {
    if (pathsOverlap(root, canonicalPath(temp))) {
      throw new Error('science-runtime: Science scratch root must not overlap a generic sandbox temp root')
    }
  }
  return { home, root, marker, key }
}

/**
 * Derive the canonical retained root without creating an owner record or directory.
 * @param dshHome - Optional explicit Harness home.
 * @param session - Exact Session that would own the root.
 * @returns The future private Session root after generic-temp overlap refusal.
 */
export async function scienceSessionScratchRoot(dshHome: string | undefined, session: Session): Promise<string> {
  return (await rootForSession(dshHome, session)).root
}

/** Return every retained path below one already-derived Session root. */
function sessionScratchPaths(root: string): ScienceSessionScratch {
  return {
    root,
    home: join(root, 'home'),
    state: join(root, 'state'),
    runs: join(root, 'runs'),
    probes: join(root, 'probes'),
    kernels: join(root, 'kernels'),
  }
}

/**
 * Derive every retained Session path without creating its owner marker or tree.
 * @param dshHome - Optional explicit Harness home.
 * @param session - Exact Session that would own the paths.
 * @returns Future private paths suitable for confinement planning.
 */
export async function planSessionScratch(dshHome: string | undefined, session: Session): Promise<ScienceSessionScratch> {
  const { root } = await rootForSession(dshHome, session)
  return sessionScratchPaths(root)
}

/** Test whether one optional managed path exists without treating other errors as absence. */
async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && (error as { readonly code?: unknown }).code === 'ENOENT') return false
    throw error
  }
}

/** Create or verify the exclusive owner marker before reusing Session scratch. */
async function ensureOwner(marker: string, root: string, key: string, session: Session): Promise<boolean> {
  const markerExists = await exists(marker)
  const rootExists = await exists(root)
  if (!markerExists && rootExists) {
    throw new Error('science-runtime: owner marker and Session scratch root must appear together')
  }
  const expected = JSON.stringify({ version: OWNER_VERSION, key, sessionId: String(session.id) })
  if (markerExists) {
    await privateFile(marker)
    if (await readFile(marker, 'utf8') !== expected) {
      throw new Error('science-runtime: owner marker does not match the exact Session identity')
    }
    // The marker is persisted before the root exists. A crash in that narrow
    // interval leaves an exact, private owner record with no mutable scratch;
    // resuming only this matching Session can complete its root creation.
    return false
  }
  await createPrivateTree(dirname(dirname(dirname(dirname(marker)))), ['science', 'v1', 'owners'])
  try {
    await writePrivateFile(marker, expected)
    return true
  } catch (error: unknown) {
    if (typeof error !== 'object' || error === null || (error as { readonly code?: unknown }).code !== 'EEXIST') throw error
    await privateFile(marker)
    if (await readFile(marker, 'utf8') !== expected) {
      throw new Error('science-runtime: concurrently created owner marker does not match the exact Session identity')
    }
    return false
  }
}

/**
 * Create or verify retained Session ownership for one pre-publication operation.
 * @param dshHome - Optional explicit Harness home.
 * @param session - Exact Session that owns the marker and paths.
 * @returns Exact ownership facts retained until publication or rollback.
 */
export async function materializeSessionScratch(
  dshHome: string | undefined,
  session: Session,
): Promise<ScienceSessionScratchPreparation> {
  const derived = await rootForSession(dshHome, session)
  const scratch = sessionScratchPaths(derived.root)
  const owner = JSON.stringify({ version: OWNER_VERSION, key: derived.key, sessionId: String(session.id) })
  let created = false
  try {
    await mkdir(derived.home, { recursive: true, mode: 0o700 })
    created = await ensureOwner(derived.marker, derived.root, derived.key, session)
    await createPrivateTree(derived.home, ['science', 'v1', 'sessions'])
    await createPrivateDirectory(derived.root)
    await Promise.all([scratch.home, scratch.state, scratch.runs, scratch.probes, scratch.kernels].map(createPrivateDirectory))
    return { scratch, created, marker: derived.marker, owner }
  } catch (error) {
    const preparation = { scratch, created, marker: derived.marker, owner }
    try {
      await rollbackSessionScratch(preparation)
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'science-runtime: incomplete Session scratch rollback failed')
    }
    throw error
  }
}

/**
 * Create or verify all retained Session scratch under the resolved Harness home.
 * @param dshHome - Optional explicit Harness home.
 * @param session - Exact Session that owns the marker and paths.
 * @returns Host-only private paths; callers never expose them in durable events.
 */
export async function ensureSessionScratch(dshHome: string | undefined, session: Session): Promise<ScienceSessionScratch> {
  return (await materializeSessionScratch(dshHome, session)).scratch
}

/**
 * Remove only ownership first created by a failed pre-publication operation.
 * @param preparation - Exact materialization result retained by the operation.
 */
export async function rollbackSessionScratch(preparation: ScienceSessionScratchPreparation): Promise<void> {
  if (!preparation.created) return
  const markerExists = await exists(preparation.marker)
  const rootExists = await exists(preparation.scratch.root)
  if (!markerExists && !rootExists) return
  if (!markerExists) {
    throw new Error('science-runtime: owner marker disappeared before Session scratch rollback')
  }
  await privateFile(preparation.marker)
  if (await readFile(preparation.marker, 'utf8') !== preparation.owner) {
    throw new Error('science-runtime: owner marker changed before Session scratch rollback')
  }
  if (rootExists) {
    await privateDirectory(preparation.scratch.root)
    await rm(preparation.scratch.root, { recursive: true, force: false })
  }
  await rm(preparation.marker, { force: false })
  await syncDirectory(dirname(preparation.marker))
}

/**
 * Plan one unique probe tree without creating any Host path.
 * @param sessionScratch - Planned or existing retained Session paths.
 * @returns Future private probe paths suitable for exact confinement wrapping.
 */
export function planProbeScratch(sessionScratch: ScienceSessionScratch): ScienceProbeScratch {
  const directory = join(sessionScratch.probes, randomUUID())
  return { directory, home: join(directory, 'home'), tmp: join(directory, 'tmp') }
}

/**
 * Create a unique private probe directory that may be removed after quiescence.
 * @param sessionScratch - Retained private root that owns the new probe directory.
 * @param planned - Exact pre-wrapped probe paths, or a newly planned tree by default.
 * @returns Private probe paths for one unpublished observation.
 */
export async function createProbeScratch(
  sessionScratch: ScienceSessionScratch,
  planned: ScienceProbeScratch = planProbeScratch(sessionScratch),
): Promise<ScienceProbeScratch> {
  if (!containsPath(sessionScratch.probes, planned.directory) || planned.directory === sessionScratch.probes
    || planned.home !== join(planned.directory, 'home') || planned.tmp !== join(planned.directory, 'tmp')) {
    throw new Error('science-runtime: planned probe paths escape the owned probes directory')
  }
  await createPrivateDirectory(planned.directory)
  await Promise.all([createPrivateDirectory(planned.home), createPrivateDirectory(planned.tmp)])
  return planned
}

/**
 * Plan one persistent kernel tree without creating any Host path.
 * @param sessionScratch - Planned or existing retained Session paths.
 * @param language - Interpreter language selecting the directory name.
 * @param index - Caller-assigned disambiguator for this language's kernel instance.
 * @returns Future private kernel paths suitable for exact confinement wrapping.
 */
export function planKernelScratch(
  sessionScratch: ScienceSessionScratch,
  language: ScienceLanguage,
  index: number,
): ScienceKernelScratch {
  const name = `${language}-${String(index)}`
  const directory = join(sessionScratch.kernels, name)
  // name is built from a closed ScienceLanguage union and a finite number's
  // String() conversion, neither of which can ever produce a path
  // separator, so join() cannot escape sessionScratch.kernels or reproduce it exactly.
  /* v8 ignore next 3 -- see above */
  if (!containsPath(sessionScratch.kernels, directory) || directory === sessionScratch.kernels) {
    throw new Error('science-runtime: kernel directory escapes the owned kernels directory')
  }
  return {
    ref: `kernels/${name}/`,
    directory,
    tmp: join(directory, 'tmp'),
    userLibrary: join(directory, language === 'python' ? 'pyuser' : 'rlibs'),
  }
}

/**
 * Create a private kernel directory, its baseline TMPDIR, and its owned
 * per-language user-install base ({@link ScienceKernelScratch.userLibrary}).
 * @param sessionScratch - Retained private root that owns the new kernel directory.
 * @param planned - Exact pre-wrapped kernel paths, or a newly planned tree by default.
 * @returns Private kernel paths for one persistent kernel process.
 */
export async function createKernelScratch(
  sessionScratch: ScienceSessionScratch,
  planned: ScienceKernelScratch,
): Promise<ScienceKernelScratch> {
  if (!containsPath(sessionScratch.kernels, planned.directory) || planned.directory === sessionScratch.kernels
    || planned.tmp !== join(planned.directory, 'tmp')
    || dirname(planned.userLibrary) !== planned.directory) {
    throw new Error('science-runtime: planned kernel paths escape the owned kernels directory')
  }
  await createPrivateDirectory(planned.directory)
  await createPrivateDirectory(planned.tmp)
  await createPrivateDirectory(planned.userLibrary)
  return planned
}

/** Language-independent run directory and reference, shared by every path derived below it. */
function runDirectory(sessionScratch: ScienceSessionScratch, runId: ScienceRunId): { readonly ref: string; readonly directory: string } {
  const name = String(runId)
  const directory = join(sessionScratch.runs, name)
  if (!containsPath(sessionScratch.runs, directory) || directory === sessionScratch.runs) {
    throw new Error('science-runtime: run directory escapes the owned runs directory')
  }
  return { ref: `runs/${name}/`, directory }
}

/**
 * Plan one run tree and source path without creating any Host path.
 * @param sessionScratch - Planned or existing retained Session paths.
 * @param runId - Provider-generated durable run identifier.
 * @param language - Interpreter language selecting the source filename.
 * @returns Future private run paths suitable for exact confinement wrapping.
 */
export function planRunScratch(
  sessionScratch: ScienceSessionScratch,
  runId: ScienceRunId,
  language: ScienceLanguage,
): ScienceRunScratch {
  const { ref, directory } = runDirectory(sessionScratch, runId)
  return {
    ref,
    directory,
    source: join(directory, language === 'python' ? 'code.py' : 'code.R'),
    artifacts: join(directory, 'artifacts'),
    inputs: join(directory, 'inputs'),
    stdout: join(directory, 'stdout.txt'),
    stderr: join(directory, 'stderr.txt'),
  }
}

/** One validated artifact input ready for byte-exact scratch materialization. */
export interface ScienceRunInputBytes {
  /** Forward-slash relative path below the run's reserved `inputs/` directory. */
  readonly path: string
  /** Attachment-store-verified immutable bytes. */
  readonly data: Uint8Array
}

/**
 * Materialize validated artifact inputs byte-exactly below one unpublished
 * run's reserved `inputs/` directory.
 * @param run - Exact unpublished run tree that owns the input directory.
 * @param inputs - Validated non-colliding relative paths and verified bytes.
 * @returns completion after every file and containing directory are flushed.
 */
export async function materializeRunInputs(
  run: ScienceRunScratch,
  inputs: readonly ScienceRunInputBytes[],
): Promise<void> {
  if (inputs.length === 0) return
  await createPrivateDirectory(run.inputs)
  const createdDirectories = new Set<string>([run.inputs])
  for (const input of inputs) {
    const target = join(run.inputs, ...input.path.split('/'))
    /* v8 ignore next 3 -- prepareRunArtifacts admits no empty, dot, parent, or absolute path before this private writer is called */
    if (!containsPath(run.inputs, target) || target === run.inputs) {
      throw new Error('science-runtime: validated input path escaped the owned input directory')
    }
    const parent = dirname(target)
    const missing: string[] = []
    for (let directory = parent; !createdDirectories.has(directory); directory = dirname(directory)) {
      /* v8 ignore next 3 -- every parent is derived from the already-contained validated target above */
      if (!containsPath(run.inputs, directory) || directory === dirname(directory)) {
        throw new Error('science-runtime: validated input parent escaped the owned input directory')
      }
      missing.push(directory)
    }
    for (const directory of missing.reverse()) {
      await createPrivateDirectory(directory)
      createdDirectories.add(directory)
    }
    await writePrivateFile(target, input.data)
  }
  await syncDirectory(run.inputs)
}

/**
 * Rederive one already-published run's artifact directory without a source
 * filename or language, the two facts a caller with only a `runId` may not
 * have on hand.
 * @param sessionScratch - Retained private root that owns the run directory.
 * @param runId - The exact successful run's durable identifier.
 * @returns the private Host artifact directory for that run.
 */
export function runArtifactDirectory(sessionScratch: ScienceSessionScratch, runId: ScienceRunId): string {
  return join(runDirectory(sessionScratch, runId).directory, 'artifacts')
}

/**
 * Remove only a quiescent provider-owned probe directory.
 * @param sessionScratch - Retained private root that owns the probe directory.
 * @param probe - Exact unpublished probe paths to remove.
 */
export async function removeProbeScratch(sessionScratch: ScienceSessionScratch, probe: ScienceProbeScratch): Promise<void> {
  if (!containsPath(sessionScratch.probes, probe.directory) || probe.directory === sessionScratch.probes) {
    throw new Error('science-runtime: probe cleanup path escapes the owned probes directory')
  }
  await rm(probe.directory, { recursive: true, force: false })
}

/**
 * Create and flush exact source plus owned run directories before start publication.
 * @param sessionScratch - Retained private root that owns the new run directory.
 * @param runId - Provider-generated durable run identifier.
 * @param language - Interpreter language selecting the source filename.
 * @param code - Exact validated source bytes to persist without normalization.
 * @returns Private run paths with a flushed source file.
 */
export async function createRunScratch(
  sessionScratch: ScienceSessionScratch,
  runId: ScienceRunId,
  language: ScienceLanguage,
  code: Uint8Array,
): Promise<ScienceRunScratch> {
  const run = planRunScratch(sessionScratch, runId, language)
  await createPrivateDirectory(run.directory)
  await createPrivateDirectory(run.artifacts)
  await writePrivateFile(run.source, code)
  await syncDirectory(run.directory)
  return run
}

/**
 * Remove only a newly-created run directory that has not reached durable start publication.
 * @param sessionScratch - Retained private root that owns the run directory.
 * @param run - Exact unpublished run paths to roll back.
 */
export async function removeUnpublishedRunScratch(
  sessionScratch: ScienceSessionScratch,
  run: ScienceRunScratch,
): Promise<void> {
  if (!containsPath(sessionScratch.runs, run.directory) || run.directory === sessionScratch.runs) {
    throw new Error('science-runtime: run rollback path escapes the owned runs directory')
  }
  await rm(run.directory, { recursive: true, force: false })
}

/**
 * Canonicalize an existing path and require that it remains under a configured prefix.
 * @param prefix - Existing configured prefix that contains the path.
 * @param path - Existing path whose canonical location is checked.
 * @returns Canonical checked path under the canonical prefix.
 */
export async function canonicalWithin(prefix: string, path: string): Promise<string> {
  const canonicalPrefix = await realpath(prefix)
  const canonicalPathname = await realpath(path)
  if (!containsPath(canonicalPrefix, canonicalPathname)) {
    throw new Error(`science-runtime: path ${JSON.stringify(path)} escapes its configured prefix`)
  }
  return canonicalPathname
}

/**
 * Require an existing regular executable file.
 * @param path - Existing interpreter candidate to inspect.
 */
export async function requireExecutable(path: string): Promise<void> {
  const entry = await lstat(path)
  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw new Error(`science-runtime: interpreter ${JSON.stringify(path)} must be a regular file`)
  }
  const executable = (entry.mode & 0o111) !== 0
  if (!executable && process.platform !== 'win32') {
    throw new Error(`science-runtime: interpreter ${JSON.stringify(path)} is not executable`)
  }
}
