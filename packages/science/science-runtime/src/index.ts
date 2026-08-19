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
  ScienceInterpreterBinding,
  ScienceProjection,
  ScienceRunTerminal,
} from '@deepseek-ai/dsh-science-session'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-science-session'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-subprocess'
import { captureRunArtifacts } from './capture.ts'
import type { CaptureRunArtifactsResult } from './capture.ts'
import { configSchema, resolveConfig } from './config.ts'
import type { Config, ConfiguredProfile } from './config.ts'
import { assertProfileRunConfinement, observeProfile, sameObservation } from './environment.ts'
import { confineRun, planRun, settleRun, startCandidate } from './execution.ts'
import { LeaseRegistry, OperationControl } from './lifecycle.ts'
import { attachRuntimeSettings } from './settings.ts'
import {
  createRunScratch,
  materializeSessionScratch,
  planRunScratch,
  planSessionScratch,
  removeUnpublishedRunScratch,
  rollbackSessionScratch,
} from './scratch.ts'
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
  /** Exact-object reservation and same-id quarantine owner. */
  private readonly leases = new LeaseRegistry()
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
    ctx.effect(() => {
      const stopSessionObserver = ctx.on('session/disposed', (session) => { this.leases.detach(session) }, { global: true })
      return async () => {
        this.disposing = true
        stopSessionObserver()
        await this.leases.disposeAll()
      }
    }, 'science runtime teardown')
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
   * Publish a direct-argv run start, then settle exactly one matching terminal
   * fact after the shared subprocess provider proves tree quiescence.
   * @param request - Exact live Session, source, authorization facts, and cancellation.
   * @returns A handle exposed only after `science/run-started` committed.
   */
  async startRun(request: StartScienceRunRequest): Promise<ScienceRunHandle> {
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
    let sessionScratch: Awaited<ReturnType<typeof planSessionScratch>> | undefined
    let scratchPreparation: Awaited<ReturnType<typeof materializeSessionScratch>> | undefined
    let runScratch: Awaited<ReturnType<typeof createRunScratch>> | undefined
    try {
      this.assertPrepublication(request.session, lease.control)
      const plan = planRun(environment, request.language, request.code)
      sessionScratch = await planSessionScratch(this.dshHome, request.session)
      await assertProfileRunConfinement(profile, request.session, sessionScratch.root)
      const plannedRun = planRunScratch(sessionScratch, plan.runId, request.language)
      if (request.language === 'r' && plannedRun.tmp.includes(' ')) {
        throw new ScienceRuntimeError('CONFINEMENT_UNAVAILABLE', 'R run TMPDIR cannot contain an ASCII space')
      }
      const confined = confineRun({
        subprocess: this.ctx.subprocess,
        sandbox: this.ctx.sandbox,
        session: request.session,
        sessionScratch,
        control: lease.control,
      }, plan, plannedRun.source)
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
      if (!this.matchesEnvironment(environment, observed.python?.binding, observed.r?.binding)) {
        const drifted = this.reobservedEnvironment(environment, observed.python?.binding, observed.r?.binding)
        request.session.append('science/environment-bound', { version: 1, environment: drifted })
        throw new ScienceRuntimeError('ENVIRONMENT_NOT_READY', 'Science environment changed during run preflight')
      }
      runScratch = await createRunScratch(sessionScratch, plan.runId, request.language, plan.sourceBytes)
      this.assertPrepublication(request.session, lease.control)
      const started = startCandidate(
        plan,
        runScratch,
        request.language,
        environment,
        request.toolCallId,
        request.requestHeaderSeq,
      )
      request.session.append('science/run-started', { version: 1, run: started })
      const done = this.settlePublishedRun(lease, request.session, sessionScratch, plan, runScratch, confined, started)
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
    if (session.header.agentPreset !== 'science' || projection === null) {
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

  /** Require each re-observed interpreter to retain its accepted binding fingerprint. */
  private matchesEnvironment(
    environment: ScienceEnvironmentBinding,
    python: ScienceInterpreterBinding | undefined,
    r: ScienceInterpreterBinding | undefined,
  ): boolean {
    return sameObservation(environment.python, python) && sameObservation(environment.r, r)
  }

  /** Append a whole invalid or drifted environment revision before refusing a changed run. */
  private reobservedEnvironment(
    environment: ScienceEnvironmentBinding,
    python: ScienceInterpreterBinding | undefined,
    r: ScienceInterpreterBinding | undefined,
  ): ScienceEnvironmentBinding {
    const bindings = [python, r].filter(binding => binding !== undefined)
    const invalid = bindings.some(binding => binding.capability !== 'available')
    const now = Date.now()
    return {
      revision: environment.revision + 1,
      profileId: environment.profileId,
      configuredAt: now,
      validatedAt: now,
      status: invalid ? 'invalid' : 'drifted',
      ...(python === undefined ? {} : { python }),
      ...(r === undefined ? {} : { r }),
      failureReason: invalid ? 'configured environment is no longer usable' : 'configured environment changed during run preflight',
    }
  }

  /** Settle a published run while retaining the exact lease through terminal commit or cleanup. */
  private async settlePublishedRun(
    lease: ReturnType<LeaseRegistry['reserve']>,
    session: StartScienceRunRequest['session'],
    sessionScratch: Awaited<ReturnType<typeof planSessionScratch>>,
    plan: ReturnType<typeof planRun>,
    runScratch: Awaited<ReturnType<typeof createRunScratch>>,
    confined: ReturnType<typeof confineRun>,
    started: ReturnType<typeof startCandidate>,
  ): Promise<ScienceRunResult> {
    let releaseAfterEventualQuiescence = false
    try {
      let settled: Awaited<ReturnType<typeof settleRun>>
      try {
        settled = await settleRun({
          subprocess: this.ctx.subprocess,
          sandbox: this.ctx.sandbox,
          session,
          sessionScratch,
          control: lease.control,
        }, started, plan, runScratch, confined)
      } catch (error) {
        if (this.ctx.sessions.get(session.id) !== session) {
          throw new ScienceRuntimeError('SESSION_NOT_LIVE', 'Science Session detached before terminal publication', { cause: error })
        }
        throw new ScienceRuntimeError('TERMINAL_COMMIT_FAILED', 'Science terminal value could not be prepared after quiescence', { cause: error })
      }
      if (!settled.quiescent) {
        releaseAfterEventualQuiescence = true
        void settled.eventualResult.then(
          async (result) => {
            if (result === undefined) return
            if (this.ctx.sessions.get(session.id) !== session) {
              this.leases.release(lease)
              return
            }
            try {
              session.append('science/run-finished', { version: 1, run: result.terminal })
            } catch {
              // A live Session without its terminal fact remains quarantined.
              return
            }
            await this.captureAfterFinish(session, runScratch, result.terminal)
            this.leases.release(lease)
          },
          () => {},
        )
        throw new ScienceRuntimeError('QUIESCENCE_UNPROVEN', 'Science subprocess tree did not reach quiescence after termination')
      }
      if (this.ctx.sessions.get(session.id) !== session) {
        throw new ScienceRuntimeError('SESSION_NOT_LIVE', 'Science Session detached before terminal publication')
      }
      try {
        session.append('science/run-finished', { version: 1, run: settled.result.terminal })
      } catch (error) {
        if (this.ctx.sessions.get(session.id) !== session) {
          throw new ScienceRuntimeError('SESSION_NOT_LIVE', 'Science Session detached before terminal publication', { cause: error })
        }
        throw new ScienceRuntimeError('TERMINAL_COMMIT_FAILED', 'Science terminal fact could not be committed', { cause: error })
      }
      const capture = await this.captureAfterFinish(session, runScratch, settled.result.terminal)
      return { ...settled.result, ...capture === undefined ? {} : { capture } }
    } finally {
      if (!releaseAfterEventualQuiescence) this.leases.release(lease)
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
   * @returns capture accounting, or `undefined` when the Session detached or capture itself failed.
   */
  private async captureAfterFinish(
    session: StartScienceRunRequest['session'],
    runScratch: Awaited<ReturnType<typeof createRunScratch>>,
    terminal: ScienceRunTerminal,
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
