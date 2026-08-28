/**
 * Client-safe tagged, versioned presentation values for `run_python`/`run_r`,
 * `annotate_artifact`, and `publish_outcome`, persisted through
 * `output.presentationMeta` and replayed by `@deepseek-ai/dsh-client-ui-science`.
 * Each value is tagged with a stable `kind` and `version` so an older or
 * newer Client can fall back to the generic tool row instead of misreading a
 * shape it does not recognize; never bytes, base64, an object URL, or a Host
 * path.
 *
 * @module @deepseek-ai/dsh-tool-science/types
 */

import type { ScienceArtifactId, ScienceArtifactMediaType } from '@deepseek-ai/dsh-science-session/types'

/** A top-left-origin region normalized against the selected raster version. */
export interface ScienceNormalizedRegionTarget {
  readonly kind: 'normalized-region'
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** One model-visible edit target selected in the Science artifact viewer. */
export type ScienceEditTarget = ScienceNormalizedRegionTarget

/** One selected target tied to its exact immutable artifact version. */
export interface ScienceEditSelection {
  readonly artifactId: ScienceArtifactId
  readonly version: number
  readonly target: ScienceEditTarget
  /** Optional instruction scoped to this exact element. */
  readonly comment?: string
}

/** Browser request to edit one or more exact immutable Science artifact versions. */
export interface ScienceEditRequest {
  readonly targets: readonly ScienceEditSelection[]
  readonly instruction: string
}

/** Durable source attached to a viewer-originated Science edit message. */
export interface ScienceEditMessageSource extends ScienceEditRequest {
  readonly kind: 'science-edit'
}

/** Receipt returned after the edit message enters the addressed agent's inbox. */
export interface ScienceEditReceipt {
  readonly accepted: true
}

/** Browser request to add a user-only note to one logical artifact. */
export interface ScienceArtifactNoteAddRequest {
  readonly artifactId: ScienceArtifactId
  readonly version: number
  readonly text: string
}

/** Browser request to remove one user-only artifact note. */
export interface ScienceArtifactNoteRemoveRequest {
  readonly artifactId: ScienceArtifactId
  readonly noteSeq: number
}

/** Receipt for a committed user-only artifact-note change. */
export interface ScienceArtifactNoteReceipt {
  readonly accepted: true
}

/** Stable rejection classes for Science edit-message admission. */
export type ScienceEditErrorCode =
  | 'SCIENCE_EDIT_INVALID_REQUEST'
  | 'SCIENCE_EDIT_TARGET_NOT_FOUND'
  | 'SCIENCE_EDIT_STALE_VERSION'
  | 'SCIENCE_EDIT_TARGET_MISMATCH'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** A user edit gesture over one exact Science artifact version. */
    'science-edit': ScienceEditMessageSource
  }
}

/**
 * Store content reference carried in one artifact presentation reference
 * (never bytes): the version row a session-addressed content read resolves.
 */
export interface ScienceArtifactPresentationContent {
  readonly versionId: string
  readonly mediaType: ScienceArtifactMediaType
  readonly byteCount: number
}

/**
 * One clickable reference to a captured or curated artifact version, keyed
 * by `(artifactId, version)` — the Client row's per-file unit.
 */
export interface ScienceArtifactPresentationItem {
  readonly artifactId: string
  readonly logicalName: string
  readonly version: number
  readonly title: string
  readonly content: ScienceArtifactPresentationContent
}

/**
 * Replayable presentation value for a `run_python`/`run_r` direct top-level
 * result (one entry per file that call's auto-capture produced, possibly
 * none) or an `annotate_artifact` direct top-level result (exactly the one
 * curated entry). Version 2 replaced the embedded session-attachment
 * reference with the project-store content reference.
 */
export interface ScienceArtifactPresentation {
  readonly kind: 'science/artifact'
  readonly version: 2
  readonly artifacts: readonly ScienceArtifactPresentationItem[]
}

/** One evidence item carried in an Outcome presentation, echoing the model-facing snake_case shape. */
export type ScienceOutcomeEvidencePresentation =
  | { readonly kind: 'run'; readonly run_id: string }
  | { readonly kind: 'chart'; readonly chart_id: string; readonly version: number }
  | { readonly kind: 'message'; readonly seq: number }

/** Replayable presentation value for one `publish_outcome` direct top-level result. */
export interface ScienceOutcomePresentation {
  readonly kind: 'science/outcome'
  readonly version: 1
  readonly revision: number
  readonly title: string
  readonly summaryMarkdown: string
  readonly evidence: readonly ScienceOutcomeEvidencePresentation[]
  readonly publishedAt: number
}
