import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { SkillCandidate, SkillProviderControl } from '@deepseek-ai/dsh-skill'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'

/**
 * `apps/desktop/resources/skills` staged by DMG packaging
 * (`electron-builder.yml`'s `extraResources`) and discovered at
 * `process.resourcesPath/skills` by the production overlay row
 * `renderDesktopRuntimeOverlay` renders for `skill-filesystem`
 * (`apps/desktop/src/runtime-overlay.ts`).
 */
const resourcesSkillsDir = join(import.meta.dirname, '../resources/skills')

/**
 * Instantiate the provider class directly with the exact config the
 * production overlay renders, bypassing `ctx.skills.registerProvider` and
 * `ctx.plugin()` — this test only needs the provider's own discovery, not
 * registry composition or the host's own `SkillRegistry`.
 */
function bundledSkillsProvider(): FileSystemSkillProvider {
  const control: SkillProviderControl = { signal: new AbortController().signal, invalidate: () => {} }
  return new FileSystemSkillProvider(new Context(), control, {
    providerName: 'bundled-skills',
    includeDefaultRoots: false,
    bundledSkillDir: resourcesSkillsDir,
    watch: false,
  })
}

async function listCandidates(provider: FileSystemSkillProvider): Promise<readonly SkillCandidate[]> {
  const result = await provider.list({})
  return Array.isArray(result) ? result : result.candidates
}

describe('desktop bundled default Science skills', () => {
  it('discovers exactly the three shipped skills, each named for its directory', async () => {
    const candidates = await listCandidates(bundledSkillsProvider())

    expect(candidates.map(candidate => candidate.name).sort()).toEqual([
      'scientific-visualization',
      'scientific-writing',
      'statistical-analysis',
    ])
    for (const candidate of candidates) {
      expect(candidate.source).toBe('bundled')
      expect(candidate.provider).toBe('bundled-skills')
    }
  })

  it('has no duplicate skill names among the bundled directories', async () => {
    const names = (await listCandidates(bundledSkillsProvider())).map(candidate => candidate.name)

    expect(new Set(names).size).toBe(names.length)
  })

  it('loads a complete, non-empty body for each bundled skill', async () => {
    const provider = bundledSkillsProvider()
    const candidates = await listCandidates(provider)

    for (const candidate of candidates) {
      const definition = await provider.get(candidate, {})
      expect(definition?.content.length ?? 0).toBeGreaterThan(0)
      expect(definition?.description.length ?? 0).toBeGreaterThan(0)
    }
  })
})
