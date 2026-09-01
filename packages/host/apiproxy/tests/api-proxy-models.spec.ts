/**
 * Web session model-directory and selection behavior: dynamic provider grouping,
 * provider-local catalog failures, logged-selection restoration without stale
 * catalog injection, advisory pass-through models, and the prompt-assembly
 * boundary for a running selection change.
 */

import { describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { agentEvents } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AttachmentStore from '@deepseek-ai/dsh-attachment'
import type { TextAttachmentRef } from '@deepseek-ai/dsh-attachment'
import LlmRuntime, { LlmAdapter, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions, LlmCallConfig, LlmModelInfo, LlmModelReasoningInfo, LlmProviderInfo,
  LlmResolvedModelInfo, StreamChunk,
  UserMessage,
} from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session'
import SessionAttachmentIndex from '@deepseek-ai/dsh-session-attachment-index'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '../src/api-proxy.ts'
import {
  appendFixtureEvents,
  ARTIFACT_ID,
  ARTIFACT_SHA,
  legalEvents,
  PROJECT_ID,
  RUN_CALL_ID,
  runStarted,
  VERSION_ID,
} from '../../../science/science-session/tests/fixtures.ts'

// Test-owned extractor-required event type: no production domain event is a
// stable stand-in for this suite (every real domain's own registration is
// covered end to end in that domain's own tests), so the generic
// registration/authorization mechanism `sessions.textAttachment` shares with
// the image path is exercised against a locally merged event type instead.
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Test-only text-media event carrying one optional attachment reference. */
    'test/text-media-saved': { readonly media?: { readonly attachment?: TextAttachmentRef } }
  }
}

declare module '@deepseek-ai/dsh-session-attachment-index/types' {
  interface SessionAttachmentExtractorMap {
    'test/text-media-saved': true
  }
}

let nextRpc = 1
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`models-${String(nextRpc++)}`), payload }
}

class CatalogAdapter extends LlmAdapter {
  constructor(
    private readonly name: string,
    private readonly models: readonly LlmModelInfo[] | Error,
    private readonly reasoning?: LlmModelReasoningInfo,
    private readonly exactError?: Error,
  ) {
    super()
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: this.name }
  }

  override listModels(): Promise<readonly LlmModelInfo[]> {
    return this.models instanceof Error
      ? Promise.reject(this.models)
      : Promise.resolve(this.models)
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    if (this.exactError !== undefined) return Promise.reject(this.exactError)
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      ...this.reasoning === undefined ? {} : { reasoning: this.reasoning },
    })
  }

  override async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    // Catalog tests never enter provider streaming.
  }
}

const REASONING: LlmModelReasoningInfo = {
  efforts: [
    { id: ReasoningEffortId('off'), name: 'Off' },
    { id: ReasoningEffortId('high'), name: 'High' },
    { id: ReasoningEffortId('max'), name: 'Max' },
  ],
  defaultEffort: ReasoningEffortId('high'),
}

async function harness(logged?: {
  provider: string
  model: string
  reasoningEffort?: ReasoningEffortId
}, cwd?: string): Promise<{
  ctx: Context
  agent: Agent
  sessionId: SessionId
}> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentRegistry)
  ctx.llm.registerAdapter(['deepseek-official'], new CatalogAdapter('DeepSeek', [
    { provider: 'deepseek-official', id: 'deepseek-chat', name: 'DeepSeek Chat' },
    { provider: 'deepseek-official', id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', description: 'Reasoning model' },
  ], REASONING))
  ctx.llm.registerAdapter(['broken'], new CatalogAdapter('Broken Provider', new Error('catalog offline')))
  ctx.llm.registerAdapter(['metadata-broken'], new CatalogAdapter('Metadata Broken', [
    { provider: 'metadata-broken', id: 'listed', name: 'Listed' },
  ], undefined, new Error('reasoning metadata offline')))
  ctx.llm.registerAdapter(['empty'], new CatalogAdapter('Empty Provider', []))
  ctx.llm.registerAdapter(['duplicate'], new CatalogAdapter('Duplicate Provider', [
    { provider: 'duplicate', id: 'same', name: 'Same' },
    { provider: 'duplicate', id: 'same', name: 'Same Again' },
  ]))
  const session = ctx.sessions.create(undefined, cwd === undefined ? undefined : { meta: { cwd } })
  if (logged !== undefined) {
    session.append('request/header', { header: { config: logged }, reason: 'initial' })
  }
  const agent = {
    id: session.id,
    session,
    status: 'running',
    ctx,
    inbox: { nextTurn: [], nextStep: [] },
  } as unknown as Agent
  ctx.agents.register(agent)
  return { ctx, agent, sessionId: session.id }
}

