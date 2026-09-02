import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { classifyVersion, reconcileProject, type ReconcileArtifactSavedEvent } from '../src/reconcile.ts'
import { ProjectArtifactStoreError } from '../src/errors.ts'
import { ProjectArtifactStoreEngine } from '../src/store.ts'
import { ArtifactId, VersionId } from '../src/ids.ts'
import type { ReconstructVersionInput, VersionRecord } from '../src/types.ts'

const dirs: string[] = []
const engines: ProjectArtifactStoreEngine[] = []
const SESSION_A = 'session-a' as SessionId
const SESSION_B = 'session-b' as SessionId

async function makeEngine(reconcileMaxVersions = 2000): Promise<ProjectArtifactStoreEngine> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-reconcile-home-'))
  dirs.push(home)
  const engine = new ProjectArtifactStoreEngine({
    journalMode: 'wal', busyTimeoutMs: 2000, storeBackupRetention: 1, reconcileMaxVersions, dshHome: home,
  })
  engines.push(engine)
  return engine
}

afterEach(async () => {
  await Promise.all(engines.splice(0).map(engine => engine.close()))
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

/** Build a minimal `VersionRecord`-shaped value for `classifyVersion`'s pure unit tests. */
function version(overrides: Partial<VersionRecord>): VersionRecord {
  return {
    versionId: VersionId('v1'),
    artifactId: ArtifactId('a1'),
    ordinal: 1,
    baseVersionId: undefined,
    baseExplicit: false,
    sha256: 'a'.repeat(64),
    mediaType: 'image/png',
    byteCount: 3,
    contentOrigin: 'run-auto',
    producerSessionId: SESSION_A,
    producerRunId: undefined,
    producerToolCallId: undefined,
    producerRequestHeaderSeq: undefined,
    producerTurn: undefined,
    environmentRevision: undefined,
    environmentFingerprint: undefined,
    createdAt: 1000,
    latestAnnotation: undefined,
    title: undefined,
    caption: undefined,
    ...overrides,
  }
}

function event(overrides: Partial<ReconcileArtifactSavedEvent>): ReconcileArtifactSavedEvent {
  return {
    artifactId: ArtifactId('a1'),
    versionId: VersionId('v1'),
    ordinal: 1,
    logicalName: 'plot.png',
    sha256: 'a'.repeat(64),
    title: null,
    caption: null,
    seenAt: 1000,
    producerSessionId: SESSION_A,
    ...overrides,
  }
}

describe('classifyVersion', () => {
  it('consistent: same versionId in both, same sha256, same title/caption', () => {
    expect(classifyVersion(version({ title: 'x', caption: 'y' }), event({ title: 'x', caption: 'y' }), true)).toBe('consistent')
  })

  it('orphan: version exists in the store, no matching event', () => {
    expect(classifyVersion(version({}), undefined, true)).toBe('orphan')
  })

  it('unverified: an incomplete event set cannot prove that an absent event is an orphan', () => {
    expect(classifyVersion(version({}), undefined, false)).toBe('unverified')
  })

  it('content-conflict: same versionId, different sha256', () => {
    expect(classifyVersion(version({ sha256: 'a'.repeat(64) }), event({ sha256: 'b'.repeat(64) }), false)).toBe('content-conflict')
  })

  it('metadata-diverged: same sha256, store\'s current title differs from the event\'s presentation snapshot', () => {
    expect(classifyVersion(version({ title: 'Curated Title', caption: undefined }), event({ title: 'plot.png', caption: null }), true))
      .toBe('metadata-diverged')
  })

  it('metadata-diverged: caption alone differs', () => {
    expect(classifyVersion(version({ title: 'x', caption: 'new' }), event({ title: 'x', caption: 'old' }), true)).toBe('metadata-diverged')
  })

  it('treats an undefined store title/caption as equal to a null event title/caption', () => {
    expect(classifyVersion(version({ title: undefined, caption: undefined }), event({ title: null, caption: null }), true)).toBe('consistent')
  })
})

describe('reconcileProject', () => {
  it('marks a store row with no matching event orphan, and clears orphan once a matching event appears', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-reconcile-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    const { version: v1 } = await engine.createArtifact(projectId, {
      logicalName: 'plot.png', kind: 'figure', originSessionId: SESSION_A,
      data: new TextEncoder().encode('bytes-v1'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })

    const noEvents = new Map<VersionId, ReconcileArtifactSavedEvent>()
    const first = await reconcileProject(engine, projectId, noEvents, { eventSetComplete: true, maxVersions: 100 })
    expect(first.outcomes).toEqual([{ versionId: v1.versionId, kind: 'orphan' }])
    const health1 = await engine.getReconciliationSummary(projectId)
    expect(health1.orphanCount).toBe(1)

    const withEvent = new Map([[v1.versionId, event({ artifactId: v1.artifactId, versionId: v1.versionId, sha256: v1.sha256 })]])
    const second = await reconcileProject(engine, projectId, withEvent, { eventSetComplete: true, maxVersions: 100 })
    expect(second.outcomes).toEqual([{ versionId: v1.versionId, kind: 'consistent' }])
    const health2 = await engine.getReconciliationSummary(projectId)
    expect(health2.orphanCount).toBe(0)
  })

  it('preserves orphan health but refreshes missing content when an incomplete event set cannot verify a row', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-reconcile-ws-'))
    dirs.push(workspace)
    const { projectId, storeRoot } = await engine.openProject(workspace)
    const { version: stored } = await engine.createArtifact(projectId, {
      logicalName: 'plot.png', kind: 'figure', originSessionId: SESSION_A,
      data: new TextEncoder().encode('bytes-v1'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })
    await engine.setVersionHealth(projectId, stored.versionId, { orphan: true })
    await rm(join(storeRoot, 'blobs', 'sha256', stored.sha256.slice(0, 2), stored.sha256), { force: true })
    const healthSpy = vi.spyOn(engine, 'setVersionHealth')

    const result = await reconcileProject(engine, projectId, new Map(), { eventSetComplete: false, maxVersions: 100 })

    expect(result.outcomes).toEqual([{ versionId: stored.versionId, kind: 'unverified' }])
    expect(healthSpy).toHaveBeenCalledWith(projectId, stored.versionId, { missingContent: true })
    const health = await engine.getReconciliationSummary(projectId)
    expect(health).toMatchObject({ orphanCount: 1, missingContentCount: 1 })
  })

  it('still records content conflicts and reconstructs dangling events from an incomplete event set', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-reconcile-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    const { version: stored } = await engine.createArtifact(projectId, {
      logicalName: 'plot.png', kind: 'figure', originSessionId: SESSION_A,
      data: new TextEncoder().encode('bytes-v1'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })
    const danglingVersionId = VersionId('dangling-incomplete')
    const events = new Map<VersionId, ReconcileArtifactSavedEvent>([
      [stored.versionId, event({ artifactId: stored.artifactId, versionId: stored.versionId, sha256: 'f'.repeat(64) })],
      [danglingVersionId, event({
        artifactId: ArtifactId('dangling-artifact-incomplete'), versionId: danglingVersionId,
        logicalName: 'summary.csv', sha256: 'c'.repeat(64),
      })],
    ])

    const result = await reconcileProject(engine, projectId, events, { eventSetComplete: false, maxVersions: 100 })

    expect(result.outcomes).toEqual([{ versionId: stored.versionId, kind: 'content-conflict' }])
    expect(result.reconstructed).toEqual([danglingVersionId])
    const health = await engine.getReconciliationSummary(projectId)
    expect(health).toMatchObject({ orphanCount: 1, reconstructedCount: 1 })
  })

  it('reconstructs a dangling event into a new store row and artifact, marked reconstructed', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-reconcile-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)

    const danglingVersionId = VersionId('dangling-version')
    const danglingArtifactId = ArtifactId('dangling-artifact')
    const events = new Map([[danglingVersionId, event({
      artifactId: danglingArtifactId, versionId: danglingVersionId, logicalName: 'summary.csv',
      sha256: 'c'.repeat(64), title: 'Summary', caption: 'A caption', producerSessionId: SESSION_B,
    })]])

    const result = await reconcileProject(engine, projectId, events, { eventSetComplete: true, maxVersions: 100 })
    expect(result.reconstructed).toEqual([danglingVersionId])

    const reconstructedVersion = await engine.getVersion(projectId, danglingVersionId)
    expect(reconstructedVersion).toMatchObject({
      artifactId: danglingArtifactId, contentOrigin: 'import', mediaType: 'text/csv',
      producerSessionId: SESSION_B, title: 'Summary', caption: 'A caption',
    })
    const artifact = await engine.getArtifact(projectId, danglingArtifactId)
    expect(artifact).toMatchObject({ logicalName: 'summary.csv', kind: 'dataset', latestVersionId: danglingVersionId })

    const health = await engine.getReconciliationSummary(projectId)
    expect(health.reconstructedCount).toBe(1)
    // Blob was never admitted for this dangling event, so it is also missing content.
    expect(health.missingContentCount).toBe(1)
  })

  it('records a content conflict: same versionId, different sha256 in store vs. event — event untouched, store row marked orphan', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-reconcile-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    const { version: v1 } = await engine.createArtifact(projectId, {
      logicalName: 'plot.png', kind: 'figure', originSessionId: SESSION_A,
      data: new TextEncoder().encode('bytes-v1'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })
    const conflicting = new Map([[v1.versionId, event({ artifactId: v1.artifactId, versionId: v1.versionId, sha256: 'f'.repeat(64) })]])

    const result = await reconcileProject(engine, projectId, conflicting, { eventSetComplete: true, maxVersions: 100 })
    expect(result.outcomes).toEqual([{ versionId: v1.versionId, kind: 'content-conflict' }])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain(v1.versionId)

    const health = await engine.getReconciliationSummary(projectId)
    expect(health.orphanCount).toBe(1)
    // The store's own row is untouched: its sha256 still names the real committed bytes.
    const stored = await engine.getVersion(projectId, v1.versionId)
    expect(stored?.sha256).toBe(v1.sha256)
  })

  it('metadata divergence is a no-op beyond the standard health write: the store keeps its own title', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-reconcile-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    const { version: v1 } = await engine.createArtifact(projectId, {
      logicalName: 'plot.png', kind: 'figure', originSessionId: SESSION_A,
      data: new TextEncoder().encode('bytes-v1'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })
    await engine.annotateVersion(projectId, v1.versionId, { actor: 'model', sessionId: SESSION_A, title: 'Curated Title' })
    const stale = new Map([[v1.versionId, event({ artifactId: v1.artifactId, versionId: v1.versionId, sha256: v1.sha256, title: 'plot.png' })]])

    const result = await reconcileProject(engine, projectId, stale, { eventSetComplete: true, maxVersions: 100 })
    expect(result.outcomes).toEqual([{ versionId: v1.versionId, kind: 'metadata-diverged' }])
    expect(result.errors).toEqual([])

    const stored = await engine.getVersion(projectId, v1.versionId)
    expect(stored?.title).toBe('Curated Title')
    const health = await engine.getReconciliationSummary(projectId)
    expect(health.orphanCount).toBe(0)
  })

  it('marks a version whose blob is missing from disk missingContent, without deleting the row', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-reconcile-ws-'))
    dirs.push(workspace)
    const { projectId, storeRoot } = await engine.openProject(workspace)
    const { version: v1 } = await engine.createArtifact(projectId, {
      logicalName: 'plot.png', kind: 'figure', originSessionId: SESSION_A,
      data: new TextEncoder().encode('bytes-v1'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })
    await rm(join(storeRoot, 'blobs', 'sha256', v1.sha256.slice(0, 2), v1.sha256), { force: true })
    const events = new Map([[v1.versionId, event({ artifactId: v1.artifactId, versionId: v1.versionId, sha256: v1.sha256 })]])

    const result = await reconcileProject(engine, projectId, events, { eventSetComplete: true, maxVersions: 100 })
    expect(result.outcomes).toEqual([{ versionId: v1.versionId, kind: 'consistent' }])
    const health = await engine.getReconciliationSummary(projectId)
    expect(health.missingContentCount).toBe(1)
    const stored = await engine.getVersion(projectId, v1.versionId)
    expect(stored).toBeDefined()
  })

  it('is idempotent: running twice over an unchanged store and event set produces the same version_health state', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-reconcile-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    const { version: v1 } = await engine.createArtifact(projectId, {
      logicalName: 'plot.png', kind: 'figure', originSessionId: SESSION_A,
      data: new TextEncoder().encode('bytes-v1'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })
    const danglingVersionId = VersionId('dangling-version')
    const events = new Map([[danglingVersionId, event({
      artifactId: ArtifactId('dangling-artifact'), versionId: danglingVersionId, logicalName: 'summary.csv', sha256: 'c'.repeat(64),
    })]])
    // v1 is orphan (no event names it); danglingVersionId is a dangling event.

    await reconcileProject(engine, projectId, events, { eventSetComplete: true, maxVersions: 100 })
    const after1 = await engine.getReconciliationSummary(projectId)

    await reconcileProject(engine, projectId, events, { eventSetComplete: true, maxVersions: 100 })
    const after2 = await engine.getReconciliationSummary(projectId)

    expect(after2.orphanCount).toBe(after1.orphanCount)
    expect(after2.reconstructedCount).toBe(after1.reconstructedCount)
    expect(after2.missingContentCount).toBe(after1.missingContentCount)
    expect(after2.items.map(item => item.versionId).sort()).toEqual(after1.items.map(item => item.versionId).sort())
    // The dangling event is reconstructed exactly once; a second reconcile leaves it as a plain consistent row, not a re-reconstruction.
    expect(after2.reconstructedCount).toBe(1)
    expect(v1.versionId).toBeDefined()
  })

  it('caps work at maxVersions and reports truncated, without processing the remainder', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-reconcile-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    for (let i = 0; i < 3; i += 1) {
      await engine.createArtifact(projectId, {
        logicalName: `plot-${String(i)}.png`, kind: 'figure', originSessionId: SESSION_A,
        data: new TextEncoder().encode(`bytes-${String(i)}`), mediaType: 'image/png', contentOrigin: 'run-auto',
      })
    }
    const result = await reconcileProject(engine, projectId, new Map(), { eventSetComplete: true, maxVersions: 2 })
    expect(result.checkedVersions).toBe(2)
    expect(result.truncated).toBe(true)
  })

  it('does not truncate when outstanding work is exactly at the bound', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-reconcile-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    await engine.createArtifact(projectId, {
      logicalName: 'plot.png', kind: 'figure', originSessionId: SESSION_A,
      data: new TextEncoder().encode('bytes'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })
    const result = await reconcileProject(engine, projectId, new Map(), { eventSetComplete: true, maxVersions: 1 })
    expect(result.checkedVersions).toBe(1)
    expect(result.truncated).toBe(false)
  })

  it('never writes to any file outside the project store — a co-located file used to stand in for a session log is untouched', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-reconcile-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    const { version: v1 } = await engine.createArtifact(projectId, {
      logicalName: 'plot.png', kind: 'figure', originSessionId: SESSION_A,
      data: new TextEncoder().encode('bytes-v1'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })

    const sessionLogPath = join(workspace, 'fake-session-log.jsonl')
    const sessionLogBytes = '{"type":"science/artifact-saved","seq":1}\n'
    await writeFile(sessionLogPath, sessionLogBytes, 'utf8')
    const before = await stat(sessionLogPath)
    const beforeContent = await readFile(sessionLogPath, 'utf8')

    const events = new Map([[v1.versionId, event({ artifactId: v1.artifactId, versionId: v1.versionId, sha256: v1.sha256 })]])
    await reconcileProject(engine, projectId, events, { eventSetComplete: true, maxVersions: 100 })
    // Also exercise the dangling-event/reconstruction write path in the same call.
    const danglingVersionId = VersionId('dangling-version-2')
    await reconcileProject(engine, projectId, new Map([[danglingVersionId, event({
      artifactId: ArtifactId('dangling-artifact-2'), versionId: danglingVersionId, logicalName: 'notes.txt', sha256: 'd'.repeat(64),
    })]]), { eventSetComplete: true, maxVersions: 100 })

    const after = await stat(sessionLogPath)
    const afterContent = await readFile(sessionLogPath, 'utf8')
    expect(after.mtimeMs).toBe(before.mtimeMs)
    expect(after.size).toBe(before.size)
    expect(afterContent).toBe(beforeContent)
    expect(afterContent).toBe(sessionLogBytes)
  })

  it('infers an unrecognized logicalName extension as application/octet-stream, not one of the five known types', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-reconcile-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    const danglingVersionId = VersionId('dangling-unknown-ext')
    const events = new Map([[danglingVersionId, event({
      artifactId: ArtifactId('dangling-unknown-artifact'), versionId: danglingVersionId,
      logicalName: 'archive.zip', sha256: 'e'.repeat(64),
    })]])

    await reconcileProject(engine, projectId, events, { eventSetComplete: true, maxVersions: 100 })
    const reconstructedVersion = await engine.getVersion(projectId, danglingVersionId)
    expect(reconstructedVersion?.mediaType).toBe('application/octet-stream')
    const artifact = await engine.getArtifact(projectId, ArtifactId('dangling-unknown-artifact'))
    expect(artifact?.kind).toBe('document')
  })

  it('records one diagnostic per item and continues the batch when a blob-existence check fails', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-reconcile-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    const { version: v1 } = await engine.createArtifact(projectId, {
      logicalName: 'plot.png', kind: 'figure', originSessionId: SESSION_A,
      data: new TextEncoder().encode('bytes-v1'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })
    const spy = vi.spyOn(engine, 'blobByteCount').mockRejectedValueOnce(new Error('forced blob check failure'))

    const result = await reconcileProject(engine, projectId, new Map(), { eventSetComplete: true, maxVersions: 100 })
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('blob existence check failed')
    expect(result.errors[0]).toContain(v1.versionId)
    spy.mockRestore()
  })

  it('records one diagnostic per item and continues the batch when writing version_health fails', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-reconcile-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    const { version: v1 } = await engine.createArtifact(projectId, {
      logicalName: 'plot.png', kind: 'figure', originSessionId: SESSION_A,
      data: new TextEncoder().encode('bytes-v1'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })
    const spy = vi.spyOn(engine, 'setVersionHealth').mockRejectedValueOnce(new Error('forced health write failure'))

    const result = await reconcileProject(engine, projectId, new Map(), { eventSetComplete: true, maxVersions: 100 })
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('failed to record reconciliation health')
    expect(result.errors[0]).toContain(v1.versionId)
    spy.mockRestore()
  })

  it('records one diagnostic per item and continues the batch when a dangling-event reconstruction fails', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-reconcile-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    // A real (non-mocked) failure: the dangling event's artifactId is unknown
    // to the store, but its logicalName collides with a DIFFERENT existing artifact.
    await engine.createArtifact(projectId, {
      logicalName: 'shared.png', kind: 'figure', originSessionId: SESSION_A,
      data: new TextEncoder().encode('bytes'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })
    const danglingVersionId = VersionId('dangling-conflict')
    const events = new Map([[danglingVersionId, event({
      artifactId: ArtifactId('a-different-artifact-id'), versionId: danglingVersionId,
      logicalName: 'shared.png', sha256: 'f'.repeat(64),
    })]])

    const result = await reconcileProject(engine, projectId, events, { eventSetComplete: true, maxVersions: 100 })
    expect(result.reconstructed).toEqual([])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('reconstruction failed')
    expect(result.errors[0]).toContain(danglingVersionId)
  })
})

