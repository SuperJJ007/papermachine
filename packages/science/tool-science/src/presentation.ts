/**
 * Projections from a canonical `annotate_artifact`/`publish_outcome` result
 * to its tagged, versioned `output.presentationMeta` value. The value shapes
 * themselves are client-safe and live in `./types.ts`, importable without
 * this package's host-only runtime.
 */

import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { ScienceArtifactReceiptValue } from './annotate-artifact.ts'
import type { ScienceOutcomeResultValue } from './publish-outcome.ts'
import type { ScienceChartPresentation, ScienceOutcomePresentation } from './types.ts'

export type {
  ScienceChartPresentation,
  ScienceChartPresentationAttachment,
  ScienceOutcomeEvidencePresentation,
  ScienceOutcomePresentation,
} from './types.ts'

/**
 * Project an `annotate_artifact` canonical result into its tagged
 * presentation value. `ScienceChartPresentation` is image-only (see its own
 * docstring); curating a non-image artifact (csv/json/md/txt) returns `null`
 * — no card, the same graceful fallback the Client row already applies to
 * any presentation value it does not recognize — until a following change
 * generalizes this presentation to every captured media type.
 * @param value - the canonical `annotate_artifact` output value.
 * @returns the presentation value persisted as `tool/result.meta`, or `null` for a non-image artifact.
 */
export function scienceArtifactPresentation(value: ScienceArtifactReceiptValue): JsonValue {
  if (value.width === undefined || value.height === undefined) return null
  const presentation: ScienceChartPresentation = {
    kind: 'science/chart',
    version: 1,
    chartId: value.artifactId,
    logicalName: value.logicalName,
    chartVersion: value.version,
    title: value.title,
    ...value.caption === undefined ? {} : { caption: value.caption },
    runId: value.runId,
    attachment: {
      attachmentId: value.attachmentId,
      mediaType: value.mediaType,
      bytes: value.bytes,
      width: value.width,
      height: value.height,
      ...value.attachmentName === undefined ? {} : { name: value.attachmentName },
    },
    createdAt: value.createdAt,
  }
  return presentation as unknown as JsonValue
}

/**
 * Project a `publish_outcome` canonical result into its tagged presentation
 * value — the exact published revision, preserved for replay after a newer
 * Outcome later replaces the projection's current value.
 * @param value - the canonical `publish_outcome` output value.
 * @returns the presentation value persisted as `tool/result.meta`.
 */
export function scienceOutcomePresentation(value: ScienceOutcomeResultValue): JsonValue {
  const presentation: ScienceOutcomePresentation = {
    kind: 'science/outcome',
    version: 1,
    revision: value.revision,
    title: value.title,
    summaryMarkdown: value.summaryMarkdown,
    evidence: value.evidence,
    publishedAt: value.publishedAt,
  }
  return presentation as unknown as JsonValue
}
