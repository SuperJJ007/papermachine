/**
 * Public operation vocabulary for the local Science Runtime.
 *
 * @module @deepseek-ai/dsh-science-runtime/types
 */

import type {
  ScienceArtifactVersionRef,
  ScienceArtifactVersion,
  ScienceChartOp,
  ScienceChartState,
  ScienceEnvironmentBinding,
  ScienceEnvironmentProfileId,
  ScienceLanguage,
  ScienceRunId,
  ScienceRunStarted,
  ScienceRunArtifactInput,
  ScienceRunTerminal,
  ScienceVersionId,
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
  /**
   * `annotate_artifact`'s `toolCallId` already authorized a prior artifact
   * annotation: one authorizing model call cannot back two curation facts.
   */
  | 'ARTIFACT_ANNOTATE_TOOL_CALL_REUSED'
  /** `saveArtifactAs` named a `sourceVersionId` that does not identify a committed version in the session's owning project. */
  | 'ARTIFACT_VERSION_NOT_FOUND'
  /** `saveArtifactAs` named a `newLogicalName` an artifact in the owning project already uses. */
  | 'ARTIFACT_LOGICAL_NAME_CONFLICT'
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
  | 'CHART_STALE_VERSION'
  | 'CHART_NOT_ADDRESSABLE'
  | 'CHART_ELEMENT_NOT_FOUND'
  | 'CHART_OP_INVALID'
  /** `installPackages` was called with no configured `micromambaPath`: this deployment cannot install packages. */
  | 'INSTALLER_NOT_CONFIGURED'
  /** The configured `micromambaPath` does not resolve to a usable executable. */
  | 'INSTALLER_UNAVAILABLE'

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
  /**
   * Capture-relative `.png` paths this run declares for auto-capture under
   * the `'declared'` raster-capture policy; ignored under `'always'`.
   */
  readonly rasterArtifacts?: readonly string[]
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

/** Inputs for installing packages into this session's applied environment for one language. */
export interface InstallScienceEnvironmentPackagesRequest {
  /** Exact live Science Session whose applied environment receives the install. */
  readonly session: Session
  /** Interpreter whose prefix receives the install; the whole environment still re-binds a fresh whole-value revision. */
  readonly language: ScienceLanguage
  /** Non-empty conda-forge package specs, e.g. `"numpy"` or `"numpy=1.26"`. */
  readonly packages: readonly string[]
  /** Caller-owned cancellation signal. */
  readonly signal: AbortSignal
}

/**
 * Terminal classification for one install attempt, mirroring
 * {@link ScienceRunTerminal.status}: `'success'` is the only status that
 * appends a fresh environment revision.
 */
export type InstallScienceEnvironmentPackagesStatus = 'success' | 'failed' | 'timed-out' | 'cancelled'

/** Operational result of one install attempt. */
export interface InstallScienceEnvironmentPackagesResult {
  /** Terminal classification for this attempt. */
  readonly status: InstallScienceEnvironmentPackagesStatus
  /**
   * The environment as it now stands, present iff {@link status} is
   * `'success'`: the session's existing binding when re-observation matched
   * it exactly, or the fresh whole-value revision this call appended when it
   * did not. See {@link environmentChanged} for which one this is. A live
   * kernel serving a superseded revision is unaffected by this call itself;
   * the next `startRun` for either language of this session finds the
   * revision mismatch and ends it (`environment-rebound`) before starting a
   * fresh one, the same path an out-of-band rebind already takes.
   */
  readonly environment?: ScienceEnvironmentBinding
  /**
   * Whether this call appended {@link environment} as a fresh revision,
   * present iff {@link status} is `'success'`. `false` means re-observation
   * found no difference from the session's existing binding — every
   * requested package was already present — so no revision was appended and
   * no kernel restarts because of this call.
   */
  readonly environmentChanged?: boolean
  /** Bounded standard-output tail from the installer process. */
  readonly stdout: ScienceRunOutput
  /** Bounded standard-error tail from the installer process. */
  readonly stderr: ScienceRunOutput
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

/**
 * Inputs for duplicating one existing artifact version into a brand-new
 * logical artifact within the same project. A viewer-driven operation, not
 * a model tool: no `toolCallId`/`requestHeaderSeq` provenance.
 */
export interface SaveScienceArtifactAsRequest {
  /** Exact live Science Session that will own the new artifact's origin. */
  readonly session: Session
  /** Store version to duplicate; may name any version this project's store holds, not only ones this session's own projection knows. */
  readonly sourceVersionId: ScienceVersionId
  /** Logical name for the new artifact; must be unused in the owning project. */
  readonly newLogicalName: string
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

/** Inputs for one direct edit of the exact current addressable PNG version. */
export interface ScienceChartEditRequest {
  readonly session: Session
  readonly artifactId: ScienceArtifactVersion['artifactId']
  readonly version: number
  readonly ops: readonly ScienceChartOp[]
  readonly signal: AbortSignal
  readonly toolCallId?: CallId
  readonly requestHeaderSeq?: number
}

/** One operation the chart adapter could not resolve against the live figure. */
export interface ScienceChartFailedOp {
  readonly index: number
  readonly reason: string
}

/** Committed direct-edit version and per-request operations that were not applied. */
export interface ScienceChartEditResult {
  readonly artifact: ScienceArtifactVersion
  readonly failedOps: readonly ScienceChartFailedOp[]
}

/** Ephemeral kernel render returned without appending an artifact version or session event. */
export interface ScienceChartPreviewResult {
  readonly png: Uint8Array
  readonly chart: ScienceChartState
  readonly failedOps: readonly ScienceChartFailedOp[]
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
   * Render the current version's cumulative operations from its producing run's saved figure and export settings,
   * then append one direct-edit PNG version. Pending previews never contribute to the committed result.
   * Expired figures recover in a disposable interpreter, isolated from current analysis state.
   * Cancellation and timeout include recovery and rendering; cleanup completes before the operation releases its lease.
   * @param request - Exact artifact version, operations, live Session, and cancellation.
   * @returns The committed version and operations whose element targets were absent.
   */
  applyChartEdit(request: ScienceChartEditRequest): Promise<ScienceChartEditResult>
  /**
   * Render validated operations against the exact current addressable chart without publishing a version
   * or mutating its saved figure. Every preview independently includes the committed operations.
   * Cold source recovery cannot mutate the analysis interpreter. An aborted operation never returns preview bytes.
   * @param request - Exact artifact version, operations, live Session, and cancellation.
   * @returns Ephemeral PNG bytes, extracted chart state, and unresolved targets.
   */
  previewChartEdit(request: ScienceChartEditRequest): Promise<ScienceChartPreviewResult>
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
  /**
   * Duplicate one existing artifact version into a brand-new logical
   * artifact in the same project: a fresh `artifactId`, ordinal 1, an
   * explicit declared baseline naming the source version, the source's own
   * content origin, and reused (never re-copied) content-addressed bytes.
   * A viewer operation, never a model tool.
   * @param request - Exact Session, the store version to duplicate, and the new logical name.
   * @returns The durable new artifact version this operation appended.
   */
  saveArtifactAs(request: SaveScienceArtifactAsRequest): Promise<ScienceArtifactVersion>
  /**
   * Install packages into the applied environment's configured prefix for
   * one language through micromamba, then, only on success, re-observe the
   * whole profile. A re-observation that differs from the session's current
   * binding appends a fresh whole-value `science/environment-bound`
   * revision; a re-observation that matches it exactly (every requested
   * package was already present, or an earlier attempt classified
   * `'timed-out'` had in fact already finished writing the prefix) appends
   * none and returns the existing binding unchanged, so a caller that
   * retries after a misreported timeout never restarts an otherwise
   * unaffected kernel for no environment change. Requires a configured
   * micromamba executable (`INSTALLER_NOT_CONFIGURED` otherwise) and an
   * applied environment with no run in flight.
   * @param request - Exact Session, target language, package specs, and cancellation.
   * @returns The install's terminal classification, output tails, and — on
   *   success — the environment as it now stands plus whether this call
   *   actually appended it as a fresh revision.
   */
  installPackages(request: InstallScienceEnvironmentPackagesRequest): Promise<InstallScienceEnvironmentPackagesResult>
}
