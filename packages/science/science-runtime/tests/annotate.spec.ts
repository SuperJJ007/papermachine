/**
 * `ScienceRuntime.annotateArtifact`: metadata-only curation over an artifact
 * version auto-capture already produced — `annotateArtifact` never imports
 * bytes itself, so this suite seeds every annotated artifact through a real
 * captured run.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { ScienceEnvironmentProfileId, replayScience } from '@deepseek-ai/dsh-science-session'
import type { ScienceRunId } from '@deepseek-ai/dsh-science-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { planSessionScratch, runArtifactDirectory } from '../src/scratch.ts'
import {
  attachScienceSession,
  authorizeAnnotateArtifact,
  authorizePythonRun,
  createFakePythonPrefix,
  createKernelRuntimeHarness,
  createScienceSession,
  kernelAction,
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
): Promise<ScienceRunId> {
  if (replayScience(session.events)?.environment === null) {
    await harness.runtime.bindEnvironment({ session, profileId: ScienceEnvironmentProfileId('fake'), signal: new AbortController().signal })
  }
  captureCallCounter += 1
  // The fake driver's `sleep` action holds DONE until `sleepMs` elapses, so
  // the test can write the artifact files under the run's own real `runId`
  // before auto-capture walks the artifact directory after DONE.
  const handle = await harness.runtime.startRun({
    session, language: 'python', code: kernelAction({ action: 'sleep', sleepMs: 200, status: 'ok' }),
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
  it('curates the latest version in place, reusing its store content reference and provenance, with origin model', async () => {
    const root = tmp('.science-annotate-latest-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-annotate-latest')
    const runId = await captureFiles(harness, root, session, { 'summary.csv': 'a,b\n1,2\n' })
    const captured = replayScience(session.events)?.artifacts.find(candidate => candidate.logicalName === 'summary.csv')
    expect(captured).toBeDefined()

    const annotated = await harness.runtime.annotateArtifact({
      session, logicalName: 'summary.csv', title: 'Result summary', caption: 'The final table',
      ...authorizeAnnotateArtifact(session), signal: new AbortController().signal,
    })

    expect(annotated.artifactId).toBe(captured?.artifactId)
    // Titling content the session already holds is not a second result: the
    // curated metadata replaces the captured version rather than standing
    // beside a byte-identical predecessor.
    expect(annotated.version).toBe(1)
    expect(annotated.title).toBe('Result summary')
    expect(annotated.caption).toBe('The final table')
    expect(annotated.origin).toBe('model')
    expect(annotated.versionId).toBe(captured?.versionId)
    expect(annotated.sha256).toBe(captured?.sha256)
    expect(annotated.mediaType).toBe(captured?.mediaType)
    expect(annotated.byteCount).toBe(captured?.byteCount)
    expect(annotated.origin).not.toBe('human-edit')
    if (annotated.origin === 'human-edit') throw new Error('annotate_artifact returned a human edit')
    expect(annotated.runId).toBe(runId)
    expect(annotated.environmentRevision).toBe(captured?.environmentRevision)
    expect(annotated.environmentFingerprint).toBe(captured?.environmentFingerprint)
    const artifacts = replayScience(session.events)?.artifacts.filter(a => a.logicalName === 'summary.csv')
    expect(artifacts?.map(a => a.version)).toEqual([1])
    expect(artifacts?.at(0)?.title).toBe('Result summary')
  })

  it('rejects curation of a direct human-edit version', async () => {
    const root = tmp('.science-annotate-human-edit-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-annotate-human-edit')
    await captureFiles(harness, root, session, { 'chart.vl.json': '{"mark":"bar"}' })
    const parent = replayScience(session.events)?.artifacts.find(candidate => candidate.logicalName === 'chart.vl.json')
    if (parent === undefined || parent.origin === 'human-edit') throw new Error('expected run-produced Vega-Lite parent')
    const stored = await harness.ctx.scienceArtifactStore.appendVersion(parent.projectId, parent.artifactId, {
      producerSessionId: session.id,
      data: new TextEncoder().encode('{"mark":{"type":"bar","color":"red"}}'),
      mediaType: 'image/png',
      origin: 'human-edit',
      title: parent.title,
      editBaselines: parent.versionId,
    })
    session.append('science/artifact-saved', {
      version: 1,
      artifact: {
        artifactId: parent.artifactId,
        producerSessionId: stored.producerSessionId,
        logicalName: parent.logicalName,
        version: stored.ordinal,
        parent: { artifactId: parent.artifactId, version: 1 },
        title: parent.title,
        origin: 'human-edit',
        projectId: parent.projectId,
        versionId: stored.versionId,
        sha256: stored.sha256,
        mediaType: 'image/png',
        byteCount: stored.byteCount,
        environmentRevision: parent.environmentRevision,
        environmentFingerprint: parent.environmentFingerprint,
        createdAt: Date.now(),
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
    expect(annotated.mediaType).toBe('text/markdown')
  })

  it('curates an exact named version in place, leaving every other version untouched', async () => {
    const root = tmp('.science-annotate-exact-version-')
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-annotate-exact-version')
    await captureFiles(harness, root, session, { 'notes.txt': 'v1' })
    await captureFiles(harness, root, session, { 'notes.txt': 'v2' })
    const v1 = replayScience(session.events)?.artifacts.find(a => a.logicalName === 'notes.txt' && a.version === 1)
    expect(v1).toBeDefined()
    if (v1 === undefined) throw new Error('expected notes.txt v1')

    const annotated = await harness.runtime.annotateArtifact({
      session, logicalName: 'notes.txt', version: 1, title: 'Original notes',
      ...authorizeAnnotateArtifact(session), signal: new AbortController().signal,
    })
    expect(annotated.version).toBe(1)
    expect(annotated.versionId).toBe(v1.versionId)
    expect(annotated.sha256).toBe(v1.sha256)
    expect(annotated.origin).not.toBe('human-edit')
    expect(v1.origin).not.toBe('human-edit')
    if (annotated.origin === 'human-edit' || v1.origin === 'human-edit') throw new Error('expected run-produced versions')
    expect(annotated.runId).toBe(v1.runId)
    const artifacts = replayScience(session.events)?.artifacts.filter(a => a.logicalName === 'notes.txt')
    expect(artifacts?.map(a => a.version)).toEqual([1, 2])
    expect(artifacts?.at(0)?.title).toBe('Original notes')
    expect(artifacts?.at(1)?.origin).toBe('auto')
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
