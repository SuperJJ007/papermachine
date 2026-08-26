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
