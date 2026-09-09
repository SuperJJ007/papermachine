/**
 * The artifact-level display name shared by every surface that names an
 * artifact outside a version-scoped detail: the library card, the viewer
 * header, the tab label, and the composer chip (C1). Always the latest
 * known version's curated title (or its logical name, when a title is
 * ever empty) — never the exact open, referenced, or emitted version's own
 * title, so the shown name stays fixed as a user steps between versions;
 * only the version badge and origin marker change. The provenance drill-in
 * and trace rows are exempt by design: they name the exact version they
 * describe.
 */

/** The fields this module needs from one artifact version, whatever its concrete type. */
export interface ScienceDisplayTitleFact {
  readonly artifactId: string
  readonly version: number
  readonly title: string
  readonly logicalName: string
}

/**
 * Resolve one artifact's display name from every version fact available for it.
 * @param facts - version facts for any number of artifacts (only the matching `artifactId` is considered).
 * @param artifactId - the artifact whose display name to resolve.
 * @returns the latest version's title (or logical name, if that title is empty), or `undefined` if no fact matches.
 */
export function scienceArtifactDisplayTitle(
  facts: readonly ScienceDisplayTitleFact[], artifactId: string,
): string | undefined {
  let latest: ScienceDisplayTitleFact | undefined
  for (const fact of facts) {
    if (fact.artifactId !== artifactId) continue
    if (latest === undefined || fact.version > latest.version) latest = fact
  }
  if (latest === undefined) return undefined
  return latest.title !== '' ? latest.title : latest.logicalName
}

/**
 * {@link scienceArtifactDisplayTitle}, for a caller that already holds one
 * exact version of the target artifact (`self`) to seed and fall back to —
 * the artifact viewer toolbar and its provenance breadcrumb, which always
 * render an already-resolved exact version and so never need the bare
 * function's `undefined` case. Never returns `undefined`.
 * @param facts - version facts for any number of artifacts (only the matching `artifactId` is considered).
 * @param self - one already-known exact version of the target artifact.
 * @returns the latest version's title between `facts` and `self` (or its logical name, if that title is empty).
 */
export function scienceArtifactDisplayTitleOrSelf(
  facts: readonly ScienceDisplayTitleFact[], self: ScienceDisplayTitleFact,
): string {
  let latest = self
  for (const fact of facts) {
    if (fact.artifactId !== self.artifactId) continue
    if (fact.version > latest.version) latest = fact
  }
  return latest.title !== '' ? latest.title : latest.logicalName
}
