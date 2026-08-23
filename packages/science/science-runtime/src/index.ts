/**
 * Folded local Conda implementation of the R2 Science Runtime operation
 * service. It has no model-facing Consumer or shipped profile entry.
 *
 * @module @deepseek-ai/dsh-science-runtime
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { ScienceEnvironmentProfileId, replayScience } from '@deepseek-ai/dsh-science-session'
import type {
  ScienceArtifactVersion,
  ScienceEnvironmentBinding,
  ScienceLanguage,
  ScienceProjection,
  ScienceRunTerminal,
} from '@deepseek-ai/dsh-science-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-science-session'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-subprocess'
import { captureRunArtifacts } from './capture.ts'
import type { CaptureRunArtifactsResult } from './capture.ts'
import { configSchema, resolveConfig } from './config.ts'
import type { Config, ConfiguredProfile } from './config.ts'
import { assertProfileRunConfinement, observeProfile } from './environment.ts'
import { DESCENDANT_GRACE_MS, kernelRunTerminal, planRun, readCaptureTail, startCandidate } from './execution.ts'
import type { KernelRunFailureCode } from './execution.ts'
import { KERNEL_ASSETS_ROOT } from './kernel-assets.ts'
import { KernelProtocolError } from './kernel-process.ts'
import type { KernelDoneFrame, KernelExecuteRequest, KernelProcess } from './kernel-process.ts'
import {
  KernelEpochRegressionError,
  KernelSet,
  KernelSetDetachedError,
  KernelSetQuarantinedError,
} from './kernel-set.ts'
import type { AcquiredKernel, ScienceKernelEndedFact, ScienceKernelStartedFact } from './kernel-set.ts'
import { LeaseRegistry, OperationControl } from './lifecycle.ts'
import type { OperationCause } from './lifecycle.ts'
import { prepareRunArtifacts } from './inputs.ts'
import type { PreparedRunArtifacts } from './inputs.ts'
import { attachRuntimeSettings } from './settings.ts'
import {
  createRunScratch,
  materializeRunInputs,
  materializeSessionScratch,
  planSessionScratch,
  removeUnpublishedRunScratch,
  rollbackSessionScratch,
} from './scratch.ts'
import type { ScienceSessionScratch } from './scratch.ts'
import { ScienceRuntimeError } from './types.ts'
import type {
  AnnotateScienceArtifactRequest,
  BindScienceEnvironmentRequest,
  ScienceRunHandle,
  ScienceRunResult,
  ScienceRuntimeService,
  StartScienceRunRequest,
} from './types.ts'

export type {
  AnnotateScienceArtifactRequest,
  BindScienceEnvironmentRequest,
  ScienceRunHandle,
  ScienceRunOutput,
  ScienceRunResult,
  ScienceRuntimeErrorCode,
  ScienceRuntimeService,
  StartScienceRunRequest,
} from './types.ts'
export { ScienceRuntimeError } from './types.ts'
export { SCIENCE_RUNTIME_SETTINGS_NAMESPACE, scienceRuntimeProfilesSchema } from './settings.ts'
export { KERNEL_ASSETS_ROOT, resolveKernelDriverPath } from './kernel-assets.ts'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'science-runtime'
/** Required shared services kept alive through terminal settlement. */
export const inject = ['attachments', 'sessions', 'subprocess', 'sandbox']

/**
 * Classify a failed `captureRunArtifacts` call for `captureAfterFinish`'s
 * diagnostic log: filesystem-level faults (the run's artifact directory
 * removed, permission denied, disk failure) are an accepted, expected
 * occasional occurrence; anything else is a defect in this Runtime's own
 * capture logic. Both stay non-fatal to the run either way — the
 * classification only picks the log severity. Mirrors `environment.ts`'s
 * `missingPathError` shape, widened to any errno code rather than an
 * allowlist, since the walk's own I/O calls are the only throw sites the
 * filesystem class needs to cover.
 * @param error - the unknown value `captureRunArtifacts` rejected with.
 * @returns whether the error carries a filesystem `code`.
 */
function isCaptureFilesystemFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  return typeof (error as { readonly code?: unknown }).code === 'string'
}

/** Terminal classification for one settled kernel execution, independent of durable identity fields. */
export interface KernelRunOutcome {
  readonly status: ScienceRunTerminal['status']
  readonly failureCode?: KernelRunFailureCode
  readonly outputDegraded: boolean
  /** Whether the caller must retire this kernel (taint-retirement/escalation) via `KernelSet.retireForEscalation`. */
  readonly retireKernel: boolean
}

/** Non-abort classification from one DONE frame: `ok`→success, `error`→`EXECUTION_FAILED`. */
function doneOutcome(frame: KernelDoneFrame): KernelRunOutcome {
  switch (frame.status) {
    case 'ok':
      return { status: 'success', outputDegraded: frame.captureDegraded, retireKernel: false }
    case 'error':
      return { status: 'failed', failureCode: 'EXECUTION_FAILED', outputDegraded: frame.captureDegraded, retireKernel: false }
    // A DONE frame can carry `interrupted` with no host SIGINT ever sent:
    // user code raising its own interrupt (Python's `KeyboardInterrupt`,
    // R's run-scoped interrupt `tryCatch`) reaches the driver the same way
    // an escalated host interrupt does, so both settle identically here.
    case 'interrupted':
      return { status: 'failed', failureCode: 'EXECUTION_FAILED', outputDegraded: frame.captureDegraded, retireKernel: false }
  }
}

