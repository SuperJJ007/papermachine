/**
 * The project artifact store engine: one cached SQLite connection per open
 * project, and the durable create/append/read/annotate/delete operations
 * over it. Framework-free — the Cordis service in `index.ts` wraps this.
 * @module @deepseek-ai/dsh-science-artifact-store/store
 */

import type { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { admitBlob, readBlob as readBlobBytes } from './blobs.ts'
import { ProjectArtifactStoreError } from './errors.ts'
import { ArtifactId, ProjectId, VersionId } from './ids.ts'
import { deleteProjectStore, resolveProjectIdentity, storeRootForProject } from './registry.ts'
import { openStoreDatabase, type JournalMode } from './schema.ts'
import type {
  AnnotateVersionInput,
  AppendVersionInput,
  ArtifactRecord,
  ArtifactVersionOrigin,
  CreateArtifactInput,
  OpenedProject,
  VersionRecord,
} from './types.ts'

/** Deployment-varying tunables for the engine's SQLite connections. */
export interface ProjectArtifactStoreOptions {
  readonly journalMode: JournalMode
  readonly busyTimeoutMs: number
  /** Explicit harness-home override; omitted follows `DSH_HOME`, then `~/.dsh`. */
  readonly dshHome?: string
}

interface ArtifactRow {
  readonly artifact_id: string
  readonly owning_project_id: string
  readonly origin_session_id: string
  readonly logical_name: string
  readonly latest_version_id: string | null
  readonly created_at: number
}

interface VersionRow {
  readonly version_id: string
  readonly artifact_id: string
  readonly ordinal: number
  readonly parent_version_id: string | null
  readonly sha256: string
  readonly media_type: string
  readonly byte_count: number
  readonly origin: string
  readonly title: string | null
  readonly caption: string | null
  readonly producer_session_id: string
  readonly producer_run_id: string | null
  readonly producer_tool_call_id: string | null
  readonly producer_request_header_seq: number | null
  readonly environment_revision: string | null
  readonly environment_fingerprint_preview: string | null
  readonly created_at: number
}

function toArtifactRecord(row: ArtifactRow): ArtifactRecord {
  if (row.latest_version_id === null) {
    // An artifact row without a latest version never survives its own
    // creation transaction; a row reaching this branch reflects a durable
    // invariant violation, not caller input.
    throw new ProjectArtifactStoreError(`artifact "${row.artifact_id}" has no latest version`, 'ARTIFACT_NOT_FOUND')
  }
  return {
    artifactId: ArtifactId(row.artifact_id),
    owningProjectId: ProjectId(row.owning_project_id),
    originSessionId: row.origin_session_id as SessionId,
    logicalName: row.logical_name,
    latestVersionId: VersionId(row.latest_version_id),
    createdAt: row.created_at,
  }
}

function toVersionRecord(row: VersionRow): VersionRecord {
  return {
    versionId: VersionId(row.version_id),
    artifactId: ArtifactId(row.artifact_id),
    ordinal: row.ordinal,
    parentVersionId: row.parent_version_id === null ? undefined : VersionId(row.parent_version_id),
    sha256: row.sha256,
    mediaType: row.media_type,
    byteCount: row.byte_count,
    origin: row.origin as ArtifactVersionOrigin,
    title: row.title ?? undefined,
    caption: row.caption ?? undefined,
    producerSessionId: row.producer_session_id as SessionId,
    producerRunId: row.producer_run_id ?? undefined,
    producerToolCallId: row.producer_tool_call_id ?? undefined,
    producerRequestHeaderSeq: row.producer_request_header_seq ?? undefined,
    environmentRevision: row.environment_revision ?? undefined,
    environmentFingerprintPreview: row.environment_fingerprint_preview ?? undefined,
    createdAt: row.created_at,
  }
}

const INSERT_VERSION_SQL = `
  INSERT INTO versions (
    version_id, artifact_id, ordinal, parent_version_id, sha256, media_type, byte_count,
    origin, title, caption, producer_session_id, producer_run_id, producer_tool_call_id,
    producer_request_header_seq, environment_revision, environment_fingerprint_preview, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`

/** Run one write transaction, rolling back on any failure before rethrowing. */
function runWriteTransaction<T>(db: DatabaseSync, operation: () => T): T {
  let began = false
  try {
    db.exec('BEGIN IMMEDIATE')
    began = true
    const result = operation()
    db.exec('COMMIT')
    return result
  } catch (error) {
    if (began) {
      try {
        db.exec('ROLLBACK')
      } catch {
        // The original failure inside the transaction remains actionable; a
        // rollback failure here only follows an already-failed connection.
      }
    }
    throw error
  }
}

/** Owns one open SQLite connection per project and the durable operations over it. */
export class ProjectArtifactStoreEngine {
  private readonly connections = new Map<string, Promise<DatabaseSync>>()
  private readonly roots = new Map<string, string>()

  /** @param options - deployment-varying connection tunables. */
  constructor(private readonly options: ProjectArtifactStoreOptions) {}

  /**
   * Resolve a workspace directory's project identity and ensure its store is open.
   * @param workspacePath - the workspace directory to resolve.
   * @returns the resolved identity, store root, and how it was resolved.
   */
  async openProject(workspacePath: string): Promise<OpenedProject> {
    const identity = await resolveProjectIdentity(workspacePath, this.options.dshHome)
    await this.connectionFor(identity.projectId, identity.storeRoot)
    return identity
  }

  private connectionFor(projectId: ProjectId, storeRootHint?: string): Promise<DatabaseSync> {
    const key = String(projectId)
    const existing = this.connections.get(key)
    if (existing !== undefined) return existing
    const storeRoot = storeRootHint ?? storeRootForProject(projectId, this.options.dshHome)
    const pending = openStoreDatabase(join(storeRoot, 'store.sqlite'), this.options.journalMode, this.options.busyTimeoutMs)
    this.connections.set(key, pending)
    this.roots.set(key, storeRoot)
    pending.catch(() => {
      this.connections.delete(key)
      this.roots.delete(key)
    })
    return pending
  }

  private async rootFor(projectId: ProjectId): Promise<string> {
    await this.connectionFor(projectId)
    // connectionFor populates roots before its promise can resolve, and
    // never removes the entry except on the failure path above (which throws
    // out of the preceding await), so the entry is present here.
    return this.roots.get(String(projectId)) as string
  }

  private getArtifactRow(db: DatabaseSync, artifactId: ArtifactId): ArtifactRecord {
    const row = db.prepare('SELECT * FROM artifacts WHERE artifact_id = ?').get(artifactId) as ArtifactRow | undefined
    if (row === undefined) throw new ProjectArtifactStoreError(`artifact "${artifactId}" was not found`, 'ARTIFACT_NOT_FOUND')
    return toArtifactRecord(row)
  }

  private getVersionRow(db: DatabaseSync, versionId: VersionId): VersionRecord {
    const row = db.prepare('SELECT * FROM versions WHERE version_id = ?').get(versionId) as VersionRow | undefined
    if (row === undefined) throw new ProjectArtifactStoreError(`version "${versionId}" was not found`, 'VERSION_NOT_FOUND')
    return toVersionRecord(row)
  }

  /**
   * Create a new artifact and its first version (ordinal 1, no parent).
   * @param projectId - the owning project; its store is opened if not already.
   * @param input - the first version's bytes, media type, origin, and metadata.
   * @returns the created artifact and its first version.
   */
  async createArtifact(projectId: ProjectId, input: CreateArtifactInput): Promise<{ artifact: ArtifactRecord; version: VersionRecord }> {
    const db = await this.connectionFor(projectId)
    const root = await this.rootFor(projectId)
    const { sha256, byteCount } = await admitBlob(root, input.data)
    const artifactId = ArtifactId(randomUUID())
    const versionId = VersionId(randomUUID())
    const now = Date.now()
    runWriteTransaction(db, () => {
      db.prepare(`
        INSERT INTO artifacts (artifact_id, owning_project_id, origin_session_id, logical_name, latest_version_id, created_at)
        VALUES (?, ?, ?, ?, NULL, ?)
      `).run(artifactId, String(projectId), input.originSessionId, input.logicalName, now)
      db.prepare(INSERT_VERSION_SQL).run(
        versionId, artifactId, 1, null, sha256, input.mediaType, byteCount,
        input.origin, input.title ?? null, input.caption ?? null, input.originSessionId,
        input.producerRunId ?? null, input.producerToolCallId ?? null, input.producerRequestHeaderSeq ?? null,
        input.environmentRevision ?? null, input.environmentFingerprintPreview ?? null, now,
      )
      db.prepare('UPDATE artifacts SET latest_version_id = ? WHERE artifact_id = ?').run(versionId, artifactId)
    })
    return { artifact: this.getArtifactRow(db, artifactId), version: this.getVersionRow(db, versionId) }
  }

  /**
   * Append a new version onto an existing artifact. The write transaction is
   * the linearization point: it reads the artifact's current latest version,
   * inserts the new version with that (or the explicit `editBaselines`) as
   * parent, and updates latest — so two concurrent appends serialize on this
   * transaction and the later committer becomes latest, never forking.
   * @param projectId - the owning project; its store is opened if not already.
   * @param artifactId - the artifact to append to.
   * @param input - the new version's bytes, media type, origin, and metadata.
   * @returns the appended version.
   * @throws {@link ProjectArtifactStoreError} with code `ARTIFACT_NOT_FOUND` when no such artifact exists in this project.
   */
  async appendVersion(projectId: ProjectId, artifactId: ArtifactId, input: AppendVersionInput): Promise<VersionRecord> {
    const db = await this.connectionFor(projectId)
    const root = await this.rootFor(projectId)
    const { sha256, byteCount } = await admitBlob(root, input.data)
    const versionId = VersionId(randomUUID())
    const now = Date.now()
    runWriteTransaction(db, () => {
      const artifactRow = db.prepare('SELECT latest_version_id FROM artifacts WHERE artifact_id = ?').get(artifactId) as
        | { latest_version_id: string | null }
        | undefined
      if (artifactRow === undefined) {
        throw new ProjectArtifactStoreError(`artifact "${artifactId}" was not found in project "${projectId}"`, 'ARTIFACT_NOT_FOUND')
      }
      const parentVersionId = input.editBaselines ?? (artifactRow.latest_version_id === null ? undefined : artifactRow.latest_version_id)
      const ordinalRow = db.prepare('SELECT COALESCE(MAX(ordinal), 0) AS max_ordinal FROM versions WHERE artifact_id = ?')
        .get(artifactId) as { max_ordinal: number }
      const ordinal = ordinalRow.max_ordinal + 1
      db.prepare(INSERT_VERSION_SQL).run(
        versionId, artifactId, ordinal, parentVersionId ?? null, sha256, input.mediaType, byteCount,
        input.origin, input.title ?? null, input.caption ?? null, input.producerSessionId,
        input.producerRunId ?? null, input.producerToolCallId ?? null, input.producerRequestHeaderSeq ?? null,
        input.environmentRevision ?? null, input.environmentFingerprintPreview ?? null, now,
      )
      db.prepare('UPDATE artifacts SET latest_version_id = ? WHERE artifact_id = ?').run(versionId, artifactId)
    })
    return this.getVersionRow(db, versionId)
  }

  /**
   * Apply a metadata-only patch to one version in place: title, caption,
   * and/or origin. Bytes, `sha256`, and `ordinal` never change.
   * @param projectId - the owning project.
   * @param versionId - the version to curate.
   * @param patch - fields to overwrite; an omitted field keeps its current value.
   * @returns the updated version.
   * @throws {@link ProjectArtifactStoreError} with code `VERSION_NOT_FOUND` when no such version exists in this project.
   */
  async annotateVersion(projectId: ProjectId, versionId: VersionId, patch: AnnotateVersionInput): Promise<VersionRecord> {
    const db = await this.connectionFor(projectId)
    runWriteTransaction(db, () => {
      const existing = db.prepare('SELECT title, caption, origin FROM versions WHERE version_id = ?').get(versionId) as
        | { title: string | null; caption: string | null; origin: string }
        | undefined
      if (existing === undefined) throw new ProjectArtifactStoreError(`version "${versionId}" was not found`, 'VERSION_NOT_FOUND')
      const title = patch.title !== undefined ? patch.title : existing.title
      const caption = patch.caption !== undefined ? patch.caption : existing.caption
      const origin = patch.origin !== undefined ? patch.origin : existing.origin
      db.prepare('UPDATE versions SET title = ?, caption = ?, origin = ? WHERE version_id = ?').run(title, caption, origin, versionId)
    })
    return this.getVersionRow(db, versionId)
  }

  /**
   * Look up one artifact by id.
   * @param projectId - the owning project.
   * @param artifactId - the artifact to look up.
   * @returns the artifact, or `undefined` when no such artifact exists.
   */
  async getArtifact(projectId: ProjectId, artifactId: ArtifactId): Promise<ArtifactRecord | undefined> {
    const db = await this.connectionFor(projectId)
    const row = db.prepare('SELECT * FROM artifacts WHERE artifact_id = ?').get(artifactId) as ArtifactRow | undefined
    return row === undefined ? undefined : toArtifactRecord(row)
  }

  /**
   * Look up one version by id.
   * @param projectId - the owning project.
   * @param versionId - the version to look up.
   * @returns the version, or `undefined` when no such version exists.
   */
  async getVersion(projectId: ProjectId, versionId: VersionId): Promise<VersionRecord | undefined> {
    const db = await this.connectionFor(projectId)
    const row = db.prepare('SELECT * FROM versions WHERE version_id = ?').get(versionId) as VersionRow | undefined
    return row === undefined ? undefined : toVersionRecord(row)
  }

  /**
   * Look up an artifact's current latest version.
   * @param projectId - the owning project.
   * @param artifactId - the artifact whose latest version to fetch.
   * @returns the latest version, or `undefined` when the artifact does not exist.
   */
  async getLatestVersion(projectId: ProjectId, artifactId: ArtifactId): Promise<VersionRecord | undefined> {
    const db = await this.connectionFor(projectId)
    const artifactRow = db.prepare('SELECT latest_version_id FROM artifacts WHERE artifact_id = ?').get(artifactId) as
      | { latest_version_id: string | null }
      | undefined
    if (artifactRow === undefined || artifactRow.latest_version_id === null) return undefined
    const row = db.prepare('SELECT * FROM versions WHERE version_id = ?').get(artifactRow.latest_version_id) as VersionRow | undefined
    return row === undefined ? undefined : toVersionRecord(row)
  }

  /**
   * List every artifact in a project, oldest first.
   * @param projectId - the owning project.
   * @returns every artifact currently in the project's store.
   */
  async listArtifacts(projectId: ProjectId): Promise<readonly ArtifactRecord[]> {
    const db = await this.connectionFor(projectId)
    const rows = db.prepare('SELECT * FROM artifacts ORDER BY created_at ASC').all() as unknown as ArtifactRow[]
    return rows.map(toArtifactRecord)
  }

  /**
   * List one artifact's versions in ordinal order.
   * @param projectId - the owning project.
   * @param artifactId - the artifact whose versions to list.
   * @returns every version of the artifact, oldest first.
   */
  async listVersions(projectId: ProjectId, artifactId: ArtifactId): Promise<readonly VersionRecord[]> {
    const db = await this.connectionFor(projectId)
    const rows = db.prepare('SELECT * FROM versions WHERE artifact_id = ? ORDER BY ordinal ASC').all(artifactId) as unknown as VersionRow[]
    return rows.map(toVersionRecord)
  }

  /**
   * Read one version's bytes by content address.
   * @param projectId - the owning project.
   * @param sha256 - the digest from an already-resolved version row.
   * @returns the verified bytes.
   */
  async readBlob(projectId: ProjectId, sha256: string): Promise<Uint8Array> {
    const root = await this.rootFor(projectId)
    return readBlobBytes(root, sha256)
  }

  /**
   * Permanently delete a project's entire store: index and blobs. Session
   * deletion never reaches this method — it is the artifact-ownership
   * cascade boundary, not a session-lifecycle operation.
   * @param projectId - the project to delete.
   */
  async deleteProject(projectId: ProjectId): Promise<void> {
    const key = String(projectId)
    const pending = this.connections.get(key)
    this.connections.delete(key)
    this.roots.delete(key)
    if (pending !== undefined) {
      const db = await pending.catch(() => undefined)
      db?.close()
    }
    await deleteProjectStore(projectId, this.options.dshHome)
  }

  /** Close every open connection. Idempotent. */
  async close(): Promise<void> {
    const pending = [...this.connections.values()]
    this.connections.clear()
    this.roots.clear()
    for (const entry of pending) {
      const db = await entry.catch(() => undefined)
      db?.close()
    }
  }
}
