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
