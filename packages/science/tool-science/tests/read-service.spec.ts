/** Real-store evidence for the Science read Remote and byte routes. */
import * as fs from 'node:fs/promises'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import ScienceArtifactStore, { VersionId, ProjectArtifactStoreError } from '@deepseek-ai/dsh-science-artifact-store'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import SessionAttachmentIndex from '@deepseek-ai/dsh-session-attachment-index'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import * as ScienceSession from '@deepseek-ai/dsh-science-session'
import { runStarted } from '../../science-session/tests/fixtures.ts'
import ScienceReadService from '../src/read-service.ts'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, stat: vi.fn(actual.stat) }
})

let ctx: Context
let root: string
let workspace: string
let service: ScienceReadService
const sessionId = SessionId('science-read-session')
const register = vi.fn((_route: { path: string; fetch(request: Request): Promise<Response> }) => () => {})
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'science-read-'))
  workspace = join(root, 'workspace')
  await mkdir(workspace)
  ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(ScienceArtifactStore, { dshHome: join(root, 'home') })
  await ctx.plugin(LocalAttachmentStore, { dshHome: join(root, 'home') })
  await ctx.plugin(SessionAttachmentIndex)
  ctx.sessions.create(sessionId, { meta: { cwd: workspace, agentPreset: 'science' } })
  ctx.provide('sessionQuery', {
    readSession: async (id: SessionId) => {
      const session = ctx.sessions.get(id)
      if (session === undefined) throw new Error('missing session')
      return { session: session.header, events: session.snapshotEvents() }
    },
    readTitle: async () => ({ title: 'Research' }),
  } as unknown as Context['sessionQuery'])
  register.mockClear()
  ctx.provide('connection', { fetch: { register } } as unknown as Context['connection'])
  service = new ScienceReadService(ctx, { workspaceEntryLimit: 2, workspaceFileByteLimit: 32 })
})
afterEach(async () => { vi.restoreAllMocks(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })

async function artifact() {
  const { projectId } = await ctx.scienceArtifactStore.openProject(workspace)
  const result = await ctx.scienceArtifactStore.createArtifact(projectId, {
    logicalName: 'result.csv', kind: 'dataset', originSessionId: sessionId,
    data: new TextEncoder().encode('x,y\n1,2\n'), mediaType: 'text/csv', contentOrigin: 'run-auto',
  })
  return { projectId, ...result }
}

it('reads project-library metadata and exact version bytes through all three read methods', async () => {
  const { projectId, version } = await artifact()
  expect(await service.scienceArtifact(sessionId, version.versionId)).toMatchObject({
    versionId: version.versionId, mediaType: 'text/csv', data: Buffer.from('x,y\n1,2\n').toString('base64'),
  })
  expect(await service.scienceLibrary(sessionId)).toMatchObject({ projectId, artifacts: [{ logicalName: 'result.csv', originSessionTitle: 'Research' }],
  })
  expect(await service.scienceVersions(sessionId, [version.versionId, VersionId('absent')])).toMatchObject({ versions: [{ versionId: version.versionId, producer: { sessionTitle: 'Research' } }],
  })
  expect(await service.scienceChartState(sessionId, version.versionId)).toEqual({ chart: null })
})

it('refuses versions from another project even when their identity is known', async () => {
  const { version } = await artifact()
  const other = SessionId('other')
  await mkdir(join(root, 'other'))
  ctx.sessions.create(other, { meta: { cwd: join(root, 'other') } })
  await expect(service.scienceArtifact(other, version.versionId)).rejects.toThrow('not referenced')
  expect(await service.scienceVersions(other, [version.versionId])).toEqual({ versions: [] })
})

it('authorizes a file from the durable V3 message before decoding UTF-8', async () => {
  const ref = await ctx.attachments.saveFile({ name: 'data.csv', data: new TextEncoder().encode('中文') })
  await expect(service.textAttachment(sessionId, ref.attachmentId)).rejects.toThrow('not referenced')
  ctx.sessions.get(sessionId)!.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'file', attachment: ref }],
  }), { surfaceOp: 'append' })
  expect(await service.textAttachment(sessionId, ref.attachmentId)).toEqual({ attachment: ref, data: '中文' })
  await expect(service.textAttachment(sessionId, AttachmentId('absent'))).rejects.toThrow('not referenced')
})

