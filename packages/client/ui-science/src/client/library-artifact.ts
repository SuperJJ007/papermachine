/** Project-library metadata retained for open artifact previews. */
import type { ScienceArtifactMediaType } from '@deepseek-ai/dsh-science-session/types'

/**
 * How one version's bytes came to exist, mirrors `dsh-host-apiproxy`'s
 * `ScienceContentOrigin` field-for-field. Redeclared here rather than
 * imported for the same browser-bundle-purity reason as the other types in
 * this file: `ui-science` depends on `dsh-client-runtime` for the RPC
 * surface, never directly on `dsh-host-apiproxy`.
 */
export type ScienceContentOrigin = 'run-auto' | 'human-edit' | 'import'

/**
 * Reconciliation flags for one project artifact's `latest` version, mirrors
 * `dsh-host-apiproxy`'s `ScienceVersionHealthFlags`. Each flag is `true`
 * (never `false`); an absent flag means that condition does not hold.
 * `orphan` is deliberately never included — see the Files-panel banner's own
 * `orphan`-is-never-surfaced rule in the package README.
 */
export interface ScienceVersionHealthFlags {
  reconstructed?: true
  missingContent?: true
}

/**
 * Project-wide store↔session reconciliation counts on the `scienceLibrary`
 * response, mirrors `dsh-host-apiproxy`'s `ScienceLibraryHealth`. `orphan` is
 * a count only: the Files-panel banner never surfaces it.
 */
export interface ScienceLibraryHealth {
  orphan: number
  reconstructed: number
  missingContent: number
}

/** Exact library record selected for a read-only artifact tab. */
export interface ScienceLibraryArtifact {
  artifactId: string
  logicalName: string
  title?: string
  caption?: string
  originSessionId: string
  originSessionTitle?: string
  latest: {
    versionId: string
    ordinal: number
    mediaType: ScienceArtifactMediaType
    byteCount: number
    createdAt: number
    health?: ScienceVersionHealthFlags
  }
}

/**
 * One project-store artifact version's current library facts, mirrors
 * `dsh-host-apiproxy`'s `ScienceVersionSummary` field-for-field: the exact
 * metadata a Files-panel row, a detail-panel toolbar, or a version stepper
 * entry renders, read fresh from the store through `sessions.scienceVersions`
 * rather than echoed from a session-log snapshot taken when the version was
 * captured (D9 — see `version-summaries.ts`).
 */
export interface ScienceVersionSummary {
  versionId: string
  artifactId: string
  logicalName: string
  ordinal: number
  title?: string
  caption?: string
  contentOrigin: ScienceContentOrigin
  createdAt: number
  mediaType: string
  byteCount: number
  health?: ScienceVersionHealthFlags
}
