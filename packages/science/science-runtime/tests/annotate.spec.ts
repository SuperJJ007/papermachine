/**
 * `ScienceRuntime.annotateArtifact`: metadata-only curation over an artifact
 * version auto-capture already produced — `annotateArtifact` never imports
 * bytes itself, while its not-found diagnostic may inspect retained run-file
 * names. This suite seeds every annotated artifact through a real captured
 * run. Provenance facts (content origin, producer, `created_at`)
 * live only in the project artifact store now (T1's authority rule), so
 * assertions about them read `ctx.scienceArtifactStore` directly rather than
 * the session projection.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { ScienceEnvironmentProfileId, replayScience } from '@deepseek-ai/dsh-science-session'
import type { ScienceRunId } from '@deepseek-ai/dsh-science-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type { StartScienceRunRequest } from '../src/types.ts'
import { planSessionScratch, runArtifactDirectory } from '../src/scratch.ts'
import {
  attachScienceSession,
  authorizeAnnotateArtifact,
  authorizePythonRun,
  createFakePythonPrefix,
  createKernelRuntimeHarness,
  createScienceSession,
  kernelAction,
  rejectSessionAppend,
} from './harness.ts'

// Cases here spawn a real kernel subprocess; under full-suite concurrency the
// default 5s timeout is not enough (same rule as run.spec.ts).
vi.setConfig({ testTimeout: 30_000 })

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tmp(prefix: string): string {
  const root = mkdtempSync(join(process.cwd(), prefix))
  roots.push(root)
  return root
}

/** Write one file below a run's real Host artifact directory. */
async function writeArtifact(
  root: string, session: Session, runId: ScienceRunId, relativePath: string, data: Uint8Array | string,
): Promise<void> {
  const sessionScratch = await planSessionScratch(join(root, 'dsh-home'), session)
  const artifacts = runArtifactDirectory(sessionScratch, runId)
  const target = join(artifacts, relativePath)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, data)
}

let captureCallCounter = 0

/**
 * Bind (once) or reuse the already-applied environment, run one Python
 * script that writes `files`, and let auto-capture produce their artifact
 * versions.
 */
async function captureFiles(
  harness: Awaited<ReturnType<typeof createKernelRuntimeHarness>>,
  root: string,
  session: Session,
  files: Readonly<Record<string, Uint8Array | string>>,
  options: Pick<StartScienceRunRequest, 'artifactInputs' | 'editBaselines' | 'rasterArtifacts'> & {
    readonly chartResult?: unknown
  } = {},
): Promise<ScienceRunId> {
  if (replayScience(session.events)?.environment === null) {
    await harness.runtime.bindEnvironment({ session, profileId: ScienceEnvironmentProfileId('fake'), signal: new AbortController().signal })
  }
  captureCallCounter += 1
  // The fake driver's `sleep` action holds DONE until `sleepMs` elapses, so
  // the test can write the artifact files under the run's own real `runId`
  // before auto-capture walks the artifact directory after DONE.
  const { chartResult, ...runOptions } = options
  const handle = await harness.runtime.startRun({
    session, language: 'python', code: kernelAction({ action: 'sleep', sleepMs: 200, status: 'ok', chartResult }),
    ...runOptions,
    ...authorizePythonRun(session, `annotate-capture-${String(captureCallCounter)}`),
    signal: new AbortController().signal,
  })
  for (const [relativePath, data] of Object.entries(files)) {
    await writeArtifact(root, session, handle.runId, relativePath, data)
  }
  const result = await handle.done
  expect(result.terminal.status).toBe('success')
  return handle.runId
}

