/**
 * GET /api/science/artifact/:sessionId/:versionId — the raw-bytes Science
 * artifact download endpoint: byte-identical passthrough (including a
 * non-UTF-8 CSV and a 2 MB+ PNG), the Content-Length/Content-Disposition/
 * nosniff header contract, authorization that never leaks a projectId, and
 * the missing/corrupt-content error codes.
 */

import { randomBytes } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { ProjectArtifactStoreError } from '@deepseek-ai/dsh-science-artifact-store'
import { createApiProxy, toFetchHandler } from '@deepseek-ai/dsh-host-apiproxy'
import {
  appendFixtureEvents,
  ARTIFACT_ID,
  PROJECT_ID,
  VERSION_ID,
} from '../../../science/science-session/tests/fixtures.ts'

const sid = (id: string): SessionId => id as SessionId

/**
 * A CSV fixture that is deliberately not valid UTF-8: GBK-style two-byte
 * sequences ("中文,value\n测试,42\n") whose lead bytes (0xD6, 0xB2) are
 * legal UTF-8 lead bytes but whose second bytes (0xD0, 0xE2) are not valid
 * UTF-8 continuation bytes (`10xxxxxx`) — a real-world "non-UTF-8 CSV upload"
 * shape, not merely non-ASCII.
 */
const GBK_CSV_BYTES = Uint8Array.from([
  0xD6, 0xD0, 0xCE, 0xC4, 0x2C, 0x76, 0x61, 0x6C, 0x75, 0x65, 0x0A,
  0xB2, 0xE2, 0xCA, 0xD4, 0x2C, 0x34, 0x32, 0x0A,
])

/** Fake `scienceArtifactStore` service; every method is overridable per test. */
function scienceStore(overrides: Record<string, unknown> = {}) {
  return {
    readBlob: vi.fn(() => Promise.resolve(new Uint8Array())),
    getVersion: vi.fn((_projectId: unknown, versionId: unknown) => Promise.resolve(
      versionId === VERSION_ID
        ? { versionId: VERSION_ID, artifactId: ARTIFACT_ID, ordinal: 1, mediaType: 'text/csv', byteCount: 0 }
        : undefined,
    )),
    getArtifact: vi.fn(() => Promise.resolve({ artifactId: ARTIFACT_ID, logicalName: 'notes.csv' })),
    openProject: vi.fn(() => Promise.resolve({ projectId: PROJECT_ID })),
    listVersions: vi.fn(() => Promise.resolve([])),
    ...overrides,
  }
}

/** One session whose log proves `VERSION_ID`, plus an optional fake store. */
async function harness(options: {
  store?: ReturnType<typeof scienceStore> | null
  persistenceListsEmpty?: boolean
} = {}): Promise<{ ctx: Context; sessionId: SessionId }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(UserQuestionService)
  const session = ctx.sessions.create(undefined, { meta: { cwd: '/tmp/science-project' } })
  appendFixtureEvents(session)
  if (options.store !== null) ctx.provide('scienceArtifactStore', (options.store ?? scienceStore()) as never)
  if (options.persistenceListsEmpty === true) {
    ctx.provide('sessionPersistence', { list: async () => [] } as never)
  }
  return { ctx, sessionId: session.id }
}

function api(ctx: Context) {
  return createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
}

function downloadUrl(sessionId: SessionId, versionId: string): string {
  return `http://host/api/science/artifact/${encodeURIComponent(sessionId)}/${encodeURIComponent(versionId)}`
}

async function get(ctx: Context, sessionId: SessionId, versionId: string): Promise<Response> {
  return toFetchHandler(api(ctx)).fetch(new Request(downloadUrl(sessionId, versionId)))
}

async function head(ctx: Context, sessionId: SessionId, versionId: string): Promise<Response> {
  return toFetchHandler(api(ctx)).fetch(new Request(downloadUrl(sessionId, versionId), { method: 'HEAD' }))
}

