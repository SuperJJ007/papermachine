/**
 * Project identity: the workspace marker file, the store's own record of its
 * last-known workspace path, and the create/reopen/move/copy resolution rule.
 * The store's `project.json` is the registry — no separate global index.
 * @module @deepseek-ai/dsh-science-artifact-store/registry
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { ProjectArtifactStoreError } from './errors.ts'
import { ProjectId } from './ids.ts'
import type { ProjectIdentityOutcome } from './types.ts'

const MARKER_DIR_NAME = '.papermachine'
const MARKER_FILE_NAME = 'project.json'
const STORE_PROJECT_FILE_NAME = 'project.json'

interface WorkspaceMarker {
  readonly projectId: string
  readonly createdAt: number
}

interface StoreProjectRecord {
  readonly projectId: string
  readonly createdAt: number
  readonly workspacePath: string
  readonly workspaceUpdatedAt: number
}

/** Result of resolving one workspace directory's project identity. */
export interface ResolvedProjectIdentity {
  readonly projectId: ProjectId
  readonly storeRoot: string
  readonly workspacePath: string
  readonly outcome: ProjectIdentityOutcome
}

function markerPath(workspacePath: string): string {
  return join(workspacePath, MARKER_DIR_NAME, MARKER_FILE_NAME)
}

function storeProjectJsonPath(storeRoot: string): string {
  return join(storeRoot, STORE_PROJECT_FILE_NAME)
}

/**
 * Deterministic store directory for a project id, rooted under the harness
 * home. Callers with only a `projectId` (no workspace path, e.g. after a
 * Host restart) use this directly without re-resolving identity.
 * @param projectId - the project's branded identifier.
 * @param dshHome - explicit harness-home override; omitted follows `DSH_HOME`, then `~/.dsh`.
 * @returns the absolute store directory path.
 */
export function storeRootForProject(projectId: ProjectId, dshHome?: string): string {
  return join(resolveDshHome(dshHome), 'projects', String(projectId))
}

async function readJsonFile<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new ProjectArtifactStoreError(`unable to read "${path}"`, 'INVALID_MARKER', { cause: error })
  }
}

function decodeWorkspaceMarker(value: unknown, path: string): WorkspaceMarker {
  if (typeof value !== 'object' || value === null) throw new ProjectArtifactStoreError(`marker at "${path}" is not an object`, 'INVALID_MARKER')
  const { projectId, createdAt } = value as Record<string, unknown>
  if (typeof projectId !== 'string' || projectId === '') throw new ProjectArtifactStoreError(`marker at "${path}" has an invalid projectId`, 'INVALID_MARKER')
  if (typeof createdAt !== 'number') throw new ProjectArtifactStoreError(`marker at "${path}" has an invalid createdAt`, 'INVALID_MARKER')
  return { projectId, createdAt }
}

function decodeStoreProjectRecord(value: unknown, path: string): StoreProjectRecord {
  if (typeof value !== 'object' || value === null) throw new ProjectArtifactStoreError(`store record at "${path}" is not an object`, 'INVALID_MARKER')
  const { projectId, createdAt, workspacePath, workspaceUpdatedAt } = value as Record<string, unknown>
  if (typeof projectId !== 'string' || projectId === '') throw new ProjectArtifactStoreError(`store record at "${path}" has an invalid projectId`, 'INVALID_MARKER')
  if (typeof createdAt !== 'number') throw new ProjectArtifactStoreError(`store record at "${path}" has an invalid createdAt`, 'INVALID_MARKER')
  if (typeof workspacePath !== 'string' || workspacePath === '') throw new ProjectArtifactStoreError(`store record at "${path}" has an invalid workspacePath`, 'INVALID_MARKER')
  if (typeof workspaceUpdatedAt !== 'number') throw new ProjectArtifactStoreError(`store record at "${path}" has an invalid workspaceUpdatedAt`, 'INVALID_MARKER')
  return { projectId, createdAt, workspacePath, workspaceUpdatedAt }
}

