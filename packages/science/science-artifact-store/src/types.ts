/** Public record and input types for the project artifact store. */

import type { SessionId } from '@deepseek-ai/dsh-session'
import type { AnnotationId, ArtifactId, NoteId, ProjectId, VersionId } from './ids.ts'

/**
 * What kind of thing an artifact is. Determines which kind-specific side
 * table (if any) its versions may carry — today only `figure_state`; the
 * remaining kinds have no side table yet, and stay valid `artifacts.kind`
 * values so this build never has to migrate this column again to admit them.
 */
export type ArtifactKind = 'figure' | 'dataset' | 'document' | 'job-output'

/**
 * How one version's BYTES came to exist. Immutable once written — curation
 * (an `annotateVersion` call) never changes it. Distinct from
 * {@link AnnotationActor}, which records who most recently changed the
 * version's METADATA.
 */
export type ContentOrigin = 'run-auto' | 'human-edit' | 'import'

/** Who wrote one {@link VersionAnnotationRecord} row. */
export type AnnotationActor = 'capture' | 'model' | 'human'

/** One logical artifact: stable identity, owning project, and its current latest version. */
export interface ArtifactRecord {
  readonly artifactId: ArtifactId
  readonly owningProjectId: ProjectId
  /** The session that created this artifact's first version. */
  readonly originSessionId: SessionId
  readonly logicalName: string
  readonly kind: ArtifactKind
  readonly latestVersionId: VersionId
  readonly createdAt: number
}

/**
 * One metadata edit on a version, in the order it was applied. Rows are
 * never updated in place — a new edit appends a new row and the version's
 * `latestAnnotationId` advances to it — so this table is the version's full
 * metadata history, and `actor`/`sessionId`/`toolCallId` name the source of
 * EACH edit independently of who produced the version's bytes.
 */
export interface VersionAnnotationRecord {
  readonly annotationId: AnnotationId
  readonly versionId: VersionId
  /** `null` when this row leaves the title cleared (either it was never set, or a later edit explicitly cleared it). */
  readonly title: string | null
  readonly caption: string | null
  readonly actor: AnnotationActor
  readonly sessionId: SessionId | undefined
  readonly toolCallId: string | undefined
  readonly requestHeaderSeq: number | undefined
  /**
   * `true` when this row was synthesized by the v1→v2 migration rather than
   * recorded from a live call. A derived row's `createdAt` equals the
   * version's own `createdAt` (the migration had no independent edit
   * timestamp to record) and its `toolCallId` is `undefined` unless a
   * `backfillProvenance` hook recovered the real one from the session log,
   * in which case the migration clears `derived` back to `false`.
   */
  readonly derived: boolean
  readonly createdAt: number
}

/** One version's live-figure-object state, for kinds that carry `figure_state`. */
export interface FigureStateRecord {
  readonly versionId: VersionId
  readonly figureKey: string
  readonly dpi: number
  /**
   * Opaque JSON text for the chart's live-object state (elements, op log,
   * hit regions). This package stores and returns it verbatim without
   * parsing — the shape belongs to `dsh-science-runtime`, not this package.
   */
  readonly stateJson: string
}

/** One user-authored note, optionally pinned to a specific version. */
export interface ArtifactNoteRecord {
  readonly noteId: NoteId
  readonly artifactId: ArtifactId
  readonly versionId: VersionId | undefined
  readonly text: string
  /** `undefined` for a note this package wrote itself (e.g. a v1→v2 rename explanation), which has no authoring session. */
  readonly sessionId: SessionId | undefined
  readonly createdAt: number
  readonly removedAt: number | undefined
}

/** Reconciliation status for one version, written by the store's caller — see `setVersionHealth`. */
export interface VersionHealthRecord {
  readonly versionId: VersionId
  /** No session event has ever referenced this version — the content is real, but no session claims producing it. */
  readonly orphan: boolean
  /** This row was rebuilt from a session event's fallback fields after its own store row was lost. */
  readonly reconstructed: boolean
  /** The row exists but its blob is missing from `blobs/sha256/`. */
  readonly missingContent: boolean
  readonly checkedAt: number
}

