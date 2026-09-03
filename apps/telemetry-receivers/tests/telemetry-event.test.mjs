import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseTelemetryEvent } from '../shared/telemetry-event.mjs'
import { validEvent } from './fixtures.mjs'

const encode = value => new TextEncoder().encode(JSON.stringify(value))

// Mirrors shared/telemetry-event.mjs's own SOURCE_IDS and PHASES, which the
// module does not export.
const SOURCE_IDS = ['tuna', 'ustc', 'official']
const PHASES = ['checking', 'solving', 'installing', 'verifying', 'publishing', 'ready']

function launchEvent() {
  return { ...Object.fromEntries(Object.entries(validEvent).filter(([key]) => !['sourceId', 'durationMs', 'environmentId'].includes(key))), event: 'app.launch' }
}

describe('parseTelemetryEvent', () => {
  it('accepts all three documented event variants', () => {
    assert.deepEqual(parseTelemetryEvent(encode(validEvent)), validEvent)
    const launch = launchEvent()
    assert.deepEqual(parseTelemetryEvent(encode(launch)), launch)
    const failed = {
      ...launch,
      event: 'environment.install-failed',
      sourceId: 'ustc',
      phase: 'installing',
      cancelled: false,
    }
    assert.deepEqual(parseTelemetryEvent(encode(failed)), failed)
  })

  it('accepts win32 alongside darwin as a valid platform', () => {
    const win32Event = { ...validEvent, platform: 'win32', arch: 'x64' }
    assert.deepEqual(parseTelemetryEvent(encode(win32Event)), win32Event)
  })

  it('accepts every documented phase and source id for environment.install-failed', () => {
    const base = { ...launchEvent(), event: 'environment.install-failed', cancelled: false }
    for (const phase of PHASES) {
      assert.notEqual(parseTelemetryEvent(encode({ ...base, phase, sourceId: 'tuna' })), undefined)
    }
    for (const sourceId of SOURCE_IDS) {
      assert.notEqual(parseTelemetryEvent(encode({ ...base, phase: 'installing', sourceId })), undefined)
    }
  })

  it('rejects an unknown phase or source id for environment.install-failed', () => {
    const base = { ...launchEvent(), event: 'environment.install-failed', sourceId: 'tuna', phase: 'installing', cancelled: false }
    assert.equal(parseTelemetryEvent(encode({ ...base, phase: 'downloading' })), undefined)
    assert.equal(parseTelemetryEvent(encode({ ...base, sourceId: 'custom-source' })), undefined)
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
