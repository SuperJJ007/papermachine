import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseDesktopHostConfig } from '../src/host-config.ts'

const resources = join(import.meta.dirname, '../resources')

describe('parseDesktopHostConfig', () => {
  it('accepts the shipped private-log bounds', async () => {
    const raw = JSON.parse(await readFile(join(resources, 'host.json'), 'utf8')) as unknown
    expect(parseDesktopHostConfig(raw)).toEqual({
      schemaVersion: 1,
      logMaxBytes: 5 * 1024 * 1024,
      logMaxRotatedFiles: 2,
    })
  })

  it('rejects open, malformed, and out-of-range records', () => {
    expect(() => parseDesktopHostConfig(null)).toThrow(/must be a record/)
    expect(() => parseDesktopHostConfig({ schemaVersion: 2, logMaxBytes: 1024, logMaxRotatedFiles: 1 }))
      .toThrow(/schemaVersion must be 1/)
    expect(() => parseDesktopHostConfig({ schemaVersion: 1, logMaxBytes: 1024, logMaxRotatedFiles: 1, extra: true }))
      .toThrow(/unknown field/)
    expect(() => parseDesktopHostConfig({ schemaVersion: 1, logMaxBytes: 1023, logMaxRotatedFiles: 1 }))
      .toThrow(/logMaxBytes/)
    expect(() => parseDesktopHostConfig({ schemaVersion: 1, logMaxBytes: 1024, logMaxRotatedFiles: 0 }))
      .toThrow(/logMaxRotatedFiles/)
  })
})