it('bounds workspace listings and previews and rejects traversal and symlink escapes', async () => {
  await writeFile(join(workspace, 'data.csv'), 'a,b')
  await writeFile(join(workspace, '.hidden'), 'hidden')
  await mkdir(join(workspace, 'folder'))
  await writeFile(join(workspace, 'large.txt'), 'x'.repeat(33))
  await writeFile(join(root, 'outside.txt'), 'outside')
  await symlink(join(root, 'outside.txt'), join(workspace, 'escape.txt'))
  expect(await service.workspaceFiles(sessionId)).toMatchObject({ root: '', truncated: true, entries: [{ name: 'data.csv' }, { name: 'folder', kind: 'dir' }],
  })
  expect(await service.workspaceFile(sessionId, 'data.csv')).toEqual({ mediaType: 'text/csv', byteCount: 3, data: Buffer.from('a,b').toString('base64') })
  for (const path of ['../outside.txt', join(root, 'outside.txt'), 'escape.txt']) await expect(service.workspaceFile(sessionId, path)).rejects.toThrow('outside')
  await expect(service.workspaceFile(sessionId, 'folder')).rejects.toThrow('not a file')
  await expect(service.workspaceFile(sessionId, 'large.txt')).rejects.toThrow('limit')
})

it('serves byte-identical GET and bodyless HEAD through the registered exact route', async () => {
  const { version } = await artifact()
  const route = register.mock.calls[0]?.[0] as unknown as { path: string; fetch(request: Request): Promise<Response> }
  expect(route.path).toBe('/api/science-artifact')
  const url = `http://localhost/api/science-artifact?sessionId=${sessionId}&versionId=${version.versionId}`
  const get = await route.fetch(new Request(url))
  expect(await get.text()).toBe('x,y\n1,2\n')
  const head = await route.fetch(new Request(url, { method: 'HEAD' }))
  expect(head.headers.get('content-length')).toBe('8')
  expect(await head.text()).toBe('')
  expect((await route.fetch(new Request('http://localhost/api/science-artifact'))).status).toBe(400)
  expect((await route.fetch(new Request(url.replace(String(version.versionId), 'absent')))).status).toBe(404)
})

it('previews supported workspace media and rejects oversized text attachments', async () => {
  for (const [name, mediaType] of [['a.json', 'application/json'], ['a.md', 'text/markdown'], ['a.markdown', 'text/markdown'], ['a.txt', 'text/plain'], ['a.png', 'image/png'], ['a.bin', 'application/octet-stream']]) {
    await writeFile(join(workspace, name!), 'data')
    expect(await service.workspaceFile(sessionId, name!)).toMatchObject({ mediaType })
  }
  await mkdir(join(workspace, 'empty'))
  expect(await service.workspaceFiles(sessionId, 'empty')).toMatchObject({ root: 'empty', entries: [] })
  const ref = await ctx.attachments.saveFile({ name: 'large.txt', data: Buffer.alloc(33) })
  ctx.sessions.get(sessionId)!.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'file', attachment: ref }],
  }), { surfaceOp: 'append' })
  await expect(service.textAttachment(sessionId, ref.attachmentId)).rejects.toThrow('limit')
})

it('requires a durable workspace for project fallback and workspace previews', async () => {
  const id = SessionId('no-workspace')
  ctx.sessions.create(id)
  await expect(service.scienceLibrary(id)).rejects.toThrow('no workspace')
  await expect(service.workspaceFiles(id)).rejects.toThrow('no workspace')
  await expect(service.scienceArtifact(id, VersionId('absent'))).rejects.toThrow('not referenced')
})

