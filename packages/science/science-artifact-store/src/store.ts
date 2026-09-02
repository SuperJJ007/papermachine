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
import { admitBlob, blobByteCount, readBlob as readBlobBytes } from './blobs.ts'
import { ProjectArtifactStoreError } from './errors.ts'
import { AnnotationId, ArtifactId, NoteId, ProjectId, VersionId } from './ids.ts'
import { reconcileProject as runReconciliation } from './reconcile.ts'
import type { ReconcileArtifactSavedEvent, ReconcileResult } from './reconcile.ts'
import { deleteProjectStore, resolveProjectIdentity, storeRootForProject } from './registry.ts'
import { openStoreDatabase, type BackfillProvenanceHook, type JournalMode, type OpenStoreDatabaseOptions } from './schema.ts'
import type {
  AnnotateVersionInput,
  AppendVersionInput,
  ArtifactKind,
  ArtifactNoteRecord,
  ArtifactRecord,
  AnnotationActor,
  CreateArtifactInput,
  FigureStateInput,
  FigureStateRecord,
  OpenedProject,
  PutNoteInput,
  ReconciliationSummary,
  ReconstructVersionInput,
  VersionAnnotationRecord,
  VersionHealthPatch,
  VersionHealthRecord,
  VersionRecord,
} from './types.ts'

/** Deployment-varying tunables for the engine's SQLite connections. */
export interface ProjectArtifactStoreOptions {
  readonly journalMode: JournalMode
  readonly busyTimeoutMs: number
  /** Explicit harness-home override; omitted follows `DSH_HOME`, then `~/.dsh`. */
  readonly dshHome?: string
  /** How many pre-upgrade `.bak` copies of a project's `store.sqlite` to retain. */
  readonly storeBackupRetention: number
  /**
   * Upper bound on how many version rows and dangling events one
   * `reconcileProject` call processes; a project with more outstanding work
   * reports `truncated: true` rather than blocking the caller.
   */
  readonly reconcileMaxVersions: number
  /** Consulted at most once per project, during a v1→v2 upgrade's optional step 4. See `schema.ts`'s `BackfillProvenanceHook`. */
  readonly backfillProvenance?: BackfillProvenanceHook
  /** Diagnostic sink for a migration's non-fatal degradations. */
  readonly onWarning?: (message: string) => void
}

interface ArtifactRow {
  readonly artifact_id: string
  readonly owning_project_id: string
  readonly origin_session_id: string
  readonly logical_name: string
  readonly kind: string
  readonly latest_version_id: string | null
  readonly created_at: number
}

interface VersionRow {
  readonly version_id: string
  readonly artifact_id: string
  readonly ordinal: number
  readonly base_version_id: string | null
  readonly base_explicit: number
  readonly sha256: string
  readonly media_type: string
  readonly byte_count: number
  readonly content_origin: string
  readonly producer_session_id: string
  readonly producer_run_id: string | null
  readonly producer_tool_call_id: string | null
  readonly producer_request_header_seq: number | null
  readonly producer_turn: number | null
  readonly environment_revision: number | null
  readonly environment_fingerprint: string | null
  readonly latest_annotation_id: string | null
  readonly created_at: number
}

interface AnnotationRow {
  readonly annotation_id: string
  readonly version_id: string
  readonly title: string | null
  readonly caption: string | null
  readonly actor: string
  readonly session_id: string | null
  readonly tool_call_id: string | null
  readonly request_header_seq: number | null
  readonly derived: number
  readonly created_at: number
}

interface NoteRow {
  readonly note_id: string
  readonly artifact_id: string
  readonly version_id: string | null
  readonly text: string
  readonly session_id: string | null
  readonly created_at: number
  readonly removed_at: number | null
}

interface FigureStateRow {
  readonly version_id: string
  readonly figure_key: string
  readonly dpi: number
  readonly state_json: string
}

interface VersionHealthRow {
  readonly version_id: string
  readonly orphan: number
  readonly reconstructed: number
  readonly missing_content: number
  readonly checked_at: number
}