/** First-cause classification for an aborted run: `TIMEOUT`/`CANCELLED`, independent of the kernel's own fate. */
function abortOutcome(cause: OperationCause, retireKernel: boolean, outputDegraded: boolean): KernelRunOutcome {
  switch (cause) {
    case 'timeout':
      return { status: 'timed-out', failureCode: 'TIMEOUT', outputDegraded, retireKernel }
    case 'cancelled':
    case 'service-disposed':
    case 'session-detached':
      return { status: 'cancelled', failureCode: 'CANCELLED', outputDegraded, retireKernel }
  }
}

/**
 * Run one RUN/DONE exchange against an acquired kernel, applying
 * interrupt-first cancel/timeout handling and terminal classification.
 * Never reads or appends durable state, and never itself retires the kernel
 * — the caller owns every append and owns calling
 * `KernelSet.retireForEscalation` when {@link KernelRunOutcome.retireKernel} is true.
 * @param control - the run's fused cancellation/timeout signal and first-cause record.
 * @param kernel - the acquired, ready kernel process.
 * @param request - exact host-minted run identity and per-run capture paths.
 * @returns the run's terminal classification.
 */
export async function settleKernelExecution(
  control: OperationControl,
  kernel: KernelProcess,
  request: KernelExecuteRequest,
): Promise<KernelRunOutcome> {
  const execution = kernel.execute(request)
  const settled = execution.then(
    (frame): { readonly kind: 'done'; readonly frame: KernelDoneFrame } => ({ kind: 'done', frame }),
    (): { readonly kind: 'died' } => ({ kind: 'died' }),
  )
  const abortWaiter = Promise.withResolvers<{ readonly kind: 'abort' }>()
  const onAbort = (): void => { abortWaiter.resolve({ kind: 'abort' }) }
  if (control.signal.aborted) onAbort()
  else control.signal.addEventListener('abort', onAbort, { once: true })
  let first: { readonly kind: 'done'; readonly frame: KernelDoneFrame } | { readonly kind: 'died' } | { readonly kind: 'abort' }
  try {
    first = await Promise.race([settled, abortWaiter.promise])
  } finally {
    control.signal.removeEventListener('abort', onAbort)
  }
  if (first.kind === 'done') return doneOutcome(first.frame)
  if (first.kind === 'died') return { status: 'failed', failureCode: 'KERNEL_DIED', outputDegraded: false, retireKernel: false }

  // Interrupt-first. The RUN frame already committed before this point,
  // so sending SIGINT now satisfies "after RUN, before DONE" regardless of
  // when the caller's own abort fired.
  kernel.interrupt()
  const escalate = new Promise<{ readonly kind: 'escalate' }>((resolve) => {
    AbortSignal.timeout(DESCENDANT_GRACE_MS).addEventListener('abort', () => { resolve({ kind: 'escalate' }) }, { once: true })
  })
  const afterInterrupt = await Promise.race([settled, escalate])
  const cause = control.cause
  /* v8 ignore next -- OperationControl always sets a cause before its signal fires */
  if (cause === undefined) throw new Error('science-runtime: kernel run abort settled with no first cause recorded')
  if (afterInterrupt.kind === 'done' && afterInterrupt.frame.status === 'interrupted') {
    // The kernel proved it caught the interrupt: it survives.
    return abortOutcome(cause, false, afterInterrupt.frame.captureDegraded)
  }
  if (afterInterrupt.kind === 'done') {
    // Taint-retirement: the SIGINT landed on an effectively idle kernel, whose state is now unknown.
    return abortOutcome(cause, true, afterInterrupt.frame.captureDegraded)
  }
  // Escalation (no DONE within DESCENDANT_GRACE_MS), or the kernel died on
  // its own while awaiting the interrupt outcome: either way this run's
  // terminal stays first-cause-governed and the kernel is retired. `settled`
  // itself never rejects (its own `.then` already converted `execution`'s
  // eventual rejection into a value), so it is safely left pending here —
  // the caller's own retirement kills the kernel, which resolves it later.
  return abortOutcome(cause, true, false)
}

/**
 * Task-vocabulary phrase for `KERNEL_START_FAILED`'s "cause class": what
 * went wrong, never an internal TypeScript class name — a model may relay
 * this message to a user.
 */
function kernelStartCauseClass(error: unknown): string {
  if (error instanceof KernelProtocolError) return 'the kernel did not complete its startup handshake'
  if (error instanceof AggregateError) return 'the kernel could not be stopped cleanly after its startup failed'
  return 'the kernel process could not be started'
}

/**
 * `ScienceRuntime.appendKernelStarted`'s own durable `science/kernel-state`
 * append was vetoed. Marked so `kernelAcquisitionError` classifies it the
 * same way `run-started`'s veto already is (`TERMINAL_COMMIT_FAILED`'s
 * sibling on the pre-publication path): `INFRASTRUCTURE_FAILURE`, not the
 * unclassified spawn-failure fallback `KERNEL_START_FAILED`.
 */
class KernelStartedAppendError extends Error {
  override name = 'KernelStartedAppendError'

  constructor(sessionId: string, cause: unknown) {
    super(`science-runtime: kernel-state started fact could not be committed for session ${JSON.stringify(sessionId)}`, { cause })
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    scienceRuntime: ScienceRuntime
  }
}

/** Folded local Science Runtime provider with public types free of Host paths. */
export class ScienceRuntime extends Service implements ScienceRuntimeService {
  static inject = inject
  static Config: z<Config> = configSchema

