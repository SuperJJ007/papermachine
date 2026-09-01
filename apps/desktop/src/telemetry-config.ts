/** Build-time telemetry endpoint configuration: closed record, `schemaVersion: 1`. */

import { HTTPS_URL } from './https-url.ts'

/** Parsed `resources/telemetry.json`: the receivers every telemetry event is dual-written to. */
export interface TelemetryConfig {
  readonly schemaVersion: 1
  /**
   * Every configured receiver, sent to independently (no failover, no
   * stop-at-first-success). An empty array is the valid "telemetry off"
   * state — distinct from a missing or unparseable file, which is a loud
   * configuration error (see {@link parseTelemetryConfig}).
   */
  readonly endpoints: readonly string[]
}

const FIELDS = ['schemaVersion', 'endpoints'] as const

/**
 * Parse an untrusted JSON value into a {@link TelemetryConfig}. A missing or
 * unparseable `telemetry.json` must reach the caller as a thrown error —
 * never a silent fallback to "telemetry off" — so a broken build ships
 * loudly rather than quietly stops reporting.
 * @param value - the parsed JSON content of `resources/telemetry.json`.
 * @throws when the record has an unknown field, the wrong `schemaVersion`,
 *   or an `endpoints` entry that is not a strict `https://` URL.
 */
export function parseTelemetryConfig(value: unknown): TelemetryConfig {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('desktop telemetry config: must be a record')
  }
  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (!(FIELDS as readonly string[]).includes(key)) throw new Error(`desktop telemetry config: unknown field ${key}`)
  }
  if (record.schemaVersion !== 1) throw new Error('desktop telemetry config: schemaVersion must be 1')
  const endpoints = record.endpoints
  if (!Array.isArray(endpoints) || endpoints.some((item: unknown) => typeof item !== 'string')) {
    throw new Error('desktop telemetry config: endpoints must be a string array')
  }
  const strings = endpoints as string[]
  if (strings.some(endpoint => !HTTPS_URL.test(endpoint))) {
    throw new Error('desktop telemetry config: every endpoint must be a strict https:// URL')
  }
  return { schemaVersion: 1, endpoints: strings }
}
