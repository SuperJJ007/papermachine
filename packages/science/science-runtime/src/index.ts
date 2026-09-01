/**
 * Folded local Conda implementation of the R2 Science Runtime operation
 * service. It has no model-facing Consumer or shipped profile entry.
 *
 * @module @deepseek-ai/dsh-science-runtime
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import z from '@deepseek-ai/schemastery'
import type { CallId } from '@deepseek-ai/dsh-llm'
import {
  decodeScienceChartState,
  MAX_CHART_OPS,
  ScienceEnvironmentProfileId,
  ScienceRunId,
  replayScience,
} from '@deepseek-ai/dsh-science-session'
import type {
  ScienceArtifactVersion,
  ScienceChartOp,
  ScienceChartState,
  ScienceEnvironmentBinding,
  ScienceLanguage,
  ScienceProjectId,
  ScienceProjection,
  ScienceRunTerminal,
} from '@deepseek-ai/dsh-science-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-sandbox'
import { ProjectArtifactStoreError } from '@deepseek-ai/dsh-science-artifact-store'
import type {} from '@deepseek-ai/dsh-science-session'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-subprocess'
import { capturablePngPaths, captureRunArtifacts } from './capture.ts'
import type { CaptureRunArtifactsResult, RasterCapturePolicy } from './capture.ts'
import { configSchema, resolveConfig } from './config.ts'
import type { Config, ConfiguredProfile } from './config.ts'
import { assertProfileRunConfinement, observeProfile } from './environment.ts'
import { DESCENDANT_GRACE_MS, kernelRunTerminal, planRun, readCaptureTail, selectBinding, startCandidate } from './execution.ts'
import type { KernelRunFailureCode } from './execution.ts'
import {
  assertValidPackageSpecs,
  confineInstallArgv,
  createInstallScratch,
  installArgv,
  installEnvironment,
  planInstallScratch,
  removeInstallScratch,
  runMicromambaInstall,
  staticMicromamba,
} from './install.ts'
import type { InstallOutcome } from './install.ts'
import { KERNEL_ASSETS_ROOT } from './kernel-assets.ts'
import { KernelExitedError, KernelProtocolError } from './kernel-process.ts'
import type { KernelDoneFrame, KernelExecuteRequest, KernelProcess } from './kernel-process.ts'
import {
  KernelEpochRegressionError,
  KernelSet,
  KernelSetDetachedError,
  KernelSetQuarantinedError,
} from './kernel-set.ts'
import type { AcquiredKernel, ScienceKernelEndedFact, ScienceKernelStartedFact } from './kernel-set.ts'
import { LeaseRegistry, OperationControl } from './lifecycle.ts'
import type { OperationCause, RuntimeLease } from './lifecycle.ts'
import { prepareRunArtifacts } from './inputs.ts'
import type { PreparedRunArtifacts } from './inputs.ts'
import { attachRuntimeSettings } from './settings.ts'
import {
  createIsolatedKernelScratch,
  createRunScratch,
  materializeRunInputs,
  materializeSessionScratch,
  planRunScratch,
  planSessionScratch,
  removeUnpublishedRunScratch,
  rollbackSessionScratch,
} from './scratch.ts'
import type { ScienceSessionScratch } from './scratch.ts'
import { ScienceRuntimeError } from './types.ts'
import type {
  AnnotateScienceArtifactRequest,
  BindScienceEnvironmentRequest,
  InstallScienceEnvironmentPackagesRequest,
  InstallScienceEnvironmentPackagesResult,
  SaveScienceArtifactAsRequest,
  ScienceChartEditRequest,
  ScienceChartEditResult,
  ScienceChartPreviewResult,
  ScienceChartFailedOp,
  ScienceRunHandle,
  ScienceRunResult,
  ScienceRuntimeService,
  StartScienceRunRequest,
} from './types.ts'

export type {
  AnnotateScienceArtifactRequest,
  BindScienceEnvironmentRequest,
  InstallScienceEnvironmentPackagesRequest,
  InstallScienceEnvironmentPackagesResult,
  InstallScienceEnvironmentPackagesStatus,
  SaveScienceArtifactAsRequest,
  ScienceChartEditRequest,
  ScienceChartEditResult,
  ScienceChartPreviewResult,
  ScienceChartFailedOp,
  ScienceRunHandle,
  ScienceRunOutput,
  ScienceRunResult,
  ScienceRuntimeErrorCode,
  ScienceRuntimeService,
  StartScienceRunRequest,
} from './types.ts'
export { ScienceRuntimeError } from './types.ts'
export { SCIENCE_RUNTIME_SETTINGS_NAMESPACE, scienceRuntimeProfilesSchema } from './settings.ts'
export { KERNEL_ASSETS_ROOT, resolveKernelChartAdapterPath, resolveKernelDriverPath } from './kernel-assets.ts'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'science-runtime'
/** Required shared services kept alive through terminal settlement. */
export const inject = ['scienceArtifactStore', 'sessions', 'subprocess', 'sandbox']

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

function plainRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