  /**
   * Parsed profile selection owned by this provider. This entry resolves it
   * from Cordis configuration alone; the
   * `@deepseek-ai/dsh-science-runtime/with-settings` entry replaces it once,
   * during load, through {@link ScienceRuntime.bindSettings}.
   */
  private profiles: ReadonlyMap<string, ConfiguredProfile>
  /** Cordis entry configuration, also the settings composition `base`. */
  private readonly cordisConfig: Config
  /** Configured operation deadline. */
  private readonly timeoutMs: number
  /** Explicit or shared-resolver Harness home input. */
  private readonly dshHome: string | undefined
  /** Configured package-inventory entry bound. */
  private readonly packagesMaxEntries: number
  /** Configured package-inventory byte bound. */
  private readonly packagesMaxBytes: number
  /** Configured auto-capture per-file byte bound. */
  private readonly captureMaxFileBytes: number
  /** Configured auto-capture per-run file-count bound. */
  private readonly captureMaxFilesPerRun: number
  /** Configured auto-capture per-session artifact-version bound. */
  private readonly captureMaxArtifactVersionsPerSession: number
  /** Configured per-run artifact-input count bound. */
  private readonly inputMaxFilesPerRun: number
  /** Configured per-run artifact-input aggregate-byte bound. */
  private readonly inputMaxBytesPerRun: number
  /** Configured persistent-kernel idle deadline. */
  private readonly kernelIdleTimeoutMs: number
  /** Configured persistent-kernel spawn-to-READY deadline. */
  private readonly kernelStartTimeoutMs: number
  /** Exact-object reservation and same-id quarantine owner. */
  private readonly leases = new LeaseRegistry()
  /** Every live persistent Science kernel across sessions. */
  private readonly kernels: KernelSet
  private disposing = false

  /**
   * @param ctx - Cordis context providing Session, subprocess, and sandbox services.
   * @param config - Strict local prefix configuration.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'scienceRuntime')
    const resolved = resolveConfig(config)
    this.profiles = resolved.profiles
    this.cordisConfig = config
    this.timeoutMs = resolved.timeoutMs
    this.dshHome = resolved.dshHome
    this.packagesMaxEntries = resolved.packagesMaxEntries
    this.packagesMaxBytes = resolved.packagesMaxBytes
    this.captureMaxFileBytes = resolved.captureMaxFileBytes
    this.captureMaxFilesPerRun = resolved.captureMaxFilesPerRun
    this.captureMaxArtifactVersionsPerSession = resolved.captureMaxArtifactVersionsPerSession
    this.inputMaxFilesPerRun = resolved.inputMaxFilesPerRun
    this.inputMaxBytesPerRun = resolved.inputMaxBytesPerRun
    this.kernelIdleTimeoutMs = resolved.kernelIdleTimeoutMs
    this.kernelStartTimeoutMs = resolved.kernelStartTimeoutMs
    this.kernels = new KernelSet({
      subprocess: ctx.subprocess,
      sandbox: ctx.sandbox,
      assetsRoot: KERNEL_ASSETS_ROOT,
      kernelIdleTimeoutMs: this.kernelIdleTimeoutMs,
      kernelStartTimeoutMs: this.kernelStartTimeoutMs,
      nextEpoch: session => this.nextKernelEpoch(session),
      onKernelStarted: (session, fact) => { this.appendKernelStarted(session, fact) },
      onKernelEnded: (session, fact) => { this.appendKernelEnded(session, fact) },
    })
    ctx.effect(() => {
      const stopSessionObserver = ctx.on('session/disposed', (session) => {
        this.leases.detach(session)
        this.kernels.detach(session)
      }, { global: true })
      return async () => {
        this.disposing = true
        stopSessionObserver()
        await Promise.allSettled([this.leases.disposeAll(), this.kernels.disposeAll()])
      }
    }, 'science runtime teardown')
  }

  /**
   * Allocate the next session-local kernel epoch, seeded from the Session's
   * own durable projection, so epochs survive a Host restart.
   * @param session - exact live Session that will own the fresh kernel.
   * @returns one greater than the highest `kernelEpoch` the Session's log has ever admitted, or 1 before any kernel.
   */
  private nextKernelEpoch(session: Session): number {
    const projection = replayScience(session.events)
    return (projection?.kernels.at(-1)?.kernelEpoch ?? 0) + 1
  }

  /**
   * Append the durable `started` fact for a freshly spawned kernel
   * (commit ordering: `KernelSet` calls this BEFORE the kernel becomes
   * acquirable, so a throw here ends the fresh kernel and fails its
   * acquiring run without ever registering it). A vetoed append is
   * re-thrown wrapped in {@link KernelStartedAppendError} so
   * `kernelAcquisitionError` classifies it correctly.
   * @param session - exact live Session that owns the fresh kernel.
   * @param fact - the started kernel's whole-value provenance.
   * @throws {@link KernelStartedAppendError} when `session.append` itself throws.
   */
  private appendKernelStarted(session: Session, fact: ScienceKernelStartedFact): void {
    try {
      session.append('science/kernel-state', {
        version: 1,
        kernel: {
          kernelEpoch: fact.kernelEpoch,
          language: fact.language,
          state: 'started',
          environmentRevision: fact.environmentRevision,
          environmentFingerprint: fact.environmentFingerprint,
          at: fact.startedAt,
        },
      })
    } catch (error) {
      throw new KernelStartedAppendError(String(session.id), error)
    }
  }

