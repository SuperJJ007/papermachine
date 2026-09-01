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
  const home = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-base-version-home-'))
  dirs.push(home)
  const engine = new ProjectArtifactStoreEngine({ journalMode: 'wal', busyTimeoutMs: 2000, storeBackupRetention: 1, dshHome: home })
  engines.push(engine)
  return engine
}

afterEach(async () => {
  await Promise.all(engines.splice(0).map(engine => engine.close()))
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('baseVersionId / baseExplicit', () => {
  it('createArtifact with no baseVersionId leaves it undefined and baseExplicit false', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-base-version-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    const { version } = await engine.createArtifact(projectId, {
      logicalName: 'plot.png', kind: 'figure', originSessionId: SESSION_A, data: new TextEncoder().encode('v1'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })
    expect(version.baseVersionId).toBeUndefined()
    expect(version.baseExplicit).toBe(false)
  })

  it('appendVersion with no baseVersionId leaves it undefined even though a chain predecessor exists', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-base-version-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    const { artifact } = await engine.createArtifact(projectId, {
      logicalName: 'plot.png', kind: 'figure', originSessionId: SESSION_A, data: new TextEncoder().encode('v1'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })
    const v2 = await engine.appendVersion(projectId, artifact.artifactId, {
      producerSessionId: SESSION_A, data: new TextEncoder().encode('v2'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })
    expect(v2.ordinal).toBe(2)
    expect(v2.baseVersionId).toBeUndefined()
    expect(v2.baseExplicit).toBe(false)
  })

  it('an explicit baseVersionId on appendVersion within the SAME artifact sets baseExplicit true', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-base-version-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    const { artifact, version: v1 } = await engine.createArtifact(projectId, {
      logicalName: 'plot.png', kind: 'figure', originSessionId: SESSION_A, data: new TextEncoder().encode('v1'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })
    const v2 = await engine.appendVersion(projectId, artifact.artifactId, {
      producerSessionId: SESSION_A, data: new TextEncoder().encode('v2'), mediaType: 'image/png', contentOrigin: 'human-edit', baseVersionId: v1.versionId,
    })
    expect(v2.baseVersionId).toBe(v1.versionId)
    expect(v2.baseExplicit).toBe(true)
  })

  it('an explicit baseVersionId may name a version of a DIFFERENT artifact', async () => {
    const engine = await makeEngine()
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-base-version-ws-'))
    dirs.push(workspace)
    const { projectId } = await engine.openProject(workspace)
    const { version: sourceV1 } = await engine.createArtifact(projectId, {
      logicalName: 'source.png', kind: 'figure', originSessionId: SESSION_A, data: new TextEncoder().encode('src'), mediaType: 'image/png', contentOrigin: 'run-auto',
    })
    // save_artifact_as: a brand-new artifact whose first version explicitly bases off another artifact's version.
    const { artifact: savedAs, version: savedV1 } = await engine.createArtifact(projectId, {
      logicalName: 'saved-copy.png', kind: 'figure', originSessionId: SESSION_A, data: new TextEncoder().encode('src'), mediaType: 'image/png', contentOrigin: 'human-edit',
      baseVersionId: sourceV1.versionId,
    })
    expect(savedV1.artifactId).toBe(savedAs.artifactId)
    expect(savedV1.artifactId).not.toBe(sourceV1.artifactId)
    expect(savedV1.ordinal).toBe(1)
    expect(savedV1.baseVersionId).toBe(sourceV1.versionId)
    expect(savedV1.baseExplicit).toBe(true)
  })
})
