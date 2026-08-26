import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseEnvironmentDeclaration } from '../src/environment-declaration.ts'

const resources = join(import.meta.dirname, '../resources/environments')

describe('desktop environment declarations', () => {
  for (const name of ['social-science', 'biology']) {
    it(`accepts the shipped ${name} declaration`, async () => {
      const parsed = parseEnvironmentDeclaration(JSON.parse(await readFile(join(resources, `${name}.json`), 'utf8')))
      expect(parsed.id).toBe(name)
      expect(parsed.healthChecks.map(check => check.language)).toEqual(['python', 'r'])
    })
  }

  it('rejects executable hooks and incomplete interpreter checks', () => {
    expect(() => parseEnvironmentDeclaration({
      schemaVersion: 1,
      id: 'unsafe',
      revision: '2026.08.1',
      name: 'Unsafe',
      supportedPlatforms: ['darwin-arm64'],
      channels: ['conda-forge'],
      packages: ['python=3.13'],
      estimatedDownloadBytes: 1,
      requiredFreeBytes: 1,
      timeoutMs: 1,
      healthChecks: [],
      postInstall: './run-me',
    })).toThrow('unknown field postInstall')
  })
})
