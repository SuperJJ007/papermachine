/**
 * Client-safe tagged, versioned presentation values for `save_chart` and
 * `publish_outcome`, persisted through `output.presentationMeta` and
 * replayed by `@deepseek-ai/dsh-client-ui-science`. Each value is tagged
 * with a stable `kind` and `version` so an older or newer Client can fall
 * back to the generic tool row instead of misreading a shape it does not
 * recognize; never bytes, base64, an object URL, or a Host path.
 *
 * @module @deepseek-ai/dsh-tool-science/types
 */

/** Complete attachment metadata carried in a chart presentation (never bytes). */
export interface ScienceChartPresentationAttachment {
  readonly attachmentId: string
  readonly mediaType: string
  readonly bytes: number
  readonly width: number
  readonly height: number
  readonly name?: string
}

/** Replayable presentation value for one `save_chart` direct top-level result. */
export interface ScienceChartPresentation {
  readonly kind: 'science/chart'
  readonly version: 1
  readonly chartId: string
  readonly logicalName: string
  readonly chartVersion: number
  readonly title: string
  readonly caption?: string
  readonly runId: string
  readonly attachment: ScienceChartPresentationAttachment
  readonly createdAt: number
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
