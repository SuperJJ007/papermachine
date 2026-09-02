import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { ProjectArtifactStoreEngine } from '../src/store.ts'

const dirs: string[] = []
const engines: ProjectArtifactStoreEngine[] = []
const SESSION_A = 'session-a' as SessionId

async function makeEngine(): Promise<ProjectArtifactStoreEngine> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-annotations-home-'))
  dirs.push(home)
  const engine = new ProjectArtifactStoreEngine({ journalMode: 'wal', busyTimeoutMs: 2000, storeBackupRetention: 1, reconcileMaxVersions: 2000, dshHome: home })
  engines.push(engine)
  return engine
}

afterEach(async () => {
  await Promise.all(engines.splice(0).map(engine => engine.close()))
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('annotateVersion', () => {
  it('appends a new version_annotations row per call and advances latestAnnotationId', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-annotations-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    const { version } = await engine.createArtifact(projectId, {
      logicalName: 'plot.png', kind: 'figure', originSessionId: SESSION_A, data: new TextEncoder().encode('v1'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })
    expect(version.latestAnnotation).toBeUndefined()

    const first = await engine.annotateVersion(projectId, version.versionId, { actor: 'capture', title: 'plot.png' })
    const second = await engine.annotateVersion(projectId, version.versionId, { actor: 'model', sessionId: SESSION_A, toolCallId: 'call-1', requestHeaderSeq: 1, title: 'Curated Title', caption: 'A caption' })

    expect(first.latestAnnotation?.annotationId).not.toBe(second.latestAnnotation?.annotationId)
    expect(second.latestAnnotation).toMatchObject({ actor: 'model', title: 'Curated Title', caption: 'A caption', toolCallId: 'call-1' })
  })

  it('never changes versions.createdAt or any producer column across annotate calls', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-annotations-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    const { version } = await engine.createArtifact(projectId, {
      logicalName: 'plot.png', kind: 'figure', originSessionId: SESSION_A, data: new TextEncoder().encode('v1'), mediaType: 'image/png', contentOrigin: 'run-auto',
      producerToolCallId: 'call-run-1', producerRequestHeaderSeq: 3,
    })

    const annotated = await engine.annotateVersion(projectId, version.versionId, { actor: 'model', sessionId: SESSION_A, toolCallId: 'call-annotate-1', requestHeaderSeq: 1, title: 'x' })

    expect(annotated.createdAt).toBe(version.createdAt)
    expect(annotated.producerToolCallId).toBe('call-run-1')
    expect(annotated.producerRequestHeaderSeq).toBe(3)
    expect(annotated.producerSessionId).toBe(version.producerSessionId)
    expect(annotated.sha256).toBe(version.sha256)
    expect(annotated.contentOrigin).toBe(version.contentOrigin)
  })

  it('title/caption omitted carries the current value forward across a new row', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-annotations-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    const { version } = await engine.createArtifact(projectId, {
      logicalName: 'plot.png', kind: 'figure', originSessionId: SESSION_A, data: new TextEncoder().encode('v1'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })

    const titled = await engine.annotateVersion(projectId, version.versionId, { actor: 'human', title: 'Kept title', caption: 'Kept caption' })
    // Omitting BOTH fields still creates a new row (a fresh actor/session on the same metadata) and both values ride forward.
    const untouched = await engine.annotateVersion(projectId, version.versionId, { actor: 'human' })
    expect(untouched.title).toBe('Kept title')
    expect(untouched.caption).toBe('Kept caption')
    expect(untouched.latestAnnotation?.annotationId).not.toBe(titled.latestAnnotation?.annotationId)
  })

  it('caption: null explicitly clears it, distinct from omitting it', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-annotations-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    const { version } = await engine.createArtifact(projectId, {
      logicalName: 'plot.png', kind: 'figure', originSessionId: SESSION_A, data: new TextEncoder().encode('v1'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })
    await engine.annotateVersion(projectId, version.versionId, { actor: 'human', title: 'T', caption: 'A caption' })

    const cleared = await engine.annotateVersion(projectId, version.versionId, { actor: 'human', caption: null })
    expect(cleared.caption).toBeUndefined()
    expect(cleared.latestAnnotation?.caption).toBeNull()
    expect(cleared.title).toBe('T')

    // A later omitted caption carries the CLEARED value (null) forward, not the earlier string.
    const kept = await engine.annotateVersion(projectId, version.versionId, { actor: 'human', title: 'T2' })
    expect(kept.caption).toBeUndefined()
    expect(kept.title).toBe('T2')
  })

  it('title: null explicitly clears it symmetrically with caption', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-annotations-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    const { version } = await engine.createArtifact(projectId, {
      logicalName: 'plot.png', kind: 'figure', originSessionId: SESSION_A, data: new TextEncoder().encode('v1'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })
    await engine.annotateVersion(projectId, version.versionId, { actor: 'human', title: 'T' })
    const cleared = await engine.annotateVersion(projectId, version.versionId, { actor: 'human', title: null })
    expect(cleared.title).toBeUndefined()
    expect(cleared.latestAnnotation?.title).toBeNull()
  })

  it('a fresh version has never been annotated: latestAnnotation, title, and caption are all undefined', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-annotations-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    const { version } = await engine.createArtifact(projectId, {
      logicalName: 'plot.png', kind: 'figure', originSessionId: SESSION_A, data: new TextEncoder().encode('v1'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })
    expect(version.latestAnnotation).toBeUndefined()
    expect(version.title).toBeUndefined()
    expect(version.caption).toBeUndefined()
  })

  it('rejects a second capture-actor annotation once a version already carries one', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-annotations-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    const { version } = await engine.createArtifact(projectId, {
      logicalName: 'plot.png', kind: 'figure', originSessionId: SESSION_A, data: new TextEncoder().encode('v1'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })
    await engine.annotateVersion(projectId, version.versionId, { actor: 'capture', title: 'plot.png' })
    await expect(engine.annotateVersion(projectId, version.versionId, { actor: 'capture', title: 'plot.png' })).rejects.toMatchObject({
      code: 'ANNOTATION_ACTOR_NOT_ALLOWED',
    })
  })

  it('lets a model curation or a human edit re-record over an existing capture-actor annotation', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-annotations-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    const { version } = await engine.createArtifact(projectId, {
      logicalName: 'plot.png', kind: 'figure', originSessionId: SESSION_A, data: new TextEncoder().encode('v1'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })
    await engine.annotateVersion(projectId, version.versionId, { actor: 'capture', title: 'plot.png' })
    const curated = await engine.annotateVersion(projectId, version.versionId, {
      actor: 'model', sessionId: SESSION_A, toolCallId: 'call-model-1', requestHeaderSeq: 1, title: 'Curated',
    })
    expect(curated.title).toBe('Curated')
    const edited = await engine.annotateVersion(projectId, version.versionId, { actor: 'human', sessionId: SESSION_A, title: 'Edited' })
    expect(edited.title).toBe('Edited')
  })

  it('rejects a second annotateVersion call citing the same (sessionId, toolCallId, requestHeaderSeq), across different versions', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-annotations-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    const first = await engine.createArtifact(projectId, {
      logicalName: 'a.csv', kind: 'dataset', originSessionId: SESSION_A, data: new TextEncoder().encode('a'), mediaType: 'text/csv', contentOrigin: 'run-auto',
    })
    const second = await engine.createArtifact(projectId, {
      logicalName: 'b.csv', kind: 'dataset', originSessionId: SESSION_A, data: new TextEncoder().encode('b'), mediaType: 'text/csv', contentOrigin: 'run-auto',
    })
    await engine.annotateVersion(projectId, first.version.versionId, {
      actor: 'model', sessionId: SESSION_A, toolCallId: 'call-shared', requestHeaderSeq: 9, title: 'first',
    })
    await expect(engine.annotateVersion(projectId, second.version.versionId, {
      actor: 'model', sessionId: SESSION_A, toolCallId: 'call-shared', requestHeaderSeq: 9, title: 'second',
    })).rejects.toMatchObject({ code: 'ANNOTATION_TOOL_CALL_REUSED' })
  })

  it('rejects a reused call even after it stopped being any version\'s CURRENT annotation', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-annotations-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    const first = await engine.createArtifact(projectId, {
      logicalName: 'a.csv', kind: 'dataset', originSessionId: SESSION_A, data: new TextEncoder().encode('a'), mediaType: 'text/csv', contentOrigin: 'run-auto',
    })
    const second = await engine.createArtifact(projectId, {
      logicalName: 'b.csv', kind: 'dataset', originSessionId: SESSION_A, data: new TextEncoder().encode('b'), mediaType: 'text/csv', contentOrigin: 'run-auto',
    })
    await engine.annotateVersion(projectId, first.version.versionId, {
      actor: 'model', sessionId: SESSION_A, toolCallId: 'call-superseded', requestHeaderSeq: 4, title: 'first',
    })
    await engine.annotateVersion(projectId, first.version.versionId, { actor: 'human', sessionId: SESSION_A, title: 'superseding edit' })
    await expect(engine.annotateVersion(projectId, second.version.versionId, {
      actor: 'model', sessionId: SESSION_A, toolCallId: 'call-superseded', requestHeaderSeq: 4, title: 'reused',
    })).rejects.toMatchObject({ code: 'ANNOTATION_TOOL_CALL_REUSED' })
  })

  it('does not reject the same toolCallId under a different session or a different requestHeaderSeq', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-annotations-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    const first = await engine.createArtifact(projectId, {
      logicalName: 'a.csv', kind: 'dataset', originSessionId: SESSION_A, data: new TextEncoder().encode('a'), mediaType: 'text/csv', contentOrigin: 'run-auto',
    })
    const second = await engine.createArtifact(projectId, {
      logicalName: 'b.csv', kind: 'dataset', originSessionId: SESSION_A, data: new TextEncoder().encode('b'), mediaType: 'text/csv', contentOrigin: 'run-auto',
    })
    const third = await engine.createArtifact(projectId, {
      logicalName: 'c.csv', kind: 'dataset', originSessionId: SESSION_A, data: new TextEncoder().encode('c'), mediaType: 'text/csv', contentOrigin: 'run-auto',
    })
    const SESSION_B = 'session-b' as SessionId
    await engine.annotateVersion(projectId, first.version.versionId, {
      actor: 'model', sessionId: SESSION_A, toolCallId: 'call-distinct', requestHeaderSeq: 1, title: 'first',
    })
    await expect(engine.annotateVersion(projectId, second.version.versionId, {
      actor: 'model', sessionId: SESSION_B, toolCallId: 'call-distinct', requestHeaderSeq: 1, title: 'other session',
    })).resolves.toMatchObject({ title: 'other session' })
    await expect(engine.annotateVersion(projectId, third.version.versionId, {
      actor: 'model', sessionId: SESSION_A, toolCallId: 'call-distinct', requestHeaderSeq: 2, title: 'other header',
    })).resolves.toMatchObject({ title: 'other header' })
  })
})