  /**
   * Append the durable `exited` fact for one kernel end path. Containment-
   * wrapped by `KernelSet` itself: a throw here never rejects teardown
   * or skips quarantine bookkeeping — a legitimately dead Session's missing
   * `exited` fact is recovered by the end-seed `ScienceKernelInterrupted` derivation.
   * @param session - exact Session that owned the kernel (may already be detached).
   * @param fact - the ended kernel's whole-value provenance and reason.
   */
  private appendKernelEnded(session: Session, fact: ScienceKernelEndedFact): void {
    session.append('science/kernel-state', {
      version: 1,
      kernel: {
        kernelEpoch: fact.kernelEpoch,
        language: fact.language,
        state: 'exited',
        reason: fact.reason,
        startedAt: fact.startedAt,
        environmentRevision: fact.environmentRevision,
        environmentFingerprint: fact.environmentFingerprint,
        at: fact.endedAt,
      },
    })
  }

  /**
   * Adopt the restart-scoped `science-runtime` settings namespace as this
   * Runtime's profile map for the whole Host lifecycle, with the Cordis entry
   * configuration as the composition `base`. Reserved for the
   * `with-settings` entry, whose Cordis injections make `settings` ACTIVE
   * before construction; calling it from a composition that did not declare
   * that dependency would reintroduce a load-order race.
   * @param settings - the ACTIVE settings provider that entry injected.
   */
  protected bindSettings(settings: SettingsProvider): void {
    this.profiles = attachRuntimeSettings(settings, this.cordisConfig)
  }

  /**
   * Observe one configured existing Conda profile and append its whole-value
   * environment revision. Static unusability becomes an honest `invalid`
   * revision; capability, cancellation, and I/O failures append nothing.
   * @param request - Exact live Session, profile identity, and caller signal.
   * @returns The accepted durable environment revision.
   */
  async bindEnvironment(request: BindScienceEnvironmentRequest): Promise<ScienceEnvironmentBinding> {
    const initial = this.assertSession(request.session)
    this.assertHostLocal()
    const profile = this.profile(String(request.profileId))
    if (initial.runs.length !== 0) {
      throw new ScienceRuntimeError('ENVIRONMENT_NOT_READY', 'Science environment cannot be rebound after the first run')
    }
    const lease = this.reserve(request.session, request.signal)
    let scratchPreparation: Awaited<ReturnType<typeof materializeSessionScratch>> | undefined
    try {
      this.assertPrepublication(request.session, lease.control)
      const sessionScratch = await planSessionScratch(this.dshHome, request.session)
      await assertProfileRunConfinement(profile, request.session, sessionScratch.root)
      this.assertPrepublication(request.session, lease.control)
      const observed = await observeProfile({
        subprocess: this.ctx.subprocess,
        sandbox: this.ctx.sandbox,
        sessionScratch,
        sessionId: request.session.id,
        signal: lease.control.signal,
        prepareSessionScratch: async () => {
          scratchPreparation = await materializeSessionScratch(this.dshHome, request.session)
          this.assertPrepublication(request.session, lease.control)
        },
        packagesMaxEntries: this.packagesMaxEntries,
        packagesMaxBytes: this.packagesMaxBytes,
      }, profile)
      this.assertPrepublication(request.session, lease.control)
      const current = this.assertSession(request.session)
      const bindings = [observed.python?.binding, observed.r?.binding].filter(binding => binding !== undefined)
      const failures = bindings.filter(binding => binding.capability !== 'available')
      const now = Date.now()
      const environment: ScienceEnvironmentBinding = {
        revision: (current.environment?.revision ?? 0) + 1,
        profileId: ScienceEnvironmentProfileId(String(request.profileId)),
        configuredAt: now,
        validatedAt: now,
        status: failures.length === 0 ? 'applied' : 'invalid',
        ...(observed.python === undefined ? {} : { python: observed.python.binding }),
        ...(observed.r === undefined ? {} : { r: observed.r.binding }),
        ...(failures.length === 0 ? {} : { failureReason: failures.map(binding => binding.reason).join('; ') }),
      }
      this.assertPrepublication(request.session, lease.control)
      request.session.append('science/environment-bound', { version: 1, environment })
      return environment
    } catch (error) {
      try {
        if (scratchPreparation !== undefined) await rollbackSessionScratch(scratchPreparation)
      } catch (rollbackError) {
        throw this.prepublicationError(lease.control, new AggregateError(
          [error, rollbackError],
          'science-runtime: pre-publication Session scratch rollback failed',
        ))
      }
      throw this.prepublicationError(lease.control, error)
    } finally {
      this.leases.release(lease)
    }
  }

