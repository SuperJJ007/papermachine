/** Branded identities owned by the project artifact store. */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one project's durable artifact store across its lifetime. */
export type ProjectId = Branded<'ScienceProjectId'>

/** Identifies one logical artifact across its immutable versions. */
export type ArtifactId = Branded<'ScienceStoreArtifactId'>

/** Identifies one immutable artifact version. */
export type VersionId = Branded<'ScienceStoreVersionId'>

/** Identifies one row in `version_annotations`: one metadata edit, appended never updated. */
export type AnnotationId = Branded<'ScienceStoreAnnotationId'>

/** Identifies one row in `artifact_notes`: one user-authored note on an artifact. */
export type NoteId = Branded<'ScienceStoreNoteId'>

/**
 * Brand a generated project identifier.
 * @param value - generated identifier.
 * @returns the same string with its project brand.
 */
export function ProjectId(value: string): ProjectId {
  return value as ProjectId
}

/**
 * Brand a generated artifact identifier.
 * @param value - generated identifier.
 * @returns the same string with its artifact brand.
 */
export function ArtifactId(value: string): ArtifactId {
  return value as ArtifactId
}

/**
 * Brand a generated version identifier.
 * @param value - generated identifier.
 * @returns the same string with its version brand.
 */
export function VersionId(value: string): VersionId {
  return value as VersionId
}

/**
 * Brand a generated annotation identifier.
 * @param value - generated identifier.
 * @returns the same string with its annotation brand.
 */
export function AnnotationId(value: string): AnnotationId {
  return value as AnnotationId
}

/**
 * Brand a generated note identifier.
 * @param value - generated identifier.
 * @returns the same string with its note brand.
 */
export function NoteId(value: string): NoteId {
  return value as NoteId
}
