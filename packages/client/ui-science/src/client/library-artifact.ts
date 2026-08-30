/** Project-library metadata retained for open artifact previews. */
import type { ScienceArtifactMediaType } from '@deepseek-ai/dsh-science-session/types'

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
  }
}