  /**
   * Resolve and materialize exact artifact inputs, acquire this run's
   * persistent kernel, publish its run start, then settle exactly one
   * matching terminal fact and baseline-attributed capture walk.
   * @param request - Exact live Session, source, authorization facts, optional artifact inputs and edit baselines, and cancellation.
   * @returns A handle exposed only after `science/run-started` committed.
   */
  async startRun(request: StartScienceRunRequest): Promise<ScienceRunHandle> {
    if (process.platform === 'win32') {
      throw new ScienceRuntimeError('KERNEL_UNSUPPORTED_PLATFORM', 'Science kernel execution requires macOS or Linux')
    }
    const projection = this.assertSession(request.session)
    this.assertHostLocal()
    const environment = projection.environment
    if (environment === null || environment.status !== 'applied') {
      throw new ScienceRuntimeError('ENVIRONMENT_NOT_READY', 'Science Runtime requires an applied environment')
    }
    if (projection.runs.some(run => run.status === 'running')) {
      throw new ScienceRuntimeError('RUNTIME_BUSY', 'Science Session already has an open run')
    }
    const profile = this.profile(String(environment.profileId))
    const lease = this.reserve(request.session, request.signal)
    let sessionScratch: ScienceSessionScratch | undefined
    let scratchPreparation: Awaited<ReturnType<typeof materializeSessionScratch>> | undefined
    let runScratch: Awaited<ReturnType<typeof createRunScratch>> | undefined
    try {
      this.assertPrepublication(request.session, lease.control)
      const plan = planRun(environment, request.language, request.code)
      const preparedArtifacts = await prepareRunArtifacts(
        projection,
        this.ctx.attachments,
        request.artifactInputs,
        request.editBaselines,
        this.inputMaxFilesPerRun,
        this.inputMaxBytesPerRun,
        lease.control.signal,
      )
      this.assertPrepublication(request.session, lease.control)
      scratchPreparation = await materializeSessionScratch(this.dshHome, request.session)
      sessionScratch = scratchPreparation.scratch
      await assertProfileRunConfinement(profile, request.session, sessionScratch.root)
      this.assertPrepublication(request.session, lease.control)
      if (request.language === 'r' && sessionScratch.runs.includes(' ')) {
        throw new ScienceRuntimeError('CONFINEMENT_UNAVAILABLE', 'R run directory cannot contain an ASCII space')
      }
      runScratch = await createRunScratch(sessionScratch, plan.runId, request.language, plan.sourceBytes)
      await materializeRunInputs(runScratch, preparedArtifacts.materialized)
      this.assertPrepublication(request.session, lease.control)
      const kernel = await this.acquireKernel(request.session, request.language, environment, sessionScratch, lease.control)
      // Disarmed immediately on acquisition, not only after run-started
      // commits: this run already owns the kernel the moment
      // `acquireKernel` resolves, before `run-started` actually appends, and the idle timer must
      // never fire in that window. `settlePublishedKernelRun`'s
      // own `finally` re-arms it once this run settles.
      this.kernels.disarmIdleTimer(request.session, request.language)
      this.assertPrepublication(request.session, lease.control)
      const started = startCandidate(
        plan,
        runScratch,
        request.language,
        environment,
        request.toolCallId,
        request.requestHeaderSeq,
        kernel.epoch,
        preparedArtifacts.inputs,
      )
      request.session.append('science/run-started', { version: 1, run: started })
      const done = this.settlePublishedKernelRun(
        lease,
        request.session,
        runScratch,
        kernel.process,
        started,
        preparedArtifacts,
      )
      return {
        runId: plan.runId,
        done,
        cancel: () => { lease.control.cancel() },
      }
    } catch (error) {
      const cleanupFailures: unknown[] = []
      try {
        if (sessionScratch !== undefined && runScratch !== undefined) {
          await removeUnpublishedRunScratch(sessionScratch, runScratch)
        }
      } catch (cleanupError) {
        cleanupFailures.push(cleanupError)
      }
      try {
        if (scratchPreparation !== undefined) await rollbackSessionScratch(scratchPreparation)
      } catch (cleanupError) {
        cleanupFailures.push(cleanupError)
      } finally {
        this.leases.release(lease)
      }
      if (cleanupFailures.length > 0) {
        throw new AggregateError(
          [error, ...cleanupFailures],
          // Defensive arm: bindEnvironment materializes the Session scratch
          // before any run can start, so a cleanup failure here always
          // follows createRunScratch today; the arm remains for a future
          // producer that reaches startRun on a freshly created tree.
          /* v8 ignore next 3 */
          runScratch === undefined
            ? 'science-runtime: pre-publication Session scratch rollback failed'
            : 'science-runtime: unpublished run rollback failed',
        )
      }
      throw this.prepublicationError(lease.control, error)
    }
  }

  /**
   * Re-commit an existing artifact version's exact attachment reference with
   * a curated title and caption: metadata-only, so it never reads or writes
   * the filesystem and never calls the attachment store, and it supersedes
   * the version it names rather than opening a new one whose bytes would
   * repeat their predecessor's. A committed event is never rolled back
   * because a later step fails; there is no later step here that can fail
   * after the append.
   * @param request - Exact live Session, target logical artifact (and optional version), title/caption, and cancellation.
   * @returns The durable curated version this operation committed.
   */
  annotateArtifact(request: AnnotateScienceArtifactRequest): Promise<ScienceArtifactVersion> {
    // Metadata-only: every step below is synchronous, so this avoids `async`
    // (a function that never awaits) — but every failure, including
    // `assertSession`'s own, must still reject rather than throw
    // synchronously, matching every other `ScienceRuntimeService` operation's
    // calling convention (a caller may `await` this without its own `async`
    // wrapper already catching a synchronous throw).
    try {
      const projection = this.assertSession(request.session)
      const lease = this.reserve(request.session, request.signal)
      try {
        this.assertPrepublication(request.session, lease.control)
        const artifact = this.curatedVersion(projection, request)
        request.session.append('science/artifact-saved', { version: 1, artifact })
        return Promise.resolve(artifact)
      } catch (error) {
        return Promise.reject(this.prepublicationError(lease.control, error))
      } finally {
        this.leases.release(lease)
      }
    } catch (error) {
      // assertSession/reserve only ever throw ScienceRuntimeError (extends Error).
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors
      return Promise.reject(error)
    }
  }

