/**
 * SQLite schema ownership for one project's `store.sqlite`: the open/version
 * sequence, target DDL, and the v1→v2 migration.
 * @module @deepseek-ai/dsh-science-artifact-store/schema
 */

import type { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, open, readdir, rm } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { ProjectArtifactStoreError } from './errors.ts'

/**
 * The on-disk physical layout version, stored in `PRAGMA user_version`. This
 * build can WRITE this version and no other; whether an older on-disk
 * version can be opened depends on whether {@link STORE_MIGRATIONS} has an
 * unbroken chain toward it, not on this number's shape.
 */
export const PROJECT_ARTIFACT_STORE_SCHEMA_VERSION = 2

/**
 * Journal modes the store will run under. `wal` is the default; the
 * rollback-journal modes exist for filesystems where WAL's shared-memory
 * files do not work (network mounts).
 */
export type JournalMode = 'wal' | 'delete' | 'truncate' | 'persist'

/** One version row still missing fields only a v1-era session log ever held, handed to a `backfillProvenance` hook. */
export interface BackfillProvenanceRow {
  /** The migrated version's id — the key the hook's returned map is looked up by. */
  readonly versionId: string
  /** The artifact this version belongs to, for scoping which session logs are relevant. */
  readonly artifactId: string
  /** The session that produced this version, for scoping which session logs are relevant. */
  readonly producerSessionId: string
}

/** Live-figure-object state a `backfillProvenance` hook recovered for one version. */
export interface BackfillProvenanceFigureState {
  /** Identifies which live figure this state belongs to, opaque to this package. */
  readonly figureKey: string
  /** Rendering resolution, dots per inch. */
  readonly dpi: number
  /** Opaque JSON text for the chart's live-object state; this package stores it verbatim without parsing. */
  readonly stateJson: string
}

/**
 * What a `backfillProvenance` hook may recover for one version from its
 * project's session logs. Every field is independently optional: an omitted
 * field leaves that column at its step-1..3 migrated default (`NULL`, or
 * `derived: true` on the version's annotation).
 */
export interface BackfillProvenanceValue {
  /** Full 64-hex-character digest, not a preview. */
  readonly environmentFingerprint?: string
  /** The request/response turn number of the authorizing tool call. */
  readonly producerTurn?: number
  /** The live-figure-object state to write into `figure_state` for this version. */
  readonly figureState?: BackfillProvenanceFigureState
  /** The authorizing tool call for the version's ONE migration-derived annotation row, if the log still names it. */
  readonly annotationToolCallId?: string
  /** The real edit timestamp for that annotation row, if the log still names it; supplying this also clears the row's `derived` flag. */
  readonly annotationCreatedAt?: number
}

/**
 * Caller-supplied hook, invoked at most once during the v1→v2 migration's
 * optional step 4. This package never reads session logs itself — that
 * format is owned by `dsh-session`/`dsh-science-session`, layers above this
 * one — so the hook lets the CALLER supply whatever it can recover from a
 * project's session logs, keyed by `versionId`.
 *
 * A `versionId` absent from the returned map (or the hook itself omitted,
 * or the hook's promise rejecting) leaves that row exactly as steps 1–3 left
 * it and the migration logs one warning through `onWarning` — it never
 * fails the migration. A single unreadable session log is this hook's own
 * concern to skip past; nothing this hook returns can roll back the rest of
 * the migration's already-applied schema and data changes.
 * @param projectId - the project whose session logs to consult.
 * @param rows - every version row migrated from v1, still missing the fields above.
 * @returns recovered values keyed by `versionId`; an absent key means "nothing found".
 */
export type BackfillProvenanceHook = (
  projectId: string,
  rows: readonly BackfillProvenanceRow[],
) => Promise<ReadonlyMap<string, BackfillProvenanceValue>>

/** Deployment-varying inputs a {@link StoreMigration} may need beyond the open connection. */
export interface MigrationApplyContext {
  readonly projectId: string
  readonly backfillProvenance?: BackfillProvenanceHook
  /** Diagnostic sink for a migration step's non-fatal degradations (e.g. a skipped backfill). */
  readonly onWarning?: (message: string) => void
}

