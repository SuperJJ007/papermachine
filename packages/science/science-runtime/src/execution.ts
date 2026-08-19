/** Direct-argv Science run construction, confinement, output, and terminal classification. */

import { randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { join } from 'node:path'
import {
  classifyDenial,
  classifyRunnerFailure,
  isRunnerSpawnFailure,
  SandboxUnavailableError,
  writableRoots,
} from '@deepseek-ai/dsh-sandbox'
import type { ConfinedArgv, SandboxPolicy, SandboxProvider } from '@deepseek-ai/dsh-sandbox'
import { ScienceRunId, ScienceScratchKey } from '@deepseek-ai/dsh-science-session'
import type {
  ScienceEnvironmentBinding,
  ScienceInterpreterAvailableBinding,
  ScienceLanguage,
  ScienceRunStarted,
  ScienceRunTerminal,
} from '@deepseek-ai/dsh-science-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle, SubprocessOutputRead, SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { OperationControl } from './lifecycle.ts'
import { pathsOverlap, sha256 } from './scratch.ts'
import type { ScienceRunScratch, ScienceSessionScratch } from './scratch.ts'
import { ScienceRuntimeError } from './types.ts'
import type { ScienceRunOutput, ScienceRunResult } from './types.ts'

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

/** Full confinement facts retained until runner/denial classification. */
export interface ConfinedExecution {
  readonly argv: readonly string[]
  readonly denialSignatures: readonly string[]
  readonly runnerFailureRules: readonly import('@deepseek-ai/dsh-sandbox').RunnerFailureRule[]
}

/** Services needed to construct and settle one direct interpreter execution. */
export interface ExecutionServices {
  readonly subprocess: SubprocessRuntime
  readonly sandbox: SandboxProvider
  readonly session: Session
  readonly sessionScratch: ScienceSessionScratch
  readonly control: OperationControl
}

/** Terminal result after the owner proved complete process-tree quiescence. */
export interface QuiescentRun {
  readonly quiescent: true
  readonly result: ScienceRunResult
}

/** Retained whole-tree proof when immediate quiescence was not established. */
export interface NonQuiescentRun {
  readonly quiescent: false
  /** Terminal result once the retained tree observation proves quiescence. */
  readonly eventualResult: Promise<ScienceRunResult | undefined>
}

/** Terminal result or the retained proof required before releasing its Session lease. */
export type SettledRun = QuiescentRun | NonQuiescentRun

/**
 * Exact fixed locale values for a supported POSIX child. Shared by every
 * confined interpreter spawn (one-shot runs and persistent kernels alike).
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
 * Direct argv for one interpreter invocation: fixed per-language hardening
 * flags followed by the caller's trailing script arguments — a source file
 * path for a one-shot run, or a driver script path plus its own argument for
 * a persistent kernel. Never a shell command.
 * @param language - selects the fixed flag set.
 * @param executable - canonical interpreter executable.
 * @param scriptArgs - trailing arguments appended after the fixed flags.
 * @returns the complete direct argv, unconfined.
 */
export function interpreterArgv(language: ScienceLanguage, executable: string, ...scriptArgs: readonly string[]): string[] {
  return language === 'python'
    ? [executable, '-I', '-B', '-u', '-X', 'utf8', ...scriptArgs]
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

/** Select the durable available binding for a requested language. */
function selectBinding(environment: ScienceEnvironmentBinding, language: ScienceLanguage): ScienceInterpreterAvailableBinding {
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
 * scratch tree. Shared by every confined interpreter spawn under that
 * Session: one-shot runs, probes, and persistent kernels alike.
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
 * Shared by every Science confinement site — one-shot runs, persistent
 * kernels, and interpreter probes alike — each of which builds its own
 * policy (a probe's differs from a run's: a narrower `workspaceRoot`).
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
 * policy. Shared by one-shot run confinement and persistent kernel spawn
 * confinement (both root the policy at the whole Session scratch tree,
 * unlike an interpreter probe's narrower policy).
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

/** Exact empty-base child environment for a published Science run. */
function runEnvironment(
  binding: ScienceInterpreterAvailableBinding,
  scratch: ScienceSessionScratch,
  run: ScienceRunScratch,
): NodeJS.ProcessEnv {
  return {
    HOME: scratch.home,
    TMPDIR: run.tmp,
    PATH: interpreterPathEnv(binding.canonicalPrefix),
    SCIENCE_STATE_DIR: scratch.state,
    SCIENCE_ARTIFACT_DIR: run.artifacts,
    ...localeEnvironment(),
  }
}

/** Read a collector after settlement without treating unavailable collector state as output. */
function output(reader: { readFrom(fromByte: number): SubprocessOutputRead } | undefined): ScienceRunOutput {
  if (reader === undefined) throw new ScienceRuntimeError('INFRASTRUCTURE_FAILURE', 'Science subprocess did not expose required collected output')
  const read = reader.readFrom(0)
  return { text: read.text, bytes: read.nextOffset, truncated: read.lossy }
}

/** Safely format a durable non-success explanation without retaining program output. */
type RuntimeFailureCode =
  | 'SPAWN_FAILED'
  | 'SANDBOX_RUNNER_FAILED'
  | 'SANDBOX_DENIED'
  | 'DESCENDANT_CLEANUP_REQUIRED'
  | 'PROCESS_SIGNALLED'
  | 'PROCESS_EXIT_NONZERO'
  | 'TIMEOUT'
  | 'CANCELLED'

/** Safe durable explanation for a Runtime-owned failure classification. */
function failureMessage(code: RuntimeFailureCode): string {
  return {
    SPAWN_FAILED: 'The configured interpreter could not start.',
    SANDBOX_RUNNER_FAILED: 'The confinement runner failed before the interpreter started.',
    SANDBOX_DENIED: 'Confinement denied a requested file effect.',
    DESCENDANT_CLEANUP_REQUIRED: 'A descendant required managed-tree cleanup.',
    PROCESS_SIGNALLED: 'The interpreter exited from a signal.',
    PROCESS_EXIT_NONZERO: 'The interpreter exited with a nonzero status.',
    TIMEOUT: 'The Science Runtime operation timed out.',
    CANCELLED: 'The Science Runtime operation was cancelled.',
  }[code]
}

/** Build a terminal value from durable start fields and operational outcome facts. */
function terminal(
  started: ScienceRunStarted,
  stdout: ScienceRunOutput,
  stderr: ScienceRunOutput,
  status: ScienceRunTerminal['status'],
  failureCode: RuntimeFailureCode | undefined,
  outcome?: { readonly exitCode: number | null; readonly signal: string | null },
): ScienceRunTerminal {
  return {
    ...started,
    status,
    finishedAt: Date.now(),
    ...(outcome?.exitCode === null || outcome?.exitCode === undefined ? {} : { exitCode: outcome.exitCode }),
    ...(outcome?.signal === null || outcome?.signal === undefined ? {} : { signal: outcome.signal }),
    stdoutBytes: stdout.bytes,
    stderrBytes: stderr.bytes,
    stdoutTruncated: stdout.truncated,
    stderrTruncated: stderr.truncated,
    ...(failureCode === undefined ? {} : { failureCode, failureMessage: failureMessage(failureCode) }),
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
 * through the seam's one termination verb and wait again. Shared by
 * one-shot run settlement and persistent kernel teardown.
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
 * Create a start candidate after source was flushed but before the requested argv is spawned.
 * @param plan - Private immutable run plan.
 * @param run - Flushed private run directory facts.
 * @param language - Requested interpreter language.
 * @param environment - Applied durable environment revision.
 * @param toolCallId - Still-pending authorization call that owns the run.
 * @param requestHeaderSeq - Durable request-header sequence that owns provenance.
 * @returns Durable start fields ready for one atomic Session append.
 */
export function startCandidate(
  plan: RunPlan,
  run: ScienceRunScratch,
  language: ScienceLanguage,
  environment: ScienceEnvironmentBinding,
  toolCallId: ScienceRunStarted['toolCallId'],
  requestHeaderSeq: number,
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
    status: 'running',
  }
}

/**
 * Wrap fixed direct argv under full Science confinement before the run directory exists.
 * @param services - Shared subprocess, sandbox, exact Session, and private scratch services.
 * @param plan - Private immutable run plan.
 * @param source - Exact private source-file path passed only as a direct argv element.
 * @returns Full confinement facts retained for spawn and result classification.
 */
export function confineRun(
  services: ExecutionServices,
  plan: RunPlan,
  source: string,
): ConfinedExecution {
  const confined = confineInterpreterArgv(
    services.session,
    services.sessionScratch,
    services.sandbox,
    plan.binding.canonicalPrefix,
    interpreterArgv(plan.binding.language, plan.binding.executable, source),
  )
  return {
    argv: confined.argv,
    denialSignatures: confined.denialSignatures,
    runnerFailureRules: confined.runnerFailureRules,
  }
}

/**
 * Start and quiesce a published run, returning a terminal value without appending it.
 * @param services - Shared execution services for the published operation.
 * @param started - Already committed durable run-start value.
 * @param plan - Private immutable run plan.
 * @param run - Private published run directory facts.
 * @param confined - Full direct-argv confinement facts.
 * @returns Terminal output and classification only after tree quiescence, or an eventual cleanup proof.
 */
export async function settleRun(
  services: ExecutionServices,
  started: ScienceRunStarted,
  plan: RunPlan,
  run: ScienceRunScratch,
  confined: ConfinedExecution,
): Promise<SettledRun> {
  let handle: SubprocessHandle | undefined
  let outcome: { readonly exitCode: number | null; readonly signal: string | null } | undefined
  let spawnError: unknown
  const stop = (): void => {
    try {
      handle?.terminate()
    } catch {
      // Settlement owns provider termination failures and still proves whole-tree exit before publishing.
    }
  }
  services.control.signal.addEventListener('abort', stop, { once: true })
  try {
    if (!services.control.signal.aborted) {
      try {
        handle = services.subprocess.spawn({
          argv: confined.argv,
          cwd: run.directory,
          stdio: {
            stdin: 'ignore',
            stdout: { maxBytes: MAX_OUTPUT_BYTES },
            stderr: { maxBytes: MAX_OUTPUT_BYTES },
          },
          graceMs: DESCENDANT_GRACE_MS,
          environmentBase: 'empty',
          env: runEnvironment(plan.binding, services.sessionScratch, run),
          signal: services.control.signal,
        })
        try {
          outcome = await handle.done
        } catch (error) {
          spawnError = error
        }
      } catch (error) {
        spawnError = error
      }
    }
    const resultAfterQuiescence = (forced: boolean): ScienceRunResult => {
      const stdout = handle === undefined ? { text: '', bytes: 0, truncated: false } : output(handle.collected.stdout)
      const stderr = handle === undefined ? { text: '', bytes: 0, truncated: false } : output(handle.collected.stderr)
      let status: ScienceRunTerminal['status'] = 'success'
      let failureCode: RuntimeFailureCode | undefined
      switch (services.control.cause) {
        case 'timeout':
          status = 'timed-out'
          failureCode = 'TIMEOUT'
          break
        case 'cancelled':
        case 'service-disposed':
        case 'session-detached':
          status = 'cancelled'
          failureCode = 'CANCELLED'
          break
        default:
          if (spawnError !== undefined) {
            status = 'failed'
            failureCode = isRunnerSpawnFailure(spawnError, confined.argv[0], run.directory)
              ? 'SANDBOX_RUNNER_FAILED'
              : 'SPAWN_FAILED'
          } else if (outcome === undefined) {
            status = 'failed'
            failureCode = 'SPAWN_FAILED'
          } else {
            const runnerFailure = classifyRunnerFailure(outcome.exitCode, stderr.text, confined.runnerFailureRules)
            if (runnerFailure !== undefined) {
              status = 'failed'
              failureCode = 'SANDBOX_RUNNER_FAILED'
            } else if (classifyDenial(outcome.exitCode, stderr.text, confined.denialSignatures)) {
              status = 'failed'
              failureCode = 'SANDBOX_DENIED'
            } else if (forced) {
              status = 'failed'
              failureCode = 'DESCENDANT_CLEANUP_REQUIRED'
            } else if (outcome.signal !== null) {
              status = 'failed'
              failureCode = 'PROCESS_SIGNALLED'
            } else if (outcome.exitCode !== 0) {
              status = 'failed'
              failureCode = 'PROCESS_EXIT_NONZERO'
            }
          }
          break
      }
      const value = terminal(started, stdout, stderr, status, failureCode, outcome)
      return { terminal: value, stdout, stderr }
    }
    const quiescence: Quiescence = handle === undefined ? { quiescent: true, forced: false } : await quiesce(handle)
    if (!quiescence.quiescent) {
      return {
        quiescent: false,
        eventualResult: quiescence.eventualQuiescence.then(quiescent => quiescent ? resultAfterQuiescence(true) : undefined),
      }
    }
    return { result: resultAfterQuiescence(quiescence.forced), quiescent: true }
  } finally {
    services.control.signal.removeEventListener('abort', stop)
  }
}