  /**
   * Resolve the exact source version `request` names (its exact `version`,
   * or the logical artifact's latest version), then build that same version's
   * curated replacement, reusing its content-addressed `attachment` and
   * originating-run provenance unchanged.
   * @param projection - exact live Science projection.
   * @param request - the annotate request naming the target logical artifact.
   * @returns the complete curated version to commit.
   * @throws {@link ScienceRuntimeError} (`ARTIFACT_NOT_FOUND`) when `logicalName`
   *   (or its named `version`) does not exist in this session.
   */
  private curatedVersion(
    projection: ScienceProjection,
    request: AnnotateScienceArtifactRequest,
  ): ScienceArtifactVersion {
    const logical = projection.artifacts.filter(candidate => candidate.logicalName === request.logicalName)
    const latest = logical.at(-1)
    if (latest === undefined) {
      throw new ScienceRuntimeError(
        'ARTIFACT_NOT_FOUND',
        `no artifact named ${JSON.stringify(request.logicalName)} exists in this session`,
      )
    }
    const source = request.version === undefined ? latest : logical.find(candidate => candidate.version === request.version)
    if (source === undefined) {
      const available = logical.map(candidate => candidate.version).join(', ')
      throw new ScienceRuntimeError(
        'ARTIFACT_NOT_FOUND',
        `artifact ${JSON.stringify(request.logicalName)} has no version ${JSON.stringify(request.version)}. Available: ${available}.`,
      )
    }
    if (source.origin === 'human-edit') {
      throw new ScienceRuntimeError(
        'ARTIFACT_NOT_FOUND',
        `artifact ${JSON.stringify(request.logicalName)} version ${String(source.version)} is a direct style edit and cannot be curated`,
      )
    }
    return {
      artifactId: latest.artifactId,
      logicalName: request.logicalName,
      // Curation is metadata over content the session already holds, so it
      // supersedes the version it names instead of opening one whose bytes
      // would be identical to its predecessor's.
      version: source.version,
      title: request.title,
      ...(request.caption === undefined ? {} : { caption: request.caption }),
      origin: 'model',
      attachment: source.attachment,
      runId: source.runId,
      toolCallId: request.toolCallId,
      requestHeaderSeq: request.requestHeaderSeq,
      environmentRevision: source.environmentRevision,
      environmentFingerprint: source.environmentFingerprint,
      createdAt: Date.now(),
    }
  }

  /** Reserve a non-queuing exact Session lease without leaking a rejected timer. */
  private reserve(session: BindScienceEnvironmentRequest['session'], signal: AbortSignal) {
    const control = new OperationControl(signal, this.timeoutMs)
    try {
      return this.leases.reserve(session, control)
    } catch (error) {
      control.dispose()
      throw error
    }
  }

  /**
   * Resolve one configured profile without exposing the mutable configuration
   * record. The requested id is fixed preset policy, never model or user
   * input, so an unresolved id always means the deployment has not named a
   * Conda prefix for it yet — the message names where to configure one
   * instead of the internal profile-id vocabulary, because both a person
   * reading it directly and a model relaying it to one need to act on it.
   */
  private profile(id: string): ConfiguredProfile {
    const profile = this.profiles.get(id)
    if (profile === undefined) {
      throw new ScienceRuntimeError(
        'PROFILE_NOT_CONFIGURED',
        `no Conda prefix is configured for the Science environment profile ${JSON.stringify(id)} — `
        + 'open Settings → Plugins → Science to configure one, then restart the Host',
      )
    }
    return profile
  }

  /** Refuse all Host-scratch work outside the local subprocess execution world. */
  private assertHostLocal(): void {
    if (this.ctx.subprocess.executionWorld !== 'host-local') {
      throw new ScienceRuntimeError('CONFINEMENT_UNAVAILABLE', 'Science private Host scratch requires a host-local subprocess provider')
    }
  }

  /** Require an exact currently attached Science Session and its strict projection. */
  private assertSession(session: BindScienceEnvironmentRequest['session']): ScienceProjection {
    if (this.disposing) throw new ScienceRuntimeError('SERVICE_DISPOSING', 'Science Runtime is disposing')
    if (this.ctx.sessions.get(session.id) !== session) {
      throw new ScienceRuntimeError('SESSION_NOT_LIVE', 'Science Runtime requires the exact live Session object')
    }
    const projection = replayScience(session.events)
    if (projection === null) {
      throw new ScienceRuntimeError('ENVIRONMENT_NOT_READY', 'Science mode must be bound before Runtime operations')
    }
    return projection
  }

  /** Recheck exact liveness and caller-controlled pre-publication cancellation. */
  private assertPrepublication(session: BindScienceEnvironmentRequest['session'], control: OperationControl): void {
    if (this.ctx.sessions.get(session.id) !== session) {
      throw new ScienceRuntimeError('SESSION_NOT_LIVE', 'Science Session detached before publication')
    }
    if (!control.signal.aborted) return
    throw this.prepublicationError(control, undefined)
  }

  /** Translate a pre-publication cause without turning a capability failure into an event. */
  private prepublicationError(control: OperationControl, error: unknown): Error {
    if (error instanceof ScienceRuntimeError) return error
    switch (control.cause) {
      case 'timeout':
        return new ScienceRuntimeError('OPERATION_TIMED_OUT', 'Science Runtime operation timed out', { cause: error })
      case 'cancelled':
      case 'service-disposed':
      case 'session-detached':
        return new ScienceRuntimeError('OPERATION_CANCELLED', 'Science Runtime operation was cancelled', { cause: error })
      default:
        return new ScienceRuntimeError('INFRASTRUCTURE_FAILURE', 'Science Runtime operation failed before publication', { cause: error })
    }
  }