it('returns editable figure state and handles PNG versions without it', async () => {
  const { projectId } = await artifact()
  const chart = { runtime: 'matplotlib', figureKey: 'plot.png', png: { width: 1, height: 1, dpi: 100 }, elements: [], hitmap: [], hitmapStatus: 'unavailable', ops: [] }
  const first = await ctx.scienceArtifactStore.createArtifact(projectId, {
    logicalName: 'plot.png', kind: 'figure', originSessionId: sessionId,
    data: Buffer.from('png'), mediaType: 'image/png', contentOrigin: 'run-auto',
    figureState: { figureKey: chart.figureKey, dpi: 100, stateJson: JSON.stringify(chart) },
  })
  expect(await service.scienceChartState(sessionId, first.version.versionId)).toEqual({ chart })
  expect((await service.scienceLibrary(sessionId)).artifacts).toHaveLength(2)
  vi.spyOn(ctx.scienceArtifactStore, 'getFigureState').mockResolvedValue(undefined)
  expect(await service.scienceChartState(sessionId, first.version.versionId)).toEqual({ chart: null })
})

it('keeps curated metadata and producer coordinates in batched version results', async () => {
  const { projectId, artifact: owner } = await artifact()
  const version = await ctx.scienceArtifactStore.appendVersion(projectId, owner.artifactId, {
    producerSessionId: sessionId, data: Buffer.from('next'), mediaType: 'text/plain', contentOrigin: 'run-auto',
    producerRunId: 'run', producerToolCallId: 'call', producerRequestHeaderSeq: 3, producerTurn: 1,
  })
  await ctx.scienceArtifactStore.annotateVersion(projectId, version.versionId, { actor: 'human', title: 'Title', caption: 'Caption' })
  expect(await service.scienceLibrary(sessionId)).toMatchObject({ artifacts: [{ title: 'Title', caption: 'Caption' }] })
  expect(await service.scienceVersions(sessionId, [version.versionId, version.versionId])).toMatchObject({ versions: [
    { title: 'Title', caption: 'Caption', producer: { runId: 'run', toolCallId: 'call', requestHeaderSeq: 3, turn: 1 } },
    { title: 'Title' },
  ] })
  vi.spyOn(ctx.sessionQuery, 'readTitle').mockResolvedValue(undefined)
  expect((await service.scienceLibrary(sessionId)).artifacts[0]).not.toHaveProperty('originSessionTitle')
  expect((await service.scienceVersions(sessionId, [version.versionId])).versions[0]!.producer).not.toHaveProperty('sessionTitle')
  vi.spyOn(ctx.sessionQuery, 'readTitle').mockRejectedValue(new Error('removed'))
  expect((await service.scienceLibrary(sessionId)).artifacts).toHaveLength(1)
  expect((await service.scienceVersions(sessionId, [version.versionId])).versions).toHaveLength(1)
  vi.spyOn(ctx.scienceArtifactStore, 'getArtifact').mockResolvedValue(undefined)
  expect(await service.scienceVersions(sessionId, [version.versionId])).toEqual({ versions: [] })
  vi.spyOn(ctx.scienceArtifactStore, 'getLatestVersion').mockResolvedValue(undefined)
  expect((await service.scienceLibrary(sessionId)).artifacts).toEqual([])
})

it('resolves session-pinned versions and ordinal run inputs before project fallback', async () => {
  const { projectId, artifact: owner, version } = await artifact()
  const fold = ScienceSession.foldScience([])
  const folded = vi.spyOn(ScienceSession, 'foldScience')
  folded.mockReturnValue({
    ...fold, artifacts: [{ artifactId: owner.artifactId, logicalName: owner.logicalName, title: owner.logicalName, version: 1,
      projectId, versionId: version.versionId, sha256: version.sha256, seenAt: 0 }],
  })
  expect(await service.scienceArtifact(sessionId, version.versionId)).toMatchObject({ versionId: version.versionId })
  const get = vi.spyOn(ctx.scienceArtifactStore, 'getVersion').mockResolvedValueOnce(undefined)
  await expect(service.scienceArtifact(sessionId, version.versionId)).rejects.toThrow('not referenced')
  get.mockRestore()
  const { inputs: _inputs, ...runWithoutInputs } = runStarted()
  folded.mockReturnValue({ ...fold, runs: [runStarted({ inputs: [
    { artifactId: owner.artifactId, version: 1, path: 'inputs/one.csv' },
    { artifactId: owner.artifactId, version: 2, path: 'inputs/two.csv' },
  ] }), runWithoutInputs] })
  expect(await service.scienceArtifact(sessionId, version.versionId)).toMatchObject({ versionId: version.versionId })
  expect(await service.scienceVersions(sessionId, [VersionId('absent')])).toEqual({ versions: [] })
})

