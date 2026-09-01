/** Error vocabulary for the project artifact store. */

/** Discriminant for {@link ProjectArtifactStoreError}. */
export type ProjectArtifactStoreErrorCode =
  | 'SCHEMA_UPGRADE_UNAVAILABLE'
  | 'SCHEMA_VERSION_NEWER'
  | 'INVALID_MARKER'
  | 'ARTIFACT_NOT_FOUND'
  | 'VERSION_NOT_FOUND'
  | 'NOTE_NOT_FOUND'
  | 'LOGICAL_NAME_CONFLICT'
  | 'BLOB_NOT_FOUND'
  | 'BLOB_CORRUPT'

/** Thrown for every failure this package owns: a stable `code` names the failure kind. */
export class ProjectArtifactStoreError extends Error {
  /**
   * @param message - human-readable diagnostic.
   * @param code - stable failure discriminant.
   * @param options - standard `Error` options (`cause`).
   */
  constructor(message: string, readonly code: ProjectArtifactStoreErrorCode, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ProjectArtifactStoreError'
  }
}
