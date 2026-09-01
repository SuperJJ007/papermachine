/**
 * Shared JSON-schema fields and value fields for model-safe Science artifact
 * values, common to `annotate_artifact`, `run_python`/`run_r`, and
 * `get_science_state`.
 */

import type { ContentOrigin, VersionRecord } from '@deepseek-ai/dsh-science-artifact-store'
import type { ScienceArtifactVersion } from '@deepseek-ai/dsh-science-session'

/**
 * Identity, curation, and media fields shared by the artifact-receipt and
 * state schemas. `contentOrigin` and `curated` are the only two store-owned
 * provenance facts the model face exposes — never the store's internal
 * `versionId`/`sha256`/`projectId`/annotation-actor detail (`packages/AGENTS.md`).
 */
export const scienceArtifactSchemaProperties = {
  artifactId: { type: 'string', required: true },
  logicalName: { type: 'string', required: true },
  version: { type: 'integer', required: true },
  title: { type: 'string', required: true },
  caption: { type: 'string' },
  contentOrigin: { type: 'string', enum: ['run-auto', 'human-edit', 'import'], required: true },
  curated: { type: 'boolean', required: true },
  mediaType: { type: 'string', required: true },
  bytes: { type: 'integer', required: true },
  seenAt: { type: 'integer', required: true },
} as const

/** Value shape `scienceArtifactValueFields` returns, matching `scienceArtifactSchemaProperties` field-for-field. */
export interface ScienceArtifactValueFields {
  readonly artifactId: string
  readonly logicalName: string
  readonly version: number
  readonly title: string
  readonly caption?: string
  readonly contentOrigin: ContentOrigin
  readonly curated: boolean
  readonly mediaType: string
  readonly bytes: number
  readonly seenAt: number
}

/**
 * Read one artifact version's current store version row, keyed by the exact
 * store reference the session-level artifact names. Shared by every
 * model-facing artifact listing (`run_python`/`run_r`, `annotate_artifact`,
 * `get_science_state`) that resolves `contentOrigin`/`curated`/media facts
 * from the store.
 * @param artifact - the session-visible artifact version to resolve.
 * @returns the store's current version row.
 */
export type ResolveArtifactStoreVersion = (artifact: ScienceArtifactVersion) => Promise<VersionRecord>

/**
 * Flatten one durable artifact version's model-safe identity, curation, and
 * media fields, matching `scienceArtifactSchemaProperties` field-for-field.
 * `artifact` supplies the session's own presentation snapshot (title/caption
 * as the model saw them, and `seenAt`); `store` supplies the store's current
 * version row — the sole authority for `contentOrigin`/media/curation status
 * since the T1/T2 artifact-authority migration.
 * @param artifact - the session-visible artifact version (presentation snapshot).
 * @param store - the store's current version row for `artifact.versionId`.
 * @returns the shared value fields.
 */
export function scienceArtifactValueFields(artifact: ScienceArtifactVersion, store: VersionRecord): ScienceArtifactValueFields {
  return {
    artifactId: String(artifact.artifactId),
    logicalName: artifact.logicalName,
    version: artifact.version,
    title: artifact.title,
    ...artifact.caption === undefined ? {} : { caption: artifact.caption },
    contentOrigin: store.contentOrigin,
    curated: store.latestAnnotation !== undefined && store.latestAnnotation.actor !== 'capture',
    mediaType: store.mediaType,
    bytes: store.byteCount,
    seenAt: artifact.seenAt,
  }
}
