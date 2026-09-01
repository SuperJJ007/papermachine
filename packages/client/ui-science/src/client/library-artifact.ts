/** Project-library metadata retained for open artifact previews. */
import type { ScienceArtifactMediaType } from '@deepseek-ai/dsh-science-session/types'

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
