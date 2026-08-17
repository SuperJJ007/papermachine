/**
 * Durable Science vocabulary and the client-safe Session projection contract.
 * Runtime validation and event declaration merging live in the host entry;
 * durable event values may contain Host-only provenance and must not be sent
 * to a client without the projection conversion.
 *
 * @module @deepseek-ai/dsh-science-session/types
 */

import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { CallId } from '@deepseek-ai/dsh-llm'
import type {
  ScienceChartId,
  ScienceEnvironmentProfileId,
  ScienceRunId,
  ScienceScratchKey,
} from './ids.ts'

export type {
  ScienceChartId,
  ScienceEnvironmentProfileId,
  ScienceRunId,
  ScienceScratchKey,
} from './ids.ts'

/** The preset-bound Science mode identity recorded once per session. */
export interface ScienceModeRef {
  /** Stable mode discriminator. */
  readonly modeId: 'science'
  /** Preset identity required by the Science invariant. */
  readonly presetId: 'science'
  /** Deployment-owned revision of the Science mode contract. */
  readonly modeRevision: string
}

/** Language selected for one Science interpreter or run. */
export type ScienceLanguage = 'python' | 'r'

/** Validation result for one interpreter binding. */
export type ScienceInterpreterCapability =
  | 'available'
  | 'unavailable'
  | 'invalid'
  | 'drifted'

/** Configuration facts known before an interpreter can be observed. */
export interface ScienceInterpreterSelection {
  /** Language this binding serves. */
  readonly language: ScienceLanguage
  /** User-configured environment prefix. */
  readonly configuredPrefix: string
}

/** Complete identity facts captured after an interpreter was observed. */
export interface ScienceInterpreterIdentity {
  /** Canonicalized environment prefix. */
  readonly canonicalPrefix: string
  /** Canonical interpreter executable. */
  readonly executable: string
  /** Stable filesystem identity captured for the executable. */
  readonly executableIdentity: string
  /** Interpreter-reported language version. */
  readonly languageVersion: string
  /** SHA-256 digest of the environment's Conda history. */
  readonly condaHistorySha256: string
  /** Stable digest over the complete binding facts. */
  readonly bindingFingerprint: string
}

/** Fully observed interpreter that is safe to authorize a run. */
export type ScienceInterpreterAvailableBinding = ScienceInterpreterSelection
  & ScienceInterpreterIdentity
  & {
    readonly capability: 'available'
    readonly reason?: never
  }

/** Failed validation with only the identity facts reached before failure. */
export type ScienceInterpreterUnavailableBinding = ScienceInterpreterSelection
  & Partial<ScienceInterpreterIdentity>
  & {
    readonly capability: Exclude<ScienceInterpreterCapability, 'available'>
    /** Stable explanation of the unavailable, invalid, or drifted observation. */
    readonly reason: string
  }

/** Honest capability record: failed observations never require sentinel identity facts. */
export type ScienceInterpreterBinding =
  | ScienceInterpreterAvailableBinding
  | ScienceInterpreterUnavailableBinding

/** Durable state of one environment revision. */
export type ScienceEnvironmentStatus = 'applied' | 'invalid' | 'drifted'

/** Whole-value environment binding recorded at one monotonic revision. */
export interface ScienceEnvironmentBinding {
  /** Positive session-local environment revision. */
  readonly revision: number
  /** Stable profile selected for the revision. */
  readonly profileId: ScienceEnvironmentProfileId
  /** Epoch milliseconds when configuration was selected. */
  readonly configuredAt: number
  /** Epoch milliseconds when validation completed. */
  readonly validatedAt: number
  /** Result of applying and validating the revision. */
  readonly status: ScienceEnvironmentStatus
  /** Python binding facts when the profile declares Python. */
  readonly python?: ScienceInterpreterBinding
  /** R binding facts when the profile declares R. */
  readonly r?: ScienceInterpreterBinding
  /** Stable human-readable failure or drift reason. */
  readonly failureReason?: string
}

/** Fields fixed by `science/run-started` and repeated by its terminal event. */
export interface ScienceRunIdentity {
  /** Stable session-local run identity. */
  readonly runId: ScienceRunId
  /** Language selected for this run. */
  readonly language: ScienceLanguage
  /** Model-issued call that authorized this run. */
  readonly toolCallId: CallId
  /** Prior `request/header` event carrying the model and prompt facts. */
  readonly requestHeaderSeq: number
  /** Applied environment revision used by this run. */
  readonly environmentRevision: number
  /** Fingerprint of the interpreter binding used by this run. */
  readonly environmentFingerprint: string
  /** Epoch milliseconds when the run began. */
  readonly startedAt: number
  /** SHA-256 digest of the exact source passed to execution. */
  readonly codeSha256: string
  /** Content-addressed immutable scratch source key. */
  readonly scratchKey: ScienceScratchKey
  /** Session-relative run directory reference, never a Host absolute path. */
  readonly runDirectoryRef: string
}

