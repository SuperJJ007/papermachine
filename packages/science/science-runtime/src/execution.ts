/** Kernel-run construction, confinement, bounded output reading, and terminal classification. */

import { randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { open, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { SandboxUnavailableError, writableRoots } from '@deepseek-ai/dsh-sandbox'
import type { ConfinedArgv, SandboxPolicy, SandboxProvider } from '@deepseek-ai/dsh-sandbox'
import { ScienceRunId, ScienceScratchKey } from '@deepseek-ai/dsh-science-session'
import type {
  ScienceEnvironmentBinding,
  ScienceInterpreterAvailableBinding,
  ScienceLanguage,
  ScienceRunArtifactInput,
  ScienceRunStarted,
  ScienceRunTerminal,
} from '@deepseek-ai/dsh-science-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { pathsOverlap, sha256 } from './scratch.ts'
import type { ScienceRunScratch, ScienceSessionScratch } from './scratch.ts'
import { ScienceRuntimeError } from './types.ts'
import type { ScienceRunOutput } from './types.ts'

/** Fixed maximum exact source bytes. */
export const MAX_SOURCE_BYTES = 262_144
/** Fixed retained bytes per execution output stream. */
export const MAX_OUTPUT_BYTES = 64_000
/** Fixed descendant grace before Runtime asks the subprocess seam to terminate. */
export const DESCENDANT_GRACE_MS = 3_000
const POSIX_LOCALE = 'C.UTF-8'
const CHILD_LOCALES: Record<NodeJS.Platform, string> = {
  aix: POSIX_LOCALE, android: POSIX_LOCALE, darwin: 'en_US.UTF-8', freebsd: POSIX_LOCALE, haiku: POSIX_LOCALE,
  linux: POSIX_LOCALE, netbsd: POSIX_LOCALE, openbsd: POSIX_LOCALE, sunos: POSIX_LOCALE, win32: POSIX_LOCALE, cygwin: POSIX_LOCALE,
}
const PATH_DIRECTORIES: Record<NodeJS.Platform, string> = {
  aix: 'bin', android: 'bin', darwin: 'bin', freebsd: 'bin', haiku: 'bin', linux: 'bin',
  netbsd: 'bin', openbsd: 'bin', sunos: 'bin', win32: 'Scripts', cygwin: 'bin',
}
const PATH_SUFFIXES: Record<NodeJS.Platform, string> = {
  aix: ':/usr/bin:/bin', android: ':/usr/bin:/bin', darwin: ':/usr/bin:/bin', freebsd: ':/usr/bin:/bin', haiku: ':/usr/bin:/bin',
  linux: ':/usr/bin:/bin', netbsd: ':/usr/bin:/bin', openbsd: ':/usr/bin:/bin', sunos: ':/usr/bin:/bin', win32: '', cygwin: ':/usr/bin:/bin',
}

/** Complete pre-publication plan with no Host scratch path exposed publicly. */
export interface RunPlan {
  readonly runId: ReturnType<typeof ScienceRunId>
  readonly sourceBytes: Buffer
  readonly scratchKey: ReturnType<typeof ScienceScratchKey>
  readonly binding: ScienceInterpreterAvailableBinding
}

/**
 * Exact fixed locale values for a supported POSIX child. Shared by every
 * confined interpreter spawn: persistent kernels and interpreter probes alike.
 * @returns fixed `LANG`/`LC_ALL`/`TZ` entries for this host platform.
 */
export function localeEnvironment(): Pick<NodeJS.ProcessEnv, 'LANG' | 'LC_ALL' | 'TZ'> {
  const locale = CHILD_LOCALES[process.platform]
  return {
    LANG: locale,
    LC_ALL: locale,
    TZ: 'UTC',
  }
}

/**
 * Fixed `PATH` entry for a configured interpreter prefix: its own `bin`
 * (`Scripts` on Windows) ahead of the platform's ordinary system
 * directories. Shared by every confined interpreter spawn.
 * @param canonicalPrefix - the observed binding's canonicalized Conda prefix.
 * @returns the exact `PATH` value for that prefix on this host platform.
 */
export function interpreterPathEnv(canonicalPrefix: string): string {
  return `${join(canonicalPrefix, PATH_DIRECTORIES[process.platform])}${PATH_SUFFIXES[process.platform]}`
}

/**
 * Direct argv for one persistent kernel's interpreter invocation: fixed
 * per-language hardening flags followed by the caller's trailing script
 * arguments — the driver script path plus its response-FIFO path argument.
 * Never a shell command. Kernel-only: an interpreter probe builds its own
 * direct argv (`probeArgv` in `environment.ts`) and keeps Python `-I`
 * (isolated mode), since a probe never needs a writable package-install
 * target. A kernel drops `-I` so pip's user-site fallback under
 * `PYTHONUSERBASE` (`kernel-process.ts`'s `kernelEnvironment`) lands on
 * `sys.path` — the mechanism that makes an inline `pip install` importable
 * within the same kernel (see the README's "Confinement and environment").
 * @param language - selects the fixed flag set.
 * @param executable - canonical interpreter executable.
 * @param scriptArgs - trailing arguments appended after the fixed flags.
 * @returns the complete direct argv, unconfined.
 */
export function interpreterArgv(language: ScienceLanguage, executable: string, ...scriptArgs: readonly string[]): string[] {
  return language === 'python'
    ? [executable, '-B', '-u', '-X', 'utf8', ...scriptArgs]
    : [executable, '--vanilla', '--encoding=UTF-8', ...scriptArgs]
}

/** Reject malformed/oversized source without adding or normalizing bytes. */
function sourceBytes(code: string): Buffer {
  if (code.length === 0 || code.includes('\0') || !code.isWellFormed()) {
    throw new ScienceRuntimeError('INVALID_REQUEST', 'Science source must be non-empty, well-formed Unicode without U+0000')
  }
  const bytes = Buffer.from(code, 'utf8')
  if (bytes.byteLength > MAX_SOURCE_BYTES) {
    throw new ScienceRuntimeError('INVALID_REQUEST', `Science source exceeds ${String(MAX_SOURCE_BYTES)} UTF-8 bytes`)
  }
  return bytes
}

/**
 * Select the durable available binding for a requested language. Shared by
 * run planning ({@link planRun}) and persistent kernel spawn
 * (`KernelSet.acquire` in `kernel-set.ts`).
 * @param environment - applied durable environment revision to select from.
 * @param language - requested interpreter language.
 * @returns the selected language's fully observed, available binding.
 * @throws {@link ScienceRuntimeError} (`ENVIRONMENT_NOT_READY`) when the
 *   revision is not `applied` or the requested language has no available binding.
 */
export function selectBinding(environment: ScienceEnvironmentBinding, language: ScienceLanguage): ScienceInterpreterAvailableBinding {
  const binding = language === 'python' ? environment.python : environment.r
  if (environment.status !== 'applied' || binding?.capability !== 'available') {
    throw new ScienceRuntimeError('ENVIRONMENT_NOT_READY', `Science ${language} environment is not available`)
  }
  return binding
}

/**
 * Build pre-publication source and direct argv facts.
 * @param environment - Applied durable environment whose selected binding is required.
 * @param language - Requested interpreter language.
 * @param code - Exact caller source before UTF-8 validation and hashing.
 * @returns Private immutable facts needed to create and start one run.
 */
export function planRun(
  environment: ScienceEnvironmentBinding,
  language: ScienceLanguage,
  code: string,
): RunPlan {
  const bytes = sourceBytes(code)
  const binding = selectBinding(environment, language)
  const runId = ScienceRunId(randomUUID())
  const scratchKey = ScienceScratchKey(sha256(Buffer.concat([
    Buffer.from(`dsh-science-scratch-v1\0${language}\0`, 'utf8'),
    bytes,
  ])))
  return {
    runId,
    sourceBytes: bytes,
    scratchKey,
    binding,
  }
}

/**
 * Fixed confinement policy rooted at exactly one canonical Science Session
 * scratch tree. Used for every persistent kernel spawn under that Session
 * (an interpreter probe's own policy is narrower, rooted at its probe
 * directory instead — see `environment.ts`).
 * @param session - exact live Session that owns the scratch tree.
 * @param scratch - that Session's private scratch paths.
 * @returns the fixed `workspace-write` sandbox policy.
 */
export function confinementPolicy(session: Session, scratch: ScienceSessionScratch): SandboxPolicy {
  return { mode: 'workspace-write', workspaceRoot: scratch.root, sessionId: session.id }
}

/**
 * Reject every prefix that may be written through the selected sandbox policy.
 * @param prefix - the observed binding's canonicalized Conda prefix.
 * @param policy - the confinement policy the prefix must stay outside of.
 * @throws {@link ScienceRuntimeError} (`CONFINEMENT_UNAVAILABLE`) when the prefix overlaps a writable root.
 */
export function assertPrefixReadOnly(prefix: string, policy: SandboxPolicy): void {
  for (const root of writableRoots(policy)) {
    if (pathsOverlap(prefix, root)) {
      throw new ScienceRuntimeError('CONFINEMENT_UNAVAILABLE', 'configured Conda prefix overlaps a sandbox writable root')
    }
  }
}

/**
 * Sandbox-confine one argv under an already-built policy: asserts the
 * interpreter's own prefix stays read-only and requires full enforcement.
 * Shared by every Science confinement site — persistent kernel spawn and
 * interpreter probes alike — each of which builds its own policy (a probe's
 * differs from a kernel's: a narrower `workspaceRoot`).
 * @param sandbox - sandbox provider performing the confinement.
 * @param canonicalPrefix - the observed binding's canonicalized Conda prefix.
 * @param policy - the caller's already-built confinement policy.
 * @param argv - direct, unconfined argv (see {@link interpreterArgv}).
 * @returns the confined argv and its denial/runner-failure classification evidence.
 * @throws {@link ScienceRuntimeError} (`CONFINEMENT_UNAVAILABLE`) when the sandbox is unavailable or reports less than full enforcement.
 */
export function confineWithFullEnforcement(
  sandbox: SandboxProvider,
  canonicalPrefix: string,
  policy: SandboxPolicy,
  argv: readonly string[],
): ConfinedArgv {
  assertPrefixReadOnly(canonicalPrefix, policy)
  let confined: ConfinedArgv
  try {
    confined = sandbox.confine(argv, policy)
  } catch (error) {
    if (error instanceof SandboxUnavailableError) {
      throw new ScienceRuntimeError('CONFINEMENT_UNAVAILABLE', 'Science requires an available full sandbox', { cause: error })
    }
    throw error
  }
  if (confined.enforcement !== 'full') {
    throw new ScienceRuntimeError('CONFINEMENT_UNAVAILABLE', 'Science requires full sandbox enforcement')
  }
  return confined
}

/**
 * Sandbox-confine one interpreter argv under a Session's `workspace-write`
 * policy: persistent kernel spawn confinement, rooted at the whole Session
 * scratch tree (unlike an interpreter probe's narrower policy).
 * @param session - exact live Session that owns the confinement policy.
 * @param scratch - that Session's private scratch paths.
 * @param sandbox - sandbox provider performing the confinement.
 * @param canonicalPrefix - the observed binding's canonicalized Conda prefix.
 * @param argv - direct, unconfined argv (see {@link interpreterArgv}).
 * @returns the confined argv and its denial/runner-failure classification evidence.
 * @throws {@link ScienceRuntimeError} (`CONFINEMENT_UNAVAILABLE`) when the sandbox is unavailable or reports less than full enforcement.
 */
export function confineInterpreterArgv(
  session: Session,
  scratch: ScienceSessionScratch,
  sandbox: SandboxProvider,
  canonicalPrefix: string,
  argv: readonly string[],
): ConfinedArgv {
  return confineWithFullEnforcement(sandbox, canonicalPrefix, confinementPolicy(session, scratch), argv)
}

/**
 * Run-terminal failure vocabulary for a kernel execution: `TIMEOUT`/
 * `CANCELLED` describe the operation's own abort cause; `EXECUTION_FAILED`
 * (the driver replied DONE `error`) and `KERNEL_DIED` (the kernel process
 * exited or broke protocol mid-run) describe the kernel protocol outcome. A
 * kernel run never populates a per-run exit code or signal.
 */
export type KernelRunFailureCode = 'TIMEOUT' | 'CANCELLED' | 'EXECUTION_FAILED' | 'KERNEL_DIED'

/** Safe durable explanation for a kernel-run terminal classification. */
function kernelFailureMessage(code: KernelRunFailureCode): string {
  return {
    TIMEOUT: 'The Science Runtime operation timed out.',
    CANCELLED: 'The Science Runtime operation was cancelled.',
    EXECUTION_FAILED: 'The interpreter raised an error while executing this run.',
    KERNEL_DIED: 'The persistent kernel stopped unexpectedly during this run.',
  }[code]
}

/**
 * Build one kernel-run terminal value from durable start fields and its terminal classification.
 * @param started - already committed durable run-start value, whole-value repeated.
 * @param stdout - bounded stdout tail read from this run's capture file.
 * @param stderr - bounded stderr tail read from this run's capture file.
 * @param status - the run's terminal status.
 * @param failureCode - present on every non-success status.
 * @param outputDegraded - whether the DONE frame carried the `capture-degraded` flag.
 * @returns the complete terminal value ready for one atomic Session append.
 */
export function kernelRunTerminal(
  started: ScienceRunStarted,
  stdout: ScienceRunOutput,
  stderr: ScienceRunOutput,
  status: ScienceRunTerminal['status'],
  failureCode: KernelRunFailureCode | undefined,
  outputDegraded: boolean,
): ScienceRunTerminal {
  return {
    ...started,
    status,
    finishedAt: Date.now(),
    stdoutBytes: stdout.bytes,
    stderrBytes: stderr.bytes,
    stdoutTruncated: stdout.truncated,
    stderrTruncated: stderr.truncated,
    ...(failureCode === undefined ? {} : { failureCode, failureMessage: kernelFailureMessage(failureCode) }),
    ...(outputDegraded ? { outputDegraded: true as const } : {}),
  }
}

/**
 * Read a bounded tail of one already-closed per-run capture file: the exact
 * byte count is the file's own size; `truncated` is whether that size
 * exceeds {@link MAX_OUTPUT_BYTES}; the retained `text` is the last
 * `MAX_OUTPUT_BYTES` bytes ("retain tail"), decoded UTF-8 without
 * multibyte-boundary alignment — matching the subprocess seam's own
 * in-memory tail collector, which truncates the same way. A missing file
 * (the driver never wrote to it — the run never reached user code) reads as
 * empty, not a failure.
 * @param path - absolute path of the per-run stdout or stderr capture file.
 * @returns the bounded output tail.
 */
export async function readCaptureTail(path: string): Promise<ScienceRunOutput> {
  let size: number
  try {
    size = (await stat(path)).size
  } catch {
    return { text: '', bytes: 0, truncated: false }
  }
  if (size === 0) return { text: '', bytes: 0, truncated: false }
  const truncated = size > MAX_OUTPUT_BYTES
  const start = truncated ? size - MAX_OUTPUT_BYTES : 0
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(size - start)
    await handle.read(buffer, 0, buffer.length, start)
    return { text: buffer.toString('utf8'), bytes: size, truncated }
  } finally {
    await handle.close()
  }
}

/** Start an unbounded cleanup observation without allowing a synchronous throw to escape. */
function awaitEventualQuiescence(handle: SubprocessHandle): Promise<boolean> {
  return Promise.resolve().then(() => handle.waitForExit())
}

/** Wait briefly for a post-parent descendant tree, then use the one subprocess termination verb. */
export type Quiescence =
  | { readonly quiescent: true; readonly forced: boolean }
  | { readonly quiescent: false; readonly forced: true; readonly eventualQuiescence: Promise<boolean> }

/**
 * Wait briefly for a subprocess tree to exit on its own, then escalate
 * through the seam's one termination verb and wait again. Used by
 * persistent kernel teardown, both ordinary (`KernelProcess.end`) and
 * spawn-failure cleanup.
 * @param handle - the live subprocess handle to quiesce.
 * @returns whether the tree proved quiescent, whether termination was
 *   forced, and (when still unproven) the retained eventual-quiescence observation.
 */
export async function quiesce(handle: SubprocessHandle): Promise<Quiescence> {
  try {
    const grace = AbortSignal.timeout(DESCENDANT_GRACE_MS)
    if (await handle.waitForExit(grace)) return { quiescent: true, forced: false }
  } catch {
    // A provider that cannot answer the bounded observation has not proven the tree dead.
  }
  try {
    handle.terminate()
  } catch {
    return { quiescent: false, forced: true, eventualQuiescence: awaitEventualQuiescence(handle) }
  }
  try {
    const forced = AbortSignal.timeout(DESCENDANT_GRACE_MS)
    if (await handle.waitForExit(forced)) return { quiescent: true, forced: true }
  } catch {
    // Keep the exact-Session quarantine until the provider can later prove exit.
  }
  return { quiescent: false, forced: true, eventualQuiescence: awaitEventualQuiescence(handle) }
}

/**
 * Create a start candidate after source was flushed but before the RUN frame is sent.
 * @param plan - Private immutable run plan.
 * @param run - Flushed private run directory facts.
 * @param language - Requested interpreter language.
 * @param environment - Applied durable environment revision.
 * @param toolCallId - Still-pending authorization call that owns the run.
 * @param requestHeaderSeq - Durable request-header sequence that owns provenance.
 * @param kernelEpoch - session-local epoch of the kernel that will execute this run (already acquired).
 * @param inputs - Exact artifact-version inputs materialized for this run.
 * @returns Durable start fields ready for one atomic Session append.
 */
export function startCandidate(
  plan: RunPlan,
  run: ScienceRunScratch,
  language: ScienceLanguage,
  environment: ScienceEnvironmentBinding,
  toolCallId: ScienceRunStarted['toolCallId'],
  requestHeaderSeq: number,
  kernelEpoch: number,
  inputs: readonly ScienceRunArtifactInput[],
): ScienceRunStarted {
  return {
    runId: plan.runId,
    language,
    toolCallId,
    requestHeaderSeq,
    environmentRevision: environment.revision,
    environmentFingerprint: plan.binding.bindingFingerprint,
    startedAt: Date.now(),
    codeSha256: sha256(plan.sourceBytes),
    scratchKey: plan.scratchKey,
    runDirectoryRef: run.ref,
    ...(inputs.length === 0 ? {} : { inputs }),
    kernelEpoch,
    status: 'running',
  }
}
