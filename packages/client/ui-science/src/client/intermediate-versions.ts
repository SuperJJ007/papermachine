/**
 * Same-turn intermediate-draft folding (C2). The model sometimes renders a
 * chart, self-checks it with `read_image`, and re-renders a fixed version in
 * the same turn before curating a title — both versions are genuinely
 * different bytes, so neither is a dead artifact, but the earlier one reads
 * to a user as a stray near-duplicate of the one right after it. This module
 * decides which versions of one artifact are that earlier, superseded-within-
 * the-turn kind: a version is a same-turn intermediate draft when a strictly
 * later version of the same artifact shares its authorizing turn. A
 * human-edit version (no authorizing turn) is never a candidate.
 */

/** The fields this module needs from one artifact version, whatever its concrete type. */
export interface ScienceIntermediateVersionFact {
  readonly version: number
  readonly origin: 'auto' | 'model' | 'human-edit'
  /** The authorizing tool call's turn; absent on a human-edit version. */
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
    const supersededInTurn = versions.some(other => other.turn === candidate.turn && other.version > candidate.version)
    if (supersededInTurn) intermediate.add(candidate.version)
  }
  return intermediate
}
