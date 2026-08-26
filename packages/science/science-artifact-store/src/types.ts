/** Public record and input types for the project artifact store. */

import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ArtifactId, ProjectId, VersionId } from './ids.ts'

/** How one version's bytes came to exist. */
export type ArtifactVersionOrigin = 'auto' | 'model' | 'human-edit'

/** One logical artifact: stable identity, owning project, and its current latest version. */
export interface ArtifactRecord {
  readonly artifactId: ArtifactId
  readonly owningProjectId: ProjectId
  /** The session that created this artifact's first version. */
  readonly originSessionId: SessionId
  readonly logicalName: string
  readonly latestVersionId: VersionId
  readonly createdAt: number
}

/** One immutable artifact version: content, provenance, and curated metadata. */
export interface VersionRecord {
  readonly versionId: VersionId
  readonly artifactId: ArtifactId
  /** Contiguous 1-based position among this artifact's versions. */
  readonly ordinal: number
  /**
   * The version this one descends from. May name a version of a DIFFERENT
   * artifact (an explicit `editBaselines` branch point); `undefined` only for
   * an artifact's first version.
   */
  readonly parentVersionId: VersionId | undefined
  readonly sha256: string
  readonly mediaType: string
  readonly byteCount: number
  readonly origin: ArtifactVersionOrigin
  readonly title: string | undefined
  readonly caption: string | undefined
  /** The session that produced this version — never the store's cascade boundary. */
  readonly producerSessionId: SessionId
  readonly producerRunId: string | undefined
  readonly producerToolCallId: string | undefined
  readonly producerRequestHeaderSeq: number | undefined
  readonly environmentRevision: string | undefined
  readonly environmentFingerprintPreview: string | undefined
  readonly createdAt: number
}

/** Input to `createArtifact`: bytes plus the first version's provenance and metadata. */
export interface CreateArtifactInput {
  readonly logicalName: string
  readonly originSessionId: SessionId
  readonly data: Uint8Array
  readonly mediaType: string
  readonly origin: ArtifactVersionOrigin
  readonly title?: string
  readonly caption?: string
  readonly producerRunId?: string
  readonly producerToolCallId?: string
  readonly producerRequestHeaderSeq?: number
  readonly environmentRevision?: string
  readonly environmentFingerprintPreview?: string
}

/** Input to `appendVersion`: bytes plus the new version's provenance and metadata. */
export interface AppendVersionInput {
  readonly producerSessionId: SessionId
  readonly data: Uint8Array
  readonly mediaType: string
  readonly origin: ArtifactVersionOrigin
  readonly title?: string
  readonly caption?: string
  /**
   * Explicit parent, naming a branch point instead of the artifact's current
   * latest version. May name a version of a different artifact. Omitted
   * appends onto the artifact's current latest version.
   */
  readonly editBaselines?: VersionId
  readonly producerRunId?: string
  readonly producerToolCallId?: string
  readonly producerRequestHeaderSeq?: number
  readonly environmentRevision?: string
  readonly environmentFingerprintPreview?: string
}

/** Metadata-only patch applied in place to the named version; bytes and ordinal never change. */
export interface AnnotateVersionInput {
  readonly title?: string
  readonly caption?: string
  readonly origin?: ArtifactVersionOrigin
}

/** How `openProject` resolved workspace identity for this call. */
export type ProjectIdentityOutcome = 'created' | 'reopened' | 'moved' | 'copied'

/** Result of resolving and opening a project for a workspace directory. */
export interface OpenedProject {
  readonly projectId: ProjectId
  /** Absolute path to this project's store directory under the harness home. */
  readonly storeRoot: string
  /** Canonicalized workspace path this call resolved against. */
  readonly workspacePath: string
  readonly outcome: ProjectIdentityOutcome
}
