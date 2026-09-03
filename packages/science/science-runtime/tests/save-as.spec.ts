/**
 * `ScienceRuntime.saveArtifactAs`: duplicate one committed artifact version
 * into a brand-new logical artifact in the same project. A viewer-only
 * operation (no model tool), so every case here calls the Runtime directly,
 * mirroring `annotate.spec.ts`'s real-capture seeding.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { ScienceEnvironmentProfileId, ScienceVersionId, replayScience } from '@deepseek-ai/dsh-science-session'
import type { ScienceRunId } from '@deepseek-ai/dsh-science-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type { StartScienceRunRequest } from '../src/types.ts'
import { planSessionScratch, runArtifactDirectory } from '../src/scratch.ts'
import {
  attachScienceSession,
  authorizePythonRun,
  createFakePythonPrefix,
  createKernelRuntimeHarness,
  createScienceSession,
  kernelAction,
} from './harness.ts'

// Cases here spawn a real kernel subprocess; under full-suite concurrency the
// default 5s timeout is not enough (same rule as annotate.spec.ts).
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
  root: string,
  harness: Awaited<ReturnType<typeof createKernelRuntimeHarness>>,
  session: Session,
  files: Readonly<Record<string, Uint8Array | string>>,
  options: Pick<StartScienceRunRequest, 'rasterArtifacts'> & { readonly chartResult?: unknown } = {},
): Promise<void> {
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
    ...authorizePythonRun(session, `save-as-capture-${String(captureCallCounter)}`),
    signal: new AbortController().signal,
  })
  for (const [relativePath, data] of Object.entries(files)) {
    await writeArtifact(root, session, handle.runId, relativePath, data)
  }
  const result = await handle.done
  expect(result.terminal.status).toBe('success')
}

describe('ScienceRuntime.saveArtifactAs', () => {
  it('duplicates a captured version into a brand-new artifact, reusing its blob and inheriting title/caption', async () => {
    const root = tmp('.science-save-as-basic-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-save-as-basic')
    await captureFiles(root, harness, session, { 'summary.csv': 'a,b\n1,2\n' })
    const source = replayScience(session.events)?.artifacts.find(candidate => candidate.logicalName === 'summary.csv')
    if (source === undefined) throw new Error('expected a captured summary.csv version')
    await harness.runtime.annotateArtifact({
      session, logicalName: 'summary.csv', title: 'Result summary', caption: 'The final table',
      toolCallId: 'save-as-basic-annotate' as never, requestHeaderSeq: 1, signal: new AbortController().signal,
    })
    const sourceStore = await harness.ctx.scienceArtifactStore.getVersion(source.projectId, source.versionId)
    if (sourceStore === undefined) throw new Error('expected the captured version to exist in the store')

    const saved = await harness.runtime.saveArtifactAs({
      session, sourceVersionId: source.versionId, newLogicalName: 'summary-copy.csv', signal: new AbortController().signal,
    })

    expect(saved.artifactId).not.toBe(source.artifactId)
    expect(saved.logicalName).toBe('summary-copy.csv')
    expect(saved.version).toBe(1)
    expect(saved.title).toBe('Result summary')
    expect(saved.caption).toBe('The final table')
    expect(saved.sha256).toBe(source.sha256)

    const savedStore = await harness.ctx.scienceArtifactStore.getVersion(saved.projectId, saved.versionId)
    expect(savedStore).toMatchObject({
      artifactId: saved.artifactId,
      ordinal: 1,
      baseVersionId: source.versionId,
      baseExplicit: true,
      sha256: sourceStore.sha256,
      mediaType: sourceStore.mediaType,
      byteCount: sourceStore.byteCount,
      contentOrigin: 'run-auto',
      producerSessionId: session.id,
      producerRunId: undefined,
      producerToolCallId: undefined,
      producerRequestHeaderSeq: undefined,
      environmentRevision: sourceStore.environmentRevision,
      environmentFingerprint: sourceStore.environmentFingerprint,
    })
    expect(savedStore?.latestAnnotation).toMatchObject({ actor: 'human', title: 'Result summary', caption: 'The final table' })

    const savedArtifact = await harness.ctx.scienceArtifactStore.getArtifact(saved.projectId, saved.artifactId)
    const sourceArtifact = await harness.ctx.scienceArtifactStore.getArtifact(source.projectId, source.artifactId)
    expect(savedArtifact?.kind).toBe(sourceArtifact?.kind)

    // Content-addressed reuse: the blob for this sha256 is admitted once by
    // capture and re-admitted (idempotently, never duplicated) by save-as.
    const savedBytes = await harness.ctx.scienceArtifactStore.readBlob(saved.projectId, saved.sha256)
    const sourceBytes = await harness.ctx.scienceArtifactStore.readBlob(source.projectId, source.sha256)
    expect(savedBytes).toEqual(sourceBytes)

    const artifacts = replayScience(session.events)?.artifacts.filter(a => a.logicalName === 'summary-copy.csv')
    expect(artifacts?.map(a => a.version)).toEqual([1])
  })

  it('records the session\'s last started turn as producerTurn, unaffected by a turn that starts afterward', async () => {
    const root = tmp('.science-save-as-producer-turn-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-save-as-producer-turn')
    await captureFiles(root, harness, session, { 'summary.csv': 'a,b\n1,2\n' })
    const source = replayScience(session.events)?.artifacts.find(candidate => candidate.logicalName === 'summary.csv')
    if (source === undefined) throw new Error('expected a captured summary.csv version')
    session.append('turn/start', { turn: 1 })

    const saved = await harness.runtime.saveArtifactAs({
      session, sourceVersionId: source.versionId, newLogicalName: 'summary-copy.csv', signal: new AbortController().signal,
    })
    // A turn starting after the save-as call must not retroactively move
    // this version's attribution to the newer turn — the idle-gap bug this
    // fix closes.
    session.append('turn/start', { turn: 2 })

    const savedStore = await harness.ctx.scienceArtifactStore.getVersion(saved.projectId, saved.versionId)
    expect(savedStore).toMatchObject({ producerTurn: 1 })
  })

  it('omits producerTurn when no turn has started in this session yet', async () => {
    const root = tmp('.science-save-as-no-turn-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-save-as-no-turn')
    await captureFiles(root, harness, session, { 'summary.csv': 'a,b\n1,2\n' })
    const source = replayScience(session.events)?.artifacts.find(candidate => candidate.logicalName === 'summary.csv')
    if (source === undefined) throw new Error('expected a captured summary.csv version')

    const saved = await harness.runtime.saveArtifactAs({
      session, sourceVersionId: source.versionId, newLogicalName: 'summary-copy.csv', signal: new AbortController().signal,
    })

    const savedStore = await harness.ctx.scienceArtifactStore.getVersion(saved.projectId, saved.versionId)
    expect(savedStore?.producerTurn).toBeUndefined()
  })

  it('carries no caption forward when the source has none', async () => {
    const root = tmp('.science-save-as-no-caption-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-save-as-no-caption')
    await captureFiles(root, harness, session, { 'notes.txt': 'v1' })
    const source = replayScience(session.events)?.artifacts.find(candidate => candidate.logicalName === 'notes.txt')
    if (source === undefined) throw new Error('expected a captured notes.txt version')

    const saved = await harness.runtime.saveArtifactAs({
      session, sourceVersionId: source.versionId, newLogicalName: 'notes-copy.txt', signal: new AbortController().signal,
    })
    expect(saved.caption).toBeUndefined()
  })

  it('preserves addressable figure state for a duplicated chart PNG', async () => {
    const root = tmp('.science-save-as-chart-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-save-as-chart')
    const chart = {
      runtime: 'matplotlib',
      png: { width: 1, height: 1, dpi: 120 },
      elements: [{ id: 'title', kind: 'title', axes: null, label: null, current: 'Evidence' }],
      hitmap: [{ id: 'title', bbox: [0, 0, 1, 1], z: 1 }],
      hitmapStatus: 'ok',
    }
    await captureFiles(root, harness, session, { 'chart.png': 'PNG' }, {
      rasterArtifacts: ['chart.png'], chartResult: { charts: { 'chart.png': chart }, errors: {} },
    })
    const source = replayScience(session.events)?.artifacts.find(candidate => candidate.logicalName === 'chart.png')
    if (source === undefined) throw new Error('expected a captured chart.png version')
    const sourceFigureState = await harness.ctx.scienceArtifactStore.getFigureState(source.projectId, source.versionId)
    expect(sourceFigureState).toMatchObject({ figureKey: 'chart.png', dpi: 120 })

    const saved = await harness.runtime.saveArtifactAs({
      session, sourceVersionId: source.versionId, newLogicalName: 'chart-copy.png', signal: new AbortController().signal,
    })

    const savedFigureState = await harness.ctx.scienceArtifactStore.getFigureState(saved.projectId, saved.versionId)
    expect(savedFigureState).toEqual({ ...sourceFigureState, versionId: saved.versionId })
  })

  it('rejects a newLogicalName already used in the project', async () => {
    const root = tmp('.science-save-as-conflict-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-save-as-conflict')
    await captureFiles(root, harness, session, { 'a.csv': 'a', 'b.csv': 'b' })
    const a = replayScience(session.events)?.artifacts.find(candidate => candidate.logicalName === 'a.csv')
    if (a === undefined) throw new Error('expected a captured a.csv version')

    await expect(harness.runtime.saveArtifactAs({
      session, sourceVersionId: a.versionId, newLogicalName: 'b.csv', signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'ARTIFACT_LOGICAL_NAME_CONFLICT' })
  })

  it('rejects a sourceVersionId that does not identify a committed version', async () => {
    const root = tmp('.science-save-as-missing-source-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-save-as-missing-source')
    await harness.runtime.bindEnvironment({ session, profileId: ScienceEnvironmentProfileId('fake'), signal: new AbortController().signal })

    await expect(harness.runtime.saveArtifactAs({
      session, sourceVersionId: ScienceVersionId('never-committed'), newLogicalName: 'copy.csv', signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'ARTIFACT_VERSION_NOT_FOUND' })
  })

  it('resolves a source version this session has never itself loaded, from anywhere in the owning project', async () => {
    const root = tmp('.science-save-as-cross-session-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const workspace = join(root, 'workspace')
    const producer = createScienceSession(harness.ctx, 'science-save-as-cross-session-producer', workspace)
    await captureFiles(root, harness, producer, { 'shared.csv': 'shared' })
    const source = replayScience(producer.events)?.artifacts.find(candidate => candidate.logicalName === 'shared.csv')
    if (source === undefined) throw new Error('expected a captured shared.csv version')

    const viewer = createScienceSession(harness.ctx, 'science-save-as-cross-session-viewer', workspace)
    const saved = await harness.runtime.saveArtifactAs({
      session: viewer, sourceVersionId: source.versionId, newLogicalName: 'shared-copy.csv', signal: new AbortController().signal,
    })
    expect(saved.sha256).toBe(source.sha256)
    expect(saved.projectId).toBe(source.projectId)
  })

  it('falls back to the new logical name for title and omits environment facts when the source carries none', async () => {
    const root = tmp('.science-save-as-no-environment-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-save-as-no-environment')
    const { projectId } = await harness.ctx.scienceArtifactStore.openProject(session.header.cwd ?? '')
    // A raw store-level `createArtifact`, bypassing capture.ts entirely: no
    // environment facts and no `capture`-actor title annotation, matching a
    // hypothetical future `content_origin: 'import'` producer this schema
    // already reserves.
    const raw = await harness.ctx.scienceArtifactStore.createArtifact(projectId, {
      logicalName: 'imported.csv', kind: 'dataset', originSessionId: session.id,
      data: new TextEncoder().encode('x'), mediaType: 'text/csv', contentOrigin: 'import',
    })
    expect(raw.version.environmentRevision).toBeUndefined()
    expect(raw.version.title).toBeUndefined()

    const saved = await harness.runtime.saveArtifactAs({
      session, sourceVersionId: raw.version.versionId, newLogicalName: 'imported-copy.csv', signal: new AbortController().signal,
    })
    expect(saved.title).toBe('imported-copy.csv')
    expect(saved.caption).toBeUndefined()
    const savedStore = await harness.ctx.scienceArtifactStore.getVersion(saved.projectId, saved.versionId)
    expect(savedStore).toMatchObject({ environmentRevision: undefined, environmentFingerprint: undefined, contentOrigin: 'import' })
  })

  it('propagates a store failure other than a logical-name conflict unchanged', async () => {
    const root = tmp('.science-save-as-store-failure-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-save-as-store-failure')
    await captureFiles(root, harness, session, { 'a.csv': 'a' })
    const source = replayScience(session.events)?.artifacts.find(candidate => candidate.logicalName === 'a.csv')
    if (source === undefined) throw new Error('expected a captured a.csv version')
    const failure = new Error('disk full')
    const createArtifact = vi.spyOn(harness.ctx.scienceArtifactStore, 'createArtifact').mockRejectedValueOnce(failure)

    // A store failure that is not itself a `ScienceRuntimeError` is folded
    // into the same pre-publication `INFRASTRUCTURE_FAILURE` classification
    // every other Runtime operation uses (`prepublicationError`), carrying
    // the original error as `cause` rather than surfacing it directly.
    await expect(harness.runtime.saveArtifactAs({
      session, sourceVersionId: source.versionId, newLogicalName: 'copy.csv', signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'INFRASTRUCTURE_FAILURE', cause: failure })
    createArtifact.mockRestore()
  })

  it('rejects a detached or non-Science Session before it resolves any artifact version', async () => {
    const root = tmp('.science-save-as-session-guards-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const plain = harness.ctx.sessions.create(SessionId('science-save-as-plain-session'))
    await expect(harness.runtime.saveArtifactAs({
      session: plain, sourceVersionId: ScienceVersionId('x'), newLogicalName: 'x.csv', signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'ENVIRONMENT_NOT_READY' })
    const attached = attachScienceSession(harness.ctx, 'science-save-as-detached-session')
    attached.detach()
    await expect(harness.runtime.saveArtifactAs({
      session: attached.session, sourceVersionId: ScienceVersionId('x'), newLogicalName: 'x.csv', signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'SESSION_NOT_LIVE' })
  })
})