describe('ScienceRuntime.annotateArtifact', () => {
  it('curates the latest version in place, reusing its store content reference and provenance', async () => {
    const root = tmp('.science-annotate-latest-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-annotate-latest')
    const runId = await captureFiles(harness, root, session, { 'summary.csv': 'a,b\n1,2\n' })
    const captured = replayScience(session.events)?.artifacts.find(candidate => candidate.logicalName === 'summary.csv')
    expect(captured).toBeDefined()
    if (captured === undefined) throw new Error('expected a captured summary.csv version')
    const beforeAnnotate = await harness.ctx.scienceArtifactStore.getVersion(captured.projectId, captured.versionId)
    if (beforeAnnotate === undefined) throw new Error('expected the captured version to exist in the store')

    const annotated = await harness.runtime.annotateArtifact({
      session, logicalName: 'summary.csv', title: 'Result summary', caption: 'The final table',
      ...authorizeAnnotateArtifact(session), signal: new AbortController().signal,
    })

    expect(annotated.artifactId).toBe(captured.artifactId)
    // Titling content the session already holds is not a second result: the
    // curated metadata replaces the captured version rather than standing
    // beside a byte-identical predecessor.
    expect(annotated.version).toBe(1)
    expect(annotated.title).toBe('Result summary')
    expect(annotated.caption).toBe('The final table')
    expect(annotated.versionId).toBe(captured.versionId)
    expect(annotated.sha256).toBe(captured.sha256)

    // Content, `created_at`, and every producer field are unaffected by
    // curation — only `latestAnnotationId` (and, through it, the store's
    // notion of current title/caption) changes.
    const afterAnnotate = await harness.ctx.scienceArtifactStore.getVersion(captured.projectId, captured.versionId)
    expect(afterAnnotate).toMatchObject({
      sha256: beforeAnnotate.sha256,
      mediaType: beforeAnnotate.mediaType,
      byteCount: beforeAnnotate.byteCount,
      contentOrigin: 'run-auto',
      producerSessionId: beforeAnnotate.producerSessionId,
      producerRunId: beforeAnnotate.producerRunId,
      producerToolCallId: beforeAnnotate.producerToolCallId,
      producerRequestHeaderSeq: beforeAnnotate.producerRequestHeaderSeq,
      environmentRevision: beforeAnnotate.environmentRevision,
      environmentFingerprint: beforeAnnotate.environmentFingerprint,
      createdAt: beforeAnnotate.createdAt,
    })
    expect(afterAnnotate?.producerRunId).toBe(String(runId))
    expect(afterAnnotate?.title).toBe('Result summary')
    expect(afterAnnotate?.caption).toBe('The final table')
    expect(afterAnnotate?.latestAnnotation).toMatchObject({ actor: 'model', title: 'Result summary', caption: 'The final table' })

    const artifacts = replayScience(session.events)?.artifacts.filter(a => a.logicalName === 'summary.csv')
    expect(artifacts?.map(a => a.version)).toEqual([1])
    expect(artifacts?.at(0)?.title).toBe('Result summary')
  })

  it('marks the version orphan when the artifact-saved append is vetoed after the store annotation already committed (W3)', async () => {
    const root = tmp('.science-annotate-append-veto-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-annotate-append-veto')
    await captureFiles(harness, root, session, { 'summary.csv': 'a,b\n1,2\n' })
    const captured = replayScience(session.events)?.artifacts.find(candidate => candidate.logicalName === 'summary.csv')
    if (captured === undefined) throw new Error('expected a captured summary.csv version')

    const appendVeto = new Error('forced append veto')
    rejectSessionAppend(session, 'science/artifact-saved', appendVeto)
    await expect(harness.runtime.annotateArtifact({
      session, logicalName: 'summary.csv', title: 'Curated Title',
      ...authorizeAnnotateArtifact(session), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'INFRASTRUCTURE_FAILURE', cause: appendVeto })

    // The store's own annotation already committed before the vetoed
    // append; the version is marked orphan rather than left silent for a
    // later reconciliation pass to discover.
    const health = await harness.ctx.scienceArtifactStore.getReconciliationSummary(captured.projectId)
    expect(health.items.find(item => item.versionId === captured.versionId)?.orphan).toBe(true)
    const stored = await harness.ctx.scienceArtifactStore.getVersion(captured.projectId, captured.versionId)
    expect(stored?.title).toBe('Curated Title')
  })

  it('logs (and does not throw) when the orphan health-mark itself fails after a vetoed append', async () => {
    const root = tmp('.science-annotate-append-veto-health-fail-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-annotate-append-veto-health-fail')
    await captureFiles(harness, root, session, { 'summary.csv': 'a,b\n1,2\n' })
    const captured = replayScience(session.events)?.artifacts.find(candidate => candidate.logicalName === 'summary.csv')
    if (captured === undefined) throw new Error('expected a captured summary.csv version')

    const warnSpy = vi.spyOn(harness.ctx.logger, 'warn').mockImplementation(() => {})
    vi.spyOn(harness.ctx.scienceArtifactStore, 'setVersionHealth').mockRejectedValueOnce(new Error('forced health write failure'))
    rejectSessionAppend(session, 'science/artifact-saved', new Error('forced append veto'))

    await expect(harness.runtime.annotateArtifact({
      session, logicalName: 'summary.csv', title: 'Curated Title',
      ...authorizeAnnotateArtifact(session), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'INFRASTRUCTURE_FAILURE' })

    await vi.waitFor(() => {
      const messages = warnSpy.mock.calls.map(call => String(call[0]))
      expect(messages.some(message => message.includes('failed to mark version') && message.includes('orphan'))).toBe(true)
    })
  })

  it('clears a caption the request omits, rather than leaving a stale value (D8)', async () => {
    const root = tmp('.science-annotate-clear-caption-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-annotate-clear-caption')
    await captureFiles(harness, root, session, { 'summary.csv': 'a,b\n1,2\n' })

    const first = await harness.runtime.annotateArtifact({
      session, logicalName: 'summary.csv', title: 'draft', caption: 'a caption',
      ...authorizeAnnotateArtifact(session, 'science-annotate-clear-caption-call-1'), signal: new AbortController().signal,
    })
    expect(first.caption).toBe('a caption')

    const second = await harness.runtime.annotateArtifact({
      session, logicalName: 'summary.csv', title: 'final',
      ...authorizeAnnotateArtifact(session, 'science-annotate-clear-caption-call-2'), signal: new AbortController().signal,
    })
    expect(second.caption).toBeUndefined()
    const stored = await harness.ctx.scienceArtifactStore.getVersion(second.projectId, second.versionId)
    expect(stored?.caption).toBeUndefined()
  })

  it('rejects a toolCallId that already authorized a prior artifact annotation', async () => {
    const root = tmp('.science-annotate-tool-call-reused-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-annotate-tool-call-reused')
    await captureFiles(harness, root, session, { 'a.csv': 'a', 'b.csv': 'b' })
    const shared = authorizeAnnotateArtifact(session, 'science-annotate-tool-call-reused-call')

    await harness.runtime.annotateArtifact({
      session, logicalName: 'a.csv', title: 'first', ...shared, signal: new AbortController().signal,
    })
    await expect(harness.runtime.annotateArtifact({
      session, logicalName: 'b.csv', title: 'second', ...shared, signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'ARTIFACT_ANNOTATE_TOOL_CALL_REUSED' })
  })

  it('rejects curation of a direct human-edit version', async () => {
    const root = tmp('.science-annotate-human-edit-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-annotate-human-edit')
    await captureFiles(harness, root, session, { 'chart.png': 'PNG original' }, { rasterArtifacts: ['chart.png'] })
    const parent = replayScience(session.events)?.artifacts.find(candidate => candidate.logicalName === 'chart.png')
    if (parent === undefined) throw new Error('expected run-produced PNG parent')
    const store = harness.ctx.scienceArtifactStore
    const stored = await store.appendVersion(parent.projectId, parent.artifactId, {
      producerSessionId: session.id,
      data: new TextEncoder().encode('PNG human edit'),
      mediaType: 'image/png',
      contentOrigin: 'human-edit',
      baseVersionId: parent.versionId,
    })
    await store.annotateVersion(parent.projectId, stored.versionId, { actor: 'human', sessionId: session.id, title: parent.title })
    session.append('science/artifact-saved', {
      version: 1,
      artifact: {
        artifactId: parent.artifactId,
        logicalName: parent.logicalName,
        version: stored.ordinal,
        title: parent.title,
        projectId: parent.projectId,
        versionId: stored.versionId,
        sha256: stored.sha256,
        seenAt: Date.now(),
      },
    })

    await expect(harness.runtime.annotateArtifact({
      session,
      logicalName: parent.logicalName,
      title: 'Forbidden curation',
      ...authorizeAnnotateArtifact(session),
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'ARTIFACT_NOT_CURATABLE' })
  })

  it('preserves addressable figure state while curating PNG metadata', async () => {
    const root = tmp('.science-annotate-chart-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-annotate-chart')
    const chart = {
      runtime: 'matplotlib',
      png: { width: 1, height: 1, dpi: 120 },
      elements: [{ id: 'title', kind: 'title', axes: null, label: null, current: 'Evidence' }],
      hitmap: [{ id: 'title', bbox: [0, 0, 1, 1], z: 1 }],
      hitmapStatus: 'ok',
    }
    await captureFiles(harness, root, session, { 'chart.png': 'PNG' }, {
      rasterArtifacts: ['chart.png'],
      chartResult: { charts: { 'chart.png': chart }, errors: {} },
    })
    const captured = replayScience(session.events)?.artifacts.find(candidate => candidate.logicalName === 'chart.png')
    if (captured === undefined) throw new Error('expected a captured chart.png version')
    const beforeFigureState = await harness.ctx.scienceArtifactStore.getFigureState(captured.projectId, captured.versionId)
    expect(beforeFigureState).toMatchObject({ figureKey: 'chart.png', dpi: 120 })

    const annotated = await harness.runtime.annotateArtifact({
      session, logicalName: 'chart.png', title: 'Addressable evidence',
      ...authorizeAnnotateArtifact(session), signal: new AbortController().signal,
    })

    const afterFigureState = await harness.ctx.scienceArtifactStore.getFigureState(annotated.projectId, annotated.versionId)
    expect(afterFigureState).toEqual(beforeFigureState)
  })

  it('curates a non-image artifact identically', async () => {
    const root = tmp('.science-annotate-text-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-annotate-text')
    await captureFiles(harness, root, session, { 'report.md': '# Report\n' })

    const annotated = await harness.runtime.annotateArtifact({
      session, logicalName: 'report.md', title: 'Final report',
      ...authorizeAnnotateArtifact(session), signal: new AbortController().signal,
    })
    await expect(harness.ctx.scienceArtifactStore.getVersion(annotated.projectId, annotated.versionId))
      .resolves.toMatchObject({ mediaType: 'text/markdown' })
  })

  it('curates an exact named version in place, leaving every other version untouched', async () => {
    const root = tmp('.science-annotate-exact-version-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-annotate-exact-version')
    await captureFiles(harness, root, session, { 'notes.txt': 'v1' })
    const v1 = replayScience(session.events)?.artifacts.find(a => a.logicalName === 'notes.txt' && a.version === 1)
    expect(v1).toBeDefined()
    if (v1 === undefined) throw new Error('expected notes.txt v1')
    await captureFiles(harness, root, session, { 'notes.txt': 'v2' }, {
      editBaselines: { 'notes.txt': { artifactId: v1.artifactId, version: 1 } },
    })

    const annotatedLatest = await harness.runtime.annotateArtifact({
      session, logicalName: 'notes.txt', version: 2, title: 'Current notes',
      ...authorizeAnnotateArtifact(session, 'science-annotate-exact-version-call-2'), signal: new AbortController().signal,
    })
    await expect(harness.ctx.scienceArtifactStore.getVersion(annotatedLatest.projectId, annotatedLatest.versionId))
      .resolves.toMatchObject({ baseVersionId: v1.versionId, baseExplicit: true })

    const annotated = await harness.runtime.annotateArtifact({
      session, logicalName: 'notes.txt', version: 1, title: 'Original notes',
      ...authorizeAnnotateArtifact(session, 'science-annotate-exact-version-call-1'), signal: new AbortController().signal,
    })
    expect(annotated.version).toBe(1)
    expect(annotated.versionId).toBe(v1.versionId)
    expect(annotated.sha256).toBe(v1.sha256)
    await expect(harness.ctx.scienceArtifactStore.getVersion(annotated.projectId, annotated.versionId))
      .resolves.toMatchObject({ contentOrigin: 'run-auto' })
    const artifacts = replayScience(session.events)?.artifacts.filter(a => a.logicalName === 'notes.txt')
    expect(artifacts?.map(a => a.version)).toEqual([1, 2])
    expect(artifacts?.at(0)?.title).toBe('Original notes')
    expect(artifacts?.at(1)).toMatchObject({ title: 'Current notes' })
  })

  it('supports a curation chain: repeated annotate calls retitle the same version', async () => {
    const root = tmp('.science-annotate-chain-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-annotate-chain')
    await captureFiles(harness, root, session, { 'plot.json': '{"ok":true}' })

    const first = await harness.runtime.annotateArtifact({
      session, logicalName: 'plot.json', title: 'draft',
      ...authorizeAnnotateArtifact(session, 'science-annotate-chain-call-1'), signal: new AbortController().signal,
    })
    const second = await harness.runtime.annotateArtifact({
      session, logicalName: 'plot.json', title: 'final',
      ...authorizeAnnotateArtifact(session, 'science-annotate-chain-call-2'), signal: new AbortController().signal,
    })
    expect(second.artifactId).toBe(first.artifactId)
    expect(second.version).toBe(first.version)
    expect(second.title).toBe('final')
    const artifacts = replayScience(session.events)?.artifacts.filter(a => a.logicalName === 'plot.json')
    expect(artifacts?.map(a => a.version)).toEqual([1])
    expect(artifacts?.at(0)?.title).toBe('final')
  })

  it('rejects an unknown logical_name', async () => {
    const root = tmp('.science-annotate-missing-name-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-annotate-missing-name')
    await harness.runtime.bindEnvironment({ session, profileId: ScienceEnvironmentProfileId('fake'), signal: new AbortController().signal })

    await expect(harness.runtime.annotateArtifact({
      session, logicalName: 'does-not-exist.csv', title: 'x',
      ...authorizeAnnotateArtifact(session), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'ARTIFACT_NOT_FOUND' })
  })

  it('directs an uncaptured retained PNG back through a producing run without capturing it during annotation', async () => {
    const root = tmp('.science-annotate-uncaptured-raster-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-annotate-uncaptured-raster')
    await captureFiles(harness, root, session, { 'plots/result.png': 'PNG' })

    const operation = harness.runtime.annotateArtifact({
      session, logicalName: 'plots/result.png', title: 'Result',
      ...authorizeAnnotateArtifact(session), signal: new AbortController().signal,
    })
    await expect(operation).rejects.toMatchObject({ code: 'ARTIFACT_NOT_FOUND' })
    await expect(operation).rejects.toThrow(
      'file "plots/result.png" exists in retained run output but was not captured; '
      + 'run the code that writes it again with raster_artifacts: ["plots/result.png"], then call annotate_artifact again',
    )
    expect(replayScience(session.events)?.artifacts).toEqual([])
    if (session.header.cwd === undefined) throw new Error('expected test Session workspace')
    const project = await harness.ctx.scienceArtifactStore.openProject(session.header.cwd)
    await expect(harness.ctx.scienceArtifactStore.listArtifacts(project.projectId)).resolves.toEqual([])
  })

  it('rejects a version that does not exist for a logical_name that does, with the available versions in the diagnostic', async () => {
    const root = tmp('.science-annotate-missing-version-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-annotate-missing-version')
    await captureFiles(harness, root, session, { 'a.csv': 'x' })

    await expect(harness.runtime.annotateArtifact({
      session, logicalName: 'a.csv', version: 9, title: 'x',
      ...authorizeAnnotateArtifact(session), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'ARTIFACT_NOT_FOUND' })
    await expect(harness.runtime.annotateArtifact({
      session, logicalName: 'a.csv', version: 9, title: 'x',
      ...authorizeAnnotateArtifact(session, 'science-annotate-missing-version-call-2'), signal: new AbortController().signal,
    })).rejects.toThrow(/Available: 1/)
  })

  it('rejects a detached or non-Science Session before it resolves any artifact version', async () => {
    const root = tmp('.science-annotate-session-guards-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const plain = harness.ctx.sessions.create(SessionId('science-annotate-plain-session'))
    await expect(harness.runtime.annotateArtifact({
      session: plain, logicalName: 'x', title: 'x',
      ...authorizeAnnotateArtifact(plain), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'ENVIRONMENT_NOT_READY' })
    const attached = attachScienceSession(harness.ctx, 'science-annotate-detached-session')
    attached.detach()
    await expect(harness.runtime.annotateArtifact({
      session: attached.session, logicalName: 'x', title: 'x',
      ...authorizeAnnotateArtifact(attached.session), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'SESSION_NOT_LIVE' })
  })
})
