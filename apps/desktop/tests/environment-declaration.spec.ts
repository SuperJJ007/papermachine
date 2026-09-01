import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseEnvironmentDeclaration } from '../src/environment-declaration.ts'

const resources = join(import.meta.dirname, '../resources/environments')

describe('desktop environment declarations', () => {
  it('accepts the shipped general declaration', async () => {
    const parsed = parseEnvironmentDeclaration(JSON.parse(await readFile(join(resources, 'general.json'), 'utf8')))
    expect(parsed.id).toBe('general')
    expect(parsed.healthChecks.map(check => check.language)).toEqual(['python', 'r'])
  })

  // The kernel's R chart capture calls ggplot2 directly
  // (`packages/science/science-runtime/assets/chart_ggplot2.R`), and both
  // interpreters have to exist for a provisioned prefix to bind, so these
  // three are requirements of the product rather than a package preference.
  it('ships the interpreters and the plotting packages the kernel assets require', async () => {
    const parsed = parseEnvironmentDeclaration(JSON.parse(await readFile(join(resources, 'general.json'), 'utf8')))
    const names = parsed.packages.map(spec => spec.split('=')[0])
    expect(names).toEqual(expect.arrayContaining(['python', 'r-base', 'matplotlib', 'r-tidyverse']))
  })

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
