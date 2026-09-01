import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session'
import ScienceArtifactStore from '../src/index.ts'
import { storeRootForProject } from '../src/registry.ts'
import { ProjectId } from '../src/ids.ts'
import type { BackfillProvenanceHook } from '../src/schema.ts'

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
      kind: 'figure',
      originSessionId: sessionId,
      data: new TextEncoder().encode('chart bytes'),
      mediaType: 'image/png',
      contentOrigin: 'run-auto',
    })

    const appended = await ctx.scienceArtifactStore.appendVersion(opened.projectId, artifact.artifactId, {
      producerSessionId: sessionId,
      data: new TextEncoder().encode('chart bytes v2'),
      mediaType: 'image/png',
      contentOrigin: 'run-auto',
    })

    const latest = await ctx.scienceArtifactStore.getLatestVersion(opened.projectId, artifact.artifactId)
    expect(latest?.versionId).toBe(appended.versionId)

    const bytes = await ctx.scienceArtifactStore.readBlob(opened.projectId, appended.sha256)
    expect(new TextDecoder().decode(bytes)).toBe('chart bytes v2')

    const fetchedArtifact = await ctx.scienceArtifactStore.getArtifact(opened.projectId, artifact.artifactId)
    expect(fetchedArtifact?.artifactId).toBe(artifact.artifactId)
    const fetchedVersion = await ctx.scienceArtifactStore.getVersion(opened.projectId, version.versionId)
    expect(fetchedVersion?.versionId).toBe(version.versionId)
    const versions = await ctx.scienceArtifactStore.listVersions(opened.projectId, artifact.artifactId)
    expect(versions.map(v => v.versionId)).toEqual([version.versionId, appended.versionId])

    const annotated = await ctx.scienceArtifactStore.annotateVersion(opened.projectId, appended.versionId, { actor: 'human', title: 'Curated' })
    expect(annotated.title).toBe('Curated')

    const note = await ctx.scienceArtifactStore.putNote(opened.projectId, { artifactId: artifact.artifactId, text: 'note text' })
    await expect(ctx.scienceArtifactStore.listNotes(opened.projectId, artifact.artifactId)).resolves.toEqual([note])
    await ctx.scienceArtifactStore.removeNote(opened.projectId, note.noteId)
    await expect(ctx.scienceArtifactStore.listNotes(opened.projectId, artifact.artifactId)).resolves.toEqual([])

    const health = await ctx.scienceArtifactStore.setVersionHealth(opened.projectId, appended.versionId, { orphan: true })
    expect(health.orphan).toBe(true)

    await expect(ctx.scienceArtifactStore.getFigureState(opened.projectId, appended.versionId)).resolves.toBeUndefined()

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
      kind: 'document',
      originSessionId: 'session-1' as SessionId,
      data: new TextEncoder().encode('note'),
      mediaType: 'text/plain',
      contentOrigin: 'run-auto',
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

  it('wires a v1→v2 migration warning through ctx.logger.warn, and passes a configured backfillProvenance through', async () => {
    const home = await makeDir('home')
    const workspace = await makeDir('workspace')

    // Pre-seed a v1 store directly on disk (bypassing the service entirely,
    // like a real rc.3 user's store), naming its project via the SAME
    // marker format `openProject` writes, so the service resolves onto it.
    const projectId = ProjectId(randomUUID())
    await mkdir(join(workspace, '.papermachine'), { recursive: true })
    await writeFile(join(workspace, '.papermachine', 'project.json'), `${JSON.stringify({ projectId, createdAt: Date.now() })}\n`)
    const storeRoot = storeRootForProject(projectId, home)
    await mkdir(storeRoot, { recursive: true })
    const seed = new DatabaseSync(join(storeRoot, 'store.sqlite'))
    seed.exec(`
      CREATE TABLE artifacts (
        artifact_id TEXT PRIMARY KEY, owning_project_id TEXT NOT NULL, origin_session_id TEXT NOT NULL,
        logical_name TEXT NOT NULL, latest_version_id TEXT, created_at INTEGER NOT NULL
      ) STRICT
    `)
    seed.exec(`
      CREATE TABLE versions (
        version_id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id), ordinal INTEGER NOT NULL,
        parent_version_id TEXT, sha256 TEXT NOT NULL, media_type TEXT NOT NULL, byte_count INTEGER NOT NULL,
        origin TEXT NOT NULL CHECK (origin IN ('auto','model','human-edit')), title TEXT, caption TEXT,
        producer_session_id TEXT NOT NULL, producer_run_id TEXT, producer_tool_call_id TEXT, producer_request_header_seq INTEGER,
        environment_revision TEXT, environment_fingerprint_preview TEXT, created_at INTEGER NOT NULL, UNIQUE (artifact_id, ordinal)
      ) STRICT
    `)
    const artifactId = randomUUID()
    const versionId = randomUUID()
    seed.prepare('INSERT INTO artifacts VALUES (?, ?, ?, ?, ?, ?)').run(artifactId, String(projectId), 'session-1', 'plot.png', versionId, 1000)
    seed.prepare(`
      INSERT INTO versions (version_id, artifact_id, ordinal, sha256, media_type, byte_count, origin, producer_session_id, created_at)
      VALUES (?, ?, 1, ?, ?, ?, 'auto', 'session-1', ?)
    `).run(versionId, artifactId, 'a'.repeat(64), 'image/png', 10, 1000)
    seed.exec('PRAGMA user_version = 1')
    seed.close()

    let hookCalls = 0
    const backfillProvenance: BackfillProvenanceHook = async () => {
      hookCalls += 1
      return new Map()
    }
    const warnings: string[] = []
    const ctx = new Context()
    ctx.logger.warn = ((message: unknown) => { warnings.push(String(message)) }) as typeof ctx.logger.warn
    await ctx.plugin(ScienceArtifactStore, { dshHome: home, backfillProvenance })

    const opened = await ctx.scienceArtifactStore.openProject(workspace)
    expect(opened.projectId).toBe(projectId)
    expect(hookCalls).toBe(1)
    // The hook returned an empty map, so the version stays without recovered
    // provenance and the migration's step-4 warning reaches ctx.logger.warn.
    expect(warnings.some(message => message.includes(versionId))).toBe(true)

    await ctx.fiber.dispose()
  })
})
