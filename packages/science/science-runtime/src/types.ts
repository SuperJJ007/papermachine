/**
 * Public operation vocabulary for the local Science Runtime.
 *
 * @module @deepseek-ai/dsh-science-runtime/types
 */

import type {
  ScienceArtifactVersion,
  ScienceEnvironmentBinding,
  ScienceEnvironmentProfileId,
  ScienceLanguage,
  ScienceRunId,
  ScienceRunStarted,
  ScienceRunTerminal,
} from '@deepseek-ai/dsh-science-session'
import type { Session } from '@deepseek-ai/dsh-session'

/** Stable rejection codes for Science Runtime operations. */
export type ScienceRuntimeErrorCode =
  | 'SESSION_NOT_LIVE'
  | 'SERVICE_DISPOSING'
  | 'RUNTIME_BUSY'
  | 'ENVIRONMENT_NOT_READY'
  | 'CONFINEMENT_UNAVAILABLE'
  | 'INVALID_REQUEST'
  | 'OPERATION_CANCELLED'
  | 'OPERATION_TIMED_OUT'
  | 'INFRASTRUCTURE_FAILURE'
  | 'QUIESCENCE_UNPROVEN'
  | 'TERMINAL_COMMIT_FAILED'
  /** `save_chart` named a run that does not exist, or is not durably successful. */
  | 'SOURCE_RUN_NOT_SUCCESSFUL'
  /** `save_chart` named a run inherited through a fork; only a local run's scratch may be imported. */
  | 'INHERITED_RUN'
  /** `save_chart` named a path that does not resolve to a regular non-symlink file inside the source run's artifact directory. */
  | 'ARTIFACT_NOT_FOUND'
  /** The deployment's configured attachment `mediaTypes` allowlist excludes `image/png`. */
  | 'IMAGE_TYPE_NOT_ALLOWED'

/** Typed error for a Runtime operation that cannot return a durable value. */
export class ScienceRuntimeError extends Error {
  /**
   * @param code - Stable operation failure classification.
   * @param message - Safe caller-facing explanation.
   * @param options - Original operational failure when one exists.
   */
  constructor(
    readonly code: ScienceRuntimeErrorCode,
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options)
    this.name = 'ScienceRuntimeError'
  }
}

/** Inputs for a configured Conda-profile observation. */
export interface BindScienceEnvironmentRequest {
  /** Exact live Science Session that will own the environment revision. */
  readonly session: Session
  /** Allowlisted profile identity from the Runtime configuration. */
  readonly profileId: ScienceEnvironmentProfileId
  /** Caller-owned cancellation signal. */
  readonly signal: AbortSignal
}

/** Inputs for one fresh Python or R source-file execution. */
export interface StartScienceRunRequest {
  /** Exact live Science Session that will own the run facts. */
  readonly session: Session
  /** Interpreter selected from the Session's applied environment. */
  readonly language: ScienceLanguage
  /** Exact, non-empty Unicode source to flush before the start fact commits. */
  readonly code: string
  /** Model-issued call already recorded in the Session log. */
  readonly toolCallId: ScienceRunStarted['toolCallId']
  /** Latest Science-era `request/header` event already recorded in the log. */
  readonly requestHeaderSeq: number
  /** Caller-owned cancellation signal. */
  readonly signal: AbortSignal
}

/** Bounded operational output returned after a run reaches a durable terminal state. */
export interface ScienceRunOutput {
  /** Retained tail text; it is not copied into the Session log. */
  readonly text: string
  /** Exact stream byte count captured by the subprocess provider. */
  readonly bytes: number
  /** Whether the retained tail lost earlier bytes. */
  readonly truncated: boolean
}

/** Operational result of a durably committed run terminal fact. */
export interface ScienceRunResult {
  /** The exact durable terminal record appended by this operation. */
  readonly terminal: ScienceRunTerminal
  /** Bounded standard-output tail. */
  readonly stdout: ScienceRunOutput
  /** Bounded standard-error tail. */
  readonly stderr: ScienceRunOutput
}

/** Inputs for importing one PNG chart from a successful run's private artifact directory. */
export interface CommitScienceChartRequest {
  /** Exact live Science Session that will own the chart version. */
  readonly session: Session
  /** The exact successful, non-inherited run whose artifact directory is imported from. */
  readonly runId: ScienceRunId
  /** Slash-separated path relative to the source run's `SCIENCE_ARTIFACT_DIR`. */
  readonly artifactPath: string
  /** Stable logical chart name within the session; a repeat commits the next version. */
  readonly logicalName: string
  /** Human-readable chart title. */
  readonly title: string
  /** Optional human-readable chart caption. */
  readonly caption?: string
  /** Model-issued call already recorded in the Session log. */
  readonly toolCallId: ScienceArtifactVersion['toolCallId']
  /** Latest Science-era `request/header` event already recorded in the log. */
  readonly requestHeaderSeq: number
  /** Caller-owned cancellation signal. */
  readonly signal: AbortSignal
}

/** Live handle for a published Science run. */
export interface ScienceRunHandle {
  /** Session-local run identifier. */
  readonly runId: ScienceRunId
  /** Resolves only after a matching terminal fact commits. */
  readonly done: Promise<ScienceRunResult>
  /** Request cancellation; repeated calls have no additional effect. */
  cancel(): void
}

/** Service definition consumed by a future model-facing Science package. */
export interface ScienceRuntimeService {
  /**
   * Observe one configured profile and append its complete environment value.
   * @param request - Exact Session, allowlisted profile, and caller cancellation.
   * @returns The durable environment revision that the operation appended.
   */
  bindEnvironment(request: BindScienceEnvironmentRequest): Promise<ScienceEnvironmentBinding>
  /**
   * Publish a run start, then launch the selected interpreter in owned scratch.
   * @param request - Exact Session, prior authorization facts, source, and cancellation.
   * @returns The published run handle; its `done` owns terminal settlement.
   */
  startRun(request: StartScienceRunRequest): Promise<ScienceRunHandle>
  /**
   * Import one PNG from a successful, non-inherited run's private artifact
   * directory, persist it through `ctx.attachments`, then append the
   * complete immutable chart version.
   * @param request - Exact Session, source run, artifact path, and cancellation.
   * @returns The durable chart version this operation appended.
   */
  commitChart(request: CommitScienceChartRequest): Promise<ScienceArtifactVersion>
}
