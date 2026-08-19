/**
 * Durable Science vocabulary and the client-safe Session projection contract.
 * Runtime validation and event declaration merging live in the host entry;
 * durable event values may contain Host-only provenance and must not be sent
 * to a client without the projection conversion.
 *
 * @module @deepseek-ai/dsh-science-session/types
 */

import type { ImageAttachmentRef, TextAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { CallId } from '@deepseek-ai/dsh-llm'
import type {
  ScienceArtifactId,
  ScienceEnvironmentProfileId,
  ScienceRunId,
  ScienceScratchKey,
} from './ids.ts'

export type {
  ScienceArtifactId,
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

/** One installed package name and version, as reported by the interpreter's own package manager. */
export interface SciencePackage {
  /** Package name exactly as reported. */
  readonly name: string
  /** Package version exactly as reported. */
  readonly version: string
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
  /** Stable digest over the complete binding facts. Excludes {@link packagesSha256}. */
  readonly bindingFingerprint: string
  /**
   * Installed packages retained after the Runtime's configured entry and
   * byte caps, sorted by name then version. Truncated when
   * {@link packagesTruncated} is `true`; {@link packagesSha256} still covers
   * the complete pre-truncation inventory.
   */
  readonly packages: readonly SciencePackage[]
  /** SHA-256 digest over the complete sorted package inventory, before any cap truncation. */
  readonly packagesSha256: string
  /** Whether the configured entry or byte cap truncated {@link packages}. */
  readonly packagesTruncated: boolean
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
  /**
   * Session-local epoch of the persistent kernel that executed this run.
   * Two runs sharing an epoch share the kernel's in-memory state: this is
   * the provenance backbone for variable-persistence continuity.
   */
  readonly kernelEpoch: number
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
  /**
   * Present iff the kernel driver's DONE frame carried the `capture-degraded`
   * flag: it could not fully restore or attribute output capture for this
   * run, so the run's result stands but {@link stdoutBytes}/{@link stderrBytes}
   * (and their retained tails) may be incomplete.
   */
  readonly outputDegraded?: true
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

/**
 * Closed reason a persistent Science kernel's own subprocess lifetime ended.
 * `science-runtime`'s `KernelSet` switches on every member with `assertNever`.
 */
export type ScienceKernelEndReason =
  /** The kernel's idle timer fired with no run activity since its last reset. */
  | 'idle'
  /** The Session that owned the kernel detached. */
  | 'session-end'
  /** A newer applied environment revision superseded the kernel's own. */
  | 'environment-rebound'
  /** An interrupted-but-unproven run left the kernel's state unknown. */
  | 'run-escalation'
  /** The kernel driver broke protocol (unparseable frame, unexpected EOF, READY timeout). */
  | 'protocol'
  /** The kernel process exited uncommanded, with no protocol violation detected. */
  | 'crash'
  /** The Science Runtime service disposed. */
  | 'service-disposed'

/**
 * Whole-value fact for one persistent kernel lifecycle transition:
 * `state: 'started'` fixes the kernel's identity and provenance; a later
 * `state: 'exited'` fact for the same `language`/`kernelEpoch` closes it.
 * Both transitions reuse this one shape rather than a started/terminal pair,
 * since a kernel-state fact never repeats fields already fixed by its own
 * prior transition the way a run terminal repeats its start-owned fields.
 */
export interface ScienceKernelState {
  /** Session-local identity for this kernel instance, strictly monotonic across both languages. */
  readonly kernelEpoch: number
  /** The kernel's language. */
  readonly language: ScienceLanguage
  /** Lifecycle transition this fact records. */
  readonly state: 'started' | 'exited'
  /** Closed reason the kernel ended; present if and only if `state === 'exited'`. */
  readonly reason?: ScienceKernelEndReason
  /**
   * Epoch milliseconds the kernel's own `started` fact recorded as its `at`;
   * present if and only if `state === 'exited'`. Keeps a closed kernel's
   * lifetime whole-value in this one fact instead of requiring a reader to
   * retain its now-superseded `started` fact; the fold asserts equality with
   * that fact's `at`.
   */
  readonly startedAt?: number
  /** Applied environment revision this kernel serves. */
  readonly environmentRevision: number
  /** Fingerprint of the language's available binding this kernel spawned against. */
  readonly environmentFingerprint: string
  /** Epoch milliseconds this transition occurred. */
  readonly at: number
}

/** Replay-derived terminal record for a kernel still `started` at `session/end-seed`. */
export interface ScienceKernelInterrupted {
  /** The kernel's own session-local epoch. */
  readonly kernelEpoch: number
  /** The kernel's language. */
  readonly language: ScienceLanguage
  /**
   * Replay-only terminal state; no `science/kernel-state` fact may carry it.
   * Shares its discriminant key with {@link ScienceKernelState.state}, so a
   * reader switches on one tag across every kernel record.
   */
  readonly state: 'interrupted'
  /** Applied environment revision the interrupted kernel served. */
  readonly environmentRevision: number
  /** Fingerprint of the language's available binding the interrupted kernel served. */
  readonly environmentFingerprint: string
  /** Epoch milliseconds when the kernel's `started` fact committed. */
  readonly startedAt: number
  /** Timestamp of the seed-boundary marker. */
  readonly finishedAt: number
  /** Sequence of the seed-boundary marker that derived this state. */
  readonly interruptedAtSeq: number
}

/**
 * Kernel state served by the Science projection: a durable
 * {@link ScienceKernelState} lifecycle fact, or its end-seed
 * {@link ScienceKernelInterrupted} derivation for a kernel still `started`
 * when the session was last observed live.
 */
export type ScienceKernel = ScienceKernelState | ScienceKernelInterrupted

/**
 * Whether one artifact version's current title and caption came from
 * unattended capture or from a model-directed curation call. `auto` names a
 * run-written file the Runtime captured and titled from its own basename;
 * `model` names a version the model deliberately titled through
 * `annotate_artifact`, which is what marks it as the result worth showing a
 * reader first. Curation supersedes the version it names, so the two values
 * describe one version's current metadata rather than two separate versions.
 */
export type ScienceArtifactOrigin = 'auto' | 'model'

/** One version of a logical Science artifact: the content one request turn produced. */
export interface ScienceArtifactVersion {
  /** Stable artifact identity shared by every version. */
  readonly artifactId: ScienceArtifactId
  /** Stable logical artifact name within the session. */
  readonly logicalName: string
  /**
   * Positive version, contiguous within the logical artifact. A version is
   * what one request turn produced: saves that repeat the version's own turn,
   * or repeat its attachment unchanged, supersede that version instead of
   * opening the next one.
   */
  readonly version: number
  /**
   * Human-readable title: always populated, either model-supplied or the
   * captured file's basename.
   */
  readonly title: string
  /** Optional human-readable caption; only ever model-supplied. */
  readonly caption?: string
  /** Whether this version's current title and caption are capture-derived or model-curated. */
  readonly origin: ScienceArtifactOrigin
  /** Immutable attachment metadata: an image, or admitted UTF-8 text. */
  readonly attachment: ImageAttachmentRef | TextAttachmentRef
  /** Successful run that produced this artifact. */
  readonly runId: ScienceRunId
  /** Model-issued call that authorized saving this artifact version. */
  readonly toolCallId: CallId
  /** Prior `request/header` carrying the authorizing request facts. */
  readonly requestHeaderSeq: number
  /** Environment revision inherited from the source run. */
  readonly environmentRevision: number
  /** Environment fingerprint inherited from the source run. */
  readonly environmentFingerprint: string
  /** Epoch milliseconds when this version's current content and metadata were committed. */
  readonly createdAt: number
}

/** One run cited by a published Science outcome. */
export interface ScienceRunEvidenceRef {
  readonly kind: 'run'
  readonly runId: ScienceRunId
}

/** One exact artifact version cited by a published Science outcome. */
export interface ScienceChartEvidenceRef {
  readonly kind: 'chart'
  readonly chartId: ScienceArtifactId
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
  readonly artifactCount: number
  readonly artifactVersionCount: number
  readonly kernelCount: number
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
  /** Every kernel instance ever started, in start order. */
  readonly kernels: readonly ScienceKernel[]
  /** Every immutable artifact version in commit order. */
  readonly artifacts: readonly ScienceArtifactVersion[]
  /** Latest published outcome revision, or `null` before publication. */
  readonly outcome: ScienceOutcomePublication | null
  /** Derived counters; never written independently to the session log. */
  readonly metrics: ScienceProjectionMetrics
  /** Sequence of the latest event that changed Science projection state. */
  readonly lastScienceEventSeq: number
}

/**
 * Browser-safe interpreter summary derived from one durable binding. Package
 * names and versions carry no Host path, so {@link packages} passes through
 * unredacted; only the inventory digest is truncated to a preview, matching
 * {@link fingerprintPreview}.
 */
export interface ScienceClientInterpreterBinding {
  readonly language: ScienceLanguage
  readonly capability: ScienceInterpreterCapability
  readonly languageVersion?: string
  readonly fingerprintPreview?: string
  readonly packages?: readonly SciencePackage[]
  readonly packagesTruncated?: boolean
  readonly packagesSha256Preview?: string
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

/**
 * Browser-safe fields shared by every Science run state. `toolCallId` and
 * `requestHeaderSeq` are session-log identities the browser already holds
 * (transcript tool nodes are keyed by the same `CallId`, and
 * `requestHeaderSeq` addresses a `request/header` event the client already
 * receives); they let a run join its authorizing transcript call.
 * `codeSha256` is a digest over source text the same transcript call already
 * restates verbatim once resolved — unlike a fingerprint or path, showing it
 * whole carries no Host-infrastructure fact, and it is provenance's durable
 * anchor for the code a person is viewing.
 */
export interface ScienceClientRunIdentity {
  readonly runId: ScienceRunId
  readonly language: ScienceLanguage
  readonly toolCallId: CallId
  readonly requestHeaderSeq: number
  readonly environmentRevision: number
  readonly environmentFingerprintPreview: string
  readonly startedAt: number
  readonly codeSha256: string
  readonly kernelEpoch: number
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
  /** Mirrors {@link ScienceRunTerminal.outputDegraded}. */
  readonly outputDegraded?: true
}

/** Browser-safe replay-derived interruption state. */
export interface ScienceClientRunInterrupted extends ScienceClientRunIdentity {
  readonly status: 'interrupted'
  readonly finishedAt: number
  readonly interruptedAtSeq: number
}

/** One run state served to Session projection clients. */
export type ScienceClientRun = ScienceClientRunStarted | ScienceClientRunTerminal | ScienceClientRunInterrupted

/**
 * Browser-safe kernel lifecycle fact mirroring {@link ScienceKernelState}.
 * The durable value carries no Host path, so only the environment fingerprint
 * needs redaction to {@link fingerprintPreview}'s twelve-character preview.
 */
export interface ScienceClientKernelState {
  readonly kernelEpoch: number
  readonly language: ScienceLanguage
  readonly state: 'started' | 'exited'
  readonly reason?: ScienceKernelEndReason
  /** Mirrors {@link ScienceKernelState.startedAt}: present if and only if `state === 'exited'`. */
  readonly startedAt?: number
  readonly environmentRevision: number
  readonly environmentFingerprintPreview: string
  readonly at: number
}

/** Browser-safe replay-derived interruption state mirroring {@link ScienceKernelInterrupted}. */
export interface ScienceClientKernelInterrupted {
  readonly kernelEpoch: number
  readonly language: ScienceLanguage
  readonly state: 'interrupted'
  readonly environmentRevision: number
  readonly environmentFingerprintPreview: string
  readonly startedAt: number
  readonly finishedAt: number
  readonly interruptedAtSeq: number
}

/** One kernel state served to Session projection clients. */
export type ScienceClientKernel = ScienceClientKernelState | ScienceClientKernelInterrupted

/**
 * Browser-safe artifact version retaining the attachment reference needed
 * for authorized reads. `toolCallId` and `requestHeaderSeq` are session-log
 * identities the browser already holds; they let an artifact version join
 * its authorizing transcript call for provenance.
 */
export interface ScienceClientArtifactVersion {
  readonly artifactId: ScienceArtifactId
  readonly logicalName: string
  readonly version: number
  readonly title: string
  readonly caption?: string
  readonly origin: ScienceArtifactOrigin
  readonly attachment: ImageAttachmentRef | TextAttachmentRef
  readonly runId: ScienceRunId
  readonly toolCallId: CallId
  readonly requestHeaderSeq: number
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
  readonly kernels: readonly ScienceClientKernel[]
  readonly artifacts: readonly ScienceClientArtifactVersion[]
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