  /**
   * Acquire this run's kernel: reuse a live matching-revision
   * kernel, or spawn a fresh one — ending a stale-revision kernel first
   * (`environment-rebound`). Translates every `KernelSet.acquire` rejection
   * onto the pre-publication `ScienceRuntimeErrorCode` vocabulary. A
   * rejection while `control`'s own signal is the cause (`control.cause` is
   * set) goes through `prepublicationError` instead: passing
   * `control.signal` into `KernelSet.acquire` means a fresh spawn can now be
   * the thing that observed the abort, and that must still read as
   * `OPERATION_TIMED_OUT`/`OPERATION_CANCELLED`, not a spawn failure.
   * @param session - exact live Session that will own the kernel.
   * @param language - requested interpreter language.
   * @param environment - applied durable environment revision the kernel must serve.
   * @param sessionScratch - the Session's already-materialized private scratch paths.
   * @param control - this run's fused cancellation/timeout signal and first-cause record.
   * @returns the acquired kernel process and its own session-local epoch.
   */
  private async acquireKernel(
    session: Session,
    language: ScienceLanguage,
    environment: ScienceEnvironmentBinding,
    sessionScratch: ScienceSessionScratch,
    control: OperationControl,
  ): Promise<AcquiredKernel> {
    try {
      return await this.kernels.acquire(session, language, environment, sessionScratch, control.signal)
    } catch (error) {
      if (control.cause !== undefined) throw this.prepublicationError(control, error)
      throw this.kernelAcquisitionError(error, language)
    }
  }

  /**
   * Map a `KernelSet.acquire` rejection onto the pre-publication
   * `ScienceRuntimeErrorCode` vocabulary. `KernelSetDetachedError`
   * maps to `SESSION_NOT_LIVE`: it means this exact Session
   * object already detached from the kernel set's registry — the same fact
   * `assertPrepublication`'s synchronous liveness check, run immediately
   * before every `acquireKernel` call with no intervening `await`, already
   * guards against; reaching here at all would mean that check raced a
   * detach in the same synchronous continuation, which cannot happen, so
   * this classification is a defensive backstop naming the actual
   * condition rather than a spawn failure. `KernelEpochRegressionError` is
   * equally unreachable through this production allocator (`nextKernelEpoch`
   * above): it derives strictly from the durable projection's own latest
   * committed epoch, appendable only through the strictly-monotonic,
   * append-only session log, so it can never return a value the live
   * `KernelSet` entry's own `epochSeen` watermark (which only ever advances
   * from that exact allocator's own prior return values) already exceeds —
   * `kernel-set.spec.ts` proves the underlying `KernelSet` guard fires
   * correctly against a deliberately misbehaving injected allocator instead.
   */
  private kernelAcquisitionError(error: unknown, language: ScienceLanguage): Error {
    if (error instanceof KernelSetQuarantinedError) {
      return new ScienceRuntimeError('RUNTIME_BUSY', 'Science kernel from a predecessor Session is still tearing down', { cause: error })
    }
    /* v8 ignore next 2 -- unreachable: see this method's own doc above. */
    if (error instanceof KernelSetDetachedError) {
      return new ScienceRuntimeError('SESSION_NOT_LIVE', 'Science Session detached before kernel acquisition', { cause: error })
    }
    /* v8 ignore next 2 -- unreachable: see this method's own doc above. */
    if (error instanceof KernelEpochRegressionError) {
      return new ScienceRuntimeError('INFRASTRUCTURE_FAILURE', 'Science kernel epoch allocation did not advance', { cause: error })
    }
    if (error instanceof KernelStartedAppendError) {
      return new ScienceRuntimeError('INFRASTRUCTURE_FAILURE', 'Science kernel start fact could not be committed', { cause: error })
    }
    if (error instanceof ScienceRuntimeError) return error
    return new ScienceRuntimeError(
      'KERNEL_START_FAILED',
      `Science ${language} kernel could not start: ${kernelStartCauseClass(error)}`,
      { cause: error },
    )
  }

