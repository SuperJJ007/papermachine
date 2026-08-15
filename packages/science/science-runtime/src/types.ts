/**
 * Public operation vocabulary for the local Science Runtime.
 *
 * @module @deepseek-ai/dsh-science-runtime/types
 */

import type {
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
}
