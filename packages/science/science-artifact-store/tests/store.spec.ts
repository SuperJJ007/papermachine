import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { ProjectArtifactStoreEngine } from '../src/store.ts'
import { ProjectArtifactStoreError } from '../src/errors.ts'
import { ArtifactId, NoteId, ProjectId, VersionId } from '../src/ids.ts'
import { storeRootForProject } from '../src/registry.ts'
import type { ArtifactRecord, VersionRecord } from '../src/types.ts'

/** Typed bridge onto the engine's private row readers, used only to exercise defensive-only branches directly. */
interface EngineInternals {
  connectionFor(projectId: ProjectId): Promise<DatabaseSync>
  getArtifactRow(db: DatabaseSync, artifactId: ArtifactId): ArtifactRecord
  getVersionRow(db: DatabaseSync, versionId: VersionId): VersionRecord
}

/** Opens a project's store.sqlite directly, bypassing the engine, to force durable states the public API cannot produce. */
async function openRawStore(home: string, projectId: ProjectId): Promise<DatabaseSync> {
  const storeRoot = storeRootForProject(projectId, home)
  await mkdir(storeRoot, { recursive: true })
  return new DatabaseSync(join(storeRoot, 'store.sqlite'))
}

const dirs: string[] = []
const engines: ProjectArtifactStoreEngine[] = []

async function makeEngine(): Promise<ProjectArtifactStoreEngine> {
  return (await makeEngineWithHome()).engine
}

async function makeEngineWithHome(): Promise<{ engine: ProjectArtifactStoreEngine; home: string }> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-engine-'))
  dirs.push(home)
  const engine = new ProjectArtifactStoreEngine({ journalMode: 'wal', busyTimeoutMs: 2000, storeBackupRetention: 1, reconcileMaxVersions: 2000, dshHome: home })
  engines.push(engine)
  return { engine, home }
}

