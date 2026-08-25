import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { deleteProjectStore, resolveProjectIdentity, storeRootForProject } from '../src/registry.ts'
import { ProjectArtifactStoreError } from '../src/errors.ts'
import { ProjectId } from '../src/ids.ts'

interface RecordedMarker {
  readonly projectId: string
}

interface RecordedStoreProject {
  readonly projectId: string
  readonly workspacePath: string
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

const dirs: string[] = []

async function makeDir(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `dsh-science-artifact-store-${name}-`))
  dirs.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('resolveProjectIdentity', () => {
  it('creates a fresh project for an unmarked workspace', async () => {
    const home = await makeDir('home')
    const workspace = await makeDir('workspace')
    const resolved = await resolveProjectIdentity(workspace, home)
    expect(resolved.outcome).toBe('created')
    expect(resolved.workspacePath).toBe(workspace)
    expect(resolved.storeRoot).toBe(storeRootForProject(resolved.projectId, home))

    const marker = await readJson<RecordedMarker>(join(workspace, '.papermachine', 'project.json'))
    expect(marker.projectId).toBe(resolved.projectId)

    const storeRecord = await readJson<RecordedStoreProject>(join(resolved.storeRoot, 'project.json'))
    expect(storeRecord).toMatchObject({ projectId: resolved.projectId, workspacePath: workspace })
  })

  it('reopens the same project id and refreshes workspaceUpdatedAt for an unchanged path', async () => {
    const home = await makeDir('home')
    const workspace = await makeDir('workspace')
    const first = await resolveProjectIdentity(workspace, home)
    const second = await resolveProjectIdentity(workspace, home)
    expect(second.outcome).toBe('reopened')
    expect(second.projectId).toBe(first.projectId)
    expect(second.storeRoot).toBe(first.storeRoot)
  })

  it('rematerializes the store when the marker survives but the store side is missing', async () => {
    const home = await makeDir('home')
    const workspace = await makeDir('workspace')
    const first = await resolveProjectIdentity(workspace, home)
    await rm(first.storeRoot, { recursive: true, force: true })

    const second = await resolveProjectIdentity(workspace, home)
    expect(second.outcome).toBe('reopened')
    expect(second.projectId).toBe(first.projectId)
    const storeRecord = await readJson<RecordedStoreProject>(join(second.storeRoot, 'project.json'))
    expect(storeRecord.projectId).toBe(first.projectId)
  })

  it('keeps the same id on a move: the original path is gone', async () => {
    const home = await makeDir('home')
    const parent = await makeDir('parent')
    const original = join(parent, 'original')
    await mkdir(original)
    const first = await resolveProjectIdentity(original, home)

    const moved = join(parent, 'moved')
    await rename(original, moved)

    const second = await resolveProjectIdentity(moved, home)
    expect(second.outcome).toBe('moved')
    expect(second.projectId).toBe(first.projectId)
    expect(second.storeRoot).toBe(first.storeRoot)

    const storeRecord = await readJson<RecordedStoreProject>(join(second.storeRoot, 'project.json'))
    expect(storeRecord.workspacePath).toBe(moved)
  })

  it('treats a directory copied without its marker as a brand-new workspace', async () => {
    const home = await makeDir('home')
    const parent = await makeDir('parent')
    const original = join(parent, 'original')
    await mkdir(original)
    const first = await resolveProjectIdentity(original, home)

    const relocated = join(parent, 'relocated')
    await mkdir(relocated)
    // No marker at all in the new directory: it looks like a brand-new workspace, not a move or copy.
    const second = await resolveProjectIdentity(relocated, home)
    expect(second.outcome).toBe('created')
    expect(second.projectId).not.toBe(first.projectId)
  })

  it('assigns a fresh id on a copy: the original path still exists and still carries the marker', async () => {
    const home = await makeDir('home')
    const parent = await makeDir('parent')
    const original = join(parent, 'original')
    await mkdir(original)
    const first = await resolveProjectIdentity(original, home)

    const copy = join(parent, 'copy')
    await mkdir(join(copy, '.papermachine'), { recursive: true })
    await cp(join(original, '.papermachine', 'project.json'), join(copy, '.papermachine', 'project.json'))

    const second = await resolveProjectIdentity(copy, home)
    expect(second.outcome).toBe('copied')
    expect(second.projectId).not.toBe(first.projectId)
    expect(second.storeRoot).not.toBe(first.storeRoot)

    // The original project's own record is untouched.
    const originalStoreRecord = await readJson<RecordedStoreProject>(join(first.storeRoot, 'project.json'))
    expect(originalStoreRecord.workspacePath).toBe(original)
  })

  it.each([
    ['is not JSON at all', 'not json {'],
    ['is not an object', '"just a string"'],
    ['has an invalid projectId', '{"projectId": 5, "createdAt": 1}'],
    ['has an invalid createdAt', '{"projectId": "p", "createdAt": "bad"}'],
  ])('rejects a marker that %s', async (_label, content) => {
    const home = await makeDir('home')
    const workspace = await makeDir('workspace')
    await mkdir(join(workspace, '.papermachine'), { recursive: true })
    await writeFile(join(workspace, '.papermachine', 'project.json'), content)
    await expect(resolveProjectIdentity(workspace, home)).rejects.toMatchObject({
      code: 'INVALID_MARKER',
    } satisfies Partial<ProjectArtifactStoreError>)
  })

  it.each([
    ['is not an object', '"just a string"'],
    ['has an invalid projectId', '{"projectId": 5, "createdAt": 1, "workspacePath": "/x", "workspaceUpdatedAt": 1}'],
    ['has an invalid createdAt', '{"projectId": "p", "createdAt": "bad", "workspacePath": "/x", "workspaceUpdatedAt": 1}'],
    ['has an invalid workspacePath', '{"projectId": "p", "createdAt": 1, "workspacePath": 5, "workspaceUpdatedAt": 1}'],
    ['has an invalid workspaceUpdatedAt', '{"projectId": "p", "createdAt": 1, "workspacePath": "/x", "workspaceUpdatedAt": "bad"}'],
  ])('rejects a store record that %s', async (_label, content) => {
    const home = await makeDir('home')
    const workspace = await makeDir('workspace')
    const resolved = await resolveProjectIdentity(workspace, home)
    await writeFile(join(resolved.storeRoot, 'project.json'), content)
    await expect(resolveProjectIdentity(workspace, home)).rejects.toMatchObject({
      code: 'INVALID_MARKER',
    } satisfies Partial<ProjectArtifactStoreError>)
  })

  it('treats a move whose original marker is present but undecodable the same as a missing one', async () => {
    const home = await makeDir('home')
    const parent = await makeDir('parent')
    const original = join(parent, 'original')
    await mkdir(original)
    const first = await resolveProjectIdentity(original, home)

    // Corrupt the ORIGINAL workspace's marker (still present, no longer decodable).
    await writeFile(join(original, '.papermachine', 'project.json'), '"not a marker"')

    const relocated = join(parent, 'relocated')
    await mkdir(join(relocated, '.papermachine'), { recursive: true })
    await cp(join(first.storeRoot, 'project.json'), join(relocated, '.papermachine', 'project.json'))
    await writeFile(join(relocated, '.papermachine', 'project.json'), JSON.stringify({ projectId: first.projectId, createdAt: first.storeRoot.length }))

    const second = await resolveProjectIdentity(relocated, home)
    // The undecodable original marker cannot prove a copy, so this resolves as a move.
    expect(second.outcome).toBe('moved')
    expect(second.projectId).toBe(first.projectId)
  })
})

describe('deleteProjectStore', () => {
  it('removes the entire store directory', async () => {
    const home = await makeDir('home')
    const workspace = await makeDir('workspace')
    const resolved = await resolveProjectIdentity(workspace, home)
    await deleteProjectStore(resolved.projectId, home)
    await expect(readFile(join(resolved.storeRoot, 'project.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('is a no-op for a project that was never materialized', async () => {
    const home = await makeDir('home')
    await expect(deleteProjectStore(ProjectId('never-existed'), home)).resolves.toBeUndefined()
  })
})