/**
 * Project-wide reconciliation health, read from `version_health` — see
 * `getReconciliationSummary`. Counts and `items` cover only versions with at
 * least one true flag; a fully healthy project reports all-zero counts and
 * an empty `items`. This is a pure read of whatever the last `reconcileProject`
 * call recorded; it never itself compares the store against a session log.
 */
export interface ReconciliationSummary {
  readonly orphanCount: number
  readonly reconstructedCount: number
  readonly missingContentCount: number
  /** Every version with at least one true health flag, most recently checked first. */
  readonly items: readonly VersionHealthRecord[]
}

/**
 * One immutable artifact version: content and producer provenance are fixed
 * at creation and never change; `latestAnnotationId` is the one column that
 * does, advancing to point at the newest {@link VersionAnnotationRecord} row.
 */
export interface VersionRecord {
  readonly versionId: VersionId
  readonly artifactId: ArtifactId
  /** Contiguous 1-based position among this artifact's versions. */
  readonly ordinal: number
  /**
   * The content baseline this version was built from. On a version created
   * by THIS schema version, set only when the caller supplied one (a model
   * `edit_of`, a viewer edit, or a `save_artifact_as`) — a plain chain
   * continuation (the common case: a second `run` overwrites the same file)
   * leaves this `undefined`, since the chain predecessor is always derivable
   * from `(artifactId, ordinal - 1)` and is never stored here on its own.
   * May name a version of a DIFFERENT artifact. The one exception: a version
   * migrated from schema v1 may carry its old `parent_version_id` here with
   * `baseExplicit` still `false` — v1 could not distinguish an explicit
   * baseline from an auto-defaulted chain predecessor, so the migration
   * copies the value without claiming it was explicit (see the v1→v2
   * migration's Agent Note).
   */
  readonly baseVersionId: VersionId | undefined
  /**
   * `true` exactly when `baseVersionId` is known to have been explicitly
   * supplied; `false` for a plain chain continuation OR an
   * honestly-uncertain value carried over from a v1 migration.
   */
  readonly baseExplicit: boolean
  readonly sha256: string
  readonly mediaType: string
  readonly byteCount: number
  readonly contentOrigin: ContentOrigin
  /** The session that produced this version — never the store's cascade boundary. */
  readonly producerSessionId: SessionId
  readonly producerRunId: string | undefined
  readonly producerToolCallId: string | undefined
  readonly producerRequestHeaderSeq: number | undefined
  /** The request/response turn number of the authorizing tool call, when known. */
  readonly producerTurn: number | undefined
  readonly environmentRevision: number | undefined
  /** Full 64-hex-character digest, not a preview. */
  readonly environmentFingerprint: string | undefined
  /** Content-commit time. Never changes after creation — metadata-edit time lives on `latestAnnotation.createdAt` instead. */
  readonly createdAt: number
  /**
   * This version's current metadata, or `undefined` when it has never been
   * annotated (a version created but not yet curated, or captured without
   * an initial-title call).
   */
  readonly latestAnnotation: VersionAnnotationRecord | undefined
  /** Convenience read of `latestAnnotation?.title`. */
  readonly title: string | undefined
  /** Convenience read of `latestAnnotation?.caption`. */
  readonly caption: string | undefined
}

/** Input to `createArtifact`/`appendVersion`: the live-figure-object state to store alongside the new version. */
export interface FigureStateInput {
  readonly figureKey: string
  readonly dpi: number
  readonly stateJson: string
}

/** Fields shared by `createArtifact` and `appendVersion`: one version's bytes and producer provenance. */
interface VersionProducerInput {
  readonly data: Uint8Array
  readonly mediaType: string
  readonly contentOrigin: ContentOrigin
  /**
   * An explicitly declared content baseline — omit for a plain chain
   * continuation. See {@link VersionRecord.baseVersionId}; `baseExplicit` is
   * never a separate input, it is `true` exactly when this is provided.
   */
  readonly baseVersionId?: VersionId
  readonly producerRunId?: string
  readonly producerToolCallId?: string
  readonly producerRequestHeaderSeq?: number
  readonly producerTurn?: number
  readonly environmentRevision?: number
  /** Full 64-hex-character digest, not a preview. */
  readonly environmentFingerprint?: string
  readonly figureState?: FigureStateInput
}

