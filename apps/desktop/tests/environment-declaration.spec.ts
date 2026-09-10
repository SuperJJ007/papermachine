import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DESKTOP_PLATFORMS, micromambaExecutableName, parseEnvironmentDeclaration } from '../src/environment-declaration.ts'

const resources = join(import.meta.dirname, '../resources/environments')
const desktopResources = join(import.meta.dirname, '../resources')

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

  it('accepts the shipped biomedical declaration', async () => {
    const parsed = parseEnvironmentDeclaration(JSON.parse(await readFile(join(resources, 'biomedical.json'), 'utf8')))
    expect(parsed.id).toBe('biomedical')
    expect(parsed.name).toContain('生物医学')
    expect(parsed.healthChecks.map(check => check.language)).toEqual(['python', 'r'])
  })

  // USTC, not TUNA, is first: TUNA's longer mirror hostname pushes this
  // declaration's deepest transitive dependency 1 character past win32's
  // `MAX_PATH` under the shipped package cache root, confirmed on real
  // Windows hardware
  // (.agents/notes/implemented/bug-fix/2026-09-07-win32-package-cache-tuna-max-path.md).
  it('ships three ordered mirror sources, ustc first, the official channel last', async () => {
    const parsed = parseEnvironmentDeclaration(JSON.parse(await readFile(join(resources, 'general.json'), 'utf8')))
    expect(parsed.sources.map(source => source.id)).toEqual(['ustc', 'tuna', 'official'])
    expect(parsed.sources.map(source => source.channels)).toEqual([
      ['https://mirrors.ustc.edu.cn/anaconda/cloud/conda-forge'],
      ['https://mirrors.tuna.tsinghua.edu.cn/anaconda/cloud/conda-forge'],
      ['https://conda.anaconda.org/conda-forge'],
    ])
  })

  // Real single-source `micromamba create` compressed package sizes, USTC
  // mirror, cloud Windows box (R2-report.md Q3): ~0.80GB. The lower bound
  // guards against a future edit shrinking the declared estimate back
  // toward the previously shipped, under-measured 0.52GB.
  it('estimates at least the real measured single-source download size', async () => {
    const parsed = parseEnvironmentDeclaration(JSON.parse(await readFile(join(resources, 'general.json'), 'utf8')))
    expect(parsed.estimatedDownloadBytes).toBeGreaterThanOrEqual(800_000_000)
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

  it('rejects a platform this carrier does not ship for', () => {
    expect(() => parseEnvironmentDeclaration(baseDeclaration({ supportedPlatforms: ['linux-x64'] })))
      .toThrow(/unsupported platform identifier/)
  })

  // An installer built for a target whose declaration excludes it reaches
  // onboarding with nothing to install, so the shipped declaration has to
  // cover every target `electron-builder.yml` produces.
  it('supports every platform this carrier ships an installer for', async () => {
    const parsed = parseEnvironmentDeclaration(JSON.parse(await readFile(join(resources, 'general.json'), 'utf8')))
    expect([...parsed.supportedPlatforms].sort()).toEqual([...DESKTOP_PLATFORMS].sort())
  })
})

/** `resources/micromamba.json`'s per-platform asset shape, `runtime` present only for win32 targets. */
interface MicromambaAsset {
  readonly url: string
  readonly sha256: string
  readonly runtime?: { readonly url: string; readonly sha256: string; readonly files: readonly string[] }
}

describe('bundled micromamba', () => {
  // `fetch:micromamba <target>` is the only source of the packaged binary, and
  // it fails on a target the manifest does not pin — a packaging run for a
  // platform added here without its asset would otherwise fail at build time.
  it('pins one checksummed asset for every shipped platform', async () => {
    const manifest = JSON.parse(await readFile(join(desktopResources, 'micromamba.json'), 'utf8')) as Record<string, MicromambaAsset | undefined>
    for (const platform of DESKTOP_PLATFORMS) {
      const asset = manifest[platform]
      expect(asset?.url ?? '').toMatch(/^https:\/\//)
      expect(asset?.sha256 ?? '').toMatch(/^[0-9a-f]{64}$/)
    }
  })

  // win32 dynamically links the MSVC CRT and ships it app-local
  // (`fetch-micromamba.ts` throws if a win32 target's manifest entry is
  // missing this block) — a bare Windows host without it fails to start the
  // packaged app with STATUS_DLL_NOT_FOUND, with no signal at fetch time.
  it('pins a checksummed app-local CRT runtime for every win32 platform, with a non-empty file list', async () => {
    const manifest = JSON.parse(await readFile(join(desktopResources, 'micromamba.json'), 'utf8')) as Record<string, MicromambaAsset | undefined>
    const win32Platforms = DESKTOP_PLATFORMS.filter(platform => platform.startsWith('win32-'))
    expect(win32Platforms.length).toBeGreaterThan(0)
    for (const platform of win32Platforms) {
      const runtime = manifest[platform]?.runtime
      expect(runtime?.url ?? '').toMatch(/^https:\/\//)
      expect(runtime?.sha256 ?? '').toMatch(/^[0-9a-f]{64}$/)
      expect(runtime?.files.length ?? 0).toBeGreaterThan(0)
    }
  })

  it('names the Windows binary with the extension Windows requires to execute it', () => {
    expect(micromambaExecutableName('win32-x64')).toBe('micromamba.exe')
    expect(micromambaExecutableName('darwin-arm64')).toBe('micromamba')
  })
})