/**
 * One `user_version` upgrade step. `apply` runs inside a single write
 * transaction the caller (`configureDatabase` below) owns: it opens
 * `BEGIN IMMEDIATE` before calling `apply`, and issues
 * `PRAGMA user_version = to` as the transaction's last statement before
 * `COMMIT`. A thrown or rejected `apply` rolls the whole step back — no
 * partial upgrade is ever durable.
 */
export interface StoreMigration {
  readonly from: number
  readonly to: number
  apply(db: DatabaseSync, context: MigrationApplyContext): void | Promise<void>
}

/**
 * Exclusively create a missing database file with owner-only permissions.
 * Existing files retain their modes, and errors other than `EEXIST` propagate.
 */
// Each database owns file creation; sharing this setup must not couple durable artifacts to the disposable search index.
/* jscpd:ignore-start */
async function createDatabaseFile(path: string): Promise<void> {
  try {
    const handle = await open(path, 'wx', 0o600)
    await handle.close()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

/* jscpd:ignore-end */

function artifactsTableDdl(tableName: string): string {
  return `
    CREATE TABLE IF NOT EXISTS ${tableName} (
      artifact_id       TEXT PRIMARY KEY,
      owning_project_id TEXT NOT NULL,
      origin_session_id TEXT NOT NULL,
      logical_name      TEXT NOT NULL,
      kind              TEXT NOT NULL CHECK (kind IN ('figure','dataset','document','job-output')),
      latest_version_id TEXT,
      created_at        INTEGER NOT NULL,
      UNIQUE (owning_project_id, logical_name)
    ) STRICT
  `
}

function versionsTableDdl(tableName: string): string {
  return `
    CREATE TABLE IF NOT EXISTS ${tableName} (
      version_id                  TEXT PRIMARY KEY,
      artifact_id                 TEXT NOT NULL REFERENCES artifacts(artifact_id),
      ordinal                     INTEGER NOT NULL,
      base_version_id             TEXT REFERENCES versions(version_id),
      base_explicit                INTEGER NOT NULL DEFAULT 0 CHECK (base_explicit IN (0,1)),
      sha256                       TEXT NOT NULL,
      media_type                   TEXT NOT NULL,
      byte_count                   INTEGER NOT NULL,
      content_origin                TEXT NOT NULL CHECK (content_origin IN ('run-auto','human-edit','import')),
      producer_session_id          TEXT NOT NULL,
      producer_run_id               TEXT,
      producer_tool_call_id         TEXT,
      producer_request_header_seq   INTEGER,
      producer_turn                 INTEGER,
      environment_revision          INTEGER,
      environment_fingerprint       TEXT,
      latest_annotation_id          TEXT REFERENCES version_annotations(annotation_id),
      created_at                    INTEGER NOT NULL,
      UNIQUE (artifact_id, ordinal)
    ) STRICT
  `
}

function versionAnnotationsDdl(): string {
  return `
    CREATE TABLE IF NOT EXISTS version_annotations (
      annotation_id      TEXT PRIMARY KEY,
      version_id         TEXT NOT NULL REFERENCES versions(version_id),
      title               TEXT,
      caption             TEXT,
      actor               TEXT NOT NULL CHECK (actor IN ('capture','model','human')),
      session_id          TEXT,
      tool_call_id        TEXT,
      request_header_seq  INTEGER,
      derived              INTEGER NOT NULL DEFAULT 0 CHECK (derived IN (0,1)),
      created_at           INTEGER NOT NULL
    ) STRICT
  `
}

function figureStateDdl(): string {
  return `
    CREATE TABLE IF NOT EXISTS figure_state (
      version_id  TEXT PRIMARY KEY REFERENCES versions(version_id),
      figure_key  TEXT NOT NULL,
      dpi         INTEGER NOT NULL,
      state_json  TEXT NOT NULL
    ) STRICT
  `
}

function artifactNotesDdl(): string {
  return `
    CREATE TABLE IF NOT EXISTS artifact_notes (
      note_id      TEXT PRIMARY KEY,
      artifact_id  TEXT NOT NULL REFERENCES artifacts(artifact_id),
      version_id   TEXT REFERENCES versions(version_id),
      text         TEXT NOT NULL,
      session_id   TEXT,
      created_at   INTEGER NOT NULL,
      removed_at   INTEGER
    ) STRICT
  `
}

function versionHealthDdl(): string {
  return `
    CREATE TABLE IF NOT EXISTS version_health (
      version_id       TEXT PRIMARY KEY REFERENCES versions(version_id),
      orphan           INTEGER NOT NULL DEFAULT 0,
      reconstructed    INTEGER NOT NULL DEFAULT 0,
      missing_content  INTEGER NOT NULL DEFAULT 0,
      checked_at       INTEGER NOT NULL
    ) STRICT
  `
}

function applySideTablesDdl(db: DatabaseSync): void {
  db.exec(versionAnnotationsDdl())
  db.exec('CREATE INDEX IF NOT EXISTS version_annotations_by_version ON version_annotations(version_id, created_at)')
  db.exec(figureStateDdl())
  db.exec(artifactNotesDdl())
  db.exec(versionHealthDdl())
}

/** Idempotent target-schema DDL for a fresh (`user_version = 0`) database, and a safety net re-run on an already-current one. */
function applyTargetSchemaDdl(db: DatabaseSync): void {
  db.exec(artifactsTableDdl('artifacts'))
  db.exec(versionsTableDdl('versions'))
  applySideTablesDdl(db)
}

/** v1 `artifacts` row shape, read only during the v1→v2 migration. */
interface V1ArtifactRow {
  readonly artifact_id: string
  readonly owning_project_id: string
  readonly origin_session_id: string
  readonly logical_name: string
  readonly latest_version_id: string | null
  readonly created_at: number
}

/** v1 `versions` row shape, read only during the v1→v2 migration. */
interface V1VersionRow {
  readonly version_id: string
  readonly artifact_id: string
  readonly ordinal: number
  readonly parent_version_id: string | null
  readonly sha256: string
  readonly media_type: string
  readonly byte_count: number
  readonly origin: 'auto' | 'model' | 'human-edit'
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

/**
 * A media type → `artifacts.kind`. Exhaustive over the only media types any
 * producer in this build ever writes; a media type outside this set falls
 * back to `document` rather than failing, since a future producer's new
 * media type needs a schema decision this mapping cannot make on its own.
 * Used by the v1→v2 migration (inferring `kind` from a version's
 * `media_type`) and by `reconcile.ts` (inferring both a reconstructed
 * version's `mediaType` and its owning artifact's `kind` from a dangling
 * event's `logicalName` extension).
 * @param mediaType - the media type to classify, or `undefined` when unknown.
 * @returns the inferred artifact kind.
 */
export function inferArtifactKind(mediaType: string | undefined): 'figure' | 'dataset' | 'document' | 'job-output' {
  switch (mediaType) {
    case 'image/png': return 'figure'
    case 'text/csv': return 'dataset'
    default: return 'document'
  }
}

interface RenameNote {
  readonly artifactId: string
  readonly text: string
}

/**
 * Step 5: resolve the new `UNIQUE(owning_project_id, logical_name)`
 * constraint against v1 data, which never enforced it. Groups artifacts by
 * `(owning_project_id, logical_name)`; within a colliding group the
 * earliest-created row keeps its name, and every later row is renamed
 * `<name>#<short artifactId>`. Chains are never merged — a rename only
 * changes the label, not which version belongs to which artifact.
 */
interface LogicalNameCollisions {
  readonly renamed: ReadonlyMap<string, string>
  readonly notes: readonly RenameNote[]
}

function resolveLogicalNameCollisions(artifactRows: readonly V1ArtifactRow[]): LogicalNameCollisions {
  const groups = new Map<string, V1ArtifactRow[]>()
  for (const row of artifactRows) {
    const key = `${row.owning_project_id} ${row.logical_name}`
    const group = groups.get(key)
    if (group === undefined) groups.set(key, [row])
    else group.push(row)
  }
  const renamed = new Map<string, string>()
  const notes: RenameNote[] = []
  for (const group of groups.values()) {
    if (group.length < 2) continue
    // group is already in created_at ASC order because artifactRows was queried that way.
    for (const row of group.slice(1)) {
      const shortId = row.artifact_id.replaceAll('-', '').slice(0, 8)
      const newName = `${row.logical_name}#${shortId}`
      renamed.set(row.artifact_id, newName)
      notes.push({
        artifactId: row.artifact_id,
        text: `this artifact's name "${row.logical_name}" collided with another artifact's in the same project `
          + `before schema v2 enforced uniqueness; it was renamed to "${newName}" during the v1→v2 migration. `
          + 'Its version chain was not merged with the other artifact\'s.',
      })
    }
  }
  return { renamed, notes }
}

/**
 * One version this migration just wrote, paired with the annotation row it
 * derived — always both-or-neither, unlike a lookup that could miss.
 */
interface MigratedVersion {
  readonly row: V1VersionRow
  readonly annotationId: string
}

/**
 * Step 4: hand every migrated version row to the caller-supplied
 * `backfillProvenance` hook and apply whatever it recovers. Never throws —
 * a missing hook, a rejected hook, or a `versionId` absent from its result
 * all degrade to leaving that data at its step-1..3 default and reporting
 * through `onWarning`.
 */
async function runProvenanceBackfill(
  db: DatabaseSync,
  context: MigrationApplyContext,
  migrated: readonly MigratedVersion[],
): Promise<void> {
  if (context.backfillProvenance === undefined) {
    context.onWarning?.(
      'science-artifact-store: v1→v2 migration skipped session-log provenance backfill — no backfillProvenance hook was supplied; '
      + 'environmentFingerprint, producerTurn, and figure_state stay unset for versions migrated from v1.',
    )
    return
  }

  const requestRows: BackfillProvenanceRow[] = migrated.map(({ row }) => ({
    versionId: row.version_id,
    artifactId: row.artifact_id,
    producerSessionId: row.producer_session_id,
  }))
  let backfill: ReadonlyMap<string, BackfillProvenanceValue>
  try {
    backfill = await context.backfillProvenance(context.projectId, requestRows)
  } catch (error) {
    context.onWarning?.(`science-artifact-store: v1→v2 migration's session-log provenance backfill hook failed and was skipped: ${String(error)}`)
    return
  }

  const updateVersion = db.prepare('UPDATE versions SET environment_fingerprint = ?, producer_turn = ? WHERE version_id = ?')
  const upsertFigureState = db.prepare(`
    INSERT INTO figure_state (version_id, figure_key, dpi, state_json) VALUES (?, ?, ?, ?)
    ON CONFLICT(version_id) DO UPDATE SET figure_key = excluded.figure_key, dpi = excluded.dpi, state_json = excluded.state_json
  `)
  const readAnnotation = db.prepare('SELECT tool_call_id, created_at FROM version_annotations WHERE annotation_id = ?')
  const updateAnnotation = db.prepare('UPDATE version_annotations SET tool_call_id = ?, created_at = ?, derived = 0 WHERE annotation_id = ?')

  for (const { row, annotationId } of migrated) {
    const value = backfill.get(row.version_id)
    if (value === undefined) {
      context.onWarning?.(`science-artifact-store: v1→v2 migration found no session-log provenance for version "${row.version_id}".`)
      continue
    }
    updateVersion.run(value.environmentFingerprint ?? null, value.producerTurn ?? null, row.version_id)
    if (value.figureState !== undefined) {
      upsertFigureState.run(row.version_id, value.figureState.figureKey, value.figureState.dpi, value.figureState.stateJson)
    }
    if (value.annotationToolCallId !== undefined || value.annotationCreatedAt !== undefined) {
      // This annotation row was inserted earlier in this SAME transaction, on
      // this same connection — a read-your-own-write SELECT here cannot miss it.
      const existing = readAnnotation.get(annotationId) as unknown as { tool_call_id: string | null; created_at: number }
      updateAnnotation.run(
        value.annotationToolCallId ?? existing.tool_call_id,
        value.annotationCreatedAt ?? existing.created_at,
        annotationId,
      )
    }
  }
}

async function applyMigration1to2(db: DatabaseSync, context: MigrationApplyContext): Promise<void> {
  // Step 1: the four tables v1 never had.
  applySideTablesDdl(db)

  const artifactRows = db.prepare('SELECT * FROM artifacts ORDER BY created_at ASC').all() as unknown as V1ArtifactRow[]
  const versionRows = db.prepare('SELECT * FROM versions ORDER BY artifact_id ASC, ordinal ASC').all() as unknown as V1VersionRow[]

  const latestMediaTypeByArtifact = new Map<string, string>()
  for (const version of versionRows) {
    // The last row visited per artifact_id in ordinal order is that artifact's latest, by construction of the ORDER BY above.
    latestMediaTypeByArtifact.set(version.artifact_id, version.media_type)
  }

  const { renamed, notes } = resolveLogicalNameCollisions(artifactRows)

  db.exec(artifactsTableDdl('artifacts_v2'))
  db.exec(versionsTableDdl('versions_v2'))

  const insertArtifact = db.prepare(`
    INSERT INTO artifacts_v2 (artifact_id, owning_project_id, origin_session_id, logical_name, kind, latest_version_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  for (const row of artifactRows) {
    const logicalName = renamed.get(row.artifact_id) ?? row.logical_name
    const kind = inferArtifactKind(latestMediaTypeByArtifact.get(row.artifact_id))
    insertArtifact.run(
      row.artifact_id, row.owning_project_id, row.origin_session_id, logicalName, kind, row.latest_version_id, row.created_at,
    )
  }

  // Step 3 (folded into the same pass as step 2): derive one annotation row
  // per version, carrying its current title/caption forward, before this
  // version's own row is written — its id becomes that row's latest_annotation_id.
  const insertVersion = db.prepare(`
    INSERT INTO versions_v2 (
      version_id, artifact_id, ordinal, base_version_id, base_explicit, sha256, media_type, byte_count,
      content_origin, producer_session_id, producer_run_id, producer_tool_call_id, producer_request_header_seq,
      producer_turn, environment_revision, environment_fingerprint, latest_annotation_id, created_at
    ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)
  `)
  const insertAnnotation = db.prepare(`
    INSERT INTO version_annotations (annotation_id, version_id, title, caption, actor, session_id, tool_call_id, request_header_seq, derived, created_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 1, ?)
  `)
  const migratedVersions: MigratedVersion[] = []
  for (const row of versionRows) {
    // v1's parent_version_id carries straight over as base_version_id — but
    // base_explicit is always 0, never 1: v1 had no column distinguishing an
    // EXPLICIT edit_of from a chain predecessor the old store.ts defaulted
    // in on its own (audit D3), so this migration cannot tell which is
    // which and marks every migrated row "not known to be explicit" rather
    // than guessing.
    const contentOrigin = row.origin === 'human-edit' ? 'human-edit' : 'run-auto'
    const annotationId = randomUUID()
    migratedVersions.push({ row, annotationId })
    // v1 stored this as TEXT written from a number (`String(revision)`); every
    // known producer writes an integer literal, so this always round-trips.
    const environmentRevision = row.environment_revision === null ? null : Number(row.environment_revision)
    insertVersion.run(
      row.version_id, row.artifact_id, row.ordinal, row.parent_version_id,
      row.sha256, row.media_type, row.byte_count, contentOrigin,
      row.producer_session_id, row.producer_run_id, row.producer_tool_call_id, row.producer_request_header_seq,
      environmentRevision, annotationId, row.created_at,
    )
    const actor = row.origin === 'model' ? 'model' : 'capture'
    insertAnnotation.run(annotationId, row.version_id, row.title, row.caption, actor, actor === 'model' ? row.producer_session_id : null, row.created_at)
  }

  db.exec('DROP TABLE versions')
  db.exec('DROP TABLE artifacts')
  db.exec('ALTER TABLE versions_v2 RENAME TO versions')
  db.exec('ALTER TABLE artifacts_v2 RENAME TO artifacts')

  const insertNote = db.prepare(`
    INSERT INTO artifact_notes (note_id, artifact_id, version_id, text, session_id, created_at, removed_at)
    VALUES (?, ?, NULL, ?, NULL, ?, NULL)
  `)
  const migratedAt = Date.now()
  for (const note of notes) insertNote.run(randomUUID(), note.artifactId, note.text, migratedAt)

  // Step 4: optional, never fails the migration.
  await runProvenanceBackfill(db, context, migratedVersions)
}

/** The v1→v2 migration: [design](../../../.agents/tmp/scratch/2026-09-01-artifact-authority/design.md) §3.3. */
const migration1to2: StoreMigration = { from: 1, to: 2, apply: applyMigration1to2 }

/** Every registered upgrade step, in no particular order — {@link resolveMigrationChain} walks them by `from`/`to`. */
export const STORE_MIGRATIONS: readonly StoreMigration[] = [migration1to2]

/**
 * Walk a chain of migrations from one version to another.
 * @param migrations - the candidate steps to chain (independent of the module-level export, so callers can test gaps directly).
 * @param from - the on-disk version to start from.
 * @param to - the version to reach.
 * @returns the ordered steps to apply.
 * @throws {@link ProjectArtifactStoreError} with code `SCHEMA_UPGRADE_UNAVAILABLE` when no step exists from some version short of `to`.
 */
export function resolveMigrationChain(migrations: readonly StoreMigration[], from: number, to: number): readonly StoreMigration[] {
  const chain: StoreMigration[] = []
  let cursor = from
  while (cursor < to) {
    const step = migrations.find(migration => migration.from === cursor)
    if (step === undefined) {
      throw new ProjectArtifactStoreError(
        `no migration exists from schema version ${cursor} toward ${to}; this on-disk store cannot be upgraded by this build`,
        'SCHEMA_UPGRADE_UNAVAILABLE',
      )
    }
    chain.push(step)
    cursor = step.to
  }
  return chain
}

/**
 * Copy `path` to `<path>.v<fromVersion>.bak` before an upgrade touches it,
 * checkpointing WAL first so the copy is complete, then prune older backups
 * beyond `retention`. Blobs are never copied — they are content-addressed
 * and untouched by a schema change.
 */
async function backupBeforeUpgrade(db: DatabaseSync, path: string, fromVersion: number, retention: number): Promise<void> {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  } catch {
    // Best-effort: a checkpoint failure still leaves a usable, only slightly stale, backup.
  }
  await copyFile(path, `${path}.v${fromVersion}.bak`)
  await pruneBackups(path, retention)
}

/** Keep only the `retention` most recently created `<path>.v<N>.bak` files, oldest first removed. */
async function pruneBackups(path: string, retention: number): Promise<void> {
  const dir = dirname(path)
  const base = basename(path)
  const prefix = `${base}.v`
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    // No directory to list means no backups to prune.
    return
  }
  const backups = entries
    .map(name => ({ name, version: parseBackupVersion(name, prefix) }))
    .filter((entry): entry is { name: string; version: number } => entry.version !== undefined)
    .sort((a, b) => b.version - a.version)
  const toRemove = backups.slice(Math.max(retention, 0))
  await Promise.all(toRemove.map(entry => rm(`${dir}/${entry.name}`, { force: true })))
}

function parseBackupVersion(name: string, prefix: string): number | undefined {
  if (!name.startsWith(prefix) || !name.endsWith('.bak')) return undefined
  const digits = name.slice(prefix.length, -'.bak'.length)
  if (!/^\d+$/.test(digits)) return undefined
  return Number(digits)
}

/** Run one migration step inside its own write transaction; any failure rolls it back and leaves `user_version` untouched. */
async function runMigrationStep(db: DatabaseSync, step: StoreMigration, context: MigrationApplyContext): Promise<void> {
  db.exec('PRAGMA foreign_keys = OFF')
  db.exec('BEGIN IMMEDIATE')
  try {
    await step.apply(db, context)
    const violations = db.prepare('PRAGMA foreign_key_check').all()
    if (violations.length > 0) {
      throw new ProjectArtifactStoreError(
        `migration from schema version ${step.from} to ${step.to} produced ${violations.length} foreign-key violation(s); rolled back`,
        'SCHEMA_UPGRADE_UNAVAILABLE',
      )
    }
    db.exec(`PRAGMA user_version = ${step.to}`)
    db.exec('COMMIT')
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // The original failure inside the transaction remains actionable; a rollback failure here only follows an already-failed connection.
    }
    throw error
  }
}

/** Deployment-varying tunables and hooks {@link openStoreDatabase} needs beyond `path`/`projectId`. */
export interface OpenStoreDatabaseOptions {
  readonly journalMode: JournalMode
  readonly busyTimeoutMs: number
  /** How many pre-upgrade `.bak` copies of `store.sqlite` to retain. */
  readonly backupRetention: number
  readonly backfillProvenance?: BackfillProvenanceHook
  readonly onWarning?: (message: string) => void
}

/**
 * Open one project's `store.sqlite`, creating and stamping it on first use,
 * or upgrading it through {@link STORE_MIGRATIONS} when it is an older
 * version this build still knows how to read. The write lock is acquired
 * with `sqlite3_busy_timeout()` so concurrent writers from separate
 * processes block-and-retry instead of failing immediately, which is what
 * makes the append linearization point in `store.ts` correct across
 * processes.
 * @param path - absolute path to the database file.
 * @param projectId - the project this store belongs to, passed through to `backfillProvenance`.
 * @param options - validated connection and migration tunables.
 * @returns the open, schema-current handle.
 * @throws {@link ProjectArtifactStoreError} with code `SCHEMA_VERSION_NEWER`
 * when the on-disk version is newer than this build writes, or
 * `SCHEMA_UPGRADE_UNAVAILABLE` when no migration chain reaches it.
 */
export async function openStoreDatabase(path: string, projectId: string, options: OpenStoreDatabaseOptions): Promise<DatabaseSync> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await createDatabaseFile(path)
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(path, { timeout: options.busyTimeoutMs })
  try {
    await configureDatabase(db, path, projectId, options)
    return db
  } catch (error: unknown) {
    db.close()
    throw error
  }
}

async function configureDatabase(db: DatabaseSync, path: string, projectId: string, options: OpenStoreDatabaseOptions): Promise<void> {
  // The validated union is safe to interpolate into a non-bindable PRAGMA.
  db.exec(`PRAGMA journal_mode = ${options.journalMode.toUpperCase()}`)
  const { user_version: onDisk } = db.prepare('PRAGMA user_version').get() as { user_version: number }

  if (onDisk === 0) {
    db.exec('PRAGMA foreign_keys = ON')
    applyTargetSchemaDdl(db)
    // Stamp fresh databases LAST: the stamp asserts the layout is complete,
    // so a failure above must leave the medium unstamped (a re-open after
    // the obstruction is cleared retries materialization from scratch).
    db.exec(`PRAGMA user_version = ${PROJECT_ARTIFACT_STORE_SCHEMA_VERSION}`)
    return
  }
  if (onDisk === PROJECT_ARTIFACT_STORE_SCHEMA_VERSION) {
    db.exec('PRAGMA foreign_keys = ON')
    applyTargetSchemaDdl(db)
    return
  }
  if (onDisk > PROJECT_ARTIFACT_STORE_SCHEMA_VERSION) {
    throw new ProjectArtifactStoreError(
      `project artifact store at "${path}" has schema version ${onDisk}, written by a newer harness than this build (${PROJECT_ARTIFACT_STORE_SCHEMA_VERSION}); `
      + 'upgrade the harness to open it. The blob directory under this store\'s root is content-addressed and can still be recovered manually if needed.',
      'SCHEMA_VERSION_NEWER',
    )
  }

  const chain = resolveMigrationChain(STORE_MIGRATIONS, onDisk, PROJECT_ARTIFACT_STORE_SCHEMA_VERSION)
  await backupBeforeUpgrade(db, path, onDisk, options.backupRetention)
  const context: MigrationApplyContext = {
    projectId,
    ...options.backfillProvenance === undefined ? {} : { backfillProvenance: options.backfillProvenance },
    ...options.onWarning === undefined ? {} : { onWarning: options.onWarning },
  }
  for (const step of chain) {
    await runMigrationStep(db, step, context)
  }
  db.exec('PRAGMA foreign_keys = ON')
}