it('reports reconciled version health and skips unrenderable legacy library rows', async () => {
  const { version } = await artifact()
  const summary = await ctx.scienceArtifactStore.getReconciliationSummary((await ctx.scienceArtifactStore.openProject(workspace)).projectId)
  const reconciliation = vi.spyOn(ctx.scienceArtifactStore, 'getReconciliationSummary')
  for (const reconstructed of [true, false]) {
    reconciliation.mockResolvedValue({
      ...summary, items: [{ versionId: version.versionId, orphan: false, checkedAt: 0, reconstructed, missingContent: true }],
    })
    expect((await service.scienceLibrary(sessionId)).artifacts[0]!.latest.health).toMatchObject({ missingContent: true })
    expect((await service.scienceVersions(sessionId, [version.versionId])).versions[0]!.health).toMatchObject({ missingContent: true })
  }
  reconciliation.mockResolvedValue({
    ...summary, items: [{ versionId: version.versionId, orphan: false, checkedAt: 0, reconstructed: true, missingContent: false }],
  })
  expect((await service.scienceLibrary(sessionId)).artifacts[0]!.latest.health).toEqual({ reconstructed: true })
  reconciliation.mockResolvedValue({
    ...summary, items: [{ versionId: version.versionId, orphan: false, checkedAt: 0, reconstructed: false, missingContent: false }],
  })
  expect((await service.scienceLibrary(sessionId)).artifacts[0]!.latest).not.toHaveProperty('health')
  vi.spyOn(ctx.scienceArtifactStore, 'getLatestVersion').mockResolvedValue({ ...version, mediaType: 'application/legacy' })
  expect((await service.scienceLibrary(sessionId)).artifacts).toEqual([])
})

it('maps missing and corrupt downloads to explicit responses and propagates other read failures', async () => {
  const { version } = await artifact()
  const route = register.mock.calls[0]![0]
  const url = `http://localhost/api/science-artifact?sessionId=${sessionId}&versionId=${version.versionId}`
  const read = vi.spyOn(ctx.scienceArtifactStore, 'readBlob')
  for (const [code, status] of [['BLOB_NOT_FOUND', 410], ['BLOB_CORRUPT', 409]] as const) {
    read.mockRejectedValueOnce(new ProjectArtifactStoreError('unavailable', code))
    expect((await route.fetch(new Request(url))).status).toBe(status)
  }
  read.mockRejectedValueOnce(new Error('disk unavailable'))
  await expect(route.fetch(new Request(url))).rejects.toThrow('disk unavailable')
  read.mockRejectedValueOnce(new ProjectArtifactStoreError('project unavailable', 'ARTIFACT_NOT_FOUND'))
  await expect(route.fetch(new Request(url))).rejects.toThrow('project unavailable')
  expect((await route.fetch(new Request(`http://localhost/api/science-artifact?sessionId=${sessionId}`))).status).toBe(400)
})

it('rejects a file that grows after the initial stat', async () => {
  const path = join(workspace, 'growing.txt')
  await writeFile(path, 'small')
  const initial = await fs.stat(path)
  await writeFile(path, 'x'.repeat(33))
  vi.mocked(fs.stat).mockResolvedValueOnce(initial)
  await expect(service.workspaceFile(sessionId, 'growing.txt')).rejects.toThrow('limit')
})
