/** Session-scoped Science project-store byte loaders. */
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ScienceArtifactContentRef } from '../src/client/science-attachment-loader.ts'
import { createScienceImageLoader, createScienceTextLoader } from '../src/client/science-attachment-loader.ts'

const SESSION = 'session-1' as SessionId

function content(over: Partial<ScienceArtifactContentRef> = {}): ScienceArtifactContentRef {
  return { versionId: 'version-1', mediaType: 'image/png', byteCount: 4, ...over }
}

function remoteOf(scienceArtifact: unknown): Context['remote'] {
  return { science: { scienceArtifact } } as unknown as Context['remote']
}

describe('createScienceImageLoader', () => {
  it('resolves a data: URI from session-authorized bytes', async () => {
    const data = Uint8Array.from([1, 2, 3, 4])
    const readScienceArtifact = vi.fn().mockResolvedValue({
      ok: true,
      value: { versionId: 'version-1', mediaType: 'image/png', byteCount: data.length, data: Buffer.from(data).toString('base64') },
    })
    const load = createScienceImageLoader(remoteOf(readScienceArtifact), SESSION)
    const url = await load(content())
    expect(url).toBe(`data:image/png;base64,${Buffer.from(data).toString('base64')}`)
    expect(readScienceArtifact).toHaveBeenCalledWith(SESSION, 'version-1')
  })

  it('preserves a large base64 payload', async () => {
    const data = new Uint8Array(0x8000 + 10).fill(7)
    const readScienceArtifact = vi.fn().mockResolvedValue({
      ok: true,
      value: { versionId: 'version-1', mediaType: 'image/png', byteCount: data.length, data: Buffer.from(data).toString('base64') },
    })
    const load = createScienceImageLoader(remoteOf(readScienceArtifact), SESSION)
    await expect(load(content())).resolves.toBe(`data:image/png;base64,${Buffer.from(data).toString('base64')}`)
  })

  it('surfaces an authorization refusal from the host', async () => {
    const readScienceArtifact = vi.fn().mockResolvedValue({ ok: false, error: { code: 'not-found', message: 'gone' } })
    await expect(createScienceImageLoader(remoteOf(readScienceArtifact), SESSION)(content()))
      .rejects.toThrow('not-found: gone')
  })

  it('memoizes a settled read by versionId, serving repeat requests without a second store read', async () => {
    const data = Uint8Array.from([9, 9, 9])
    const readScienceArtifact = vi.fn().mockResolvedValue({
      ok: true,
      value: { versionId: 'version-1', mediaType: 'image/png', byteCount: data.length, data: Buffer.from(data).toString('base64') },
    })
    const load = createScienceImageLoader(remoteOf(readScienceArtifact), SESSION)
    const [first, second] = await Promise.all([load(content()), load(content())])
    expect(second).toBe(first)
    expect(readScienceArtifact).toHaveBeenCalledTimes(1)
  })

  it('evicts a rejected read so a retry re-fetches instead of replaying the failure', async () => {
    const readScienceArtifact = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: { code: 'not-found', message: 'gone' } })
      .mockResolvedValueOnce({
        ok: true,
        value: { versionId: 'version-1', mediaType: 'image/png', byteCount: 1, data: 'AQ==' },
      })
    const load = createScienceImageLoader(remoteOf(readScienceArtifact), SESSION)
    await expect(load(content())).rejects.toThrow('not-found: gone')
    await expect(load(content())).resolves.toBe(`data:image/png;base64,${Buffer.from([1]).toString('base64')}`)
    expect(readScienceArtifact).toHaveBeenCalledTimes(2)
  })

  it('bounds the memoized version count, evicting the oldest entry first', async () => {
    const readScienceArtifact = vi.fn().mockImplementation((_sessionId: SessionId, versionId: string) => Promise.resolve({
      ok: true,
      value: { versionId, mediaType: 'image/png', byteCount: 1, data: 'AQ==' },
    }))
    const load = createScienceImageLoader(remoteOf(readScienceArtifact), SESSION)
    const versionIds = Array.from({ length: 65 }, (_, index) => `bounded-${String(index)}`)
    for (const versionId of versionIds) await load(content({ versionId }))
    expect(readScienceArtifact).toHaveBeenCalledTimes(65)

    // The most recently inserted entry is still cached.
    await load(content({ versionId: versionIds.at(-1)! }))
    expect(readScienceArtifact).toHaveBeenCalledTimes(65)

    // The oldest entry (index 0) was evicted to hold the cache at 64 entries.
    await load(content({ versionId: versionIds[0]! }))
    expect(readScienceArtifact).toHaveBeenCalledTimes(66)
  })
})

describe('createScienceTextLoader', () => {
  it('decodes authenticated UTF-8 bytes', async () => {
    const data = new TextEncoder().encode('a,b\n1,2\n')
    const readScienceArtifact = vi.fn().mockResolvedValue({
      ok: true,
      value: { versionId: 'version-2', mediaType: 'text/csv', byteCount: data.length, data: Buffer.from(data).toString('base64') },
    })
    const load = createScienceTextLoader(remoteOf(readScienceArtifact), SESSION)
    await expect(load(content({ versionId: 'version-2', mediaType: 'text/csv' }))).resolves.toBe('a,b\n1,2\n')
    expect(readScienceArtifact).toHaveBeenCalledWith(SESSION, 'version-2')
  })

  it('rejects invalid UTF-8 and a declined read', async () => {
    const invalid = vi.fn().mockResolvedValue({
      ok: true,
      value: { versionId: 'version-1', mediaType: 'text/plain', byteCount: 1, data: '/w==' },
    })
    await expect(createScienceTextLoader(remoteOf(invalid), SESSION)(content({ mediaType: 'text/plain' })))
      .rejects.toThrow()
    const declined = vi.fn().mockResolvedValue({ ok: false, error: { code: 'not-found', message: 'gone' } })
    await expect(createScienceTextLoader(remoteOf(declined), SESSION)(content({ mediaType: 'text/plain' })))
      .rejects.toThrow('not-found: gone')
  })
})
