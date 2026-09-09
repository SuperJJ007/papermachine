/** Session-scoped Science project-store byte loaders. */
import { describe, expect, it, vi } from 'vitest'
import type { ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ScienceArtifactContentRef } from '../src/client/science-attachment-loader.ts'
import { createScienceImageLoader, createScienceTextLoader } from '../src/client/science-attachment-loader.ts'

const SESSION = 'session-1' as SessionId

function content(over: Partial<ScienceArtifactContentRef> = {}): ScienceArtifactContentRef {
  return { versionId: 'version-1', mediaType: 'image/png', byteCount: 4, ...over }
}

function sessionsOf(readScienceArtifact: unknown): ISessions {
  return {
    binding: (id: string) => id === SESSION
      ? { sessionId: SESSION, session: { readScienceArtifact }, ctx: {} }
      : undefined,
  } as unknown as ISessions
}

describe('createScienceImageLoader', () => {
  it('resolves a data: URI from session-authorized bytes', async () => {
    const data = Uint8Array.from([1, 2, 3, 4])
    const readScienceArtifact = vi.fn().mockResolvedValue({
      ok: true,
      value: { versionId: 'version-1', mediaType: 'image/png', byteCount: data.length, data },
    })
    const load = createScienceImageLoader(sessionsOf(readScienceArtifact), SESSION)
    const url = await load(content())
    expect(url).toBe(`data:image/png;base64,${Buffer.from(data).toString('base64')}`)
    expect(readScienceArtifact).toHaveBeenCalledWith('version-1')
  })

  it('encodes bytes spanning multiple base64 chunks', async () => {
    const data = new Uint8Array(0x8000 + 10).fill(7)
    const readScienceArtifact = vi.fn().mockResolvedValue({
      ok: true,
      value: { versionId: 'version-1', mediaType: 'image/png', byteCount: data.length, data },
    })
    const load = createScienceImageLoader(sessionsOf(readScienceArtifact), SESSION)
    await expect(load(content())).resolves.toBe(`data:image/png;base64,${Buffer.from(data).toString('base64')}`)
  })

  it('rejects an unknown binding and a declined read', async () => {
    const unknown = createScienceImageLoader(sessionsOf(vi.fn()), 'unknown-session' as SessionId)
    await expect(unknown(content())).rejects.toThrow(/resolved no binding/)
    const readScienceArtifact = vi.fn().mockResolvedValue({ ok: false, error: { code: 'not-found', message: 'gone' } })
    await expect(createScienceImageLoader(sessionsOf(readScienceArtifact), SESSION)(content()))
      .rejects.toThrow('not-found: gone')
  })

  it('memoizes a settled read by versionId, serving repeat requests without a second store read', async () => {
    const data = Uint8Array.from([9, 9, 9])
    const readScienceArtifact = vi.fn().mockResolvedValue({
      ok: true,
      value: { versionId: 'version-1', mediaType: 'image/png', byteCount: data.length, data },
    })
    const load = createScienceImageLoader(sessionsOf(readScienceArtifact), SESSION)
    const [first, second] = await Promise.all([load(content()), load(content())])
    expect(second).toBe(first)
    expect(readScienceArtifact).toHaveBeenCalledTimes(1)
  })

  it('evicts a rejected read so a retry re-fetches instead of replaying the failure', async () => {
    const readScienceArtifact = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: { code: 'not-found', message: 'gone' } })
      .mockResolvedValueOnce({
        ok: true,
        value: { versionId: 'version-1', mediaType: 'image/png', byteCount: 1, data: Uint8Array.of(1) },
      })
    const load = createScienceImageLoader(sessionsOf(readScienceArtifact), SESSION)
    await expect(load(content())).rejects.toThrow('not-found: gone')
    await expect(load(content())).resolves.toBe(`data:image/png;base64,${Buffer.from([1]).toString('base64')}`)
    expect(readScienceArtifact).toHaveBeenCalledTimes(2)
  })

  it('bounds the memoized version count, evicting the oldest entry first', async () => {
    const readScienceArtifact = vi.fn().mockImplementation((versionId: string) => Promise.resolve({
      ok: true,
      value: { versionId, mediaType: 'image/png', byteCount: 1, data: Uint8Array.of(1) },
    }))
    const load = createScienceImageLoader(sessionsOf(readScienceArtifact), SESSION)
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
      value: { versionId: 'version-2', mediaType: 'text/csv', byteCount: data.length, data },
    })
    const load = createScienceTextLoader(sessionsOf(readScienceArtifact), SESSION)
    await expect(load(content({ versionId: 'version-2', mediaType: 'text/csv' }))).resolves.toBe('a,b\n1,2\n')
    expect(readScienceArtifact).toHaveBeenCalledWith('version-2')
  })

  it('rejects an unknown binding, invalid UTF-8, and a declined read', async () => {
    const unknown = createScienceTextLoader(sessionsOf(vi.fn()), 'unknown-session' as SessionId)
    await expect(unknown(content({ mediaType: 'text/plain' }))).rejects.toThrow(/resolved no binding/)
    const invalid = vi.fn().mockResolvedValue({
      ok: true,
      value: { versionId: 'version-1', mediaType: 'text/plain', byteCount: 1, data: Uint8Array.of(0xff) },
    })
    await expect(createScienceTextLoader(sessionsOf(invalid), SESSION)(content({ mediaType: 'text/plain' })))
      .rejects.toThrow()
    const declined = vi.fn().mockResolvedValue({ ok: false, error: { code: 'not-found', message: 'gone' } })
    await expect(createScienceTextLoader(sessionsOf(declined), SESSION)(content({ mediaType: 'text/plain' })))
      .rejects.toThrow('not-found: gone')
  })
})
