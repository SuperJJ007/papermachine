/**
 * Same-turn intermediate-draft folding (C2). A run sometimes renders a
 * chart, self-checks it with `read_image`, and re-renders a fixed version in
 * the same turn before curating a title — both versions are genuinely
 * different bytes, so neither is a dead artifact, but the earlier one reads
 * to a user as a stray near-duplicate of the one right after it. This module
 * decides which versions of one artifact are that earlier, superseded-
 * within-the-turn kind: a version is a same-turn intermediate draft when a
 * strictly later version of the same artifact shares both its authorizing
 * turn and its producing session. `turn` alone is a per-session counter, so
 * the comparison also requires the same `producerSessionId`. A human-edit
 * version, or a version with no authorizing turn, is never a candidate.
 */

import type { ScienceContentOrigin } from './library-artifact.ts'

/** The fields this module needs from one artifact version, whatever its concrete type. */
export interface ScienceIntermediateVersionFact {
  readonly version: number
  readonly origin: ScienceContentOrigin
  /** The session that produced this version; turn numbers are only comparable within the same producing session. */
  readonly producerSessionId: string
  /** The producer's turn; an absent value keeps the version visible. */
  readonly turn?: number
}

/**
 * Resolve which versions in one artifact's version list are same-turn
 * intermediate drafts.
 * @param versions - every version of one artifact (any order).
 * @returns the version numbers that are same-turn intermediate drafts.
 */
export function foldIntermediateVersions(
  versions: readonly ScienceIntermediateVersionFact[],
): ReadonlySet<number> {
  const intermediate = new Set<number>()
  for (const candidate of versions) {
    if (candidate.origin === 'human-edit' || candidate.turn === undefined) continue
    const supersededInTurn = versions.some(other =>
      other.turn === candidate.turn
      && other.producerSessionId === candidate.producerSessionId
      && other.version > candidate.version,
    )
    if (supersededInTurn) intermediate.add(candidate.version)
  }
  return intermediate
}
