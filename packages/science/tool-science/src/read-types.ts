/** Science project-library response metadata. */
import type { ScienceArtifactMediaType } from '@deepseek-ai/dsh-science-session/types'

/** Science project-library response metadata. */
export type ScienceContentOrigin = 'run-auto' | 'human-edit' | 'import'

/** Science project-library response metadata. */
export interface ScienceVersionHealthFlags {
  reconstructed?: true
  missingContent?: true
}

/** Science project-library response metadata. */
export interface ScienceLibraryHealth {
  orphan: number
  reconstructed: number
  missingContent: number
}

/** Science project-library response metadata. */
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

/** Science project-library response metadata. */
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
  producer: {
    sessionId: string
    sessionTitle?: string
    runId?: string
    toolCallId?: string
    requestHeaderSeq?: number
    turn?: number
  }
  health?: ScienceVersionHealthFlags
}
