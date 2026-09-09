// @vitest-environment jsdom
/** Session-scoped artifact loaders and current version fact conversion. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ScienceClientArtifactVersion } from '@deepseek-ai/dsh-science-session/types'
import { createScienceImageUrlLoader, createScienceTextUrlLoader } from '../src/client/science-artifact-url-loader.ts'
import { createScienceChartStateLoader } from '../src/client/science-chart-state-loader.ts'
import { createLoadScienceVersions, toRenderableVersion } from '../src/client/version-summaries.ts'
import type { ScienceVersionSummary } from '../src/client/library-artifact.ts'

const SESSION = 'session/a' as SessionId
const CONTENT = { versionId: 'version/1', mediaType: 'text/plain', byteCount: 4 } as const

afterEach(() => { vi.unstubAllGlobals() })

describe('raw artifact URL loaders', () => {
  it('resolves an encoded image URL without fetching it', async () => {
    expect(await createScienceImageUrlLoader(SESSION)(CONTENT)).toContain('/api/science/artifact/session%2Fa/version%2F1')
  })

  it('returns fetched text and rejects a failed response with its status', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, text: vi.fn().mockResolvedValue('data') })
      .mockResolvedValueOnce({ ok: false, status: 410 })
    vi.stubGlobal('fetch', fetchMock)
    const load = createScienceTextUrlLoader(SESSION)
    await expect(load(CONTENT)).resolves.toBe('data')
    await expect(load(CONTENT)).rejects.toThrow('science artifact text read failed: 410')
  })
})

describe('session-scoped readers', () => {
  it('reads chart state and reports missing bindings and RPC failures', async () => {
    const readScienceChartState = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: { chart: null } })
      .mockResolvedValueOnce({ ok: false, error: { code: 'missing', message: 'gone' } })
    const sessions = { binding: vi.fn(() => ({ session: { readScienceChartState } })) } as unknown as ISessions
    const load = createScienceChartStateLoader(sessions, SESSION)
    await expect(load(CONTENT)).resolves.toBeNull()
    await expect(load(CONTENT)).rejects.toThrow('missing: gone')
    expect(readScienceChartState).toHaveBeenCalledWith('version/1')

    const absent = createScienceChartStateLoader({ binding: vi.fn() } as unknown as ISessions, SESSION)
    await expect(absent(CONTENT)).rejects.toThrow('resolved no binding')
  })

  it('reads a version batch and reports a missing binding', async () => {
    const readScienceVersions = vi.fn().mockResolvedValue({ ok: true, value: { versions: [] } })
    const sessions = { binding: vi.fn(() => ({ session: { readScienceVersions } })) } as unknown as ISessions
    await expect(createLoadScienceVersions(sessions, SESSION)(['version/1'])).resolves.toEqual({ ok: true, value: { versions: [] } })
    expect(readScienceVersions).toHaveBeenCalledWith(['version/1'])

    const absent = createLoadScienceVersions({ binding: vi.fn() } as unknown as ISessions, SESSION)
    await expect(absent(['version/1'])).rejects.toThrow('resolved no binding')
  })
})

describe('toRenderableVersion', () => {
  it('uses the logical name when the current title is absent', () => {
    const artifact = {
      artifactId: 'artifact-1', logicalName: 'old.csv', version: 1, versionId: 'version/1',
      sha256: 'a'.repeat(64), title: 'Old title', seenAt: 1,
    } as ScienceClientArtifactVersion
    const summary: ScienceVersionSummary = {
      versionId: 'version/1', artifactId: 'artifact-1', logicalName: 'current.csv', ordinal: 1,
      contentOrigin: 'import', createdAt: 2, mediaType: 'text/csv', byteCount: 4,
      producer: { sessionId: SESSION },
    }
    expect(toRenderableVersion(artifact, new Map([[summary.versionId, summary]]))?.title).toBe('current.csv')
  })
})