/** Fields `insertAnnotation` needs, shared by `annotateVersion` and `reconstructVersion`. */
interface InsertAnnotationFields {
  readonly title: string | null
  readonly caption: string | null
  readonly actor: AnnotationActor
  readonly sessionId?: SessionId
  readonly toolCallId?: string
  readonly requestHeaderSeq?: number
  readonly derived: boolean
  readonly createdAt: number
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
    kind: row.kind as ArtifactKind,
    latestVersionId: VersionId(row.latest_version_id),
    createdAt: row.created_at,
  }
}

function toAnnotationRecord(row: AnnotationRow): VersionAnnotationRecord {
  return {
    annotationId: AnnotationId(row.annotation_id),
    versionId: VersionId(row.version_id),
    title: row.title,
    caption: row.caption,
    actor: row.actor as AnnotationActor,
    sessionId: row.session_id === null ? undefined : row.session_id as SessionId,
    toolCallId: row.tool_call_id ?? undefined,
    requestHeaderSeq: row.request_header_seq ?? undefined,
    derived: row.derived === 1,
    createdAt: row.created_at,
  }
}

function toVersionRecord(row: VersionRow, annotation: VersionAnnotationRecord | undefined): VersionRecord {
  return {
    versionId: VersionId(row.version_id),
    artifactId: ArtifactId(row.artifact_id),
    ordinal: row.ordinal,
    baseVersionId: row.base_version_id === null ? undefined : VersionId(row.base_version_id),
    baseExplicit: row.base_explicit === 1,
    sha256: row.sha256,
    mediaType: row.media_type,
    byteCount: row.byte_count,
    contentOrigin: row.content_origin as VersionRecord['contentOrigin'],
    producerSessionId: row.producer_session_id as SessionId,
    producerRunId: row.producer_run_id ?? undefined,
    producerToolCallId: row.producer_tool_call_id ?? undefined,
    producerRequestHeaderSeq: row.producer_request_header_seq ?? undefined,
    producerTurn: row.producer_turn ?? undefined,
    environmentRevision: row.environment_revision ?? undefined,
    environmentFingerprint: row.environment_fingerprint ?? undefined,
    createdAt: row.created_at,
    latestAnnotation: annotation,
    title: annotation?.title ?? undefined,
    caption: annotation?.caption ?? undefined,
  }
}

function toNoteRecord(row: NoteRow): ArtifactNoteRecord {
  return {
    noteId: NoteId(row.note_id),
    artifactId: ArtifactId(row.artifact_id),
    versionId: row.version_id === null ? undefined : VersionId(row.version_id),
    text: row.text,
    sessionId: row.session_id === null ? undefined : row.session_id as SessionId,
    createdAt: row.created_at,
    removedAt: row.removed_at ?? undefined,
  }
}

function toFigureStateRecord(row: FigureStateRow): FigureStateRecord {
  return {
    versionId: VersionId(row.version_id),
    figureKey: row.figure_key,
    dpi: row.dpi,
    stateJson: row.state_json,
  }
}

function toVersionHealthRecord(row: VersionHealthRow): VersionHealthRecord {
  return {
    versionId: VersionId(row.version_id),
    orphan: row.orphan === 1,
    reconstructed: row.reconstructed === 1,
    missingContent: row.missing_content === 1,
    checkedAt: row.checked_at,
  }
}

