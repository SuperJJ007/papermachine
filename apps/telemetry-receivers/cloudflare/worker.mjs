/** Cloudflare Worker receiver backed by a D1 binding named `DB`. */

import { MAX_BODY_BYTES, parseTelemetryEvent } from '../shared/telemetry-event.mjs'

const INSERT_EVENT_SQL = `
  INSERT OR IGNORE INTO events (
    event_id,
    anonymous_id,
    event,
    timestamp,
    app_version,
    platform,
    arch,
    schema_version,
    source_id,
    duration_ms,
    environment_id,
    phase,
    cancelled,
    received_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`

function emptyResponse(status, headers = undefined) {
  return new Response(null, { status, headers })
}

async function readLimitedBody(request) {
  const declaredLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return undefined
  if (request.body === null) return new Uint8Array()

  const reader = request.body.getReader()
  const chunks = []
  let byteLength = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    byteLength += value.byteLength
    if (byteLength > MAX_BODY_BYTES) {
      // The oversize response must return regardless of whether the runtime
      // can actually cancel the in-flight read; a cancel failure here is not
      // actionable and must not turn a 413 into an unhandled rejection.
      void reader.cancel().catch(() => {})
      return undefined
    }
    chunks.push(value)
  }
  const bodyBytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bodyBytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bodyBytes
}

function nullableEventField(event, field) {
  return field in event ? event[field] : null
}

async function insertEvent(database, event) {
  const cancelled = event.event === 'environment.install-failed'
    ? (event.cancelled ? 1 : 0)
    : null
  await database.prepare(INSERT_EVENT_SQL).bind(
    event.eventId,
    event.anonymousId,
    event.event,
    event.timestamp,
    event.appVersion,
    event.platform,
    event.arch,
    event.schemaVersion,
    nullableEventField(event, 'sourceId'),
    nullableEventField(event, 'durationMs'),
    nullableEventField(event, 'environmentId'),
    nullableEventField(event, 'phase'),
    cancelled,
    new Date().toISOString(),
  ).run()
}

export default {
  /**
   * Receive one anonymous telemetry event without logging request metadata.
   * @param {Request} request - Worker request.
   * @param {{ DB: import('@cloudflare/workers-types').D1Database }} env - Worker bindings.
   * @returns {Promise<Response>} Empty 204, 400, 405, 413, or 500 response.
   */
  async fetch(request, env) {
    if (request.method !== 'POST') return emptyResponse(405, { allow: 'POST' })

    let bodyBytes
    try {
      bodyBytes = await readLimitedBody(request)
    } catch {
      return emptyResponse(400)
    }
    if (bodyBytes === undefined) return emptyResponse(413)
    const event = parseTelemetryEvent(bodyBytes)
    if (event === undefined) return emptyResponse(400)

    try {
      await insertEvent(env.DB, event)
    } catch {
      return emptyResponse(500)
    }
    return emptyResponse(204)
  },
}