afterEach(async () => {
  await Promise.all(engines.splice(0).map(engine => engine.close()))
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

const SESSION_A = 'session-a' as SessionId
const SESSION_B = 'session-b' as SessionId

describe('ProjectArtifactStoreEngine', () => {
  it('creates an artifact whose first version has ordinal 1 and no explicit baseline', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)

    const { artifact, version } = await engine.createArtifact(projectId, {
      logicalName: 'plot.png',
      kind: 'figure',
      originSessionId: SESSION_A,
      data: new TextEncoder().encode('bytes-v1'),
      mediaType: 'image/png',
      contentOrigin: 'run-auto',
    })

    expect(version.ordinal).toBe(1)
    expect(version.baseVersionId).toBeUndefined()
    expect(version.baseExplicit).toBe(false)
    expect(version.artifactId).toBe(artifact.artifactId)
    expect(version.latestAnnotation).toBeUndefined()
    expect(version.title).toBeUndefined()
    expect(version.caption).toBeUndefined()
    expect(artifact.latestVersionId).toBe(version.versionId)
    expect(artifact.owningProjectId).toBe(projectId)
    expect(artifact.originSessionId).toBe(SESSION_A)
    expect(artifact.kind).toBe('figure')
  })

  it('appends a linear chain of versions onto the same artifact, ordinal contiguous, no baseline defaulted from latest', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)

    const { artifact, version: v1 } = await engine.createArtifact(projectId, {
      logicalName: 'plot.png', kind: 'figure', originSessionId: SESSION_A,
      data: new TextEncoder().encode('v1'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })

    const v2 = await engine.appendVersion(projectId, artifact.artifactId, {
      producerSessionId: SESSION_A,
      data: new TextEncoder().encode('v2'),
      mediaType: 'image/png',
      contentOrigin: 'run-auto',
    })
    expect(v2.ordinal).toBe(2)
    // A plain continuation never gets a baseline defaulted from the artifact's latest version.
    expect(v2.baseVersionId).toBeUndefined()
    expect(v2.baseExplicit).toBe(false)

    // A second session in the same project can append too — producer tracks the appending session.
    const v3 = await engine.appendVersion(projectId, artifact.artifactId, {
      producerSessionId: SESSION_B,
      data: new TextEncoder().encode('v3'),
      mediaType: 'image/png',
      contentOrigin: 'run-auto',
    })
    expect(v3.ordinal).toBe(3)
    expect(v3.producerSessionId).toBe(SESSION_B)

    const latest = await engine.getLatestVersion(projectId, artifact.artifactId)
    expect(latest?.versionId).toBe(v3.versionId)
    const updatedArtifact = await engine.getArtifact(projectId, artifact.artifactId)
    expect(updatedArtifact?.latestVersionId).toBe(v3.versionId)

    const versions = await engine.listVersions(projectId, artifact.artifactId)
    expect(versions.map(v => v.versionId)).toEqual([v1.versionId, v2.versionId, v3.versionId])
  })

  it('records an explicit baseVersionId naming a version of a different artifact without forking the chain', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)

    const { artifact: artifactA, version: aV1 } = await engine.createArtifact(projectId, {
      logicalName: 'a.png', kind: 'figure', originSessionId: SESSION_A, data: new TextEncoder().encode('a1'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })
    const { artifact: artifactB, version: bV1 } = await engine.createArtifact(projectId, {
      logicalName: 'b.png', kind: 'figure', originSessionId: SESSION_A, data: new TextEncoder().encode('b1'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })

    // artifact B's next version branches from artifact A's version.
    const bV2 = await engine.appendVersion(projectId, artifactB.artifactId, {
      producerSessionId: SESSION_A,
      data: new TextEncoder().encode('b2-from-a1'),
      mediaType: 'image/png',
      contentOrigin: 'human-edit',
      baseVersionId: aV1.versionId,
    })
    expect(bV2.artifactId).toBe(artifactB.artifactId)
    expect(bV2.ordinal).toBe(2)
    expect(bV2.baseVersionId).toBe(aV1.versionId)
    expect(bV2.baseExplicit).toBe(true)

    // Artifact A's own chain is untouched.
    const artifactARecord = await engine.getArtifact(projectId, artifactA.artifactId)
    expect(artifactARecord?.latestVersionId).toBe(aV1.versionId)
    expect(bV1.ordinal).toBe(1)
  })

  it('createArtifact stores a figureState row alongside the first version', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    const { version } = await engine.createArtifact(projectId, {
      logicalName: 'chart.png', kind: 'figure', originSessionId: SESSION_A,
      data: new TextEncoder().encode('v1'), mediaType: 'image/png', contentOrigin: 'run-auto',
      figureState: { figureKey: 'fig-1', dpi: 144, stateJson: '{"elements":[]}' },
    })
    const state = await engine.getFigureState(projectId, version.versionId)
    expect(state).toEqual({ versionId: version.versionId, figureKey: 'fig-1', dpi: 144, stateJson: '{"elements":[]}' })
  })

  it('appendVersion also stores a figureState row alongside the new version', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    const { artifact } = await engine.createArtifact(projectId, {
      logicalName: 'chart.png', kind: 'figure', originSessionId: SESSION_A,
      data: new TextEncoder().encode('v1'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })
    const v2 = await engine.appendVersion(projectId, artifact.artifactId, {
      producerSessionId: SESSION_A, data: new TextEncoder().encode('v2'), mediaType: 'image/png', contentOrigin: 'human-edit',
      figureState: { figureKey: 'fig-1', dpi: 96, stateJson: '{"elements":[1]}' },
    })
    const state = await engine.getFigureState(projectId, v2.versionId)
    expect(state).toEqual({ versionId: v2.versionId, figureKey: 'fig-1', dpi: 96, stateJson: '{"elements":[1]}' })
  })

  it('tolerates a durably corrupted latest_annotation_id: the version resolves with latestAnnotation undefined instead of throwing', async () => {
    const { engine, home } = await makeEngineWithHome()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    const { version } = await engine.createArtifact(projectId, {
      logicalName: 'plot.png', kind: 'figure', originSessionId: SESSION_A, data: new TextEncoder().encode('v1'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })
    await engine.annotateVersion(projectId, version.versionId, { actor: 'human', title: 'T' })

    const raw = await openRawStore(home, projectId)
    raw.exec('PRAGMA foreign_keys = OFF')
    raw.exec(`UPDATE versions SET latest_annotation_id = 'dangling-annotation' WHERE version_id = '${version.versionId}'`)
    raw.close()

    const resolved = await engine.getVersion(projectId, version.versionId)
    expect(resolved?.latestAnnotation).toBeUndefined()
    expect(resolved?.title).toBeUndefined()

    // annotateVersion itself resolves the same dangling pointer through the same
    // path (latest_annotation_id non-null but the row it names is gone) and
    // still succeeds, carrying forward "no title" rather than throwing.
    const reannotated = await engine.annotateVersion(projectId, version.versionId, { actor: 'human', caption: 'still works' })
    expect(reannotated.title).toBeUndefined()
    expect(reannotated.caption).toBe('still works')
  })

  it('throws LOGICAL_NAME_CONFLICT creating a second artifact with the same name in the same project', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    await engine.createArtifact(projectId, {
      logicalName: 'plot.png', kind: 'figure', originSessionId: SESSION_A, data: new TextEncoder().encode('v1'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })
    await expect(engine.createArtifact(projectId, {
      logicalName: 'plot.png', kind: 'figure', originSessionId: SESSION_A, data: new TextEncoder().encode('v1-again'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })).rejects.toMatchObject({ code: 'LOGICAL_NAME_CONFLICT' } satisfies Partial<ProjectArtifactStoreError>)
  })

  it('a different project may reuse a logicalName another project already has', async () => {
    const engine = await makeEngine()
    const workspaceA = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-ws-'))
    const workspaceB = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-ws-'))
    dirs.push(workspaceA, workspaceB)
    const { projectId: projectA } = await engine.openProject(workspaceA)
    const { projectId: projectB } = await engine.openProject(workspaceB)
    await engine.createArtifact(projectA, {
      logicalName: 'plot.png', kind: 'figure', originSessionId: SESSION_A, data: new TextEncoder().encode('a'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })
    await expect(engine.createArtifact(projectB, {
      logicalName: 'plot.png', kind: 'figure', originSessionId: SESSION_A, data: new TextEncoder().encode('b'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })).resolves.toBeDefined()
  })

  it('throws ARTIFACT_NOT_FOUND appending onto an unknown artifact', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)

    await expect(engine.appendVersion(projectId, ArtifactId('unknown'), {
      producerSessionId: SESSION_A, data: new TextEncoder().encode('x'), mediaType: 'text/plain', contentOrigin: 'run-auto',
    })).rejects.toMatchObject({ code: 'ARTIFACT_NOT_FOUND' } satisfies Partial<ProjectArtifactStoreError>)
  })

  it('returns undefined, not an error, for a lookup of a never-created record', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)

    await expect(engine.getArtifact(projectId, ArtifactId('unknown'))).resolves.toBeUndefined()
    await expect(engine.getVersion(projectId, VersionId('unknown'))).resolves.toBeUndefined()
    await expect(engine.getLatestVersion(projectId, ArtifactId('unknown'))).resolves.toBeUndefined()
    await expect(engine.getFigureState(projectId, VersionId('unknown'))).resolves.toBeUndefined()
  })

  it('annotateVersion appends a new row instead of updating in place: createdAt and producer columns never change', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    const { version } = await engine.createArtifact(projectId, {
      logicalName: 'plot.png', kind: 'figure', originSessionId: SESSION_A, data: new TextEncoder().encode('v1'),
      mediaType: 'image/png', contentOrigin: 'run-auto',
    })

    const annotated = await engine.annotateVersion(projectId, version.versionId, {
      actor: 'model', sessionId: SESSION_A, toolCallId: 'call-1', requestHeaderSeq: 7,
      title: 'Curated title', caption: 'A caption',
    })
    expect(annotated.title).toBe('Curated title')
    expect(annotated.caption).toBe('A caption')
    expect(annotated.latestAnnotation).toMatchObject({ actor: 'model', sessionId: SESSION_A, toolCallId: 'call-1', requestHeaderSeq: 7, derived: false })
    expect(annotated.ordinal).toBe(version.ordinal)
    expect(annotated.sha256).toBe(version.sha256)
    expect(annotated.byteCount).toBe(version.byteCount)
    expect(annotated.createdAt).toBe(version.createdAt)
    expect(annotated.producerToolCallId).toBe(version.producerToolCallId)

    // Omitted fields carry the current value forward into the new row.
    const reannotated = await engine.annotateVersion(projectId, version.versionId, { actor: 'human', caption: 'Updated caption' })
    expect(reannotated.title).toBe('Curated title')
    expect(reannotated.caption).toBe('Updated caption')
    expect(reannotated.latestAnnotation?.annotationId).not.toBe(annotated.latestAnnotation?.annotationId)
    expect(reannotated.createdAt).toBe(version.createdAt)
  })

  it('reads back exactly the admitted bytes for a version', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    const data = new TextEncoder().encode('exact bytes')
    const { version } = await engine.createArtifact(projectId, {
      logicalName: 'plot.png', kind: 'figure', originSessionId: SESSION_A, data, mediaType: 'image/png', contentOrigin: 'run-auto',
    })
    const read = await engine.readBlob(projectId, version.sha256)
    expect(read).toEqual(data)
  })

  it('lists artifacts oldest first', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    const { artifact: first } = await engine.createArtifact(projectId, {
      logicalName: 'first.png', kind: 'figure', originSessionId: SESSION_A, data: new TextEncoder().encode('1'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })
    const { artifact: second } = await engine.createArtifact(projectId, {
      logicalName: 'second.png', kind: 'figure', originSessionId: SESSION_A, data: new TextEncoder().encode('2'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })
    const artifacts = await engine.listArtifacts(projectId)
    expect(artifacts.map(a => a.artifactId)).toEqual([first.artifactId, second.artifactId])
  })

  it('deleteProject removes the entire store; a fresh openProject under the same workspace starts a new project', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-ws-'))
    dirs.push(workspace)
    const opened = await engine.openProject(workspace)
    const { artifact } = await engine.createArtifact(opened.projectId, {
      logicalName: 'plot.png', kind: 'figure', originSessionId: SESSION_A, data: new TextEncoder().encode('v1'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })

    await engine.deleteProject(opened.projectId)
    await expect(engine.getArtifact(opened.projectId, artifact.artifactId)).resolves.toBeUndefined()

    // The workspace marker is untouched by project deletion; reopening the
    // SAME workspace resolves the SAME (now-empty) project id — deletion
    // removes the store's data, not the workspace's identity.
    const reopened = await engine.openProject(workspace)
    expect(reopened.projectId).toBe(opened.projectId)
    expect(reopened.outcome).toBe('reopened')
    await expect(engine.listArtifacts(reopened.projectId)).resolves.toEqual([])
  })

  it('reads back a known version by id', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    const { version } = await engine.createArtifact(projectId, {
      logicalName: 'plot.png', kind: 'figure', originSessionId: SESSION_A, data: new TextEncoder().encode('v1'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })
    await expect(engine.getVersion(projectId, version.versionId)).resolves.toEqual(version)
  })

  it('throws VERSION_NOT_FOUND annotating an unknown version', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    await expect(engine.annotateVersion(projectId, VersionId('unknown'), { actor: 'human', title: 'x' })).rejects.toMatchObject({
      code: 'VERSION_NOT_FOUND',
    } satisfies Partial<ProjectArtifactStoreError>)
  })

  it('putNote/listNotes/removeNote: notes are soft-deleted and excluded from listNotes once removed', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    const { artifact, version } = await engine.createArtifact(projectId, {
      logicalName: 'plot.png', kind: 'figure', originSessionId: SESSION_A, data: new TextEncoder().encode('v1'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })

    const note = await engine.putNote(projectId, { artifactId: artifact.artifactId, versionId: version.versionId, text: 'looks off', sessionId: SESSION_A })
    expect(note.text).toBe('looks off')
    expect(note.removedAt).toBeUndefined()

    await expect(engine.listNotes(projectId, artifact.artifactId)).resolves.toEqual([note])

    await engine.removeNote(projectId, note.noteId)
    await expect(engine.listNotes(projectId, artifact.artifactId)).resolves.toEqual([])
  })

  it('throws ARTIFACT_NOT_FOUND putting a note on an unknown artifact', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    await expect(engine.putNote(projectId, { artifactId: ArtifactId('unknown'), text: 'x' })).rejects.toMatchObject({
      code: 'ARTIFACT_NOT_FOUND',
    } satisfies Partial<ProjectArtifactStoreError>)
  })

  it('throws NOTE_NOT_FOUND removing an unknown or already-removed note', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    await expect(engine.removeNote(projectId, NoteId('unknown'))).rejects.toMatchObject({
      code: 'NOTE_NOT_FOUND',
    } satisfies Partial<ProjectArtifactStoreError>)
  })

  it('setVersionHealth upserts and preserves omitted fields across calls', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    const { version } = await engine.createArtifact(projectId, {
      logicalName: 'plot.png', kind: 'figure', originSessionId: SESSION_A, data: new TextEncoder().encode('v1'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })

    // No row yet and every field omitted: each falls back through its "no existing row" default.
    const first = await engine.setVersionHealth(projectId, version.versionId, {})
    expect(first).toMatchObject({ orphan: false, reconstructed: false, missingContent: false })

    // Every field explicitly true.
    const second = await engine.setVersionHealth(projectId, version.versionId, { orphan: true, reconstructed: true, missingContent: true })
    expect(second).toMatchObject({ orphan: true, reconstructed: true, missingContent: true })
    expect(second.checkedAt).toBeGreaterThanOrEqual(first.checkedAt)

    // Every field explicitly false — distinct from omitting it, and distinct from the true values just set.
    const third = await engine.setVersionHealth(
      projectId, version.versionId, { orphan: false, reconstructed: false, missingContent: false },
    )
    expect(third).toMatchObject({ orphan: false, reconstructed: false, missingContent: false })

    // A fully empty patch now carries every (already-false) field forward from the row that exists.
    const fourth = await engine.setVersionHealth(projectId, version.versionId, {})
    expect(fourth).toMatchObject({ orphan: false, reconstructed: false, missingContent: false })

    // A single field set true, the other two carried forward from the existing (false) row.
    const fifth = await engine.setVersionHealth(projectId, version.versionId, { missingContent: true })
    expect(fifth).toMatchObject({ orphan: false, reconstructed: false, missingContent: true })
  })

  it('is a no-op deleting a project whose store was never opened in this engine', async () => {
    const engine = await makeEngine()
    await expect(engine.deleteProject(ProjectId('never-opened'))).resolves.toBeUndefined()
  })

  it('cleans up a failed connection so a later call retries instead of reusing the rejection', async () => {
    const { engine, home } = await makeEngineWithHome()
    const projectId = ProjectId('bad-schema-project')
    const seed = await openRawStore(home, projectId)
    seed.exec('PRAGMA user_version = 999')
    seed.close()

    await expect(engine.getArtifact(projectId, ArtifactId('x'))).rejects.toMatchObject({ code: 'SCHEMA_VERSION_NEWER' })
    // The failed attempt did not get stuck cached: fixing the on-disk version
    // lets the very next call for the same project succeed.
    const fixed = await openRawStore(home, projectId)
    fixed.exec('PRAGMA user_version = 0')
    fixed.close()
    await expect(engine.getArtifact(projectId, ArtifactId('x'))).resolves.toBeUndefined()
  })

  it('tolerates a connection that is still failing to open when close() or deleteProject() runs', async () => {
    const { engine, home } = await makeEngineWithHome()
    const projectId = ProjectId('bad-schema-project-2')
    const seed = await openRawStore(home, projectId)
    seed.exec('PRAGMA user_version = 999')
    seed.close()

    // Fire the failing call without awaiting it first, so the rejected
    // connection promise is still cached when close()/deleteProject() runs.
    // The immediate no-op catch only prevents Node's unhandled-rejection
    // check from racing ahead of the real assertion below, which attaches
    // its own handler once close() (an independent, slower await) returns.
    const stillPending = engine.getArtifact(projectId, ArtifactId('x'))
    stillPending.catch(() => {})
    await expect(engine.close()).resolves.toBeUndefined()
    await expect(stillPending).rejects.toMatchObject({ code: 'SCHEMA_VERSION_NEWER' })

    const engine2 = new ProjectArtifactStoreEngine({ journalMode: 'wal', busyTimeoutMs: 2000, storeBackupRetention: 1, reconcileMaxVersions: 2000, dshHome: home })
    engines.push(engine2)
    const secondPending = engine2.getArtifact(projectId, ArtifactId('x'))
    secondPending.catch(() => {})
    await expect(engine2.deleteProject(projectId)).resolves.toBeUndefined()
    await expect(secondPending).rejects.toMatchObject({ code: 'SCHEMA_VERSION_NEWER' })
  })

  it('rejects a second write transaction that cannot acquire the lock within busyTimeoutMs', async () => {
    const { engine, home } = await makeEngineWithHome()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    const { artifact } = await engine.createArtifact(projectId, {
      logicalName: 'plot.png', kind: 'figure', originSessionId: SESSION_A, data: new TextEncoder().encode('v1'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })

    // Hold an uncommitted write transaction open on a second raw connection
    // so the engine's own BEGIN IMMEDIATE cannot acquire the lock at all.
    const blocker = await openRawStore(home, projectId)
    blocker.exec('BEGIN IMMEDIATE')
    try {
      const shortTimeout = new ProjectArtifactStoreEngine({ journalMode: 'wal', busyTimeoutMs: 50, storeBackupRetention: 1, reconcileMaxVersions: 2000, dshHome: home })
      try {
        await expect(shortTimeout.appendVersion(projectId, artifact.artifactId, {
          producerSessionId: SESSION_A, data: new TextEncoder().encode('v2'), mediaType: 'image/png', contentOrigin: 'run-auto',
        })).rejects.toThrow()
      } finally {
        await shortTimeout.close()
      }
    } finally {
      blocker.exec('ROLLBACK')
      blocker.close()
    }

    // The lock is free again: the store is unharmed by the rejected attempt.
    const v2 = await engine.appendVersion(projectId, artifact.artifactId, {
      producerSessionId: SESSION_A, data: new TextEncoder().encode('v2'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })
    expect(v2.ordinal).toBe(2)
  })

  it('refuses to present an artifact whose latest_version_id was durably cleared, and appendVersion still recovers', async () => {
    const { engine, home } = await makeEngineWithHome()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    const { artifact, version: v1 } = await engine.createArtifact(projectId, {
      logicalName: 'plot.png', kind: 'figure', originSessionId: SESSION_A, data: new TextEncoder().encode('v1'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })

    const raw = await openRawStore(home, projectId)
    raw.exec(`UPDATE artifacts SET latest_version_id = NULL WHERE artifact_id = '${artifact.artifactId}'`)
    raw.close()

    // getArtifact refuses to present an artifact with no latest version.
    await expect(engine.getArtifact(projectId, artifact.artifactId)).rejects.toMatchObject({
      code: 'ARTIFACT_NOT_FOUND',
    } satisfies Partial<ProjectArtifactStoreError>)

    // appendVersion only reads latest_version_id to compute the ordinal, not to default a baseline — it still recovers.
    const v2 = await engine.appendVersion(projectId, artifact.artifactId, {
      producerSessionId: SESSION_A, data: new TextEncoder().encode('v2'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })
    expect(v2.baseVersionId).toBeUndefined()
    expect(v2.ordinal).toBe(v1.ordinal + 1)
  })

  it('returns undefined from getLatestVersion when the recorded latest version row is gone', async () => {
    const { engine, home } = await makeEngineWithHome()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    const { artifact } = await engine.createArtifact(projectId, {
      logicalName: 'plot.png', kind: 'figure', originSessionId: SESSION_A, data: new TextEncoder().encode('v1'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })

    const raw = await openRawStore(home, projectId)
    raw.exec(`UPDATE artifacts SET latest_version_id = 'dangling' WHERE artifact_id = '${artifact.artifactId}'`)
    raw.close()

    await expect(engine.getLatestVersion(projectId, artifact.artifactId)).resolves.toBeUndefined()
  })

  it('private row readers refuse a row absent immediately after their own insert (defensive-only path)', async () => {
    const { engine } = await makeEngineWithHome()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    // These branches are unreachable through the public API — every real
    // caller reads back the row it just inserted in the same transaction.
    // Exercised directly through a typed bridge to prove the defensive
    // checks are correct code, not dead code, without fabricating a durable
    // inconsistency to trigger them.
    const privateEngine = engine as unknown as EngineInternals
    const db = await privateEngine.connectionFor(projectId)
    expect(() => privateEngine.getArtifactRow(db, ArtifactId('unknown'))).toThrow(
      expect.objectContaining({ code: 'ARTIFACT_NOT_FOUND' }),
    )
    expect(() => privateEngine.getVersionRow(db, VersionId('unknown'))).toThrow(
      expect.objectContaining({ code: 'VERSION_NOT_FOUND' }),
    )
  })
})
