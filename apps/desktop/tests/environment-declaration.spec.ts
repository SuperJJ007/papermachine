import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseEnvironmentDeclaration } from '../src/environment-declaration.ts'

const resources = join(import.meta.dirname, '../resources/environments')

/** A minimal, otherwise-valid declaration body; each test overrides only the field(s) it exercises. */
function baseDeclaration(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'test',
    revision: '2026.08.1',
    name: 'Test',
    supportedPlatforms: ['darwin-arm64'],
    sources: [{ id: 'official', name: 'Official', channels: ['https://conda.anaconda.org/conda-forge'] }],
    packages: ['python=3.13'],
    estimatedDownloadBytes: 1,
    requiredFreeBytes: 1,
    timeoutMs: 1,
    healthChecks: [
      { language: 'python', executable: 'python', args: [] },
      { language: 'r', executable: 'Rscript', args: [] },
    ],
    ...overrides,
  }
}

describe('desktop environment declarations', () => {
  it('accepts the shipped general declaration', async () => {
    const parsed = parseEnvironmentDeclaration(JSON.parse(await readFile(join(resources, 'general.json'), 'utf8')))
    expect(parsed.id).toBe('general')
    expect(parsed.healthChecks.map(check => check.language)).toEqual(['python', 'r'])
  })

  it('ships three ordered mirror sources, tuna first, the official channel last', async () => {
    const parsed = parseEnvironmentDeclaration(JSON.parse(await readFile(join(resources, 'general.json'), 'utf8')))
    expect(parsed.sources.map(source => source.id)).toEqual(['tuna', 'ustc', 'official'])
    expect(parsed.sources.map(source => source.channels)).toEqual([
      ['https://mirrors.tuna.tsinghua.edu.cn/anaconda/cloud/conda-forge'],
      ['https://mirrors.ustc.edu.cn/anaconda/cloud/conda-forge'],
      ['https://conda.anaconda.org/conda-forge'],
    ])
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
    expect(() => parseEnvironmentDeclaration({ ...baseDeclaration(), healthChecks: [], postInstall: './run-me' }))
      .toThrow('unknown field postInstall')
  })

  it('rejects a channel URL that is not https', () => {
    expect(() => parseEnvironmentDeclaration(baseDeclaration({
      sources: [{ id: 'official', name: 'Official', channels: ['http://conda.anaconda.org/conda-forge'] }],
    }))).toThrow(/invalid channel URL/)
  })

  it('rejects a channel URL carrying a shell metacharacter, as would reach micromamba argv unescaped', () => {
    for (const hostile of [
      'https://conda.anaconda.org/conda-forge; rm -rf /',
      'https://conda.anaconda.org/conda-forge$(whoami)',
      'https://conda.anaconda.org/conda-forge`id`',
      'https://conda.anaconda.org/conda-forge|cat',
      'https://conda.anaconda.org/conda-forge&&ls',
      'https://conda.anaconda.org/conda-forge\nrm -rf /',
      'https://conda.anaconda.org/conda-forge with space',
    ]) {
      expect(() => parseEnvironmentDeclaration(baseDeclaration({
        sources: [{ id: 'official', name: 'Official', channels: [hostile] }],
      }))).toThrow(/invalid channel URL/)
    }
  })

  it('accepts the three shipped mirror URLs individually', () => {
    for (const channel of [
      'https://mirrors.tuna.tsinghua.edu.cn/anaconda/cloud/conda-forge',
      'https://mirrors.ustc.edu.cn/anaconda/cloud/conda-forge',
      'https://conda.anaconda.org/conda-forge',
    ]) {
      expect(() => parseEnvironmentDeclaration(baseDeclaration({
        sources: [{ id: 'official', name: 'Official', channels: [channel] }],
      }))).not.toThrow()
    }
  })

  it('rejects an empty sources array', () => {
    expect(() => parseEnvironmentDeclaration(baseDeclaration({ sources: [] })))
      .toThrow(/sources must be a non-empty array/)
  })

  it('rejects a duplicate source id', () => {
    const source = { id: 'official', name: 'Official', channels: ['https://conda.anaconda.org/conda-forge'] }
    expect(() => parseEnvironmentDeclaration(baseDeclaration({ sources: [source, source] })))
      .toThrow(/duplicate source id/)
  })

  it('rejects a source with an unknown field', () => {
    expect(() => parseEnvironmentDeclaration(baseDeclaration({
      sources: [{ id: 'official', name: 'Official', channels: ['https://conda.anaconda.org/conda-forge'], priority: 1 }],
    }))).toThrow(/source has an unknown field/)
  })

  it('rejects an invalid source id', () => {
    expect(() => parseEnvironmentDeclaration(baseDeclaration({
      sources: [{ id: 'Official', name: 'Official', channels: ['https://conda.anaconda.org/conda-forge'] }],
    }))).toThrow(/invalid source id/)
  })
})