interface ExtractedChartsResult {
  readonly charts: ReadonlyMap<string, ScienceChartState>
  readonly retireKernel: boolean
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
 * Wait for `settlement`, or return as soon as `signal` aborts — whichever
 * comes first. Used by {@link ScienceRuntime.reserveQueued} so a caller
 * queued behind another Session-wide operation stops waiting the moment its
 * own cancellation arrives, rather than only noticing on its next retry
 * after the blocking lease eventually settles on its own.
 * @param settlement - the blocking lease's own settlement promise.
 * @param signal - the queued caller's cancellation signal.
 */
function raceSettlementOrAbort(settlement: Promise<void>, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const onAbort = (): void => { resolve() }
    signal.addEventListener('abort', onAbort, { once: true })
    void settlement.then(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    })
  })
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
  /**
   * Combined installer identity, narrowing `ResolvedConfig`'s two
   * independently-optional `micromambaPath`/`installChannels` fields into
   * one typed invariant: `undefined` means this deployment cannot install
   * packages; defined always carries both, since `resolveConfig` rejects a
   * deployment that sets one without the other.
   */
  private readonly installer: { readonly micromambaPath: string; readonly channels: readonly string[] } | undefined
  /** Configured package-inventory entry bound. */
  private readonly packagesMaxEntries: number
  /** Configured package-inventory byte bound. */
  private readonly packagesMaxBytes: number
  /** Configured raster-capture policy for auto-captured `.png` files. */
  private readonly rasterCapture: RasterCapturePolicy
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
  /** Configured post-run chart extraction deadline. */
  private readonly chartExtractTimeoutMs: number
  /** Configured recent-run live-figure retention count. */
  private readonly chartLiveRunsRetained: number
  /** Exact-object reservation and same-id quarantine owner. */
  private readonly leases = new LeaseRegistry()
  /** Resolved owning project per exact live Session, cached for its lifetime. */
  private readonly projects = new WeakMap<Session, Promise<ScienceProjectId>>()
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
    if (resolved.micromambaPath === undefined) {
      this.installer = undefined
    } else {
      // resolveConfig's own cross-field check already proved installChannels
      // is defined whenever micromambaPath is; this is not a second policy
      // decision, only narrowing that proof into one typed field.
      /* v8 ignore next 3 */
      if (resolved.installChannels === undefined) {
        throw new Error('science-runtime: resolved micromambaPath with no resolved installChannels')
      }
      this.installer = { micromambaPath: resolved.micromambaPath, channels: resolved.installChannels }
    }
    this.packagesMaxEntries = resolved.packagesMaxEntries
    this.packagesMaxBytes = resolved.packagesMaxBytes
    this.rasterCapture = resolved.rasterCapture
    this.captureMaxFileBytes = resolved.captureMaxFileBytes
    this.captureMaxFilesPerRun = resolved.captureMaxFilesPerRun
    this.captureMaxArtifactVersionsPerSession = resolved.captureMaxArtifactVersionsPerSession
    this.inputMaxFilesPerRun = resolved.inputMaxFilesPerRun
    this.inputMaxBytesPerRun = resolved.inputMaxBytesPerRun
    this.kernelIdleTimeoutMs = resolved.kernelIdleTimeoutMs
    this.kernelStartTimeoutMs = resolved.kernelStartTimeoutMs
    this.chartExtractTimeoutMs = resolved.chartExtractTimeoutMs
    this.chartLiveRunsRetained = resolved.chartLiveRunsRetained
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
   * Resolve the exact Session's owning project through the project artifact
   * store, creating the workspace marker on the first Science operation in an
   * unmarked workspace. The resolution is cached per exact Session object;
   * a failed open is evicted so the next operation retries it.
   * @param session - exact live Session whose header cwd names the workspace.
   * @returns the owning project id.
   * @throws {@link ScienceRuntimeError} (`PROJECT_UNAVAILABLE`) when the session header carries no cwd.
   */
  private sessionProject(session: Session): Promise<ScienceProjectId> {
    const existing = this.projects.get(session)
    if (existing !== undefined) return existing
    const cwd = session.header.cwd
    if (cwd === undefined) {
      return Promise.reject(new ScienceRuntimeError(
        'PROJECT_UNAVAILABLE',
        'Science project store requires the session\'s workspace directory (session header cwd)',
      ))
    }
    const resolved = this.ctx.scienceArtifactStore.openProject(cwd).then(opened => opened.projectId)
    this.projects.set(session, resolved)
    resolved.catch(() => { this.projects.delete(session) })
    return resolved
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
      // Resolve (and on first use create) the session's owning project before
      // any environment work: a session that cannot name its workspace
      // project fails its first Science operation loudly, not its first
      // capture after a run already executed.
      await this.sessionProject(request.session)
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
   * Install packages into one language's applied prefix through micromamba,
   * then, only on a successful install, re-observe the whole profile and
   * append a fresh whole-value `science/environment-bound` revision —
   * exactly the operation `bindEnvironment`'s own post-first-run guard
   * refuses. A live kernel serving the superseded revision is left running:
   * the next `startRun` for either language finds the revision mismatch and
   * ends it (`environment-rebound`) before starting a fresh one, the same
   * path an out-of-band rebind already takes (`kernel-set.ts`).
   * @param request - Exact live Session, target language, package specs, and cancellation.
   * @returns The install's terminal classification, output tails, and — on success — the fresh environment revision.
   */
  async installPackages(request: InstallScienceEnvironmentPackagesRequest): Promise<InstallScienceEnvironmentPackagesResult> {
    this.assertSession(request.session)
    this.assertHostLocal()
    const installer = this.installer
    if (installer === undefined) {
      throw new ScienceRuntimeError('INSTALLER_NOT_CONFIGURED', 'Science package installation requires a configured micromamba executable path')
    }
    assertValidPackageSpecs(request.packages)
    const lease = await this.reserveQueued(request.session, request.signal)
    try {
      this.assertPrepublication(request.session, lease.control)
      const projection = this.assertSession(request.session)
      const environment = projection.environment
      if (environment === null || environment.status !== 'applied') {
        throw new ScienceRuntimeError('ENVIRONMENT_NOT_READY', 'Science Runtime requires an applied environment')
      }
      // Mirrors startRun's own orphan check: the lease itself is free, but an
      // orphaned durable 'running' run (a crash before its own terminal
      // committed) must still block a whole-value environment rebind.
      if (projection.runs.some(run => run.status === 'running')) {
        throw new ScienceRuntimeError('RUNTIME_BUSY', 'Science Session already has an open run')
      }
      const binding = selectBinding(environment, request.language)
      const profile = this.profile(String(environment.profileId))
      const executable = await staticMicromamba(installer.micromambaPath)
      this.assertPrepublication(request.session, lease.control)
      // Whole-attempt channel fallback, mirroring the desktop provisioning's
      // own retry shape: each configured channel URL runs as one complete,
      // independent micromamba invocation (installArgv never receives more
      // than one), and only a 'failed' outcome tries the next URL — a
      // 'cancelled'/'timed-out' outcome shares this call's OperationControl
      // across every attempt, so retrying would immediately observe the same
      // abort. See the [package-install Agent Note](../../../../.agents/notes/implemented/feature/2026-09-01-science-package-install.md).
      let outcome: InstallOutcome | undefined
      for (const [index, channelUrl] of installer.channels.entries()) {
        const argv = installArgv(executable, binding.canonicalPrefix, request.packages, channelUrl)
        const confined = confineInstallArgv(this.ctx.sandbox, request.session, binding.canonicalPrefix, argv)
        const scratch = planInstallScratch(binding.canonicalPrefix)
        await createInstallScratch(scratch)
        try {
          const env = installEnvironment(binding.canonicalPrefix, scratch)
          outcome = await runMicromambaInstall(this.ctx.subprocess, confined, env, scratch.directory, lease.control)
        } finally {
          // Low-stakes cleanup of a throwaway scratch subdirectory under the
          // prefix, unlike Session-scratch rollback below: never worth masking
          // the install's own outcome, so a failure here only logs.
          try {
            await removeInstallScratch(scratch)
          } catch (cleanupError) {
            this.ctx.logger.warn(`science-runtime: package-install scratch cleanup failed: ${String(cleanupError)}`)
          }
        }
        if (outcome.status !== 'failed' || index === installer.channels.length - 1) break
      }
      /* v8 ignore next -- installChannels is validated non-empty at config resolution, so the loop always assigns outcome once */
      if (outcome === undefined) throw new Error('science-runtime: package install ran no channel attempt')
      if (outcome.status !== 'success') {
        return { status: outcome.status, stdout: outcome.stdout, stderr: outcome.stderr }
      }
      this.assertPrepublication(request.session, lease.control)
      const sessionScratch = await planSessionScratch(this.dshHome, request.session)
      const observed = await observeProfile({
        subprocess: this.ctx.subprocess,
        sandbox: this.ctx.sandbox,
        sessionScratch,
        sessionId: request.session.id,
        signal: lease.control.signal,
        packagesMaxEntries: this.packagesMaxEntries,
        packagesMaxBytes: this.packagesMaxBytes,
      }, profile)
      this.assertPrepublication(request.session, lease.control)
      const current = this.assertSession(request.session).environment
      // Unreachable: the durable Science fold only ever appends an
      // environment revision, never clears one, so a session already
      // holding an applied revision above can never replay back to
      // `environment === null`. Narrows the type the projection's `.environment`
      // field carries rather than asserting past a real defensive gap.
      /* v8 ignore next 3 */
      if (current === null) {
        throw new ScienceRuntimeError('INFRASTRUCTURE_FAILURE', 'Science environment was unbound during package install')
      }
      const bindings = [observed.python?.binding, observed.r?.binding].filter(candidate => candidate !== undefined)
      const failures = bindings.filter(candidate => candidate.capability !== 'available')
      const now = Date.now()
      const fresh: ScienceEnvironmentBinding = {
        revision: current.revision + 1,
        profileId: current.profileId,
        configuredAt: now,
        validatedAt: now,
        status: failures.length === 0 ? 'applied' : 'invalid',
        ...(observed.python === undefined ? {} : { python: observed.python.binding }),
        ...(observed.r === undefined ? {} : { r: observed.r.binding }),
        ...(failures.length === 0 ? {} : { failureReason: failures.map(candidate => candidate.reason).join('; ') }),
      }
      this.assertPrepublication(request.session, lease.control)
      request.session.append('science/environment-bound', { version: 1, environment: fresh })
      return { status: 'success', environment: fresh, stdout: outcome.stdout, stderr: outcome.stderr }
    } catch (error) {
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
    this.assertSession(request.session)
    this.assertHostLocal()
    // Queues behind another run/bind/annotate operation already holding
    // this Session's lease instead of rejecting outright — see
    // `reserveQueued`'s own doc. `environment`/the open-run check below are
    // read fresh AFTER the lease is granted, not from this pre-queue probe:
    // a call that queued behind a run has stale state by the time it
    // actually starts.
    const lease = await this.reserveQueued(request.session, request.signal)
    let sessionScratch: ScienceSessionScratch | undefined
    let scratchPreparation: Awaited<ReturnType<typeof materializeSessionScratch>> | undefined
    let runScratch: Awaited<ReturnType<typeof createRunScratch>> | undefined
    try {
      this.assertPrepublication(request.session, lease.control)
      const projection = this.assertSession(request.session)
      const environment = projection.environment
      if (environment === null || environment.status !== 'applied') {
        throw new ScienceRuntimeError('ENVIRONMENT_NOT_READY', 'Science Runtime requires an applied environment')
      }
      // Reaching this with an open run means the lease itself is free (the
      // holder released it) while the durable log still shows a run
      // 'running' — an orphan left by a run whose settlement fired without
      // its own `run-finished` ever committing (e.g. a crash before a Host
      // restart re-attached this Session), not the in-process race
      // `reserveQueued` already resolved by queueing.
      if (projection.runs.some(run => run.status === 'running')) {
        throw new ScienceRuntimeError('RUNTIME_BUSY', 'Science Session already has an open run')
      }
      const profile = this.profile(String(environment.profileId))
      const plan = planRun(environment, request.language, request.code)
      const projectId = await this.sessionProject(request.session)
      const preparedArtifacts = await prepareRunArtifacts(
        projection,
        this.ctx.scienceArtifactStore,
        projectId,
        request.artifactInputs,
        request.editBaselines,
        request.rasterArtifacts,
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
        projectId,
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
   * Apply one direct-edit request and commit its successful operations as a new PNG version.
   *
   * @param request - The exact chart version, operations, and cancellation context.
   * @returns The committed artifact and any operations whose targets could not be resolved.
   */
  async applyChartEdit(request: ScienceChartEditRequest): Promise<ScienceChartEditResult> {
    return this.performChartEdit(request, true)
  }

  /**
   * Render one direct-edit request without publishing store or session state:
   * the shared warm/replay path exports a PNG and re-extracts its chart, but
   * no artifact version or `science/artifact-saved` event is committed.
   * Cold recovery uses an isolated interpreter and the operation's cancellation/deadline.
   * @param request - Exact session, target artifact/version, and operations to render for preview.
   * @returns The rendered preview PNG bytes, its re-extracted chart state, and any operations whose targets could not be resolved.
   */
  async previewChartEdit(request: ScienceChartEditRequest): Promise<ScienceChartPreviewResult> {
    return this.performChartEdit(request, false)
  }

  /** Execute the shared warm/replay chart path and publish its output only when `commit` is `true`. */
  private async performChartEdit(
    request: ScienceChartEditRequest, commit: true,
  ): Promise<ScienceChartEditResult>
  private async performChartEdit(
    request: ScienceChartEditRequest, commit: false,
  ): Promise<ScienceChartPreviewResult>
  private async performChartEdit(
    request: ScienceChartEditRequest,
    commit: boolean,
  ): Promise<ScienceChartEditResult | ScienceChartPreviewResult> {
    if (request.ops.length === 0 || request.ops.length > MAX_CHART_OPS) {
      throw new ScienceRuntimeError('CHART_OP_INVALID', 'Chart edit operations must contain between 1 and 100 entries')
    }
    this.assertSession(request.session)
    this.assertHostLocal()
    const lease = await this.reserveQueued(request.session, request.signal)
    let replayScratch: Awaited<ReturnType<typeof createRunScratch>> | undefined
    let replayKernel: KernelProcess | undefined
    let usingReplay = false
    let previewReady = false
    let sessionScratch: ScienceSessionScratch | undefined
    let editLanguage: ScienceLanguage | undefined
    try {
      this.assertPrepublication(request.session, lease.control)
      const projection = this.assertSession(request.session)
      const versions = projection.artifacts.filter(candidate => candidate.artifactId === request.artifactId)
      const parent = versions.at(-1)
      if (parent === undefined || parent.version !== request.version) {
        throw new ScienceRuntimeError('CHART_STALE_VERSION', 'Chart edit must name the current artifact version')
      }
      const projectId = parent.projectId
      const store = this.ctx.scienceArtifactStore
      // mediaType/contentOrigin/figure_state live only in the store now (T1's
      // authority rule): the session projection carries no more than the
      // versionId this exact reference names.
      const parentRecord = await store.getVersion(projectId, parent.versionId)
      const parentFigureState = await store.getFigureState(projectId, parent.versionId)
      /* v8 ignore next 3 -- projection already resolved this versionId; a missing store row is a durable invariant violation */
      if (parentRecord === undefined) {
        throw new Error('science-runtime: chart edit target no longer identifies a committed store version')
      }
      if (parentRecord.mediaType !== 'image/png' || parentFigureState === undefined) {
        throw new ScienceRuntimeError('CHART_NOT_ADDRESSABLE', 'Chart edit target is not an addressable PNG version')
      }
      const parentChart = decodeScienceChartState(JSON.parse(parentFigureState.stateJson))
      try {
        decodeScienceChartState({ ...parentChart, ops: [...parentChart.ops, ...request.ops] })
      } catch (error) {
        throw new ScienceRuntimeError('CHART_OP_INVALID', 'Chart edit operations are invalid or exceed chart state bounds', { cause: error })
      }
      // Human edits must parent the current version, so the nearest run-origin version owns their baseline.
      // `contentOrigin` lives only in the store, so the artifact's full
      // ordinal history is read from there rather than the session's own
      // (possibly partial) local knowledge of this artifactId.
      const artifactHistory = await store.listVersions(projectId, parent.artifactId)
      const sourceVersion = artifactHistory.findLast(candidate => candidate.contentOrigin !== 'human-edit')
      // A version's baseVersionId chain always terminates at ordinal 1, and
      // `commitStyleEdit` only ever appends onto an existing artifact
      // (`createArtifact` always supplies its own contentOrigin, never
      // `commitStyleEdit`'s hardcoded 'human-edit') — so ordinal 1 is never
      // itself human-edit, and this findLast always resolves.
      /* v8 ignore next 3 */
      if (sourceVersion === undefined) {
        throw new ScienceRuntimeError('CHART_NOT_ADDRESSABLE', 'Chart source run is unavailable; rerun the code to regenerate this figure')
      }
      const sourceFigureState = await store.getFigureState(projectId, sourceVersion.versionId)
      // `parentChart.figureKey` chains back, unchanged, to whichever
      // run-auto version's own successful chart extraction first produced
      // it (every step here and in capture.ts's figureState copies the
      // prior figureKey verbatim) — so that same ancestor's figure_state
      // row still exists whenever `sourceVersion` does.
      /* v8 ignore next 3 */
      if (sourceFigureState === undefined) {
        throw new ScienceRuntimeError('CHART_NOT_ADDRESSABLE', 'Chart source run is unavailable; rerun the code to regenerate this figure')
      }
      const sourceChart = decodeScienceChartState(JSON.parse(sourceFigureState.stateJson))
      if (sourceChart.figureKey !== parentChart.figureKey) {
        throw new ScienceRuntimeError('CHART_NOT_ADDRESSABLE', 'Chart source run is unavailable; rerun the code to regenerate this figure')
      }
      /* v8 ignore next 3 -- a run-auto version's producer always carries the run id that produced it */
      if (sourceVersion.producerRunId === undefined) {
        throw new ScienceRuntimeError('CHART_NOT_ADDRESSABLE', 'Chart source run is unavailable; rerun the code to regenerate this figure')
      }
      const sourceRunId = ScienceRunId(sourceVersion.producerRunId)
      const sourceRun = projection.runs.find(candidate => candidate.runId === sourceRunId)
      const environment = projection.environment
      // The durable Science invariant requires every run-origin artifact to reference a terminal
      // run under an applied environment revision.
      /* v8 ignore next 3 */
      if (sourceRun === undefined || environment === null || environment.status !== 'applied') {
        throw new ScienceRuntimeError('CHART_NOT_ADDRESSABLE', 'Chart source run is unavailable; rerun the code to regenerate this figure')
      }
      const language: ScienceLanguage = parentChart.runtime === 'matplotlib' ? 'python' : 'r'
      editLanguage = language
      if (sourceRun.language !== language) {
        throw new ScienceRuntimeError('CHART_NOT_ADDRESSABLE', 'Chart runtime does not match its source run language')
      }
      const scratchPreparation = await materializeSessionScratch(this.dshHome, request.session)
      sessionScratch = scratchPreparation.scratch
      const kernel = await this.acquireKernel(request.session, language, environment, sessionScratch, lease.control)
      this.kernels.disarmIdleTimer(request.session, language)

      const cumulativeOps = [...parentChart.ops, ...request.ops]
      const failedOffset = parentChart.ops.length
      let application = await this.applyChartInKernel(
        kernel.process,
        sourceRunId,
        parentChart.figureKey,
        cumulativeOps,
        parentChart.png.dpi,
        planRunScratch(sessionScratch, sourceRunId, language).directory,
        lease.control.signal,
      )
      if (application.kind === 'not-registered') {
        const sourceScratch = planRunScratch(sessionScratch, sourceRunId, language)
        let sourceBytes: Uint8Array
        try {
          sourceBytes = await readFile(sourceScratch.source)
        } catch (error) {
          throw new ScienceRuntimeError(
            'CHART_NOT_ADDRESSABLE',
            'Chart source scratch is unavailable; rerun the code to regenerate this figure',
            { cause: error },
          )
        }
        const prepared = await prepareRunArtifacts(
          projection,
          this.ctx.scienceArtifactStore,
          projectId,
          sourceRun.inputs,
          undefined,
          undefined,
          this.inputMaxFilesPerRun,
          this.inputMaxBytesPerRun,
          lease.control.signal,
        )
        replayScratch = await createRunScratch(
          sessionScratch,
          ScienceRunId(`replay-${randomUUID()}`),
          language,
          sourceBytes,
        )
        await materializeRunInputs(replayScratch, prepared.materialized)
        this.assertPrepublication(request.session, lease.control)
        usingReplay = true
        replayKernel = await this.kernels.startIsolated(
          request.session, language, environment, await createIsolatedKernelScratch(replayScratch), lease.control.signal,
        )
        this.assertPrepublication(request.session, lease.control)
        const replayOutcome = await settleKernelExecution(lease.control, replayKernel, {
          runId: sourceRunId,
          sourcePath: replayScratch.source,
          cwd: replayScratch.directory,
          stdoutPath: replayScratch.stdout,
          stderrPath: replayScratch.stderr,
          artifactDir: replayScratch.artifacts,
          inputDir: replayScratch.inputs,
        })
        this.assertPrepublication(request.session, lease.control)
        if (replayOutcome.status !== 'success') {
          throw new ScienceRuntimeError('CHART_NOT_ADDRESSABLE', 'Chart source replay failed; rerun the code to regenerate this figure')
        }
        application = await this.applyChartInKernel(
          replayKernel,
          sourceRunId,
          parentChart.figureKey,
          cumulativeOps,
          parentChart.png.dpi,
          replayScratch.directory,
          lease.control.signal,
        )
      }
      if (application.kind === 'not-registered') {
        throw new ScienceRuntimeError('CHART_NOT_ADDRESSABLE', 'Chart source replay did not register the figure')
      }
      if (application.failedOps.some(failed => failed.index < failedOffset)) {
        throw new ScienceRuntimeError('CHART_NOT_ADDRESSABLE', 'Chart committed edits could not be reconstructed; rerun the code to regenerate this figure')
      }
      const failedOps = application.failedOps
        .filter(failed => failed.index >= failedOffset)
        .map(failed => ({ index: failed.index - failedOffset, reason: failed.reason }))
      const failedIndices = new Set(failedOps.map(failed => failed.index))
      const successfulOps = request.ops.filter((_, index) => !failedIndices.has(index))
      if (commit && successfulOps.length === 0) {
        throw new ScienceRuntimeError('CHART_ELEMENT_NOT_FOUND', 'No chart edit operation resolved an addressable element')
      }
      const chart = decodeScienceChartState({
        ...application.chart,
        figureKey: parentChart.figureKey,
        ops: [...parentChart.ops, ...successfulOps],
      })
      this.assertPrepublication(request.session, lease.control)
      if (!commit) {
        previewReady = true
        return { png: application.png, chart, failedOps }
      }
      // Human-edit provenance (T2§6): the new version's base is the exact
      // parent version, its content_origin is 'human-edit', its
      // environment* fields are ASSIGNED from the parent's own store-read
      // values (never re-validated against a fold check — the store row is
      // already the fact), and it carries no run/tool-call producer fields
      // of its own.
      const stored = await store.appendVersion(projectId, parent.artifactId, {
        producerSessionId: request.session.id,
        data: application.png,
        mediaType: 'image/png',
        contentOrigin: 'human-edit',
        baseVersionId: parent.versionId,
        ...parentRecord.environmentRevision === undefined ? {} : { environmentRevision: parentRecord.environmentRevision },
        ...parentRecord.environmentFingerprint === undefined ? {} : { environmentFingerprint: parentRecord.environmentFingerprint },
        figureState: { figureKey: chart.figureKey, dpi: chart.png.dpi, stateJson: JSON.stringify(chart) },
      })
      // Title/caption are inherited verbatim from the parent's current
      // presentation (a separate annotation, not a `versions` column — T1
      // dropped title/caption from `createArtifact`/`appendVersion` entirely).
      await store.annotateVersion(projectId, stored.versionId, {
        actor: 'human',
        sessionId: request.session.id,
        title: parent.title,
        caption: parent.caption ?? null,
      })
      const artifact: ScienceArtifactVersion = {
        artifactId: parent.artifactId,
        logicalName: parent.logicalName,
        version: stored.ordinal,
        title: parent.title,
        ...parent.caption === undefined ? {} : { caption: parent.caption },
        projectId,
        versionId: stored.versionId,
        sha256: stored.sha256,
        seenAt: Date.now(),
      }
      this.assertPrepublication(request.session, lease.control)
      request.session.append('science/artifact-saved', { version: 1, artifact })
      return { artifact, failedOps }
    } catch (error) {
      if (!usingReplay && (error instanceof KernelProtocolError || error instanceof KernelExitedError)) {
        // applyChartInKernel is reached only after editLanguage is assigned.
        /* v8 ignore next */
        if (editLanguage !== undefined) await this.kernels.retireForEscalation(request.session, editLanguage)
      }
      if (lease.control.signal.aborted) throw this.prepublicationError(lease.control, undefined)
      throw error instanceof ScienceRuntimeError ? error : this.prepublicationError(lease.control, error)
    } finally {
      try {
        if (replayKernel !== undefined) {
          const quiescence = await replayKernel.end('chart-replay-finished')
          if (!quiescence.quiescent) await quiescence.eventualQuiescence
        }
        if (sessionScratch !== undefined && replayScratch !== undefined) {
          await removeUnpublishedRunScratch(sessionScratch, replayScratch)
        }
      } finally {
        if (editLanguage !== undefined) this.kernels.resetIdleTimer(request.session, editLanguage)
        this.leases.release(lease)
      }
      if (previewReady) this.assertPrepublication(request.session, lease.control)
    }
  }

  /** Exchange one chart request through private files and decode its exact result fields. */
  private async applyChartInKernel(
    kernel: KernelProcess,
    runId: ScienceRunId,
    figureKey: string,
    ops: readonly ScienceChartOp[],
    dpi: number,
    directory: string,
    signal: AbortSignal,
  ): Promise<
    | { readonly kind: 'not-registered' }
    | { readonly kind: 'applied'; readonly chart: Record<string, unknown>; readonly failedOps: readonly ScienceChartFailedOp[]; readonly png: Uint8Array }
  > {
    const token = randomUUID()
    const requestPath = join(directory, `chart-apply-${token}-request.json`)
    const resultPath = join(directory, `chart-apply-${token}-result.json`)
    const outputPath = join(directory, `chart-apply-${token}.png`)
    try {
      await writeFile(requestPath, JSON.stringify({ figureKey, ops, outputPath, dpi }), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      const frame = await kernel.applyChart({ runId, requestPath, resultPath, timeoutMs: this.chartExtractTimeoutMs, signal })
      if (frame.status === 'error' && frame.detail === 'not_registered') return { kind: 'not-registered' }
      if (frame.status === 'error') throw new Error(`science-runtime: chart application failed: ${frame.detail}`)
      const root = plainRecord(JSON.parse(await readFile(resultPath, 'utf8')))
      const chart = root === undefined ? undefined : plainRecord(root['chart'])
      const failed = root?.['failedOps']
      if (root === undefined || chart === undefined || !Array.isArray(failed)
        || Object.keys(root).sort().join(',') !== 'chart,failedOps') {
        throw new Error('science-runtime: chart application result must contain exact chart and failedOps fields')
      }
      const failedOps = failed.map((value) => {
        const candidate = plainRecord(value)
        if (candidate === undefined || Object.keys(candidate).sort().join(',') !== 'index,reason'
          || !Number.isSafeInteger(candidate['index']) || (candidate['index'] as number) < 0
          || typeof candidate['reason'] !== 'string') {
          throw new Error('science-runtime: chart application failedOps entry is invalid')
        }
        return { index: candidate['index'] as number, reason: candidate['reason'] }
      })
      return { kind: 'applied', chart, failedOps, png: await readFile(outputPath) }
    } finally {
      await Promise.allSettled([requestPath, resultPath, outputPath].map(path => unlink(path)))
    }
  }

  /**
   * Re-commit an existing artifact version's exact store content reference
   * with a curated title and caption: metadata-only, appending one new
   * `version_annotations` row (`annotateVersion`) rather than opening a new
   * version whose bytes would repeat their predecessor's. The store's
   * annotation write is the sole authority for this metadata edit's own
   * provenance (`actor: 'model'`, `sessionId`, `toolCallId`,
   * `requestHeaderSeq`) — this operation never rebuilds a full version value
   * and never lets the curating call's identity stand in for the content's
   * own producer. A vetoed append after the store update leaves the store
   * curated with no matching event — accepted metadata decay, resolved by
   * the fold's own value staying the projection authority. A committed
   * event is never rolled back because a later step fails; there is no
   * later step here that can fail after the append.
   * @param request - Exact live Session, target logical artifact (and optional version), title/caption, and cancellation.
   * @returns The durable curated version this operation committed.
   */
  async annotateArtifact(request: AnnotateScienceArtifactRequest): Promise<ScienceArtifactVersion> {
    const projection = this.assertSession(request.session)
    const lease = this.reserve(request.session, request.signal)
    try {
      this.assertPrepublication(request.session, lease.control)
      const target = this.resolveAnnotateTarget(projection, request)
      const store = this.ctx.scienceArtifactStore
      const currentVersion = await store.getVersion(target.projectId, target.versionId)
      /* v8 ignore next 3 -- projection already resolved this versionId; a missing store row is a durable invariant violation */
      if (currentVersion === undefined) {
        throw new Error('science-runtime: annotate target no longer identifies a committed store version')
      }
      if (currentVersion.contentOrigin === 'human-edit') {
        throw new ScienceRuntimeError(
          'ARTIFACT_NOT_CURATABLE',
          `artifact ${JSON.stringify(request.logicalName)} version ${String(target.version)} exists but is a direct human style edit and cannot be curated; `
            + 'edit its content through a new run (run_python/run_r against it as an edit_of baseline) or the viewer\'s style editor instead',
        )
      }
      await this.assertAnnotateToolCallUnused(target.projectId, projection, request.toolCallId)
      this.assertPrepublication(request.session, lease.control)
      await store.annotateVersion(target.projectId, target.versionId, {
        actor: 'model',
        sessionId: request.session.id,
        toolCallId: request.toolCallId,
        requestHeaderSeq: request.requestHeaderSeq,
        title: request.title,
        caption: request.caption ?? null,
      })
      const artifact: ScienceArtifactVersion = {
        artifactId: target.artifactId,
        logicalName: request.logicalName,
        // Curation is metadata over content the session already holds, so it
        // supersedes the version it names instead of opening one whose bytes
        // would be identical to its predecessor's.
        version: target.version,
        title: request.title,
        ...request.caption === undefined ? {} : { caption: request.caption },
        projectId: target.projectId,
        versionId: target.versionId,
        sha256: currentVersion.sha256,
        seenAt: Date.now(),
      }
      this.assertPrepublication(request.session, lease.control)
      request.session.append('science/artifact-saved', { version: 1, artifact })
      return artifact
    } catch (error) {
      throw this.prepublicationError(lease.control, error)
    } finally {
      this.leases.release(lease)
    }
  }

  /**
   * Duplicate one existing artifact version into a brand-new logical
   * artifact in the same project. Content-addressed bytes are reused (the
   * store's blob admission is idempotent by digest, so re-admitting the
   * source's own bytes never duplicates them on disk); provenance is a
   * fresh fact this session originates, not a copy of the source's own
   * producer — `baseVersionId` names the source explicitly instead. A
   * viewer operation: no authorizing tool call, so `session.append` records
   * only the store reference and the presentation snapshot the store just
   * committed.
   * @param request - Exact Session, the store version to duplicate, and the new logical name.
   * @returns The durable new artifact version this operation appended.
   * @throws {@link ScienceRuntimeError} (`ARTIFACT_VERSION_NOT_FOUND`) when
   *   `sourceVersionId` does not identify a committed version in the
   *   session's owning project, or (`ARTIFACT_LOGICAL_NAME_CONFLICT`) when
   *   `newLogicalName` is already used in that project.
   */
  async saveArtifactAs(request: SaveScienceArtifactAsRequest): Promise<ScienceArtifactVersion> {
    this.assertSession(request.session)
    const lease = this.reserve(request.session, request.signal)
    try {
      this.assertPrepublication(request.session, lease.control)
      const projectId = await this.sessionProject(request.session)
      const store = this.ctx.scienceArtifactStore
      const source = await store.getVersion(projectId, request.sourceVersionId)
      if (source === undefined) {
        throw new ScienceRuntimeError(
          'ARTIFACT_VERSION_NOT_FOUND',
          `version ${JSON.stringify(request.sourceVersionId)} does not identify a committed version in this project`,
        )
      }
      const sourceArtifact = await store.getArtifact(projectId, source.artifactId)
      /* v8 ignore next 3 -- a version's own store row always names an artifact row the same store still holds */
      if (sourceArtifact === undefined) {
        throw new Error('science-runtime: save-as source version no longer identifies a committed artifact')
      }
      const sourceFigureState = await store.getFigureState(projectId, source.versionId)
      const data = await store.readBlob(projectId, source.sha256)
      this.assertPrepublication(request.session, lease.control)
      let created: Awaited<ReturnType<typeof store.createArtifact>>
      try {
        created = await store.createArtifact(projectId, {
          logicalName: request.newLogicalName,
          kind: sourceArtifact.kind,
          originSessionId: request.session.id,
          data,
          mediaType: source.mediaType,
          contentOrigin: source.contentOrigin,
          baseVersionId: source.versionId,
          ...source.environmentRevision === undefined ? {} : { environmentRevision: source.environmentRevision },
          ...source.environmentFingerprint === undefined ? {} : { environmentFingerprint: source.environmentFingerprint },
          ...sourceFigureState === undefined ? {} : {
            figureState: { figureKey: sourceFigureState.figureKey, dpi: sourceFigureState.dpi, stateJson: sourceFigureState.stateJson },
          },
        })
      } catch (error) {
        if (error instanceof ProjectArtifactStoreError && error.code === 'LOGICAL_NAME_CONFLICT') {
          throw new ScienceRuntimeError(
            'ARTIFACT_LOGICAL_NAME_CONFLICT',
            `an artifact named ${JSON.stringify(request.newLogicalName)} already exists in this project`,
            { cause: error },
          )
        }
        throw error
      }
      // Title/caption are inherited verbatim from the source's current
      // presentation (a separate annotation, not a `versions` column — T1
      // dropped title/caption from `createArtifact` entirely).
      await store.annotateVersion(projectId, created.version.versionId, {
        actor: 'human',
        sessionId: request.session.id,
        title: source.title ?? request.newLogicalName,
        caption: source.caption ?? null,
      })
      const artifact: ScienceArtifactVersion = {
        artifactId: created.artifact.artifactId,
        logicalName: request.newLogicalName,
        version: created.version.ordinal,
        title: source.title ?? request.newLogicalName,
        ...source.caption === undefined ? {} : { caption: source.caption },
        projectId,
        versionId: created.version.versionId,
        sha256: created.version.sha256,
        seenAt: Date.now(),
      }
      this.assertPrepublication(request.session, lease.control)
      request.session.append('science/artifact-saved', { version: 1, artifact })
      return artifact
    } catch (error) {
      throw this.prepublicationError(lease.control, error)
    } finally {
      this.leases.release(lease)
    }
  }

  /**
   * Resolve the exact source version `request` names (its exact `version`,
   * or the logical artifact's latest version) from this session's own live
   * projection.
   * @param projection - exact live Science projection.
   * @param request - the annotate request naming the target logical artifact.
   * @returns the resolved target version's session-visible identity.
   * @throws {@link ScienceRuntimeError} (`ARTIFACT_NOT_FOUND`) when `logicalName`
   *   (or its named `version`) does not exist in this session.
   */
  private resolveAnnotateTarget(
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
    return source
  }

  /**
   * Reject an `annotate_artifact` call whose `toolCallId` already authorized
   * a prior curation. `science/artifact-saved` no longer carries a
   * `toolCallId` a session-log replay could cross-check for reuse (the fold
   * check this replaces is documented in
   * `2026-09-02-science-artifact-event-slimming.md`'s residual-gap table),
   * so this checks the store's own `version_annotations` rows instead — a
   * durable, restart-safe record, unlike an in-memory Runtime set. Scoped to
   * the logical artifacts this SESSION's own projection already knows
   * (`annotate_artifact` can only ever target one of those) and checked
   * against each version's CURRENT `latestAnnotation` only: a toolCallId
   * superseded by a later annotation is no longer visible through the
   * store's public API, which exposes no per-version annotation history.
   * Both narrowings are accepted incompleteness, not silently dropped
   * coverage — see the Agent Note.
   * @param projectId - the owning project.
   * @param projection - this session's own live Science projection.
   * @param toolCallId - the authorizing call to check for reuse.
   * @throws {@link ScienceRuntimeError} (`ARTIFACT_ANNOTATE_TOOL_CALL_REUSED`) when reused.
   */
  private async assertAnnotateToolCallUnused(
    projectId: ScienceProjectId,
    projection: ScienceProjection,
    toolCallId: CallId,
  ): Promise<void> {
    const artifactIds = new Set(projection.artifacts.map(candidate => candidate.artifactId))
    for (const artifactId of artifactIds) {
      const versions = await this.ctx.scienceArtifactStore.listVersions(projectId, artifactId)
      if (versions.some(candidate => candidate.latestAnnotation?.toolCallId === toolCallId)) {
        throw new ScienceRuntimeError(
          'ARTIFACT_ANNOTATE_TOOL_CALL_REUSED',
          `toolCallId ${JSON.stringify(toolCallId)} already authorized a prior artifact annotation and cannot authorize another`,
        )
      }
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
   * Reserve `session` for a run, queueing behind any run/bind/annotate
   * operation already holding this Session's lease instead of failing the
   * caller outright. `run_python` and `run_r` issued in the same assistant
   * step share one Session-wide lease (`startRun`'s durable open-run check
   * and `KernelSet`'s own per-Session acquire discipline both require at
   * most one Runtime operation in flight per Session — see `kernel-set.ts`'s
   * module doc), so this lets whichever call arrives second get a genuine
   * turn once the first vacates instead of racing `RUNTIME_BUSY` against
   * whichever call's synchronous prefix reserved first — the outcome a
   * caller cancelled mid-race would otherwise see reported as an opaque
   * `Science Runtime operation was cancelled` with no `run-started` fact to
   * explain it.
   *
   * Retries {@link reserve} each time the blocking lease settles; every
   * retry constructs a fresh {@link OperationControl}, so a caller's own
   * per-operation deadline starts counting from when it actually acquires
   * the lease, not from when it started queueing. `signal` aborting while
   * queued, or the Runtime entering disposal while queued, rejects before
   * constructing any `OperationControl`, so a caller cancelled or preempted
   * while only queued never touches Runtime state.
   * @param session - exact live Session that will own the reservation.
   * @param signal - caller-owned cancellation signal.
   * @returns the granted lease.
   */
  private async reserveQueued(session: BindScienceEnvironmentRequest['session'], signal: AbortSignal): Promise<RuntimeLease> {
    for (;;) {
      if (signal.aborted) {
        throw new ScienceRuntimeError('OPERATION_CANCELLED', 'Science Runtime operation was cancelled', { cause: signal.reason })
      }
      if (this.disposing) throw new ScienceRuntimeError('SERVICE_DISPOSING', 'Science Runtime is disposing')
      try {
        return this.reserve(session, signal)
      } catch (error) {
        // LeaseRegistry.reserve's only throw is the RUNTIME_BUSY rejection
        // this loop retries on (lifecycle.ts); a different shape is a
        // defensive backstop, not a reachable production path.
        /* v8 ignore next 2 */
        if (!(error instanceof ScienceRuntimeError) || error.code !== 'RUNTIME_BUSY') throw error
        // Synchronous throw-then-read with no `await` between them: the
        // lease this RUNTIME_BUSY just named cannot have released yet.
        // oxlint-disable-next-line typescript/no-non-null-assertion -- see above
        const blocking = this.leases.blocking(session)!
        await raceSettlementOrAbort(blocking.settlement, signal)
      }
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
    projectId: ScienceProjectId,
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
      let retireAfterChartExtraction = false
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
        const extracted = outcome.retireKernel
          ? { charts: new Map<string, ScienceChartState>(), retireKernel: false }
          : await this.extractChartsAfterFinish(kernel, runScratch, terminal, preparedArtifacts.rasterArtifacts)
        retireAfterChartExtraction = extracted.retireKernel
        const capture = await this.captureAfterFinish(
          session,
          projectId,
          runScratch,
          terminal,
          preparedArtifacts.editBaselines,
          preparedArtifacts.rasterArtifacts,
          extracted.charts,
        )
        return { terminal, stdout, stderr, ...capture === undefined ? {} : { capture } }
      } finally {
        // Retire-vs-rearm derives from the settled run and chart protocol
        // outcomes, so it must run on every exit from this block — including a
        // thrown `readCaptureTail` or a vetoed `run-finished` append: a
        // tainted kernel left unretired stays live with an
        // unknown post-interrupt state for the next run to reuse, and a
        // non-tainted kernel left unrearmed can never end `idle`.
        if (outcome.retireKernel || retireAfterChartExtraction) {
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
   * Ask a healthy kernel to extract chart state before the artifact walk.
   * Every failure leaves the run terminal and ordinary capture intact.
   * Protocol failure or timeout additionally retires the kernel because its
   * request stream can no longer be trusted.
   */
  private async extractChartsAfterFinish(
    kernel: KernelProcess,
    runScratch: Awaited<ReturnType<typeof createRunScratch>>,
    terminal: ScienceRunTerminal,
    rasterArtifacts: PreparedRunArtifacts['rasterArtifacts'],
  ): Promise<ExtractedChartsResult> {
    let pngPaths: readonly string[]
    try {
      pngPaths = await capturablePngPaths(runScratch.artifacts, this.rasterCapture, rasterArtifacts)
    } catch (error) {
      /* v8 ignore start -- walkArtifactFiles absorbs per-directory filesystem failures and returns its safe partial result */
      const message = `science-runtime: chart discovery failed for run "${terminal.runId}": ${String(error)}`
      if (isCaptureFilesystemFailure(error)) this.ctx.logger.warn(message)
      else this.ctx.logger.error(message)
      return { charts: new Map(), retireKernel: false }
      /* v8 ignore stop */
    }
    if (pngPaths.length === 0) return { charts: new Map(), retireKernel: false }

    const requestPath = join(runScratch.directory, 'chart-extract-request.json')
    const resultPath = join(runScratch.directory, 'chart-extract-result.json')
    try {
      await writeFile(requestPath, JSON.stringify({
        artifactDir: runScratch.artifacts,
        allow: this.rasterCapture === 'always' ? null : [...rasterArtifacts],
        retainRuns: this.chartLiveRunsRetained,
      }), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      const frame = await kernel.extractCharts({
        runId: terminal.runId,
        requestPath,
        resultPath,
        timeoutMs: this.chartExtractTimeoutMs,
      })
      if (frame.status === 'error') {
        this.ctx.logger.warn(`science-runtime: chart extraction failed for run "${terminal.runId}": ${frame.detail}`)
        return { charts: new Map(), retireKernel: false }
      }
      const decoded: unknown = JSON.parse(await readFile(resultPath, 'utf8'))
      const root = plainRecord(decoded)
      const chartValues = root === undefined ? undefined : plainRecord(root['charts'])
      const errors = root === undefined ? undefined : plainRecord(root['errors'])
      if (root === undefined || chartValues === undefined || errors === undefined
        || Object.keys(root).sort().join(',') !== 'charts,errors') {
        throw new Error('chart result must contain exact charts and errors records')
      }
      for (const [path, detail] of Object.entries(errors)) {
        if (typeof detail !== 'string') throw new Error('chart result errors must contain string values')
        this.ctx.logger.warn(`science-runtime: chart ${JSON.stringify(path)} was not extracted for run "${terminal.runId}": ${detail}`)
      }
      const allowed = new Set(pngPaths)
      const charts = new Map<string, ScienceChartState>()
      for (const [path, extraction] of Object.entries(chartValues)) {
        if (!allowed.has(path)) continue
        try {
          charts.set(path, decodeScienceChartState({
            ...plainRecord(extraction),
            figureKey: path,
            ops: [],
          }))
        } catch (error) {
          this.ctx.logger.warn(`science-runtime: chart ${JSON.stringify(path)} was invalid for run "${terminal.runId}": ${String(error)}`)
        }
      }
      return { charts, retireKernel: false }
    } catch (error) {
      const retireKernel = error instanceof KernelProtocolError || error instanceof KernelExitedError
      const message = `science-runtime: chart extraction failed for run "${terminal.runId}": ${String(error)}`
      if (isCaptureFilesystemFailure(error)) this.ctx.logger.warn(message)
      else this.ctx.logger.error(message)
      return { charts: new Map(), retireKernel }
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
   * @param projectId - the session's already-resolved owning project.
   * @param runScratch - the run's private Host scratch, including its artifact directory.
   * @param terminal - the exact terminal record just committed, supplying every captured version's provenance.
   * @param editBaselines - Validated exact parents keyed by capture-relative path.
   * @param rasterArtifacts - Validated capture-relative `.png` paths this run declared for capture.
   * @param charts - Validated chart state keyed by capture-relative PNG path.
   * @returns capture accounting, or `undefined` when the Session detached or capture itself failed.
   */
  private async captureAfterFinish(
    session: StartScienceRunRequest['session'],
    projectId: ScienceProjectId,
    runScratch: Awaited<ReturnType<typeof createRunScratch>>,
    terminal: ScienceRunTerminal,
    editBaselines: PreparedRunArtifacts['editBaselines'],
    rasterArtifacts: PreparedRunArtifacts['rasterArtifacts'],
    charts: ReadonlyMap<string, ScienceChartState>,
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
        store: this.ctx.scienceArtifactStore,
        projectId,
        session,
        runArtifacts: runScratch.artifacts,
        sourceRun: terminal,
        editBaselines,
        rasterCapture: this.rasterCapture,
        rasterArtifacts,
        charts,
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