  /**
   * Settle a published kernel run: the RUN/DONE protocol exchange,
   * bounded output-tail reads, terminal commit, auto-capture, and (when
   * the run's classification requires it) background kernel retirement — while retaining the exact
   * lease through commit or cleanup. Never proves subprocess-tree
   * quiescence itself: that is `KernelSet`'s own concern for the kernel
   * process, decoupled from this run's own terminal.
   */
  private async settlePublishedKernelRun(
    lease: ReturnType<LeaseRegistry['reserve']>,
    session: StartScienceRunRequest['session'],
    runScratch: Awaited<ReturnType<typeof createRunScratch>>,
    kernel: KernelProcess,
    started: ReturnType<typeof startCandidate>,
    preparedArtifacts: PreparedRunArtifacts,
  ): Promise<ScienceRunResult> {
    try {
      const request: KernelExecuteRequest = {
        runId: started.runId,
        sourcePath: runScratch.source,
        cwd: runScratch.directory,
        stdoutPath: runScratch.stdout,
        stderrPath: runScratch.stderr,
        artifactDir: runScratch.artifacts,
        inputDir: runScratch.inputs,
      }
      let outcome: KernelRunOutcome
      try {
        outcome = await settleKernelExecution(lease.control, kernel, request)
      } catch (error) {
        if (this.ctx.sessions.get(session.id) !== session) {
          throw new ScienceRuntimeError('SESSION_NOT_LIVE', 'Science Session detached before terminal publication', { cause: error })
        }
        throw new ScienceRuntimeError('TERMINAL_COMMIT_FAILED', 'Science terminal value could not be prepared after kernel settlement', { cause: error })
      }
      try {
        const [stdout, stderr] = await Promise.all([readCaptureTail(runScratch.stdout), readCaptureTail(runScratch.stderr)])
        const terminal = kernelRunTerminal(started, stdout, stderr, outcome.status, outcome.failureCode, outcome.outputDegraded)
        if (this.ctx.sessions.get(session.id) !== session) {
          throw new ScienceRuntimeError('SESSION_NOT_LIVE', 'Science Session detached before terminal publication')
        }
        try {
          session.append('science/run-finished', { version: 1, run: terminal })
        } catch (error) {
          if (this.ctx.sessions.get(session.id) !== session) {
            throw new ScienceRuntimeError('SESSION_NOT_LIVE', 'Science Session detached before terminal publication', { cause: error })
          }
          throw new ScienceRuntimeError('TERMINAL_COMMIT_FAILED', 'Science terminal fact could not be committed', { cause: error })
        }
        const capture = await this.captureAfterFinish(session, runScratch, terminal, preparedArtifacts.editBaselines)
        return { terminal, stdout, stderr, ...capture === undefined ? {} : { capture } }
      } finally {
        // Retire-vs-rearm derives from `outcome` alone, already settled
        // above, so it must run on every exit from this block — including a
        // thrown `readCaptureTail` or a vetoed `run-finished` append: a
        // tainted kernel left unretired stays live with an
        // unknown post-interrupt state for the next run to reuse, and a
        // non-tainted kernel left unrearmed can never end `idle`.
        if (outcome.retireKernel) {
          // Fire-and-forget: never blocks this run's own settlement — a
          // subsequent acquire() for this session drains any still-in-flight
          // teardown internally (KernelSet.drain).
          void this.kernels.retireForEscalation(session, started.language).catch((error: unknown) => {
            this.ctx.logger.error(`science-runtime: kernel retirement failed for session "${session.id}": ${String(error)}`)
          })
        } else {
          this.kernels.resetIdleTimer(session, started.language)
        }
      }
    } finally {
      this.leases.release(lease)
    }
  }

  /**
   * Auto-capture every eligible file in one just-finished run's artifact
   * directory as the next version of its logical Science artifact. Runs
   * once per run, immediately after its `science/run-finished` fact commits
   * and while the run's lease is still held; a capture failure here is
   * never a run failure — the terminal fact this run already committed
   * stands regardless, symmetric to the accepted crash-between-commit-and-
   * capture gap (capture.ts). Every failure is logged, not silently
   * absorbed: an environmental fault (the artifact directory disappeared, a
   * permission or disk error) logs at `warn`, since it is an accepted,
   * expected occasional occurrence; anything else logs at `error`, since it
   * is a defect in this Runtime's own capture logic and must stay visible
   * rather than disappearing without trace. The README's Known Limitations
   * names the residual case this still cannot recover from: capture itself
   * has no automatic retry, so a logged failure means that run's eligible
   * files stay uncaptured until the next run.
   * @param session - exact live Session that owns the just-finished run.
   * @param runScratch - the run's private Host scratch, including its artifact directory.
   * @param terminal - the exact terminal record just committed, supplying every captured version's provenance.
   * @param editBaselines - Validated exact parents keyed by capture-relative path.
   * @returns capture accounting, or `undefined` when the Session detached or capture itself failed.
   */
  private async captureAfterFinish(
    session: StartScienceRunRequest['session'],
    runScratch: Awaited<ReturnType<typeof createRunScratch>>,
    terminal: ScienceRunTerminal,
    editBaselines: PreparedRunArtifacts['editBaselines'],
  ): Promise<CaptureRunArtifactsResult | undefined> {
    // The caller already re-verified liveness immediately before the
    // run-finished append this method follows; only a detach racing that
    // exact synchronous continuation reaches this, not deterministically
    // reproducible in a test.
    /* v8 ignore next */
    if (this.ctx.sessions.get(session.id) !== session) return undefined
    let result: CaptureRunArtifactsResult
    try {
      result = await captureRunArtifacts({
        attachments: this.ctx.attachments,
        session,
        runArtifacts: runScratch.artifacts,
        sourceRun: terminal,
        editBaselines,
        captureMaxFileBytes: this.captureMaxFileBytes,
        captureMaxFilesPerRun: this.captureMaxFilesPerRun,
        captureMaxArtifactVersionsPerSession: this.captureMaxArtifactVersionsPerSession,
      })
    } catch (error) {
      const message = `science-runtime: auto-capture failed for session "${session.id}" run "${terminal.runId}": ${String(error)}`
      if (isCaptureFilesystemFailure(error)) this.ctx.logger.warn(message)
      else this.ctx.logger.error(message)
      return undefined
    }
    if (result.appendFailed) {
      this.ctx.logger.warn(`science-runtime: auto-capture stopped early for session "${session.id}" run "${terminal.runId}": a session.append rejection interrupted the walk`)
    }
    return result
  }
}

export default ScienceRuntime