async function writeWorkspaceMarker(workspacePath: string, marker: WorkspaceMarker): Promise<void> {
  await writeFileAtomic(markerPath(workspacePath), `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
}

async function writeStoreProjectRecord(storeRoot: string, record: StoreProjectRecord): Promise<void> {
  await writeFileAtomic(storeProjectJsonPath(storeRoot), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
}

async function markerStillNamesProject(workspacePath: string, projectId: ProjectId): Promise<boolean> {
  const marker = await readJsonFile<unknown>(markerPath(workspacePath))
  if (marker === undefined) return false
  try {
    return decodeWorkspaceMarker(marker, markerPath(workspacePath)).projectId === String(projectId)
  } catch {
    // An unreadable marker at the recorded path cannot prove the id survives there, so it is not evidence of a copy.
    return false
  }
}

/**
 * Resolve a workspace directory's project identity, creating a fresh project
 * on first use and applying the move-vs-copy rule when the store's recorded
 * workspace path differs from the one opening now: the opening directory is
 * a copy (fresh id, marker rewritten) only when the recorded path still
 * exists and still carries a marker naming the same project; otherwise it is
 * a move (same id, the store's recorded path is updated).
 * @param workspacePath - the workspace directory to resolve; need not exist yet as a Science workspace.
 * @param dshHome - explicit harness-home override; omitted follows `DSH_HOME`, then `~/.dsh`.
 * @returns the resolved project identity and its store directory.
 * @throws {@link ProjectArtifactStoreError} with code `INVALID_MARKER` when an existing marker or store record cannot be decoded.
 */
export async function resolveProjectIdentity(workspacePath: string, dshHome?: string): Promise<ResolvedProjectIdentity> {
  const canonicalWorkspace = resolve(workspacePath)
  const now = Date.now()
  const markerValue = await readJsonFile<unknown>(markerPath(canonicalWorkspace))

  if (markerValue === undefined) {
    const projectId = ProjectId(randomUUID())
    await writeWorkspaceMarker(canonicalWorkspace, { projectId, createdAt: now })
    const storeRoot = storeRootForProject(projectId, dshHome)
    await mkdir(storeRoot, { recursive: true, mode: 0o700 })
    await writeStoreProjectRecord(storeRoot, { projectId, createdAt: now, workspacePath: canonicalWorkspace, workspaceUpdatedAt: now })
    return { projectId, storeRoot, workspacePath: canonicalWorkspace, outcome: 'created' }
  }

  const marker = decodeWorkspaceMarker(markerValue, markerPath(canonicalWorkspace))
  const projectId = ProjectId(marker.projectId)
  const storeRoot = storeRootForProject(projectId, dshHome)
  const storeRecordValue = await readJsonFile<unknown>(storeProjectJsonPath(storeRoot))

  if (storeRecordValue === undefined) {
    // The marker survived but the store side was never materialized (or was
    // lost) — materialize it fresh under the SAME id; the marker is authoritative.
    await mkdir(storeRoot, { recursive: true, mode: 0o700 })
    await writeStoreProjectRecord(storeRoot, {
      projectId, createdAt: marker.createdAt, workspacePath: canonicalWorkspace, workspaceUpdatedAt: now,
    })
    return { projectId, storeRoot, workspacePath: canonicalWorkspace, outcome: 'reopened' }
  }

  const storeRecord = decodeStoreProjectRecord(storeRecordValue, storeProjectJsonPath(storeRoot))
  if (storeRecord.workspacePath === canonicalWorkspace) {
    await writeStoreProjectRecord(storeRoot, { ...storeRecord, workspaceUpdatedAt: now })
    return { projectId, storeRoot, workspacePath: canonicalWorkspace, outcome: 'reopened' }
  }

  if (await markerStillNamesProject(storeRecord.workspacePath, projectId)) {
    // COPY: the original workspace is still there and still owns this id, so
    // the directory opening now is a duplicate — it gets a fresh identity.
    const copyProjectId = ProjectId(randomUUID())
    await writeWorkspaceMarker(canonicalWorkspace, { projectId: copyProjectId, createdAt: now })
    const copyStoreRoot = storeRootForProject(copyProjectId, dshHome)
    await mkdir(copyStoreRoot, { recursive: true, mode: 0o700 })
    await writeStoreProjectRecord(copyStoreRoot, {
      projectId: copyProjectId, createdAt: now, workspacePath: canonicalWorkspace, workspaceUpdatedAt: now,
    })
    return { projectId: copyProjectId, storeRoot: copyStoreRoot, workspacePath: canonicalWorkspace, outcome: 'copied' }
  }

  // MOVE: the recorded path is gone, or no longer carries this id — keep the
  // same identity and repoint the store's recorded workspace path.
  await writeStoreProjectRecord(storeRoot, { ...storeRecord, workspacePath: canonicalWorkspace, workspaceUpdatedAt: now })
  return { projectId, storeRoot, workspacePath: canonicalWorkspace, outcome: 'moved' }
}

/**
 * Permanently remove one project's entire store directory — the one cascade
 * boundary in this package. Session deletion never reaches here: store rows
 * keep their producer `sessionId` as provenance regardless of session lifecycle.
 * @param projectId - the project to remove.
 * @param dshHome - explicit harness-home override; omitted follows `DSH_HOME`, then `~/.dsh`.
 */
export async function deleteProjectStore(projectId: ProjectId, dshHome?: string): Promise<void> {
  await rm(storeRootForProject(projectId, dshHome), { recursive: true, force: true })
}
