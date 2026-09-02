/** Build-time desktop Host configuration: closed record, `schemaVersion: 1`. */

/** Parsed `resources/host.json` settings for persisted Host diagnostics. */
export interface DesktopHostConfig {
  readonly schemaVersion: 1
  /** Maximum bytes retained in the active `host.log` file. */
  readonly logMaxBytes: number
  /** Number of rotated `host.log.N` files retained beside the active log. */
  readonly logMaxRotatedFiles: number
}

const FIELDS = ['schemaVersion', 'logMaxBytes', 'logMaxRotatedFiles'] as const

/** Schema ceiling also used to prune rotations left by a formerly larger config. */
export const MAX_HOST_LOG_ROTATED_FILES = 20

/** Require one safe integer within a closed range. */
function boundedInteger(value: unknown, field: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`desktop host config: ${field} must be a safe integer from ${String(minimum)} through ${String(maximum)}`)
  }
  return value as number
}

/**
 * Parse an untrusted JSON value into a {@link DesktopHostConfig}.
 * @param value - parsed `resources/host.json` content.
 * @returns validated Host diagnostic settings.
 * @throws when the record is open, uses another schema version, or carries an out-of-range logging bound.
 */
export function parseDesktopHostConfig(value: unknown): DesktopHostConfig {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('desktop host config: must be a record')
  }
  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (!(FIELDS as readonly string[]).includes(key)) throw new Error(`desktop host config: unknown field ${key}`)
  }
  if (record.schemaVersion !== 1) throw new Error('desktop host config: schemaVersion must be 1')
  return {
    schemaVersion: 1,
    logMaxBytes: boundedInteger(record.logMaxBytes, 'logMaxBytes', 1_024, 50 * 1024 * 1024),
    logMaxRotatedFiles: boundedInteger(record.logMaxRotatedFiles, 'logMaxRotatedFiles', 1, MAX_HOST_LOG_ROTATED_FILES),
  }
}