/**
 * Input to `createArtifact`: bytes plus the first version's provenance.
 * Carries no title/caption — curate the version afterward with `annotateVersion`.
 */
export interface CreateArtifactInput extends VersionProducerInput {
  readonly logicalName: string
  readonly kind: ArtifactKind
  readonly originSessionId: SessionId
}

/**
 * Input to `appendVersion`: bytes plus the new version's provenance. Carries
 * no title/caption — curate the version afterward with `annotateVersion`.
 */
export interface AppendVersionInput extends VersionProducerInput {
  readonly producerSessionId: SessionId
}

/**
 * Input to `annotateVersion`: appends one new {@link VersionAnnotationRecord}
 * row and advances the version's `latestAnnotationId` to it. `title` and
 * `caption` are independently tri-state: omit to carry the current value
 * forward unchanged, pass `null` to explicitly clear it, pass a string to
 * set it. A model edit requires its complete authorizing call identity;
 * capture and human edits cannot claim one.
 */
export type AnnotateVersionInput = {
  readonly actor: 'capture'
  readonly sessionId?: SessionId
  readonly title?: string | null
  readonly caption?: string | null
} | {
  readonly actor: 'model'
  readonly sessionId: SessionId
  readonly toolCallId: string
  readonly requestHeaderSeq: number
  readonly title?: string | null
  readonly caption?: string | null
} | {
  readonly actor: 'human'
  readonly sessionId?: SessionId
  readonly title?: string | null
  readonly caption?: string | null
}

/** Input to `putNote`: always creates a new note row: there is no update-in-place. */
export interface PutNoteInput {
  readonly artifactId: ArtifactId
  readonly versionId?: VersionId
  readonly text: string
  readonly sessionId?: SessionId
}

/**
 * Input to `setVersionHealth`: an omitted field keeps its current (or
 * default `false`) value; `checkedAt` always advances to the call time.
 */
export interface VersionHealthPatch {
  readonly orphan?: boolean
  readonly reconstructed?: boolean
  readonly missingContent?: boolean
}

/**
 * Input to `reconstructVersion`: rebuild one version row (and its owning
 * artifact row, when the store no longer has one) from a session-log
 * event's fallback fields, for the case a store row was lost while its
 * `science/artifact-saved` event survived. Every EXACT id (`versionId`,
 * `artifactId`) is caller-supplied rather than store-generated, since the
 * reconstructed row must be reachable by the same id the surviving event
 * already names. `contentOrigin` is always fixed to `'import'` by the
 * engine — never a caller input — since a reconstructed row's real content
 * origin is exactly the fact this reconstruction cannot recover.
 */
export interface ReconstructVersionInput {
  readonly versionId: VersionId
  readonly artifactId: ArtifactId
  /** Used only when the owning artifact row does not exist yet. */
  readonly logicalName: string
  /** Used only when the owning artifact row does not exist yet. */
  readonly kind: ArtifactKind
  readonly ordinal: number
  readonly sha256: string
  readonly mediaType: string
  /**
   * The blob's real on-disk size when reconciliation found it present, or
   * `0` when the blob is also missing — an honest sentinel, not a claimed
   * byte count; callers cross-check `missingContent` before trusting this
   * field on a reconstructed row.
   */
  readonly byteCount: number
  readonly producerSessionId: SessionId
  /** The event's own `seenAt` — the closest available approximation to a content-commit time this reconstruction has. */
  readonly createdAt: number
  readonly title: string | null
  readonly caption: string | null
}

/** How `openProject` resolved workspace identity for this call. */
export type ProjectIdentityOutcome = 'created' | 'reopened' | 'moved' | 'copied'

/** Result of resolving and opening a project for a workspace directory. */
export interface OpenedProject {
  readonly projectId: ProjectId
  /** Absolute path to this project's store directory under the harness home. */
  readonly storeRoot: string
  /** Canonicalized workspace path this call resolved against. */
  readonly workspacePath: string
  readonly outcome: ProjectIdentityOutcome
}
