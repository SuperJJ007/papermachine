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

import type { ScienceArtifactId } from '@deepseek-ai/dsh-science-session/types'

/** A Vega-Lite structural target selected in the artifact viewer. */
export interface ScienceSpecPathTarget {
  readonly kind: 'spec-path'
  /** Dot-separated path into the selected Vega-Lite document, such as `mark` or `encoding.color`. */
  readonly path: string
}

/** A top-left-origin region normalized against the selected raster version. */
export interface ScienceNormalizedRegionTarget {
  readonly kind: 'normalized-region'
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** One model-visible edit target selected in the Science artifact viewer. */
export type ScienceEditTarget = ScienceSpecPathTarget | ScienceNormalizedRegionTarget

/** One selected target tied to its exact immutable artifact version. */
export interface ScienceEditSelection {
  readonly artifactId: ScienceArtifactId
  readonly version: number
  readonly target: ScienceEditTarget
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

/** Browser request to commit a styled Vega-Lite document over one exact current version. */
export interface ScienceStyleEditRequest {
  readonly artifactId: ScienceArtifactId
  /** Exact parent version being replaced by the edited working copy. */
  readonly version: number
  /** Complete edited Vega-Lite JSON text. */
  readonly spec: string
}

/** Exact new version committed by a direct style edit. */
export interface ScienceStyleEditReceipt {
  readonly artifactId: ScienceArtifactId
  readonly version: number
  readonly origin: 'human-edit'
}

/** Stable rejection classes for Science edit-message admission. */
export type ScienceEditErrorCode =
  | 'SCIENCE_EDIT_INVALID_REQUEST'
  | 'SCIENCE_EDIT_TARGET_NOT_FOUND'
  | 'SCIENCE_EDIT_STALE_VERSION'
  | 'SCIENCE_EDIT_TARGET_MISMATCH'
  | 'SCIENCE_EDIT_SPEC_INVALID'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** A user edit gesture over one exact Science artifact version. */
    'science-edit': ScienceEditMessageSource
  }
}

/**
 * Complete attachment metadata carried in one artifact presentation
 * reference (never bytes). Width/height present only for an image attachment.
 */
export interface ScienceArtifactPresentationAttachment {
  readonly attachmentId: string
  readonly mediaType: string
  readonly bytes: number
  readonly width?: number
  readonly height?: number
  readonly name?: string
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
  readonly attachment: ScienceArtifactPresentationAttachment
}

/**
 * Replayable presentation value for a `run_python`/`run_r` direct top-level
 * result (one entry per file that call's auto-capture produced, possibly
 * none) or an `annotate_artifact` direct top-level result (exactly the one
 * curated entry).
 */
export interface ScienceArtifactPresentation {
  readonly kind: 'science/artifact'
  readonly version: 1
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
