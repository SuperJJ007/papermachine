import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseTelemetryEvent } from '../shared/telemetry-event.mjs'
import { validEvent } from './fixtures.mjs'

const encode = value => new TextEncoder().encode(JSON.stringify(value))

describe('parseTelemetryEvent', () => {
  it('accepts all three documented event variants', () => {
    assert.deepEqual(parseTelemetryEvent(encode(validEvent)), validEvent)
    const launch = Object.fromEntries(Object.entries(validEvent).filter(([key]) => !['sourceId', 'durationMs', 'environmentId'].includes(key)))
    launch.event = 'app.launch'
    assert.deepEqual(parseTelemetryEvent(encode(launch)), launch)
    const failed = {
      ...launch,
      event: 'environment.install-failed',
      sourceId: 'custom-source',
      phase: 'installing',
      cancelled: false,
    }
    assert.deepEqual(parseTelemetryEvent(encode(failed)), failed)
  })

  it('accepts win32 alongside darwin as a valid platform', () => {
    const win32Event = { ...validEvent, platform: 'win32', arch: 'x64' }
    assert.deepEqual(parseTelemetryEvent(encode(win32Event)), win32Event)
  })

  it('rejects invalid JSON, UUIDs, event names, schemas, variants, and unknown fields', () => {
    assert.equal(parseTelemetryEvent(new TextEncoder().encode('{')), undefined)
    for (const patch of [
      { eventId: 'not-a-uuid' },
      { anonymousId: 'not-a-uuid' },
      { event: 'unknown' },
      { event: '__proto__' },
      { schemaVersion: 2 },
      { platform: 'linux' },
      { arch: 'ia32' },
      { sourceId: 'custom-source' },
      { extra: 'must not be logged' },
    ]) {
      assert.equal(parseTelemetryEvent(encode({ ...validEvent, ...patch })), undefined)
    }
  })
})