const INSERT_VERSION_SQL = `
  INSERT INTO versions (
    version_id, artifact_id, ordinal, base_version_id, base_explicit, sha256, media_type, byte_count,
    content_origin, producer_session_id, producer_run_id, producer_tool_call_id, producer_request_header_seq,
    producer_turn, environment_revision, environment_fingerprint, latest_annotation_id, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
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
    const openOptions: OpenStoreDatabaseOptions = {
      journalMode: this.options.journalMode,
      busyTimeoutMs: this.options.busyTimeoutMs,
      backupRetention: this.options.storeBackupRetention,
      ...this.options.backfillProvenance === undefined ? {} : { backfillProvenance: this.options.backfillProvenance },
      ...this.options.onWarning === undefined ? {} : { onWarning: this.options.onWarning },
    }
    const pending = openStoreDatabase(join(storeRoot, 'store.sqlite'), key, openOptions)
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

  private getAnnotationRow(db: DatabaseSync, annotationId: string): VersionAnnotationRecord | undefined {
    const row = db.prepare('SELECT * FROM version_annotations WHERE annotation_id = ?').get(annotationId) as AnnotationRow | undefined
    return row === undefined ? undefined : toAnnotationRecord(row)
  }

  private assembleVersion(db: DatabaseSync, row: VersionRow): VersionRecord {
    const annotation = row.latest_annotation_id === null ? undefined : this.getAnnotationRow(db, row.latest_annotation_id)
    return toVersionRecord(row, annotation)
  }

  private getVersionRow(db: DatabaseSync, versionId: VersionId): VersionRecord {
    const row = db.prepare('SELECT * FROM versions WHERE version_id = ?').get(versionId) as VersionRow | undefined
    if (row === undefined) throw new ProjectArtifactStoreError(`version "${versionId}" was not found`, 'VERSION_NOT_FOUND')
    return this.assembleVersion(db, row)
  }

  private insertFigureState(db: DatabaseSync, versionId: VersionId, figureState: FigureStateInput): void {
    db.prepare('INSERT INTO figure_state (version_id, figure_key, dpi, state_json) VALUES (?, ?, ?, ?)')
      .run(versionId, figureState.figureKey, figureState.dpi, figureState.stateJson)
  }

  /**
   * Insert one `version_annotations` row and advance the version's
   * `latestAnnotationId` to it. Shared by `annotateVersion` (`derived:
   * false`, a live call) and `reconstructVersion` (`derived: true`, a
   * reconciliation-synthesized row) — the same append-only mechanism, two
   * different callers.
   */
  private insertAnnotation(db: DatabaseSync, versionId: VersionId, fields: InsertAnnotationFields): AnnotationId {
    const annotationId = AnnotationId(randomUUID())
    db.prepare(`
      INSERT INTO version_annotations (annotation_id, version_id, title, caption, actor, session_id, tool_call_id, request_header_seq, derived, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      annotationId, versionId, fields.title, fields.caption, fields.actor,
      fields.sessionId ?? null, fields.toolCallId ?? null, fields.requestHeaderSeq ?? null,
      fields.derived ? 1 : 0, fields.createdAt,
    )
    db.prepare('UPDATE versions SET latest_annotation_id = ? WHERE version_id = ?').run(annotationId, versionId)
    return annotationId
  }

  /**
   * Create a new artifact and its first version (ordinal 1). Carries no
   * title/caption — curate the version afterward with `annotateVersion`.
   * @param projectId - the owning project; its store is opened if not already.
   * @param input - the first version's bytes, kind, provenance, and optional explicit baseline.
   * @returns the created artifact and its first version.
   * @throws {@link ProjectArtifactStoreError} with code `LOGICAL_NAME_CONFLICT`
   * when the project already has an artifact with this `logicalName`.
   */
  async createArtifact(projectId: ProjectId, input: CreateArtifactInput): Promise<{ artifact: ArtifactRecord; version: VersionRecord }> {
    const db = await this.connectionFor(projectId)
    const root = await this.rootFor(projectId)
    const { sha256, byteCount } = await admitBlob(root, input.data)
    const artifactId = ArtifactId(randomUUID())
    const versionId = VersionId(randomUUID())
    const now = Date.now()
    runWriteTransaction(db, () => {
      const conflict = db.prepare('SELECT 1 FROM artifacts WHERE owning_project_id = ? AND logical_name = ?').get(String(projectId), input.logicalName)
      if (conflict !== undefined) {
        throw new ProjectArtifactStoreError(`an artifact named "${input.logicalName}" already exists in project "${projectId}"`, 'LOGICAL_NAME_CONFLICT')
      }
      db.prepare(`
        INSERT INTO artifacts (artifact_id, owning_project_id, origin_session_id, logical_name, kind, latest_version_id, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, ?)
      `).run(artifactId, String(projectId), input.originSessionId, input.logicalName, input.kind, now)
      db.prepare(INSERT_VERSION_SQL).run(
        versionId, artifactId, 1, input.baseVersionId ?? null, input.baseVersionId === undefined ? 0 : 1,
        sha256, input.mediaType, byteCount, input.contentOrigin, input.originSessionId,
        input.producerRunId ?? null, input.producerToolCallId ?? null, input.producerRequestHeaderSeq ?? null,
        input.producerTurn ?? null, input.environmentRevision ?? null, input.environmentFingerprint ?? null, now,
      )
      db.prepare('UPDATE artifacts SET latest_version_id = ? WHERE artifact_id = ?').run(versionId, artifactId)
      if (input.figureState !== undefined) this.insertFigureState(db, versionId, input.figureState)
    })
    return { artifact: this.getArtifactRow(db, artifactId), version: this.getVersionRow(db, versionId) }
  }

  /**
   * Append a new version onto an existing artifact. The write transaction is
   * the linearization point: it reads the artifact's current latest version
   * only to compute the next ordinal, inserts the new version, and updates
   * latest — so two concurrent appends serialize on this transaction and the
   * later committer becomes latest, never forking. `baseVersionId` is never
   * defaulted from the artifact's latest version: an omitted baseline means
   * a plain chain continuation, not "no opinion" (see `VersionRecord.baseVersionId`).
   * @param projectId - the owning project; its store is opened if not already.
   * @param artifactId - the artifact to append to.
   * @param input - the new version's bytes, provenance, and optional explicit baseline.
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
      const artifactRow = db.prepare('SELECT artifact_id FROM artifacts WHERE artifact_id = ?').get(artifactId) as { artifact_id: string } | undefined
      if (artifactRow === undefined) {
        throw new ProjectArtifactStoreError(`artifact "${artifactId}" was not found in project "${projectId}"`, 'ARTIFACT_NOT_FOUND')
      }
      const ordinalRow = db.prepare('SELECT COALESCE(MAX(ordinal), 0) AS max_ordinal FROM versions WHERE artifact_id = ?')
        .get(artifactId) as { max_ordinal: number }
      const ordinal = ordinalRow.max_ordinal + 1
      db.prepare(INSERT_VERSION_SQL).run(
        versionId, artifactId, ordinal, input.baseVersionId ?? null, input.baseVersionId === undefined ? 0 : 1,
        sha256, input.mediaType, byteCount, input.contentOrigin, input.producerSessionId,
        input.producerRunId ?? null, input.producerToolCallId ?? null, input.producerRequestHeaderSeq ?? null,
        input.producerTurn ?? null, input.environmentRevision ?? null, input.environmentFingerprint ?? null, now,
      )
      db.prepare('UPDATE artifacts SET latest_version_id = ? WHERE artifact_id = ?').run(versionId, artifactId)
      if (input.figureState !== undefined) this.insertFigureState(db, versionId, input.figureState)
    })
    return this.getVersionRow(db, versionId)
  }

  /**
   * Append one metadata edit onto a version and advance its
   * `latestAnnotationId` to it. Bytes, `sha256`, `ordinal`, and every
   * producer field are untouched — and so is the version's own `createdAt`.
   * `title`/`caption` are independently tri-state: omitted carries the
   * current value forward, `null` clears it, a string sets it.
   * @param projectId - the owning project.
   * @param versionId - the version to annotate.
   * @param patch - the edit's author and the fields to change.
   * @returns the version, reflecting the newly appended annotation.
   * @throws {@link ProjectArtifactStoreError} with code `VERSION_NOT_FOUND` when no such version exists in this project.
   */
  async annotateVersion(projectId: ProjectId, versionId: VersionId, patch: AnnotateVersionInput): Promise<VersionRecord> {
    const db = await this.connectionFor(projectId)
    const now = Date.now()
    runWriteTransaction(db, () => {
      const versionRow = db.prepare('SELECT latest_annotation_id FROM versions WHERE version_id = ?').get(versionId) as
        | { latest_annotation_id: string | null }
        | undefined
      if (versionRow === undefined) throw new ProjectArtifactStoreError(`version "${versionId}" was not found`, 'VERSION_NOT_FOUND')
      const existing = versionRow.latest_annotation_id === null ? undefined : this.getAnnotationRow(db, versionRow.latest_annotation_id)
      const title = patch.title !== undefined ? patch.title : existing?.title ?? null
      const caption = patch.caption !== undefined ? patch.caption : existing?.caption ?? null
      this.insertAnnotation(db, versionId, {
        title, caption, actor: patch.actor,
        ...patch.sessionId === undefined ? {} : { sessionId: patch.sessionId },
        ...patch.toolCallId === undefined ? {} : { toolCallId: patch.toolCallId },
        ...patch.requestHeaderSeq === undefined ? {} : { requestHeaderSeq: patch.requestHeaderSeq },
        derived: false,
        createdAt: now,
      })
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
    return row === undefined ? undefined : this.assembleVersion(db, row)
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
    return row === undefined ? undefined : this.assembleVersion(db, row)
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
    return rows.map(row => this.assembleVersion(db, row))
  }

  /**
   * List one artifact's active (non-removed) notes, oldest first.
   * @param projectId - the owning project.
   * @param artifactId - the artifact whose notes to list.
   * @returns every note that has not been removed.
   */
  async listNotes(projectId: ProjectId, artifactId: ArtifactId): Promise<readonly ArtifactNoteRecord[]> {
    const db = await this.connectionFor(projectId)
    const rows = db.prepare('SELECT * FROM artifact_notes WHERE artifact_id = ? AND removed_at IS NULL ORDER BY created_at ASC')
      .all(artifactId) as unknown as NoteRow[]
    return rows.map(toNoteRecord)
  }

  /**
   * Add a new note. There is no update-in-place: editing a note means
   * removing it and adding another.
   * @param projectId - the owning project.
   * @param input - the artifact (and optional version) to attach the note to, its text, and its author.
   * @returns the created note.
   * @throws {@link ProjectArtifactStoreError} with code `ARTIFACT_NOT_FOUND` when no such artifact exists in this project.
   */
  async putNote(projectId: ProjectId, input: PutNoteInput): Promise<ArtifactNoteRecord> {
    const db = await this.connectionFor(projectId)
    const noteId = NoteId(randomUUID())
    const now = Date.now()
    runWriteTransaction(db, () => {
      const artifactRow = db.prepare('SELECT 1 FROM artifacts WHERE artifact_id = ?').get(input.artifactId)
      if (artifactRow === undefined) throw new ProjectArtifactStoreError(`artifact "${input.artifactId}" was not found`, 'ARTIFACT_NOT_FOUND')
      db.prepare(`
        INSERT INTO artifact_notes (note_id, artifact_id, version_id, text, session_id, created_at, removed_at)
        VALUES (?, ?, ?, ?, ?, ?, NULL)
      `).run(noteId, input.artifactId, input.versionId ?? null, input.text, input.sessionId ?? null, now)
    })
    const row = db.prepare('SELECT * FROM artifact_notes WHERE note_id = ?').get(noteId) as unknown as NoteRow
    return toNoteRecord(row)
  }

  /**
   * Soft-delete a note: sets `removedAt`, never deletes the row.
   * @param projectId - the owning project.
   * @param noteId - the note to remove.
   * @throws {@link ProjectArtifactStoreError} with code `NOTE_NOT_FOUND` when no such active note exists.
   */
  async removeNote(projectId: ProjectId, noteId: NoteId): Promise<void> {
    const db = await this.connectionFor(projectId)
    const now = Date.now()
    runWriteTransaction(db, () => {
      const result = db.prepare('UPDATE artifact_notes SET removed_at = ? WHERE note_id = ? AND removed_at IS NULL').run(now, noteId)
      if (result.changes === 0) throw new ProjectArtifactStoreError(`note "${noteId}" was not found, or was already removed`, 'NOTE_NOT_FOUND')
    })
  }

  /**
   * Look up one version's live-figure-object state.
   * @param projectId - the owning project.
   * @param versionId - the version whose figure state to fetch.
   * @returns the figure state, or `undefined` when this version carries none.
   */
  async getFigureState(projectId: ProjectId, versionId: VersionId): Promise<FigureStateRecord | undefined> {
    const db = await this.connectionFor(projectId)
    const row = db.prepare('SELECT * FROM figure_state WHERE version_id = ?').get(versionId) as FigureStateRow | undefined
    return row === undefined ? undefined : toFigureStateRecord(row)
  }

  /**
   * Apply a reconciliation-status patch to one version, upserting its
   * `version_health` row. An omitted field keeps its current (or default
   * `false`) value; `checkedAt` always advances to the call time. Callers
   * own the reconciliation algorithm — this method only records its result.
   * @param projectId - the owning project.
   * @param versionId - the version whose health to update.
   * @param patch - fields to overwrite; an omitted field keeps its current value.
   * @returns the updated health row.
   */
  async setVersionHealth(projectId: ProjectId, versionId: VersionId, patch: VersionHealthPatch): Promise<VersionHealthRecord> {
    const db = await this.connectionFor(projectId)
    const now = Date.now()
    runWriteTransaction(db, () => {
      const existing = db.prepare('SELECT orphan, reconstructed, missing_content FROM version_health WHERE version_id = ?').get(versionId) as
        | { orphan: number; reconstructed: number; missing_content: number }
        | undefined
      const orphan = patch.orphan !== undefined ? (patch.orphan ? 1 : 0) : existing?.orphan ?? 0
      const reconstructed = patch.reconstructed !== undefined ? (patch.reconstructed ? 1 : 0) : existing?.reconstructed ?? 0
      const missingContent = patch.missingContent !== undefined ? (patch.missingContent ? 1 : 0) : existing?.missing_content ?? 0
      db.prepare(`
        INSERT INTO version_health (version_id, orphan, reconstructed, missing_content, checked_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(version_id) DO UPDATE SET orphan = excluded.orphan, reconstructed = excluded.reconstructed, missing_content = excluded.missing_content, checked_at = excluded.checked_at
      `).run(versionId, orphan, reconstructed, missingContent, now)
    })
    const row = db.prepare('SELECT * FROM version_health WHERE version_id = ?').get(versionId) as unknown as VersionHealthRow
    return toVersionHealthRecord(row)
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
   * Check one blob's on-disk presence and size without reading or
   * digest-verifying its bytes, for reconciliation's `missingContent` check.
   * @param projectId - the owning project.
   * @param sha256 - the digest from an already-resolved version row.
   * @returns the blob's byte count, or `undefined` when it is missing.
   */
  async blobByteCount(projectId: ProjectId, sha256: string): Promise<number | undefined> {
    const root = await this.rootFor(projectId)
    return blobByteCount(root, sha256)
  }

  /**
   * Rebuild one version row (and its owning artifact row, when this
   * project's store no longer has one) from a session-log event's fallback
   * fields — reconciliation's response to a dangling event (the store row
   * that once backed it was lost while the event survived). Idempotent: a
   * `versionId` that already names a version row is left completely
   * untouched and that existing row is returned, treating the call as
   * already-applied rather than throwing — a batched reconciliation run may
   * call this again after a previous batch already created the row.
   * `contentOrigin` is always `'import'` on the row this writes: a
   * reconstructed row's real origin (a run, or a human edit) is exactly the
   * fact this reconstruction has no way to recover, and `'import'` is the
   * one {@link ContentOrigin} value that does not claim otherwise. Never
   * called by any path but reconciliation — every ordinary content commit
   * goes through `createArtifact`/`appendVersion`.
   * @param projectId - the owning project.
   * @param input - the exact ids, ordinal, content address, and best-available provenance to reconstruct.
   * @returns the reconstructed (or, if idempotent, the pre-existing) version row.
   * @throws {@link ProjectArtifactStoreError} with code `RECONCILE_ORDINAL_CONFLICT`
   * when the artifact already has a DIFFERENT version committed at this ordinal.
   */
  async reconstructVersion(projectId: ProjectId, input: ReconstructVersionInput): Promise<VersionRecord> {
    const db = await this.connectionFor(projectId)
    runWriteTransaction(db, () => {
      const existingVersion = db.prepare('SELECT 1 FROM versions WHERE version_id = ?').get(input.versionId)
      if (existingVersion !== undefined) return
      const artifactRow = db.prepare('SELECT 1 FROM artifacts WHERE artifact_id = ?').get(input.artifactId)
      if (artifactRow === undefined) {
        const nameConflict = db.prepare('SELECT 1 FROM artifacts WHERE owning_project_id = ? AND logical_name = ?')
          .get(String(projectId), input.logicalName)
        if (nameConflict !== undefined) {
          throw new ProjectArtifactStoreError(
            `cannot reconstruct artifact "${input.artifactId}": an artifact named "${input.logicalName}" already exists in project "${projectId}" under a different id`,
            'LOGICAL_NAME_CONFLICT',
          )
        }
        db.prepare(`
          INSERT INTO artifacts (artifact_id, owning_project_id, origin_session_id, logical_name, kind, latest_version_id, created_at)
          VALUES (?, ?, ?, ?, ?, NULL, ?)
        `).run(input.artifactId, String(projectId), input.producerSessionId, input.logicalName, input.kind, input.createdAt)
      }
      const ordinalConflict = db.prepare('SELECT version_id FROM versions WHERE artifact_id = ? AND ordinal = ?')
        .get(input.artifactId, input.ordinal) as { version_id: string } | undefined
      if (ordinalConflict !== undefined && ordinalConflict.version_id !== input.versionId) {
        throw new ProjectArtifactStoreError(
          `artifact "${input.artifactId}" already has a different committed version at ordinal ${String(input.ordinal)}; `
          + `cannot reconstruct version "${input.versionId}" there`,
          'RECONCILE_ORDINAL_CONFLICT',
        )
      }
      db.prepare(INSERT_VERSION_SQL).run(
        input.versionId, input.artifactId, input.ordinal, null, 0,
        input.sha256, input.mediaType, input.byteCount, 'import', input.producerSessionId,
        null, null, null, null, null, null, input.createdAt,
      )
      const currentMax = db.prepare('SELECT MAX(ordinal) AS max_ordinal FROM versions WHERE artifact_id = ?')
        .get(input.artifactId) as { max_ordinal: number }
      if (input.ordinal === currentMax.max_ordinal) {
        db.prepare('UPDATE artifacts SET latest_version_id = ? WHERE artifact_id = ?').run(input.versionId, input.artifactId)
      }
      if (input.title !== null || input.caption !== null) {
        this.insertAnnotation(db, input.versionId, {
          title: input.title, caption: input.caption, actor: 'capture', sessionId: input.producerSessionId,
          derived: true, createdAt: input.createdAt,
        })
      }
    })
    return this.getVersionRow(db, input.versionId)
  }

  /**
   * Read project-wide reconciliation health from `version_health`: counts
   * plus every version with at least one true flag. A pure read — building
   * the comparison that decides these flags is `reconcileProject`'s job.
   * @param projectId - the owning project.
   * @returns aggregate counts and the unhealthy version list, most recently checked first.
   */
  async getReconciliationSummary(projectId: ProjectId): Promise<ReconciliationSummary> {
    const db = await this.connectionFor(projectId)
    const rows = db.prepare(`
      SELECT * FROM version_health
      WHERE orphan = 1 OR reconstructed = 1 OR missing_content = 1
      ORDER BY checked_at DESC
    `).all() as unknown as VersionHealthRow[]
    const items = rows.map(toVersionHealthRecord)
    return {
      orphanCount: items.filter(item => item.orphan).length,
      reconstructedCount: items.filter(item => item.reconstructed).length,
      missingContentCount: items.filter(item => item.missingContent).length,
      items,
    }
  }

  /**
   * Reconcile one project's store against session-log events a caller has
   * already read and folded — see `reconcile.ts`'s `reconcileProject` for
   * the full algorithm. This wrapper supplies the configured
   * `reconcileMaxVersions` work bound; the algorithm itself never writes a
   * session log and never fails the whole call for one bad item.
   * @param projectId - the project to reconcile.
   * @param events - every `science/artifact-saved` event the caller read
   * from this project's session logs, folded per `versionId` (last write wins).
   * @param eventSetComplete - whether the caller read every relevant session log and event.
   * @returns what this call checked, reconstructed, and could not fully reconcile.
   */
  async reconcileProject(
    projectId: ProjectId,
    events: ReadonlyMap<VersionId, ReconcileArtifactSavedEvent>,
    eventSetComplete: boolean,
  ): Promise<ReconcileResult> {
    await this.connectionFor(projectId)
    return runReconciliation(this, projectId, events, {
      eventSetComplete,
      maxVersions: this.options.reconcileMaxVersions,
    })
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
