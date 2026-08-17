/**
 * Folded local Conda implementation of the R2 Science Runtime operation
 * service. It has no model-facing Consumer or shipped profile entry.
 *
 * @module @deepseek-ai/dsh-science-runtime
 */

import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { ScienceChartId, ScienceEnvironmentProfileId, replayScience } from '@deepseek-ai/dsh-science-session'
import type {
  ScienceChartVersion,
  ScienceEnvironmentBinding,
  ScienceInterpreterBinding,
  ScienceProjection,
} from '@deepseek-ai/dsh-science-session'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-science-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-subprocess'
import { readBoundedFile, resolveArtifactFile } from './chart.ts'
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
  runArtifactDirectory,
} from './scratch.ts'
import { ScienceRuntimeError } from './types.ts'
import type {
  BindScienceEnvironmentRequest,
  CommitScienceChartRequest,
  ScienceRunHandle,
  ScienceRunResult,
  ScienceRuntimeService,
  StartScienceRunRequest,
} from './types.ts'

export type {
  BindScienceEnvironmentRequest,
  CommitScienceChartRequest,
  ScienceRunHandle,
  ScienceRunOutput,
  ScienceRunResult,
  ScienceRuntimeErrorCode,
  ScienceRuntimeService,
  StartScienceRunRequest,
} from './types.ts'
export { ScienceRuntimeError } from './types.ts'
export { SCIENCE_RUNTIME_SETTINGS_NAMESPACE, scienceRuntimeProfilesSchema } from './settings.ts'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'science-runtime'
/** Required shared services kept alive through terminal settlement. */
export const inject = ['attachments', 'sessions', 'subprocess', 'sandbox']

/** Find the durable start seq of one run, required to test the fork-lineage boundary. */
function runStartedSeq(session: Session, runId: CommitScienceChartRequest['runId']): number | undefined {
  return session.events.find((event: SessionEvent): boolean =>
    event.type === 'science/run-started' && event.data.run.runId === runId)?.seq
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
  /** Configured artifact-selection diagnostic entry bound. */
  private readonly artifactDiagnosticMaxEntries: number
  /** Configured artifact-selection diagnostic byte bound. */
  private readonly artifactDiagnosticMaxBytes: number
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
    this.artifactDiagnosticMaxEntries = resolved.artifactDiagnosticMaxEntries
    this.artifactDiagnosticMaxBytes = resolved.artifactDiagnosticMaxBytes
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
   * Import one PNG from a successful, non-inherited run's private artifact
   * directory, persist it through `ctx.attachments`, then append the
   * complete immutable chart version. Attachment persistence precedes the
   * event: a failure before the event may leave only an unreferenced
   * content-addressed object, but a committed event is never rolled back
   * because a later step fails.
   * @param request - Exact live Session, source run, artifact path, and cancellation.
   * @returns The durable chart version this operation appended.
   */
  async commitChart(request: CommitScienceChartRequest): Promise<ScienceChartVersion> {
    const projection = this.assertSession(request.session)
    this.assertHostLocal()
    const source = projection.runs.find(run => run.runId === request.runId)
    if (source === undefined || source.status !== 'success') {
      throw new ScienceRuntimeError(
        'SOURCE_RUN_NOT_SUCCESSFUL',
        `Science run ${JSON.stringify(request.runId)} does not exist or is not a durably successful run`,
      )
    }
    const startedSeq = runStartedSeq(request.session, request.runId)
    /* v8 ignore next 3 -- a run present in the projection always has its durable science/run-started event */
    if (startedSeq === undefined) {
      throw new ScienceRuntimeError('INFRASTRUCTURE_FAILURE', 'Science run start event is missing from the Session log')
    }
    if (startedSeq < (request.session.header.seedLength ?? 0)) {
      throw new ScienceRuntimeError(
        'INHERITED_RUN',
        `Science run ${JSON.stringify(request.runId)} was inherited through a fork; there is no local artifact directory for it in this session — rerun the code in this session before saving a chart from it`,
      )
    }
    const lease = this.reserve(request.session, request.signal)
    try {
      this.assertPrepublication(request.session, lease.control)
      const sessionScratch = await planSessionScratch(this.dshHome, request.session)
      const runArtifacts = runArtifactDirectory(sessionScratch, request.runId)
      const filePath = await resolveArtifactFile(
        runArtifacts, request.artifactPath, this.artifactDiagnosticMaxEntries, this.artifactDiagnosticMaxBytes,
      )
      this.assertPrepublication(request.session, lease.control)
      const limits = this.ctx.attachments.imageLimits
      if (!limits.mediaTypes.includes('image/png')) {
        throw new ScienceRuntimeError('IMAGE_TYPE_NOT_ALLOWED', 'the configured attachment store does not accept image/png')
      }
      const data = await readBoundedFile(filePath, limits.maxImageBytes)
      this.assertPrepublication(request.session, lease.control)
      const attachment = await this.ctx.attachments.saveImage({
        data, mediaType: 'image/png', name: basename(request.artifactPath),
      })
      // Recheck liveness, current projection, the exact source predicate, and
      // authorizing facts before appending — the file read and attachment
      // save may have taken long enough for the Session to change.
      this.assertPrepublication(request.session, lease.control)
      const current = this.assertSession(request.session)
      const currentSource = current.runs.find(run => run.runId === request.runId)
      /* v8 ignore next 5 -- a run's successful terminal status is monotonic.
       * No fold path removes a run; this protects a future invariant
       * relaxation, not a Runtime path reachable today. */
      if (currentSource === undefined || currentSource.status !== 'success') {
        throw new ScienceRuntimeError(
          'SOURCE_RUN_NOT_SUCCESSFUL',
          `Science run ${JSON.stringify(request.runId)} is no longer a durably successful run`,
        )
      }
      const logical = current.charts.filter(chart => chart.logicalName === request.logicalName)
      const latest = logical.at(-1)
      const chart: ScienceChartVersion = {
        chartId: latest?.chartId ?? ScienceChartId(randomUUID()),
        logicalName: request.logicalName,
        version: latest === undefined ? 1 : latest.version + 1,
        title: request.title,
        ...(request.caption === undefined ? {} : { caption: request.caption }),
        attachment,
        runId: request.runId,
        toolCallId: request.toolCallId,
        requestHeaderSeq: request.requestHeaderSeq,
        environmentRevision: currentSource.environmentRevision,
        environmentFingerprint: currentSource.environmentFingerprint,
        createdAt: Date.now(),
      }
      request.session.append('science/chart-saved', { version: 1, chart })
      return chart
    } catch (error) {
      throw this.prepublicationError(lease.control, error)
    } finally {
      this.leases.release(lease)
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

  /** Resolve one configured profile without exposing the mutable configuration record. */
  private profile(id: string): ConfiguredProfile {
    const profile = this.profiles.get(id)
    if (profile === undefined) {
      throw new ScienceRuntimeError('INVALID_REQUEST', `unknown Science environment profile ${JSON.stringify(id)}`)
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
          (result) => {
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
      return settled.result
    } finally {
      if (!releaseAfterEventualQuiescence) this.leases.release(lease)
    }
  }
}

export default ScienceRuntime