describe('GET /api/science/artifact/:sessionId/:versionId', () => {
  it('streams the exact blob bytes with a matching Content-Length and no charset on a text/* Content-Type', async () => {
    const { ctx, sessionId } = await harness({
      store: scienceStore({ readBlob: vi.fn(() => Promise.resolve(GBK_CSV_BYTES)) }),
    })
    const response = await get(ctx, sessionId, VERSION_ID)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/csv')
    expect(response.headers.get('content-length')).toBe(String(GBK_CSV_BYTES.byteLength))
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(GBK_CSV_BYTES)
  })

  it('streams a 2 MB+ PNG byte-for-byte with a matching Content-Length', async () => {
    const png = randomBytes(2 * 1024 * 1024 + 777)
    const { ctx, sessionId } = await harness({
      store: scienceStore({
        readBlob: vi.fn(() => Promise.resolve(new Uint8Array(png))),
        getVersion: vi.fn((_projectId: unknown, versionId: unknown) => Promise.resolve(
          versionId === VERSION_ID
            ? { versionId: VERSION_ID, artifactId: ARTIFACT_ID, ordinal: 3, mediaType: 'image/png', byteCount: png.byteLength }
            : undefined,
        )),
        getArtifact: vi.fn(() => Promise.resolve({ artifactId: ARTIFACT_ID, logicalName: 'chart.png' })),
      }),
    })
    const response = await get(ctx, sessionId, VERSION_ID)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('content-length')).toBe(String(png.byteLength))
    expect(response.headers.get('content-disposition')).toContain('chart-v3.png')
    const body = new Uint8Array(await response.arrayBuffer())
    expect(body.byteLength).toBe(png.byteLength)
    expect(body).toEqual(new Uint8Array(png))
  })

  it('RFC 5987-encodes a non-ASCII filename carrying an attr-char-excluded mark, with an ASCII-safe plain fallback', async () => {
    const { ctx, sessionId } = await harness({
      store: scienceStore({ getArtifact: vi.fn(() => Promise.resolve({ artifactId: ARTIFACT_ID, logicalName: "统计结果(1)'.csv" })) }),
    })
    const response = await get(ctx, sessionId, VERSION_ID)
    expect(response.status).toBe(200)
    const disposition = response.headers.get('content-disposition')
    expect(disposition).toBe(
      'attachment; filename="____(1)\'-v1.csv"; '
      + "filename*=UTF-8''%E7%BB%9F%E8%AE%A1%E7%BB%93%E6%9E%9C%281%29%27-v1.csv",
    )
  })

  it('falls back to the version id with no extension when the artifact record cannot be resolved', async () => {
    const { ctx, sessionId } = await harness({
      store: scienceStore({ getArtifact: vi.fn(() => Promise.resolve(undefined)) }),
    })
    const response = await get(ctx, sessionId, VERSION_ID)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="${VERSION_ID}-v1"; filename*=UTF-8''${VERSION_ID}-v1`,
    )
  })

  it('answers 404 without revealing the project id for a version the session cannot prove', async () => {
    const { ctx, sessionId } = await harness()
    const response = await get(ctx, sessionId, 'unreferenced-version')
    expect(response.status).toBe(404)
    const body = await response.text()
    expect(body).not.toContain(PROJECT_ID)
  })

  it('answers 404 for a session id no persistence backend can find', async () => {
    const { ctx } = await harness({ persistenceListsEmpty: true })
    const response = await get(ctx, sid('ghost-session'), VERSION_ID)
    expect(response.status).toBe(404)
  })

  it('answers 500 when session resolution itself fails (no persistence backend composed)', async () => {
    const { ctx } = await harness()
    const response = await get(ctx, sid('ghost-session'), VERSION_ID)
    expect(response.status).toBe(500)
  })

  it('answers 500 when the deployment mounts no scienceArtifactStore service', async () => {
    const { ctx, sessionId } = await harness({ store: null })
    const response = await get(ctx, sessionId, VERSION_ID)
    expect(response.status).toBe(500)
    expect(await response.text()).toContain('dsh-science-artifact-store')
  })

  it('answers 500 when authorizing the requested version itself throws', async () => {
    const { ctx, sessionId } = await harness({
      store: scienceStore({ getVersion: vi.fn(() => Promise.reject(new Error('store offline'))) }),
    })
    const response = await get(ctx, sessionId, VERSION_ID)
    expect(response.status).toBe(500)
  })

  it('answers 410 with a missing_content error code when the blob is absent from the store, before any body is produced', async () => {
    const { ctx, sessionId } = await harness({
      store: scienceStore({
        readBlob: vi.fn(() => Promise.reject(new ProjectArtifactStoreError('blob missing', 'BLOB_NOT_FOUND'))),
      }),
    })
    const response = await get(ctx, sessionId, VERSION_ID)
    expect(response.status).toBe(410)
    expect(response.headers.get('x-science-artifact-error')).toBe('missing_content')
  })

  it('answers 409 with a content_corrupt error code when the blob fails SHA-256 verification, interrupting the download rather than returning tampered bytes', async () => {
    const { ctx, sessionId } = await harness({
      store: scienceStore({
        readBlob: vi.fn(() => Promise.reject(new ProjectArtifactStoreError('blob corrupt', 'BLOB_CORRUPT'))),
      }),
    })
    const response = await get(ctx, sessionId, VERSION_ID)
    expect(response.status).toBe(409)
    expect(response.headers.get('x-science-artifact-error')).toBe('content_corrupt')
    expect(response.headers.get('content-length')).not.toBe('0')
    await expect(response.text()).resolves.not.toContain('csv')
  })

  it('answers 500 for an unexpected blob-read failure', async () => {
    const { ctx, sessionId } = await harness({
      store: scienceStore({ readBlob: vi.fn(() => Promise.reject(new Error('disk failure'))) }),
    })
    const response = await get(ctx, sessionId, VERSION_ID)
    expect(response.status).toBe(500)
  })
})

describe('HEAD /api/science/artifact/:sessionId/:versionId', () => {
  // The client's download flow (ScienceDetailsView.tsx's downloadArtifact)
  // HEAD-checks this exact URL before ever creating a save anchor, to
  // classify a 410/409/other failure without triggering a browser download
  // dialog for a request that would fail. A route that only ever matched
  // GET (the regression this file's own HEAD coverage guards against) left
  // every real download broken: the preflight itself always failed.
  it('answers the same status and headers as GET, with no streamed body', async () => {
    const { ctx, sessionId } = await harness({
      store: scienceStore({ readBlob: vi.fn(() => Promise.resolve(GBK_CSV_BYTES)) }),
    })
    const response = await head(ctx, sessionId, VERSION_ID)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/csv')
    expect(response.headers.get('content-length')).toBe(String(GBK_CSV_BYTES.byteLength))
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.body).toBeNull()
  })

  it('returns a bodyless 410 missing_content error from HEAD', async () => {
    const { ctx, sessionId } = await harness({
      store: scienceStore({
        readBlob: vi.fn(() => Promise.reject(new ProjectArtifactStoreError('blob missing', 'BLOB_NOT_FOUND'))),
      }),
    })
    const response = await head(ctx, sessionId, VERSION_ID)
    expect(response.status).toBe(410)
    expect(response.headers.get('x-science-artifact-error')).toBe('missing_content')
    expect(response.body).toBeNull()
  })

  it('returns a bodyless 404 for a version the session cannot prove', async () => {
    const { ctx, sessionId } = await harness()
    const response = await head(ctx, sessionId, 'unreferenced-version')
    expect(response.status).toBe(404)
    expect(response.body).toBeNull()
  })
})
