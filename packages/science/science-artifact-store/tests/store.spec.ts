import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { ProjectArtifactStoreEngine } from '../src/store.ts'
import { ProjectArtifactStoreError } from '../src/errors.ts'
import { ArtifactId, ProjectId, VersionId } from '../src/ids.ts'
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
  const engine = new ProjectArtifactStoreEngine({ journalMode: 'wal', busyTimeoutMs: 2000, dshHome: home })
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
  it('creates an artifact whose first version has ordinal 1 and no parent', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)

    const { artifact, version } = await engine.createArtifact(projectId, {
      logicalName: 'plot.png',
      originSessionId: SESSION_A,
      data: new TextEncoder().encode('bytes-v1'),
      mediaType: 'image/png',
      origin: 'auto',
      title: 'Plot',
    })

    expect(version.ordinal).toBe(1)
    expect(version.parentVersionId).toBeUndefined()
    expect(version.artifactId).toBe(artifact.artifactId)
    expect(artifact.latestVersionId).toBe(version.versionId)
    expect(artifact.owningProjectId).toBe(projectId)
    expect(artifact.originSessionId).toBe(SESSION_A)
  })

  it('appends a linear chain of versions onto the same artifact', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)

    const { artifact, version: v1 } = await engine.createArtifact(projectId, {
      logicalName: 'plot.png',
      originSessionId: SESSION_A,
      data: new TextEncoder().encode('v1'),
      mediaType: 'image/png',
      origin: 'auto',
    })

    const v2 = await engine.appendVersion(projectId, artifact.artifactId, {
      producerSessionId: SESSION_A,
      data: new TextEncoder().encode('v2'),
      mediaType: 'image/png',
      origin: 'auto',
    })
    expect(v2.ordinal).toBe(2)
    expect(v2.parentVersionId).toBe(v1.versionId)

    // A second session in the same project can append too — producer tracks the appending session.
    const v3 = await engine.appendVersion(projectId, artifact.artifactId, {
      producerSessionId: SESSION_B,
      data: new TextEncoder().encode('v3'),
      mediaType: 'image/png',
      origin: 'model',
    })
    expect(v3.ordinal).toBe(3)
    expect(v3.parentVersionId).toBe(v2.versionId)
    expect(v3.producerSessionId).toBe(SESSION_B)

    const latest = await engine.getLatestVersion(projectId, artifact.artifactId)
    expect(latest?.versionId).toBe(v3.versionId)
    const updatedArtifact = await engine.getArtifact(projectId, artifact.artifactId)
    expect(updatedArtifact?.latestVersionId).toBe(v3.versionId)

    const versions = await engine.listVersions(projectId, artifact.artifactId)
    expect(versions.map(v => v.versionId)).toEqual([v1.versionId, v2.versionId, v3.versionId])
  })

  it('records an explicit editBaselines parent naming a version of a different artifact without forking the chain', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)

    const { artifact: artifactA, version: aV1 } = await engine.createArtifact(projectId, {
      logicalName: 'a.png', originSessionId: SESSION_A, data: new TextEncoder().encode('a1'), mediaType: 'image/png', origin: 'auto',
    })
    const { artifact: artifactB, version: bV1 } = await engine.createArtifact(projectId, {
      logicalName: 'b.png', originSessionId: SESSION_A, data: new TextEncoder().encode('b1'), mediaType: 'image/png', origin: 'auto',
    })

    // artifact B's next version branches from artifact A's version instead of its own latest.
    const bV2 = await engine.appendVersion(projectId, artifactB.artifactId, {
      producerSessionId: SESSION_A,
      data: new TextEncoder().encode('b2-from-a1'),
      mediaType: 'image/png',
      origin: 'model',
      editBaselines: aV1.versionId,
    })
    expect(bV2.artifactId).toBe(artifactB.artifactId)
    expect(bV2.ordinal).toBe(2)
    expect(bV2.parentVersionId).toBe(aV1.versionId)

    // Artifact A's own chain is untouched.
    const artifactARecord = await engine.getArtifact(projectId, artifactA.artifactId)
    expect(artifactARecord?.latestVersionId).toBe(aV1.versionId)
    expect(bV1.ordinal).toBe(1)
  })

  it('throws ARTIFACT_NOT_FOUND appending onto an unknown artifact', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)

    await expect(engine.appendVersion(projectId, ArtifactId('unknown'), {
      producerSessionId: SESSION_A, data: new TextEncoder().encode('x'), mediaType: 'text/plain', origin: 'auto',
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
  })

  it('annotates a version in place: title/caption/origin change, bytes and ordinal do not', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    const { version } = await engine.createArtifact(projectId, {
      logicalName: 'plot.png', originSessionId: SESSION_A, data: new TextEncoder().encode('v1'),
      mediaType: 'image/png', origin: 'auto', title: 'Untitled',
    })

    const annotated = await engine.annotateVersion(projectId, version.versionId, { title: 'Curated title', caption: 'A caption', origin: 'model' })
    expect(annotated.title).toBe('Curated title')
    expect(annotated.caption).toBe('A caption')
    expect(annotated.origin).toBe('model')
    expect(annotated.ordinal).toBe(version.ordinal)
    expect(annotated.sha256).toBe(version.sha256)
    expect(annotated.byteCount).toBe(version.byteCount)

    // Omitted fields keep their current value.
    const reannotated = await engine.annotateVersion(projectId, version.versionId, { caption: 'Updated caption' })
    expect(reannotated.title).toBe('Curated title')
    expect(reannotated.caption).toBe('Updated caption')

    // Omitting caption specifically also keeps its current value.
    const captionKept = await engine.annotateVersion(projectId, version.versionId, { title: 'Retitled' })
    expect(captionKept.title).toBe('Retitled')
    expect(captionKept.caption).toBe('Updated caption')
  })

  it('reads back exactly the admitted bytes for a version', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    const data = new TextEncoder().encode('exact bytes')
    const { version } = await engine.createArtifact(projectId, {
      logicalName: 'plot.png', originSessionId: SESSION_A, data, mediaType: 'image/png', origin: 'auto',
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
      logicalName: 'first.png', originSessionId: SESSION_A, data: new TextEncoder().encode('1'), mediaType: 'image/png', origin: 'auto',
    })
    const { artifact: second } = await engine.createArtifact(projectId, {
      logicalName: 'second.png', originSessionId: SESSION_A, data: new TextEncoder().encode('2'), mediaType: 'image/png', origin: 'auto',
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
      logicalName: 'plot.png', originSessionId: SESSION_A, data: new TextEncoder().encode('v1'), mediaType: 'image/png', origin: 'auto',
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
      logicalName: 'plot.png', originSessionId: SESSION_A, data: new TextEncoder().encode('v1'), mediaType: 'image/png', origin: 'auto',
    })
    await expect(engine.getVersion(projectId, version.versionId)).resolves.toEqual(version)
  })

  it('throws VERSION_NOT_FOUND annotating an unknown version', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    await expect(engine.annotateVersion(projectId, VersionId('unknown'), { title: 'x' })).rejects.toMatchObject({
      code: 'VERSION_NOT_FOUND',
    } satisfies Partial<ProjectArtifactStoreError>)
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

    await expect(engine.getArtifact(projectId, ArtifactId('x'))).rejects.toMatchObject({ code: 'SCHEMA_VERSION_MISMATCH' })
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
    await expect(stillPending).rejects.toMatchObject({ code: 'SCHEMA_VERSION_MISMATCH' })

    const engine2 = new ProjectArtifactStoreEngine({ journalMode: 'wal', busyTimeoutMs: 2000, dshHome: home })
    engines.push(engine2)
    const secondPending = engine2.getArtifact(projectId, ArtifactId('x'))
    secondPending.catch(() => {})
    await expect(engine2.deleteProject(projectId)).resolves.toBeUndefined()
    await expect(secondPending).rejects.toMatchObject({ code: 'SCHEMA_VERSION_MISMATCH' })
  })

  it('rejects a second write transaction that cannot acquire the lock within busyTimeoutMs', async () => {
    const { engine, home } = await makeEngineWithHome()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    const { artifact } = await engine.createArtifact(projectId, {
      logicalName: 'plot.png', originSessionId: SESSION_A, data: new TextEncoder().encode('v1'), mediaType: 'image/png', origin: 'auto',
    })

    // Hold an uncommitted write transaction open on a second raw connection
    // so the engine's own BEGIN IMMEDIATE cannot acquire the lock at all.
    const blocker = await openRawStore(home, projectId)
    blocker.exec('BEGIN IMMEDIATE')
    try {
      const shortTimeout = new ProjectArtifactStoreEngine({ journalMode: 'wal', busyTimeoutMs: 50, dshHome: home })
      try {
        await expect(shortTimeout.appendVersion(projectId, artifact.artifactId, {
          producerSessionId: SESSION_A, data: new TextEncoder().encode('v2'), mediaType: 'image/png', origin: 'auto',
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
      producerSessionId: SESSION_A, data: new TextEncoder().encode('v2'), mediaType: 'image/png', origin: 'auto',
    })
    expect(v2.ordinal).toBe(2)
  })

  it('recovers from a durably inconsistent artifact row (latest_version_id manually cleared)', async () => {
    const { engine, home } = await makeEngineWithHome()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    const { artifact, version: v1 } = await engine.createArtifact(projectId, {
      logicalName: 'plot.png', originSessionId: SESSION_A, data: new TextEncoder().encode('v1'), mediaType: 'image/png', origin: 'auto',
    })

    const raw = await openRawStore(home, projectId)
    raw.exec(`UPDATE artifacts SET latest_version_id = NULL WHERE artifact_id = '${artifact.artifactId}'`)
    raw.close()

    // getArtifact refuses to present an artifact with no latest version.
    await expect(engine.getArtifact(projectId, artifact.artifactId)).rejects.toMatchObject({
      code: 'ARTIFACT_NOT_FOUND',
    } satisfies Partial<ProjectArtifactStoreError>)

    // appendVersion without an explicit editBaselines falls back to "no parent"
    // rather than crashing when there is no recorded latest to inherit.
    const v2 = await engine.appendVersion(projectId, artifact.artifactId, {
      producerSessionId: SESSION_A, data: new TextEncoder().encode('v2'), mediaType: 'image/png', origin: 'auto',
    })
    expect(v2.parentVersionId).toBeUndefined()
    expect(v2.ordinal).toBe(v1.ordinal + 1)
  })

  it('returns undefined from getLatestVersion when the recorded latest version row is gone', async () => {
    const { engine, home } = await makeEngineWithHome()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    const { artifact } = await engine.createArtifact(projectId, {
      logicalName: 'plot.png', originSessionId: SESSION_A, data: new TextEncoder().encode('v1'), mediaType: 'image/png', origin: 'auto',
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
