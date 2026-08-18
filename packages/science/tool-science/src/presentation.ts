/**
 * Projections from a canonical `run_python`/`run_r`, `annotate_artifact`, or
 * `publish_outcome` result to its tagged, versioned `output.presentationMeta`
 * value. The value shapes themselves are client-safe and live in `./types.ts`,
 * importable without this package's host-only runtime.
 */

import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { ScienceOutcomeResultValue } from './publish-outcome.ts'
import type { ScienceArtifactPresentation, ScienceArtifactPresentationItem, ScienceOutcomePresentation } from './types.ts'

export type {
  ScienceArtifactPresentation,
  ScienceArtifactPresentationAttachment,
  ScienceArtifactPresentationItem,
  ScienceOutcomeEvidencePresentation,
  ScienceOutcomePresentation,
} from './types.ts'

/**
 * Project every captured or curated artifact this call names into one
 * tagged presentation value — a `run_python`/`run_r` call passes every file
 * its capture walk produced (possibly none); `annotate_artifact` passes
 * exactly the one curated entry.
 * @param artifacts - the artifacts to reference, in display order.
 * @returns the presentation value persisted as `tool/result.meta`, or `null` when there is nothing to reference.
 */
export function scienceArtifactPresentation(artifacts: readonly ScienceArtifactPresentationItem[]): JsonValue {
  if (artifacts.length === 0) return null
  const presentation: ScienceArtifactPresentation = { kind: 'science/artifact', version: 1, artifacts }
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
