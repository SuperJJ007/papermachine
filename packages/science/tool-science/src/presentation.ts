/**
 * Projections from a canonical `run_python`/`run_r` or `annotate_artifact`
 * result to its tagged, versioned `output.presentationMeta`
 * value. The value shapes themselves are client-safe and live in `./types.ts`,
 * importable without this package's host-only runtime.
 */

import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { ScienceArtifactPresentation, ScienceArtifactPresentationItem } from './types.ts'

export type {
  ScienceArtifactPresentation,
  ScienceArtifactPresentationContent,
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
  const presentation: ScienceArtifactPresentation = { kind: 'science/artifact', version: 2, artifacts }
  return presentation as unknown as JsonValue
}