describe('ProjectArtifactStoreEngine.reconstructVersion', () => {
  function reconstructInput(overrides: Partial<ReconstructVersionInput>): ReconstructVersionInput {
    return {
      versionId: VersionId('r1'),
      artifactId: ArtifactId('ra1'),
      logicalName: 'reconstructed.png',
      kind: 'figure',
      ordinal: 1,
      sha256: 'a'.repeat(64),
      mediaType: 'image/png',
      byteCount: 0,
      producerSessionId: SESSION_A,
      createdAt: 1000,
      title: null,
      caption: null,
      ...overrides,
    }
  }

  it('is idempotent: a versionId that already names a row is left untouched and returned as-is', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-reconstruct-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    const { version: v1 } = await engine.createArtifact(projectId, {
      logicalName: 'plot.png', kind: 'figure', originSessionId: SESSION_A,
      data: new TextEncoder().encode('bytes-v1'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })

    const result = await engine.reconstructVersion(projectId, reconstructInput({
      versionId: v1.versionId, artifactId: v1.artifactId, sha256: 'different-sha-would-be-ignored'.padEnd(64, '0'),
    }))
    expect(result.sha256).toBe(v1.sha256)
    expect(result.contentOrigin).toBe('run-auto')
  })

  it('appends onto an existing artifact when the artifact row already exists', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-reconstruct-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    const { artifact } = await engine.createArtifact(projectId, {
      logicalName: 'plot.png', kind: 'figure', originSessionId: SESSION_A,
      data: new TextEncoder().encode('bytes-v1'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })

    const reconstructed = await engine.reconstructVersion(projectId, reconstructInput({
      versionId: VersionId('r2'), artifactId: artifact.artifactId, logicalName: 'plot.png', ordinal: 2,
    }))
    expect(reconstructed.artifactId).toBe(artifact.artifactId)
    expect(reconstructed.ordinal).toBe(2)
    const versions = await engine.listVersions(projectId, artifact.artifactId)
    expect(versions).toHaveLength(2)
  })

  it('throws LOGICAL_NAME_CONFLICT when the logicalName already names a different artifact', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-reconstruct-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    await engine.createArtifact(projectId, {
      logicalName: 'taken.png', kind: 'figure', originSessionId: SESSION_A,
      data: new TextEncoder().encode('bytes'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })

    await expect(engine.reconstructVersion(projectId, reconstructInput({ logicalName: 'taken.png' })))
      .rejects.toMatchObject({ code: 'LOGICAL_NAME_CONFLICT' } satisfies Partial<ProjectArtifactStoreError>)
  })

  it('throws RECONCILE_ORDINAL_CONFLICT when a different version already committed at that ordinal', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-reconstruct-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    const { artifact, version: v1 } = await engine.createArtifact(projectId, {
      logicalName: 'plot.png', kind: 'figure', originSessionId: SESSION_A,
      data: new TextEncoder().encode('bytes-v1'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })

    await expect(engine.reconstructVersion(projectId, reconstructInput({
      versionId: VersionId('a-different-version-id'), artifactId: artifact.artifactId, logicalName: 'plot.png', ordinal: v1.ordinal,
    }))).rejects.toMatchObject({ code: 'RECONCILE_ORDINAL_CONFLICT' } satisfies Partial<ProjectArtifactStoreError>)
  })

  it('does not advance the artifact\'s latestVersionId when reconstructing an ordinal that is not the current max', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-reconstruct-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    const artifactId = ArtifactId('ra-nonmax')
    // Both versions of this artifact are entirely reconstructed (no createArtifact call): ordinal 2 first, mirroring a
    // reconciliation run that processes two dangling events for the same artifact in an order that is not ordinal order.
    const latest = await engine.reconstructVersion(projectId, reconstructInput({
      versionId: VersionId('ra-nonmax-v2'), artifactId, logicalName: 'reconstructed-nonmax.png', ordinal: 2,
    }))
    const older = await engine.reconstructVersion(projectId, reconstructInput({
      versionId: VersionId('ra-nonmax-v1'), artifactId, logicalName: 'reconstructed-nonmax.png', ordinal: 1,
    }))

    const artifact = await engine.getArtifact(projectId, artifactId)
    expect(artifact?.latestVersionId).toBe(latest.versionId)
    expect(artifact?.latestVersionId).not.toBe(older.versionId)
  })
})
