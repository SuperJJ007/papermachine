/**
 * Shared JSON-schema fields and value fields for model-safe Science artifact
 * values, common to `annotate_artifact` and `get_science_state`.
 */

import type { ScienceArtifactVersion } from '@deepseek-ai/dsh-science-session'

/** Identity, curation, source, and media fields shared by the artifact-receipt and state schemas. */
export const scienceArtifactSchemaProperties = {
  artifactId: { type: 'string', required: true },
  logicalName: { type: 'string', required: true },
  version: { type: 'integer', required: true },
  title: { type: 'string', required: true },
  caption: { type: 'string' },
  origin: { type: 'string', enum: ['auto', 'model', 'human-edit'], required: true },
  parent: {
    type: 'object', additionalProperties: false,
    properties: {
      artifactId: { type: 'string', required: true },
      version: { type: 'integer', required: true },
    },
  },
  runId: { type: 'string' },
  mediaType: { type: 'string', required: true },
  bytes: { type: 'integer', required: true },
  width: { type: 'integer' },
  height: { type: 'integer' },
  createdAt: { type: 'integer', required: true },
} as const

/** Value shape `scienceArtifactValueFields` returns, matching `scienceArtifactSchemaProperties` field-for-field. */
export interface ScienceArtifactValueFields {
  readonly artifactId: string
  readonly logicalName: string
  readonly version: number
  readonly title: string
  readonly caption?: string
  readonly origin: ScienceArtifactVersion['origin']
  readonly parent?: { readonly artifactId: string; readonly version: number }
  readonly runId?: string
  readonly mediaType: string
  readonly bytes: number
  readonly width?: number
  readonly height?: number
  readonly createdAt: number
}

/**
 * Flatten one durable artifact version's identity, curation, source, and
 * media fields, matching `scienceArtifactSchemaProperties` field-for-field.
 * The artifact-receipt (`annotate-artifact.ts`) and state (`state.ts`) value
 * builders each spread this and add their own remaining fields —
 * `attachmentId`/`attachmentName` for the receipt, `environmentRevision`/
 * `environmentFingerprintPreview` for state.
 * @param artifact - the durable artifact version to flatten.
 * @returns the shared value fields, `width`/`height` present only for an image attachment.
 */
export function scienceArtifactValueFields(artifact: ScienceArtifactVersion): ScienceArtifactValueFields {
  const { attachment } = artifact
  const isImage = 'width' in attachment
  return {
    artifactId: String(artifact.artifactId),
    logicalName: artifact.logicalName,
    version: artifact.version,
    title: artifact.title,
    ...artifact.caption === undefined ? {} : { caption: artifact.caption },
    origin: artifact.origin,
    ...artifact.parent === undefined ? {} : {
      parent: { artifactId: String(artifact.parent.artifactId), version: artifact.parent.version },
    },
    ...artifact.origin === 'human-edit' ? {} : { runId: String(artifact.runId) },
    mediaType: attachment.mediaType,
    bytes: attachment.bytes,
    ...isImage ? { width: attachment.width, height: attachment.height } : {},
    createdAt: artifact.createdAt,
  }
}