/** Whole-value record emitted when a Science run starts. */
export interface ScienceRunStarted extends ScienceRunIdentity {
  /** Durable start status. */
  readonly status: 'running'
}

/** Terminal statuses that may be written by `science/run-finished`. */
export type ScienceRunTerminalStatus =
  | 'success'
  | 'failed'
  | 'timed-out'
  | 'cancelled'

/** Whole-value terminal record for a run that produced a durable finish. */
export interface ScienceRunTerminal extends ScienceRunIdentity {
  /** Durable terminal status. */
  readonly status: ScienceRunTerminalStatus
  /** Epoch milliseconds when execution settled. */
  readonly finishedAt: number
  /** Process exit status when one was observed. */
  readonly exitCode?: number
  /** Process signal when one was observed. */
  readonly signal?: string
  /** Exact captured standard-output byte count. */
  readonly stdoutBytes: number
  /** Exact captured standard-error byte count. */
  readonly stderrBytes: number
  /** Whether standard output exceeded the durable capture limit. */
  readonly stdoutTruncated: boolean
  /** Whether standard error exceeded the durable capture limit. */
  readonly stderrTruncated: boolean
  /** Stable failure classification for a non-success terminal state. */
  readonly failureCode?: string
  /** Human-readable failure explanation safe for durable storage. */
  readonly failureMessage?: string
}

/** Replay-derived terminal record for a run open at `session/end-seed`. */
export interface ScienceRunInterrupted extends ScienceRunIdentity {
  /** Replay-only terminal status; no finish event may carry it. */
  readonly status: 'interrupted'
  /** Timestamp of the seed-boundary marker. */
  readonly finishedAt: number
  /** Sequence of the seed-boundary marker that derived this state. */
  readonly interruptedAtSeq: number
}

/** Run state served by the Science projection. */
export type ScienceRun = ScienceRunStarted | ScienceRunTerminal | ScienceRunInterrupted

/** One immutable PNG version of a logical Science chart. */
export interface ScienceChartVersion {
  /** Stable chart identity shared by every version. */
  readonly chartId: ScienceChartId
  /** Stable logical chart name within the session. */
  readonly logicalName: string
  /** Positive version, contiguous within the logical chart. */
  readonly version: number
  /** Human-readable chart title. */
  readonly title: string
  /** Optional human-readable chart caption. */
  readonly caption?: string
  /** Immutable attachment metadata; Science version one requires PNG. */
  readonly attachment: ImageAttachmentRef
  /** Successful run that produced this chart. */
  readonly runId: ScienceRunId
  /** Model-issued call that authorized saving this chart version. */
  readonly toolCallId: CallId
  /** Prior `request/header` carrying the authorizing request facts. */
  readonly requestHeaderSeq: number
  /** Environment revision inherited from the source run. */
  readonly environmentRevision: number
  /** Environment fingerprint inherited from the source run. */
  readonly environmentFingerprint: string
  /** Epoch milliseconds when the immutable attachment was committed. */
  readonly createdAt: number
}

/** One run cited by a published Science outcome. */
export interface ScienceRunEvidenceRef {
  readonly kind: 'run'
  readonly runId: ScienceRunId
}

/** One exact chart version cited by a published Science outcome. */
export interface ScienceChartEvidenceRef {
  readonly kind: 'chart'
  readonly chartId: ScienceChartId
  readonly version: number
}

/** One prior model-visible message cited by a published Science outcome. */
export interface ScienceMessageEvidenceRef {
  readonly kind: 'message'
  readonly seq: number
}

/** Backward reference carried by a published Science outcome. */
export type ScienceEvidenceRef =
  | ScienceRunEvidenceRef
  | ScienceChartEvidenceRef
  | ScienceMessageEvidenceRef

/** Whole-value publication of the current Science outcome revision. */
export interface ScienceOutcomePublication {
  /** Positive, contiguous publication revision. */
  readonly revision: number
  /** Human-readable result title. */
  readonly title: string
  /** Markdown result summary, bounded at the durable decoder. */
  readonly summaryMarkdown: string
  /** Non-empty set of prior durable evidence references. */
  readonly evidence: readonly ScienceEvidenceRef[]
  /** Epoch milliseconds when this revision was published. */
  readonly publishedAt: number
  /** Model-issued call that authorized publishing this revision. */
  readonly toolCallId: CallId
  /** Prior `request/header` carrying the publishing request facts. */
  readonly requestHeaderSeq: number
  /**
   * Exact sorted applied-environment revisions used by cited run or chart
   * evidence; empty for message-only evidence.
   */
  readonly environmentRevisions: readonly number[]
}

