import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session'
import ScienceArtifactStore from '../src/index.ts'

const dirs: string[] = []

async function makeDir(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `dsh-science-artifact-store-index-${name}-`))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('ScienceArtifactStore Cordis service', () => {
  it('registers ctx.scienceArtifactStore and round-trips a create/append/read/latest cycle through it', async () => {
    const home = await makeDir('home')
    const workspace = await makeDir('workspace')
    const ctx = new Context()
    await ctx.plugin(ScienceArtifactStore, { dshHome: home })

    const opened = await ctx.scienceArtifactStore.openProject(workspace)
    expect(opened.outcome).toBe('created')

    const sessionId = 'session-1' as SessionId
    const { artifact, version } = await ctx.scienceArtifactStore.createArtifact(opened.projectId, {
      logicalName: 'chart.png',
      originSessionId: sessionId,
      data: new TextEncoder().encode('chart bytes'),
      mediaType: 'image/png',
      origin: 'auto',
      title: 'Chart',
    })

    const appended = await ctx.scienceArtifactStore.appendVersion(opened.projectId, artifact.artifactId, {
      producerSessionId: sessionId,
      data: new TextEncoder().encode('chart bytes v2'),
      mediaType: 'image/png',
      origin: 'auto',
    })

    const latest = await ctx.scienceArtifactStore.getLatestVersion(opened.projectId, artifact.artifactId)
    expect(latest?.versionId).toBe(appended.versionId)
    expect(latest?.parentVersionId).toBe(version.versionId)

    const bytes = await ctx.scienceArtifactStore.readBlob(opened.projectId, appended.sha256)
    expect(new TextDecoder().decode(bytes)).toBe('chart bytes v2')

    const fetchedArtifact = await ctx.scienceArtifactStore.getArtifact(opened.projectId, artifact.artifactId)
    expect(fetchedArtifact?.artifactId).toBe(artifact.artifactId)
    const fetchedVersion = await ctx.scienceArtifactStore.getVersion(opened.projectId, version.versionId)
    expect(fetchedVersion?.versionId).toBe(version.versionId)
    const versions = await ctx.scienceArtifactStore.listVersions(opened.projectId, artifact.artifactId)
    expect(versions.map(v => v.versionId)).toEqual([version.versionId, appended.versionId])

    const annotated = await ctx.scienceArtifactStore.annotateVersion(opened.projectId, appended.versionId, { title: 'Curated' })
    expect(annotated.title).toBe('Curated')

    await ctx.scienceArtifactStore.deleteProject(opened.projectId)
    await expect(ctx.scienceArtifactStore.getArtifact(opened.projectId, artifact.artifactId)).resolves.toBeUndefined()

    await ctx.fiber.dispose()
  })

  it('resolves the default harness home when dshHome is omitted from Config', async () => {
    const ctx = new Context()
    // Construction alone never touches the filesystem — only a method call
    // that opens a project connection does — so this exercises the omitted
    // branch of the dshHome spread without depending on the real OS home.
    await ctx.plugin(ScienceArtifactStore, {})
    expect(ctx.scienceArtifactStore).toBeInstanceOf(ScienceArtifactStore)
    await ctx.fiber.dispose()
  })

  it('closes its SQLite connections when the owning fiber disposes', async () => {
    const home = await makeDir('home')
    const workspace = await makeDir('workspace')
    const ctx = new Context()
    await ctx.plugin(ScienceArtifactStore, { dshHome: home })
    const opened = await ctx.scienceArtifactStore.openProject(workspace)
    await ctx.scienceArtifactStore.createArtifact(opened.projectId, {
      logicalName: 'note.txt',
      originSessionId: 'session-1' as SessionId,
      data: new TextEncoder().encode('note'),
      mediaType: 'text/plain',
      origin: 'auto',
    })

    await ctx.fiber.dispose()
    expect(ctx.get('scienceArtifactStore')).toBeUndefined()

    // A fresh service instance over the same store reads what was durably committed.
    const ctx2 = new Context()
    await ctx2.plugin(ScienceArtifactStore, { dshHome: home })
    const reopened = await ctx2.scienceArtifactStore.openProject(workspace)
    const artifacts = await ctx2.scienceArtifactStore.listArtifacts(reopened.projectId)
    expect(artifacts).toHaveLength(1)
    await ctx2.fiber.dispose()
  })
})
