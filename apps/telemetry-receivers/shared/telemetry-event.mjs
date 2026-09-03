/** Validation shared by both telemetry receivers. */

/** Request body byte ceiling. Both receivers stop buffering a request body once it exceeds this and return `413` without JSON-parsing it. */
export const MAX_BODY_BYTES = 8 * 1024

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const ISO_8601_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u
// The package sources the shipped environment declaration ships, matching
// apps/desktop/src/environment-declaration.ts's shipped source ids.
const SOURCE_IDS = ['tuna', 'ustc', 'official']
// Equal to ProvisioningProgress['phase'] in apps/desktop/src/provisioning.ts.
const PHASES = ['checking', 'solving', 'installing', 'verifying', 'publishing', 'ready']
const COMMON_KEYS = [
  'anonymousId',
  'appVersion',
  'arch',
  'event',
  'eventId',
  'platform',
  'schemaVersion',
  'timestamp',
]
const EVENT_KEYS = {
  'app.launch': COMMON_KEYS,
  'environment.installed': [...COMMON_KEYS, 'durationMs', 'environmentId', 'sourceId'],
  'environment.install-failed': [...COMMON_KEYS, 'cancelled', 'phase', 'sourceId'],
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0
}

function isValidSourceId(value) {
  return SOURCE_IDS.includes(value)
}

function hasExactKeys(value, expectedKeys) {
  const actualKeys = Object.keys(value).sort()
  const sortedExpectedKeys = [...expectedKeys].sort()
  return actualKeys.length === sortedExpectedKeys.length
    && actualKeys.every((key, index) => key === sortedExpectedKeys[index])
}

function hasValidCommonFields(value) {
  return UUID_PATTERN.test(value.eventId)
    && UUID_PATTERN.test(value.anonymousId)
    && isNonEmptyString(value.timestamp)
    && ISO_8601_PATTERN.test(value.timestamp)
    && !Number.isNaN(Date.parse(value.timestamp))
    && isNonEmptyString(value.appVersion)
    && (value.platform === 'darwin' || value.platform === 'win32')
    && (value.arch === 'arm64' || value.arch === 'x64')
    && value.schemaVersion === 1
}

/**
 * Parse and validate one telemetry request body.
 * Unknown fields are rejected so the Aliyun receiver never writes accidental
 * content or identifiers outside the documented event fields to SLS.
 * @param {Uint8Array} bodyBytes - Complete request body, already limited to {@link MAX_BODY_BYTES}.
 * @returns {Record<string, unknown> | undefined} The validated event, or `undefined` for a 400 response.
 */
export function parseTelemetryEvent(bodyBytes) {
  let value
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bodyBytes)
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!isRecord(value)) return undefined
  if (typeof value.event !== 'string' || !Object.hasOwn(EVENT_KEYS, value.event)) return undefined
  const expectedKeys = EVENT_KEYS[value.event]
  if (!hasExactKeys(value, expectedKeys) || !hasValidCommonFields(value)) return undefined

  switch (value.event) {
    case 'app.launch':
      return value
    case 'environment.installed':
      if (!isValidSourceId(value.sourceId)
        || typeof value.durationMs !== 'number'
        || !Number.isFinite(value.durationMs)
        || value.durationMs < 0
        || (value.environmentId !== 'general' && value.environmentId !== 'custom')) return undefined
      return value
    case 'environment.install-failed':
      if (!isValidSourceId(value.sourceId)
        || !PHASES.includes(value.phase)
        || typeof value.cancelled !== 'boolean') return undefined
      return value
    default:
      return undefined
  }
}