/** Stable counters served with the current Science projection. */
export interface ScienceProjectionMetrics {
  readonly runCount: number
  readonly successfulRunCount: number
  readonly chartCount: number
  readonly chartVersionCount: number
  readonly outcomeRevision: number
}

/** Complete strict replay value for Host-side Science decisions. */
export interface ScienceProjection {
  /** The session's one durable Science mode binding. */
  readonly mode: ScienceModeRef
  /** Latest environment revision, or `null` before the first binding. */
  readonly environment: ScienceEnvironmentBinding | null
  /** All durable and replay-derived run states in start order. */
  readonly runs: readonly ScienceRun[]
  /** Every immutable chart version in commit order. */
  readonly charts: readonly ScienceChartVersion[]
  /** Latest published outcome revision, or `null` before publication. */
  readonly outcome: ScienceOutcomePublication | null
  /** Derived counters; never written independently to the session log. */
  readonly metrics: ScienceProjectionMetrics
  /** Sequence of the latest event that changed Science projection state. */
  readonly lastScienceEventSeq: number
}

/** Browser-safe interpreter summary derived from one durable binding. */
export interface ScienceClientInterpreterBinding {
  readonly language: ScienceLanguage
  readonly capability: ScienceInterpreterCapability
  readonly languageVersion?: string
  readonly fingerprintPreview?: string
}

/** Browser-safe environment revision with every Host path and free-text failure omitted. */
export interface ScienceClientEnvironmentBinding {
  readonly revision: number
  readonly profileId: ScienceEnvironmentProfileId
  readonly configuredAt: number
  readonly validatedAt: number
  readonly status: ScienceEnvironmentStatus
  readonly python?: ScienceClientInterpreterBinding
  readonly r?: ScienceClientInterpreterBinding
}

/** Browser-safe fields shared by every Science run state. */
export interface ScienceClientRunIdentity {
  readonly runId: ScienceRunId
  readonly language: ScienceLanguage
  readonly environmentRevision: number
  readonly environmentFingerprintPreview: string
  readonly startedAt: number
}

/** Browser-safe running state. */
export interface ScienceClientRunStarted extends ScienceClientRunIdentity {
  readonly status: 'running'
}

/** Browser-safe durable terminal state; free-text failure output is omitted. */
export interface ScienceClientRunTerminal extends ScienceClientRunIdentity {
  readonly status: ScienceRunTerminalStatus
  readonly finishedAt: number
  readonly exitCode?: number
  readonly signal?: string
  readonly stdoutBytes: number
  readonly stderrBytes: number
  readonly stdoutTruncated: boolean
  readonly stderrTruncated: boolean
  readonly failureCode?: string
}

/** Browser-safe replay-derived interruption state. */
export interface ScienceClientRunInterrupted extends ScienceClientRunIdentity {
  readonly status: 'interrupted'
  readonly finishedAt: number
  readonly interruptedAtSeq: number
}

/** One run state served to Session projection clients. */
export type ScienceClientRun = ScienceClientRunStarted | ScienceClientRunTerminal | ScienceClientRunInterrupted

/** Browser-safe chart version retaining the attachment reference needed for authorized reads. */
export interface ScienceClientChartVersion {
  readonly chartId: ScienceChartId
  readonly logicalName: string
  readonly version: number
  readonly title: string
  readonly caption?: string
  readonly attachment: ImageAttachmentRef
  readonly runId: ScienceRunId
  readonly environmentRevision: number
  readonly environmentFingerprintPreview: string
  readonly createdAt: number
}

/** Browser-safe Outcome publication without authorizing request facts. */
export interface ScienceClientOutcomePublication {
  readonly revision: number
  readonly title: string
  readonly summaryMarkdown: string
  readonly evidence: readonly ScienceEvidenceRef[]
  readonly publishedAt: number
  readonly environmentRevisions: readonly number[]
}

/** Browser-safe Session projection for a Science-bound session. */
export interface ScienceClientProjection {
  readonly mode: ScienceModeRef
  readonly environment: ScienceClientEnvironmentBinding | null
  readonly runs: readonly ScienceClientRun[]
  readonly charts: readonly ScienceClientChartVersion[]
  readonly outcome: ScienceClientOutcomePublication | null
  readonly metrics: ScienceProjectionMetrics
  readonly lastScienceEventSeq: number
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /**
     * Replayed Science state, or `null` before a valid Science mode binding.
     * An absent key means this package was not composed in the host.
     */
    science: ScienceClientProjection | null
  }
}
