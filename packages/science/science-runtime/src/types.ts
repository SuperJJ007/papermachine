/**
 * Public operation vocabulary for the local Science Runtime.
 *
 * @module @deepseek-ai/dsh-science-runtime/types
 */

import type {
  ScienceArtifactVersionRef,
  ScienceArtifactVersion,
  ScienceEnvironmentBinding,
  ScienceEnvironmentProfileId,
  ScienceLanguage,
  ScienceRunId,
  ScienceRunStarted,
  ScienceRunArtifactInput,
  ScienceRunTerminal,
} from '@deepseek-ai/dsh-science-session'
import type { CaptureRunArtifactsResult } from './capture.ts'
import type { CallId } from '@deepseek-ai/dsh-llm'

export type { CaptureRunArtifactsResult } from './capture.ts'
import type { Session } from '@deepseek-ai/dsh-session'

/** Stable rejection codes for Science Runtime operations. */
export type ScienceRuntimeErrorCode =
  | 'SESSION_NOT_LIVE'
  | 'SERVICE_DISPOSING'
  | 'RUNTIME_BUSY'
  | 'ENVIRONMENT_NOT_READY'
  | 'CONFINEMENT_UNAVAILABLE'
  | 'INVALID_REQUEST'
  /** No Conda prefix is configured for the requested profile id in this deployment. */
  | 'PROFILE_NOT_CONFIGURED'
  /** The session's owning project cannot be resolved: its header names no workspace directory (cwd). */
  | 'PROJECT_UNAVAILABLE'
  | 'OPERATION_CANCELLED'
  | 'OPERATION_TIMED_OUT'
  | 'INFRASTRUCTURE_FAILURE'
  | 'QUIESCENCE_UNPROVEN'
  | 'TERMINAL_COMMIT_FAILED'
  /** `annotate_artifact` named a `logical_name` (or an exact `version` of it) that does not exist in this session. */
  | 'ARTIFACT_NOT_FOUND'
  /**
   * `annotate_artifact` named an existing version whose `origin` is
   * `'human-edit'`: curation would either erase the direct-edit
   * discriminator (by rewriting it onto the `'model'` branch) or claim a
   * model tool authorization that a direct style edit never carried, so the
   * version stays uncurated. Editing that chart's content requires a new
   * run (`run_python`/`run_r` against it as an `edit_of` baseline) or the
   * viewer's own style editor.
   */
  | 'ARTIFACT_NOT_CURATABLE'
  /** A requested run input does not identify a committed artifact version. */
  | 'INPUT_NOT_FOUND'
  /** A requested run input path is unsafe or collides with another input path. */
  | 'INPUT_PATH_INVALID'
  /** Requested run inputs exceed the configured count or aggregate-byte bound. */
  | 'INPUT_TOO_LARGE'
  /** A persistent kernel's spawn, READY handshake, or start-time confinement failed; the message names the language and cause class. */
  | 'KERNEL_START_FAILED'
  /** Kernel execution requires darwin or linux; rejected pre-publication on every other platform. */
  | 'KERNEL_UNSUPPORTED_PLATFORM'

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
  /** Exact committed artifact versions to materialize below the run's reserved `inputs/` directory. */
  readonly artifactInputs?: readonly ScienceRunArtifactInput[]
  /** Exact parent version for each named capture-relative output path. */
  readonly editBaselines?: Readonly<Record<string, ScienceArtifactVersionRef>>
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
  /**
   * Auto-capture accounting for this run's artifact directory, run
   * synchronously before this result returns. `undefined` only when the
   * walk itself failed or the Session detached immediately after the
   * terminal fact committed — captured versions from an earlier partial
   * walk (if any) are still durable `science/artifact-saved` events,
   * discoverable through `get_science_state`.
   */
  readonly capture?: CaptureRunArtifactsResult
}

/** Inputs for curating one existing artifact version with a title and optional caption. */
export interface AnnotateScienceArtifactRequest {
  /** Exact live Science Session that will own the new curated version. */
  readonly session: Session
  /** Stable logical artifact name within the session. */
  readonly logicalName: string
  /** Exact existing version of `logicalName` to annotate; defaults to its latest version. */
  readonly version?: number
  /** Human-readable artifact title. */
  readonly title: string
  /** Optional human-readable artifact caption. */
  readonly caption?: string
  /** Model-issued call already recorded in the Session log. */
  readonly toolCallId: CallId
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
   * Resolve and materialize exact artifact inputs, publish a run start, then
   * launch the selected interpreter in owned scratch. Every rejection before
   * publication removes the unpublished run tree.
   * @param request - Exact Session, prior authorization facts, source, optional artifact inputs and edit baselines, and cancellation.
   * @returns The published run handle; its `done` owns terminal settlement.
   */
  startRun(request: StartScienceRunRequest): Promise<ScienceRunHandle>
  /**
   * Re-commit an existing artifact version's exact store content reference
   * as its curated replacement, carrying a model-supplied title and optional
   * caption. Metadata-only: the store row is curated in place and the
   * content-addressed reference is reused unchanged.
   * @param request - Exact Session, target logical artifact (and optional
   *   version), title/caption, and cancellation.
   * @returns The durable curated version this operation appended.
   */
  annotateArtifact(request: AnnotateScienceArtifactRequest): Promise<ScienceArtifactVersion>
}
