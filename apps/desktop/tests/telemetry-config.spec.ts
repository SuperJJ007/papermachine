import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseTelemetryConfig } from '../src/telemetry-config.ts'

const resources = join(import.meta.dirname, '../resources')

describe('parseTelemetryConfig', () => {
  it('accepts an empty endpoints array — the valid "telemetry off" state', () => {
    expect(parseTelemetryConfig({ schemaVersion: 1, endpoints: [] })).toEqual({ schemaVersion: 1, endpoints: [] })
  })

  it('accepts the three shipped-style receiver URLs', () => {
    const endpoints = [
      'https://telemetry.papermachine.workers.dev/v1/events',
      'https://cn-hk.papermachine.example.com/v1/events',
      'https://a.example/x',
    ]
    expect(parseTelemetryConfig({ schemaVersion: 1, endpoints }).endpoints).toEqual(endpoints)
  })

  it('rejects a schemaVersion other than 1', () => {
    expect(() => parseTelemetryConfig({ schemaVersion: 2, endpoints: [] })).toThrow(/schemaVersion must be 1/)
  })

  it('rejects an unknown field', () => {
    expect(() => parseTelemetryConfig({ schemaVersion: 1, endpoints: [], extra: true })).toThrow(/unknown field/)
  })

  it('rejects a non-record value', () => {
    expect(() => parseTelemetryConfig(null)).toThrow(/must be a record/)
    expect(() => parseTelemetryConfig(['x'])).toThrow(/must be a record/)
  })

  it('rejects an endpoints entry that is not a string', () => {
    expect(() => parseTelemetryConfig({ schemaVersion: 1, endpoints: [1] })).toThrow(/must be a string array/)
  })

  it('rejects a non-https endpoint URL', () => {
    expect(() => parseTelemetryConfig({ schemaVersion: 1, endpoints: ['http://a.example/x'] }))
      .toThrow(/strict https:\/\/ URL/)
  })

  it('rejects an endpoint URL carrying a shell metacharacter or whitespace, as would reach a parser boundary unescaped', () => {
    for (const hostile of [
      'https://a.example/x; rm -rf /',
      'https://a.example/x$(whoami)',
      'https://a.example/x`id`',
      'https://a.example/x with space',
      'https://a.example/x\nrm -rf /',
    ]) {
      expect(() => parseTelemetryConfig({ schemaVersion: 1, endpoints: [hostile] })).toThrow(/strict https:\/\/ URL/)
    }
  })

  it('parses the shipped resources/telemetry.json, shipping with telemetry off by default', async () => {
    const raw = JSON.parse(await readFile(join(resources, 'telemetry.json'), 'utf8')) as unknown
    expect(parseTelemetryConfig(raw)).toEqual({ schemaVersion: 1, endpoints: [] })
  })
})