function expectValue<T>(response: { result: { ok: true; value: T } | { ok: false } }): T {
  if (!response.result.ok) throw new Error('expected successful response')
  return response.result.value
}

function registerTextOnly(ctx: Context): void {
  ctx.llm.registerAdapter(['text-only'], new class extends CatalogAdapter {
    override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
      return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text'] })
    }
  }('Text Only', []))
}

describe('Web session model selection', () => {
  it('validates an ordered image batch before persisting any member', async () => {
    const { ctx, agent, sessionId } = await harness()
    const validateImage = vi.fn((_input: { data: Uint8Array }) => Promise.resolve())
    const saveImage = vi.fn((input: { data: Uint8Array; mediaType: 'image/png'; name?: string }) => Promise.resolve({
      attachmentId: `att-${String(input.data[0])}`,
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      width: 1,
      height: 1,
      ...input.name === undefined ? {} : { name: input.name },
    }))
    const attachments = {
      imageLimits: {
        maxImageBytes: 4,
        maxImagesPerMessage: 2,
        maxMessageImageBytes: 4,
        maxImagePixels: 4,
        maxImageDimension: 2000,
        mediaTypes: ['image/png'],
      },
      validateImage,
      saveImage,
    }
    ctx.provide('attachments', Object.setPrototypeOf(attachments, AttachmentStore.prototype) as never)
    const followup = vi.fn()
    Object.assign(agent, { followup })
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }),
      cwd: '/tmp',
    })

    const result = await api.sessions.prompt(request({
      sessionId,
      mode: 'queue' as const,
      content: [
        { type: 'image' as const, mediaType: 'image/png' as const, data: 'AQ==', name: 'first.png' },
        { type: 'text' as const, text: 'compare' },
        { type: 'image' as const, mediaType: 'image/png' as const, data: 'Ag==' },
      ],
    }))
    expect(result.result.ok).toBe(true)
    expect(validateImage.mock.calls.map(([input]) => [...input.data])).toEqual([[1], [2]])
    expect(saveImage.mock.calls.map(([input]) => [...input.data])).toEqual([[1], [2]])
    expect((followup.mock.calls[0]?.[0] as UserMessage).content).toEqual([
      {
        type: 'image',
        attachment: {
          attachmentId: 'att-1', mediaType: 'image/png', bytes: 1, width: 1, height: 1, name: 'first.png',
        },
      },
      { type: 'text', text: 'compare' },
      { type: 'image', attachment: { attachmentId: 'att-2', mediaType: 'image/png', bytes: 1, width: 1, height: 1 } },
    ])

    const denied = await api.sessions.prompt(request({
      sessionId,
      mode: 'queue' as const,
      content: Array.from({ length: 3 }, () => ({
        type: 'image' as const, mediaType: 'image/png' as const, data: 'AQ==',
      })),
    }))
    expect(denied.result).toMatchObject({
      ok: false,
      error: { code: 'attachment-error', details: { reason: 'TOO_MANY_IMAGES' } },
    })
    expect(saveImage).toHaveBeenCalledTimes(2)
    await ctx.fiber.dispose()
  })

  it('allows a text-only selection while durable or pending images remain available for later models', async () => {
    const { ctx, agent, sessionId } = await harness()
    registerTextOnly(ctx)
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }),
      cwd: '/tmp',
    })
    const image = {
      type: 'image' as const,
      attachment: { attachmentId: 'att-history', mediaType: 'image/png' as const, bytes: 1, width: 1, height: 1 },
    }
    agent.session.append('user/message', {
      id: 'image-message', role: 'user', source: { kind: 'user' }, content: [image],
    } as never, { surfaceOp: 'append' })
    expect(expectValue(await api.sessions.selectModel(request({
      sessionId, provider: 'text-only', model: 'plain',
    }))).selected).toEqual({ provider: 'text-only', model: 'plain' })

    agent.session.append('user/message', {
      id: 'summary', role: 'user', source: { kind: 'plugin', plugin: 'compact' },
      content: [{ type: 'text', text: 'image summarized' }],
    } as never, {
      surfaceOp: { op: 'replace', start: 0, end: agent.session.events.length - 1 },
      sourceEventSeqs: agent.session.events.map(event => event.seq),
    })
    ;(agent.inbox.nextTurn as UserMessage[]).push({
      id: 'pending-image', role: 'user', source: { kind: 'user' }, content: [image],
    } as never)
    expect(expectValue(await api.sessions.selectModel(request({
      sessionId, provider: 'text-only', model: 'plain',
    }))).selected).toEqual({ provider: 'text-only', model: 'plain' })
    await ctx.fiber.dispose()
  })

  it('authorizes attachment bytes only when the session event stream references the id', async () => {
    const { ctx, agent, sessionId } = await harness()
    const ref = {
      attachmentId: 'att-authorized', mediaType: 'image/png' as const, bytes: 2, width: 1, height: 1,
    }
    const readImage = vi.fn(() => Promise.resolve({ ref, data: Uint8Array.of(1, 2) }))
    ctx.provide('attachments', { readImage } as never)
    await ctx.plugin(SessionAttachmentIndex)
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }),
      cwd: '/tmp',
    })
    agent.session.append('agent/inbox/spliced', {
      target: 'next-turn',
      start: 0,
      inserted: [{
        id: 'queued-image', role: 'user', source: { kind: 'user' },
        content: [{ type: 'image', attachment: ref }],
      }],
    } as never)

    const allowed = await api.sessions.attachment(request({
      sessionId, attachmentId: 'att-authorized' as never,
    }))
    expect(allowed.result).toMatchObject({ ok: true, value: { attachment: ref, data: 'AQI=' } })
    const denied = await api.sessions.attachment(request({
      sessionId, attachmentId: 'att-other' as never,
    }))
    expect(denied.result).toMatchObject({
      ok: false,
      error: { code: 'attachment-error', details: { reason: 'ATTACHMENT_NOT_REFERENCED' } },
    })
    expect(readImage).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
  })

  it('authorizes text attachment bytes only when the session event stream references the id, mirroring the image path', async () => {
    const { ctx, sessionId, agent } = await harness()
    const ref = { attachmentId: 'txt-authorized' as never, mediaType: 'text/plain' as const, bytes: 2 }
    const readText = vi.fn(() => Promise.resolve({ ref, data: new TextEncoder().encode('ok') }))
    ctx.provide('attachments', { readText } as never)
    await ctx.plugin(SessionAttachmentIndex)
    // host-apiproxy has no dependency on any domain package, so this exercises
    // the generic extractor-registration/authorization mechanism against the
    // test-owned `test/text-media-saved` event type declared above rather
    // than a real domain event. Every real domain's own text-attachment
    // producers (e.g. Science's auto-capture and `annotate_artifact`) are
    // covered end to end in that domain's own test suites.
    ctx.sessionAttachments.register('test/text-media-saved', () => [ref])
    agent.session.append('test/text-media-saved', { media: { attachment: ref } })
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }),
      cwd: '/tmp',
    })

    const allowed = await api.sessions.textAttachment(request({
      sessionId, attachmentId: 'txt-authorized' as never,
    }))
    expect(allowed.result).toMatchObject({ ok: true, value: { attachment: ref, data: 'ok' } })
    const denied = await api.sessions.textAttachment(request({
      sessionId, attachmentId: 'txt-other' as never,
    }))
    expect(denied.result).toMatchObject({
      ok: false,
      error: { code: 'attachment-error', details: { reason: 'ATTACHMENT_NOT_REFERENCED' } },
    })
    expect(readText).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
  })

  it('reads a project-store blob only for a version proven by the named session fold', async () => {
    const { ctx, sessionId, agent } = await harness()
    appendFixtureEvents(agent.session)
    const readBlob = vi.fn(() => Promise.resolve(Uint8Array.of(1, 2, 3)))
    const openProject = vi.fn()
    const getVersion = vi.fn(() => Promise.resolve({ versionId: VERSION_ID, mediaType: 'image/png', byteCount: 128 }))
    ctx.provide('scienceArtifactStore', {
      readBlob,
      openProject,
      getVersion,
      listVersions: vi.fn(),
    } as never)
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }),
      cwd: '/tmp',
    })

    const allowed = await api.sessions.scienceArtifact(request({ sessionId, versionId: VERSION_ID as never }))
    expect(allowed.result).toEqual({
      ok: true,
      value: { versionId: VERSION_ID, mediaType: 'image/png', byteCount: 128, data: 'AQID' },
    })
    expect(readBlob).toHaveBeenCalledWith(PROJECT_ID, ARTIFACT_SHA)
    expect(openProject).not.toHaveBeenCalled()

    const denied = await api.sessions.scienceArtifact(request({ sessionId, versionId: 'unreferenced' as never }))
    expect(denied.result).toMatchObject({
      ok: false,
      error: { code: 'science-artifact-error', details: { reason: 'VERSION_NOT_REFERENCED' } },
    })
    expect(readBlob).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
  })

  it('corroborates an S3 cross-session input ordinal in the session project before reading its version id', async () => {
    const cwd = '/tmp/science-cross-session'
    const { ctx, sessionId, agent } = await harness(undefined, cwd)
    appendFixtureEvents(agent.session, legalEvents().slice(0, 4))
    const runCall = agent.session.append('tool/call', {
      turn: 1, step: 1, callId: RUN_CALL_ID, name: 'run_python', arguments: '{}',
    })
    agent.session.append('science/run-started', {
      version: 1,
      run: runStarted({
        requestHeaderSeq: 3,
        startedAt: runCall.time,
        inputs: [{ artifactId: ARTIFACT_ID, version: 2, path: 'reference/plot.png' }],
      }),
    })
    const crossVersionId = 'cross-version-2'
    const readBlob = vi.fn(() => Promise.resolve(Uint8Array.of(9)))
    const openProject = vi.fn(() => Promise.resolve({ projectId: PROJECT_ID }))
    const listVersions = vi.fn(() => Promise.resolve([{
      versionId: crossVersionId,
      ordinal: 2,
      sha256: '9'.repeat(64),
      mediaType: 'image/png',
      byteCount: 1,
    }]))
    const getVersion = vi.fn(() => Promise.resolve(undefined))
    ctx.provide('scienceArtifactStore', { readBlob, openProject, listVersions, getVersion } as never)
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }),
      cwd: '/tmp',
    })

    const allowed = await api.sessions.scienceArtifact(request({ sessionId, versionId: crossVersionId as never }))
    expect(allowed.result).toMatchObject({ ok: true, value: { versionId: crossVersionId, data: 'CQ==' } })
    expect(openProject).toHaveBeenCalledWith(cwd)
    expect(listVersions).toHaveBeenCalledWith(PROJECT_ID, ARTIFACT_ID)

    const wrongOrdinal = await api.sessions.scienceArtifact(request({ sessionId, versionId: 'cross-version-3' as never }))
    expect(wrongOrdinal.result).toMatchObject({
      ok: false,
      error: { code: 'science-artifact-error', details: { reason: 'VERSION_NOT_REFERENCED' } },
    })
    expect(readBlob).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
  })

  it('lists the project library and reads any exact version owned by the session project', async () => {
    const cwd = '/tmp/science-library-project'
    const { ctx, sessionId } = await harness(undefined, cwd)
    const version = {
      versionId: 'project-version-1', artifactId: ARTIFACT_ID, ordinal: 1, sha256: ARTIFACT_SHA,
      mediaType: 'text/csv', byteCount: 3, createdAt: 42, origin: 'auto', title: 'Results',
    }
    const otherSession = ctx.sessions.create(undefined, { meta: { cwd: '/tmp/other-science-project' } })
    const otherProjectId = 'project-other' as typeof PROJECT_ID
    ctx.provide('scienceArtifactStore', {
      openProject: vi.fn((path: string) => Promise.resolve({ projectId: path === cwd ? PROJECT_ID : otherProjectId })),
      listArtifacts: vi.fn(() => Promise.resolve([{
        artifactId: ARTIFACT_ID, owningProjectId: PROJECT_ID, logicalName: 'results.csv',
        originSessionId: sessionId, latestVersionId: version.versionId, createdAt: 41,
      }])),
      getLatestVersion: vi.fn(() => Promise.resolve(version)),
      getVersion: vi.fn((projectId: typeof PROJECT_ID) => Promise.resolve(projectId === PROJECT_ID ? version : undefined)),
      listVersions: vi.fn(() => Promise.resolve([])),
      readBlob: vi.fn(() => Promise.resolve(Buffer.from('a\n1'))),
      getReconciliationSummary: vi.fn(() => Promise.resolve({ orphanCount: 0, reconstructedCount: 0, missingContentCount: 0, items: [] })),
    } as never)
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }), cwd: '/tmp' })

    expect(expectValue(await api.sessions.scienceLibrary(request({ sessionId })))).toMatchObject({
      projectId: PROJECT_ID,
      artifacts: [{ logicalName: 'results.csv', title: 'Results', latest: { versionId: 'project-version-1', ordinal: 1 } }],
      health: { orphan: 0, reconstructed: 0, missingContent: 0 },
    })
    expect(expectValue(await api.sessions.scienceArtifact(request({ sessionId, versionId: version.versionId as never })))).toMatchObject({
      mediaType: 'text/csv', data: 'YQox',
    })
    expect((await api.sessions.scienceArtifact(request({
      sessionId: otherSession.id, versionId: version.versionId as never,
    }))).result).toMatchObject({
      ok: false, error: { details: { reason: 'VERSION_NOT_REFERENCED' } },
    })
    await ctx.fiber.dispose()
  })

  it('skips a version whose stored media type this build no longer renders instead of failing the whole listing', async () => {
    const cwd = '/tmp/science-library-legacy-media'
    const { ctx, sessionId } = await harness(undefined, cwd)
    const legacyArtifactId = 'artifact-legacy-vega' as typeof ARTIFACT_ID
    const png = {
      versionId: 'png-version-1', artifactId: ARTIFACT_ID, ordinal: 1, sha256: ARTIFACT_SHA,
      mediaType: 'image/png', byteCount: 3, createdAt: 42, origin: 'auto', title: 'Chart',
    }
    const legacy = {
      versionId: 'legacy-version-1', artifactId: legacyArtifactId, ordinal: 1, sha256: ARTIFACT_SHA,
      mediaType: 'application/vnd.vega-lite+json', byteCount: 3, createdAt: 40, origin: 'auto', title: 'Old spec',
    }
    ctx.provide('scienceArtifactStore', {
      openProject: vi.fn(() => Promise.resolve({ projectId: PROJECT_ID })),
      listArtifacts: vi.fn(() => Promise.resolve([
        { artifactId: legacyArtifactId, owningProjectId: PROJECT_ID, logicalName: 'chart.vl.json', originSessionId: sessionId, latestVersionId: legacy.versionId, createdAt: 39 },
        { artifactId: ARTIFACT_ID, owningProjectId: PROJECT_ID, logicalName: 'chart.png', originSessionId: sessionId, latestVersionId: png.versionId, createdAt: 41 },
      ])),
      getLatestVersion: vi.fn((_projectId: typeof PROJECT_ID, artifactId: typeof ARTIFACT_ID) =>
        Promise.resolve(artifactId === legacyArtifactId ? legacy : png)),
      getVersion: vi.fn(() => Promise.resolve(png)),
      listVersions: vi.fn(() => Promise.resolve([])),
      readBlob: vi.fn(() => Promise.resolve(Buffer.from('a\n1'))),
      getReconciliationSummary: vi.fn(() => Promise.resolve({ orphanCount: 0, reconstructedCount: 0, missingContentCount: 0, items: [] })),
    } as never)
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }), cwd: '/tmp' })

    const library = expectValue(await api.sessions.scienceLibrary(request({ sessionId })))
    expect(library.artifacts).toHaveLength(1)
    expect(library.artifacts).toMatchObject([
      { logicalName: 'chart.png', latest: { mediaType: 'image/png' } },
    ])
    await ctx.fiber.dispose()
  })

  it('carries project-wide reconciliation health counts and marks only reconstructed/missing-content latest versions, never orphan', async () => {
    const cwd = '/tmp/science-library-health'
    const { ctx, sessionId } = await harness(undefined, cwd)
    const reconstructedArtifactId = 'artifact-reconstructed' as typeof ARTIFACT_ID
    const missingContentArtifactId = 'artifact-missing-content' as typeof ARTIFACT_ID
    const orphanArtifactId = 'artifact-orphan' as typeof ARTIFACT_ID
    const reconstructedVersion = {
      versionId: 'reconstructed-version-1', artifactId: reconstructedArtifactId, ordinal: 1, sha256: ARTIFACT_SHA,
      mediaType: 'text/csv', byteCount: 3, createdAt: 10, origin: 'auto', title: 'Reconstructed',
    }
    const missingContentVersion = {
      versionId: 'missing-content-version-1', artifactId: missingContentArtifactId, ordinal: 1, sha256: ARTIFACT_SHA,
      mediaType: 'text/csv', byteCount: 3, createdAt: 11, origin: 'auto', title: 'Missing content',
    }
    const orphanVersion = {
      versionId: 'orphan-version-1', artifactId: orphanArtifactId, ordinal: 1, sha256: ARTIFACT_SHA,
      mediaType: 'text/csv', byteCount: 3, createdAt: 12, origin: 'auto', title: 'Orphan',
    }
    ctx.provide('scienceArtifactStore', {
      openProject: vi.fn(() => Promise.resolve({ projectId: PROJECT_ID })),
      listArtifacts: vi.fn(() => Promise.resolve([
        { artifactId: reconstructedArtifactId, owningProjectId: PROJECT_ID, logicalName: 'reconstructed.csv', originSessionId: sessionId, latestVersionId: reconstructedVersion.versionId, createdAt: 9 },
        { artifactId: missingContentArtifactId, owningProjectId: PROJECT_ID, logicalName: 'missing.csv', originSessionId: sessionId, latestVersionId: missingContentVersion.versionId, createdAt: 9 },
        { artifactId: orphanArtifactId, owningProjectId: PROJECT_ID, logicalName: 'orphan.csv', originSessionId: sessionId, latestVersionId: orphanVersion.versionId, createdAt: 9 },
      ])),
      getLatestVersion: vi.fn((_projectId: typeof PROJECT_ID, artifactId: typeof ARTIFACT_ID) => Promise.resolve(
        artifactId === reconstructedArtifactId ? reconstructedVersion
          : artifactId === missingContentArtifactId ? missingContentVersion
            : orphanVersion,
      )),
      listVersions: vi.fn(() => Promise.resolve([])),
      readBlob: vi.fn(() => Promise.resolve(Buffer.from('a\n1'))),
      getReconciliationSummary: vi.fn(() => Promise.resolve({
        orphanCount: 1, reconstructedCount: 1, missingContentCount: 1,
        items: [
          { versionId: reconstructedVersion.versionId, orphan: false, reconstructed: true, missingContent: false, checkedAt: 1 },
          { versionId: missingContentVersion.versionId, orphan: false, reconstructed: false, missingContent: true, checkedAt: 2 },
          { versionId: orphanVersion.versionId, orphan: true, reconstructed: false, missingContent: false, checkedAt: 3 },
        ],
      })),
    } as never)
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }), cwd: '/tmp' })

    const library = expectValue(await api.sessions.scienceLibrary(request({ sessionId })))
    expect(library.health).toEqual({ orphan: 1, reconstructed: 1, missingContent: 1 })
    const byArtifactId = new Map(library.artifacts.map(item => [item.artifactId, item]))
    expect(byArtifactId.get(reconstructedArtifactId)?.latest.health).toEqual({ reconstructed: true })
    expect(byArtifactId.get(missingContentArtifactId)?.latest.health).toEqual({ missingContent: true })
    // Orphan is a project-wide count only — never a per-item flag on the
    // affected artifact's `latest`, matching the Files-panel rule that never
    // surfaces it.
    expect(byArtifactId.get(orphanArtifactId)?.latest.health).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('fails the project library explicitly when the artifact store is not mounted', async () => {
    const { ctx, sessionId } = await harness(undefined, '/tmp/science-library-no-store')
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }), cwd: '/tmp',
    })
    expect((await api.sessions.scienceLibrary(request({ sessionId }))).result).toMatchObject({
      ok: false, error: { code: 'internal' },
    })
    await ctx.fiber.dispose()
  })

  it('contains workspace listing and preview reads within the session cwd', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dsh-workspace-library-'))
    try {
      await mkdir(join(cwd, 'data'))
      await mkdir(join(cwd, 'many'))
      await Promise.all(Array.from({ length: 2_001 }, (_, index) => mkdir(join(cwd, 'many', `entry-${String(index).padStart(4, '0')}`))))
      await mkdir(join(cwd, '.private'))
      await mkdir(join(cwd, 'node_modules'))
      await writeFile(join(cwd, 'table.csv'), 'a,b\n1,2\n')
      await writeFile(join(cwd, 'large.txt'), Buffer.alloc(2 * 1_024 * 1_024 + 1))
      await writeFile(join(cwd, '.secret'), 'hidden')
      await symlink(tmpdir(), join(cwd, 'escape'))
      const { ctx, sessionId } = await harness(undefined, cwd)
      const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }), cwd: '/tmp' })

      const root = expectValue(await api.sessions.workspaceFiles(request({ sessionId })))
      expect(root.root).toBe('')
      expect(root.entries.map(entry => [entry.name, entry.kind, entry.mediaType])).toEqual([
        ['data', 'dir', undefined],
        ['large.txt', 'file', 'text/plain'],
        ['many', 'dir', undefined],
        ['table.csv', 'file', 'text/csv'],
      ])
      expect(expectValue(await api.sessions.workspaceFiles(request({ sessionId, path: 'many' })))).toMatchObject({
        root: 'many', truncated: true,
      })
      expect(expectValue(await api.sessions.workspaceFile(request({ sessionId, path: 'table.csv' })))).toEqual({
        mediaType: 'text/csv', byteCount: 8, data: 'YSxiCjEsMgo=',
      })
      expect((await api.sessions.workspaceFile(request({ sessionId, path: '../outside.txt' }))).result).toMatchObject({
        ok: false, error: { details: { reason: 'PATH_OUTSIDE_WORKSPACE' } },
      })
      expect((await api.sessions.workspaceFile(request({ sessionId, path: 'large.txt' }))).result).toMatchObject({
        ok: false, error: { details: { reason: 'FILE_TOO_LARGE' } },
      })
      await ctx.fiber.dispose()
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('groups successful providers and leaves an unlisted current selection out of the catalog', async () => {
    const { ctx, sessionId } = await harness({
      provider: 'deepseek-official',
      model: 'private-preview',
      reasoningEffort: ReasoningEffortId('max'),
    })
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }), cwd: '/tmp' })

    const catalog = expectValue(await api.sessions.models(request({ sessionId })))
    expect(catalog.current).toEqual({
      provider: 'deepseek-official',
      model: 'private-preview',
      reasoningEffort: 'max',
    })
    expect(catalog.groups).toEqual([{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [
        { id: 'deepseek-chat', name: 'DeepSeek Chat', reasoning: REASONING },
        {
          id: 'deepseek-reasoner',
          name: 'DeepSeek Reasoner',
          description: 'Reasoning model',
          reasoning: REASONING,
        },
      ],
    }])
    expect(catalog.failures).toEqual([
      { id: 'broken', name: 'Broken Provider', message: 'catalog offline' },
      { id: 'metadata-broken', name: 'Metadata Broken', message: 'reasoning metadata offline' },
      {
        id: 'duplicate',
        name: 'Duplicate Provider',
        message: 'adapter returned invalid or duplicate model metadata for provider "duplicate"',
      },
    ])
    await ctx.fiber.dispose()
  })

  it('accepts an advisory-unlisted model, rejects an unavailable provider, and switches only after the next assembly', async () => {
    const { ctx, agent, sessionId } = await harness()
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }), cwd: '/tmp' })
    const seed: LlmCallConfig = { provider: 'seed', model: 'seed', temperature: 0.2 }
    const signal = new AbortController().signal

    expect(expectValue(await api.sessions.models(request({ sessionId }))).current)
      .toEqual({ provider: 'deepseek-official', model: 'deepseek-chat' })
    expect((await ctx.systemPrompt.assemble()).variables)
      .toMatchObject({ provider: 'deepseek-official', model: 'deepseek-chat' })

    const selected = expectValue(await api.sessions.selectModel(request({
      sessionId,
      provider: 'deepseek-official',
      model: 'private-preview',
      reasoningEffort: 'max',
    })))
    expect(selected.selected).toEqual({
      provider: 'deepseek-official',
      model: 'private-preview',
      reasoningEffort: 'max',
    })
    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 0, signal }, () => Promise.resolve(seed),
    )).resolves.toMatchObject({ provider: 'deepseek-official', model: 'deepseek-chat' })

    expect((await ctx.systemPrompt.assemble()).variables)
      .toMatchObject({ provider: 'deepseek-official', model: 'private-preview' })
    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 1, signal }, () => Promise.resolve(seed),
    )).resolves.toMatchObject({
      provider: 'deepseek-official',
      model: 'private-preview',
      reasoningEffort: 'max',
    })

    const unsupported = await api.sessions.selectModel(request({
      sessionId,
      provider: 'deepseek-official',
      model: 'private-preview',
      reasoningEffort: 'medium',
    }))
    expect(unsupported.result).toMatchObject({
      ok: false,
      error: {
        code: 'model-unavailable',
        message: 'provider "deepseek-official" model "private-preview" does not support reasoning effort "medium"',
      },
    })

    const rejected = await api.sessions.selectModel(request({
      sessionId,
      provider: 'missing',
      model: 'model',
    }))
    expect(rejected.result).toEqual({
      ok: false,
      error: {
        code: 'model-unavailable',
        message: 'no adapter registered for provider "missing"',
        details: { provider: 'missing', model: 'model' },
      },
    })
    expect(expectValue(await api.sessions.models(request({ sessionId }))).current)
      .toEqual({ provider: 'deepseek-official', model: 'private-preview', reasoningEffort: 'max' })
    await ctx.fiber.dispose()
  })

  it('reads the Agent default live for a session whose log names no selection', async () => {
    const { ctx, sessionId } = await harness()
    let stored = { provider: 'deepseek-official', model: 'deepseek-chat' }
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => stored,
      cwd: '/tmp',
    })

    expect(expectValue(await api.sessions.models(request({ sessionId }))).current)
      .toEqual({ provider: 'deepseek-official', model: 'deepseek-chat' })
    // The default moving after the session exists still reaches it: New
    // Session reuses a blank session rather than minting another, so a seed
    // captured at creation would show the superseded model there.
    stored = { provider: 'deepseek-official', model: 'deepseek-reasoner' }
    expect(expectValue(await api.sessions.models(request({ sessionId }))).current)
      .toEqual({ provider: 'deepseek-official', model: 'deepseek-reasoner' })
    expect(expectValue(await api.host.describe(request({}))))
      .toMatchObject({ provider: 'deepseek-official', model: 'deepseek-reasoner' })
    await ctx.fiber.dispose()
  })

  it('keeps a session on its logged selection when the Agent default differs', async () => {
    const { ctx, sessionId } = await harness({
      provider: 'deepseek-official',
      model: 'deepseek-chat',
    })
    let stored = { provider: 'deepseek-official', model: 'deepseek-chat' }
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => stored,
      cwd: '/tmp',
    })

    stored = { provider: 'duplicate', model: 'same' }
    expect(expectValue(await api.sessions.models(request({ sessionId }))).current)
      .toEqual({ provider: 'deepseek-official', model: 'deepseek-chat' })
    await ctx.fiber.dispose()
  })

  it('saves an accepted selection as the default and survives a storage failure', async () => {
    const { ctx, sessionId } = await harness()
    const saved: unknown[] = []
    let reject = false
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }),
      saveDefaultModelSelection: (selection) => {
        saved.push(selection)
        return reject ? Promise.reject(new Error('read-only document')) : Promise.resolve()
      },
      cwd: '/tmp',
    })

    expectValue(await api.sessions.selectModel(request({
      sessionId, provider: 'deepseek-official', model: 'deepseek-reasoner', reasoningEffort: 'max',
    })))
    expect(saved).toEqual([
      { provider: 'deepseek-official', model: 'deepseek-reasoner', reasoningEffort: 'max' },
    ])

    // A refused selection never becomes anyone's default.
    await api.sessions.selectModel(request({ sessionId, provider: 'missing', model: 'model' }))
    expect(saved).toHaveLength(1)

    // Storage failing is not the selection failing: the switch already applies
    // to this session, so the call still succeeds.
    reject = true
    const stillAccepted = expectValue(await api.sessions.selectModel(request({
      sessionId, provider: 'deepseek-official', model: 'deepseek-chat',
    })))
    expect(stillAccepted.selected).toEqual({ provider: 'deepseek-official', model: 'deepseek-chat', reasoningEffort: 'high' })
    expect(expectValue(await api.sessions.models(request({ sessionId }))).current)
      .toEqual({ provider: 'deepseek-official', model: 'deepseek-chat', reasoningEffort: 'high' })
    await ctx.fiber.dispose()
  })

  it('refuses a prompt no adapter can route, and reports it on the directory', async () => {
    const { ctx, sessionId } = await harness()
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'deleted-gateway', model: 'deleted-model' }),
      cwd: '/tmp',
    })

    // The client disabling its input is an affordance; this method stays
    // callable, so the refusal has to live here.
    const refused = await api.sessions.prompt(request({
      sessionId, mode: 'queue' as const, content: [{ type: 'text' as const, text: 'hi' }],
    }))
    expect(refused.result).toMatchObject({
      ok: false,
      error: { code: 'model-unavailable', details: { provider: 'deleted-gateway', model: 'deleted-model' } },
    })
    expect(expectValue(await api.sessions.models(request({ sessionId }))).routable).toBe(false)

    // An advisory-unlisted model on a live route is NOT this: the route
    // serves it, so the prompt goes through and nothing blocks.
    expectValue(await api.sessions.selectModel(request({
      sessionId, provider: 'deepseek-official', model: 'unlisted-but-served',
    })))
    const catalog = expectValue(await api.sessions.models(request({ sessionId })))
    expect(catalog.routable).toBe(true)
    expect(catalog.groups.flatMap(group => group.models.map(model => model.id)))
      .not.toContain('unlisted-but-served')
    await ctx.fiber.dispose()
  })

  it('serves a session and its catalog when the stored default names a route that is gone', async () => {
    const { ctx, sessionId } = await harness()
    const api = createApiProxy(ctx, {
      // What a Models-page removal leaves behind: the settings document still
      // names the route the user last picked, and nothing serves it.
      defaultModelSelection: () => ({ provider: 'deleted-gateway', model: 'deleted-model' }),
      cwd: '/tmp',
    })

    const catalog = expectValue(await api.sessions.models(request({ sessionId })))
    // Passed through rather than repaired: matching no group is precisely what
    // makes the composer seat prompt for a selection instead of naming a model
    // the deployment cannot reach.
    expect(catalog.current).toEqual({ provider: 'deleted-gateway', model: 'deleted-model' })
    expect(catalog.groups.flatMap(group => group.models.map(model => `${group.id}/${model.id}`)))
      .not.toContain('deleted-gateway/deleted-model')
    await ctx.fiber.dispose()
  })
})
