/**
 * SQLite schema ownership for one project's `store.sqlite`: the open/version
 * sequence and DDL for the `artifacts` and `versions` tables.
 * @module @deepseek-ai/dsh-science-artifact-store/schema
 */

import type { DatabaseSync } from 'node:sqlite'
import { mkdir, open } from 'node:fs/promises'
import { dirname } from 'node:path'
import { ProjectArtifactStoreError } from './errors.ts'

/**
 * The on-disk physical layout version, stored in `PRAGMA user_version`.
 * Bumped only on a breaking change to the table layout; any other stamped
 * version rejects — this unreleased format has no migrations.
 */
export const PROJECT_ARTIFACT_STORE_SCHEMA_VERSION = 1

/**
 * Journal modes the store will run under. `wal` is the default; the
 * rollback-journal modes exist for filesystems where WAL's shared-memory
 * files do not work (network mounts).
 */
export type JournalMode = 'wal' | 'delete' | 'truncate' | 'persist'

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
/**
 * Open one project's `store.sqlite`, creating and stamping it on first use.
 * The write lock is acquired with `sqlite3_busy_timeout()` so concurrent
 * writers from separate processes block-and-retry instead of failing
 * immediately, which is what makes the append linearization point in
 * `store.ts` correct across processes.
 * @param path - absolute path to the database file.
 * @param journalMode - validated journal pragma.
 * @param busyTimeoutMs - maximum time a writer blocks waiting for a competing lock.
 * @returns the open, schema-validated handle.
 * @throws {@link ProjectArtifactStoreError} with code `SCHEMA_VERSION_MISMATCH` when the on-disk version is neither `0` nor current.
 */
export async function openStoreDatabase(path: string, journalMode: JournalMode, busyTimeoutMs: number): Promise<DatabaseSync> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await createDatabaseFile(path)
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(path, { timeout: busyTimeoutMs })
  try {
    configureDatabase(db, path, journalMode)
    return db
  } catch (error: unknown) {
    db.close()
    throw error
  }
}

function configureDatabase(db: DatabaseSync, path: string, journalMode: JournalMode): void {
  db.exec('PRAGMA foreign_keys = ON')
  // The validated union is safe to interpolate into a non-bindable PRAGMA.
  db.exec(`PRAGMA journal_mode = ${journalMode.toUpperCase()}`)
  const { user_version: onDisk } = db.prepare('PRAGMA user_version').get() as { user_version: number }
  if (onDisk !== 0 && onDisk !== PROJECT_ARTIFACT_STORE_SCHEMA_VERSION) {
    throw new ProjectArtifactStoreError(
      `project artifact store at "${path}" has schema version ${onDisk}, incompatible with this build (${PROJECT_ARTIFACT_STORE_SCHEMA_VERSION})`,
      'SCHEMA_VERSION_MISMATCH',
    )
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS artifacts (
      artifact_id        TEXT PRIMARY KEY,
      owning_project_id  TEXT NOT NULL,
      origin_session_id  TEXT NOT NULL,
      logical_name       TEXT NOT NULL,
      latest_version_id  TEXT,
      created_at         INTEGER NOT NULL
    ) STRICT
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS versions (
      version_id                    TEXT PRIMARY KEY,
      artifact_id                   TEXT NOT NULL REFERENCES artifacts(artifact_id),
      ordinal                       INTEGER NOT NULL,
      parent_version_id             TEXT REFERENCES versions(version_id),
      sha256                        TEXT NOT NULL,
      media_type                    TEXT NOT NULL,
      byte_count                    INTEGER NOT NULL,
      origin                        TEXT NOT NULL CHECK (origin IN ('auto', 'model', 'human-edit')),
      title                         TEXT,
      caption                       TEXT,
      producer_session_id           TEXT NOT NULL,
      producer_run_id               TEXT,
      producer_tool_call_id         TEXT,
      producer_request_header_seq   INTEGER,
      environment_revision          TEXT,
      environment_fingerprint_preview TEXT,
      created_at                    INTEGER NOT NULL,
      UNIQUE (artifact_id, ordinal)
    ) STRICT
  `)
  if (onDisk === 0) {
    // Stamp fresh databases LAST: the stamp asserts the layout is complete,
    // so a failure above must leave the medium unstamped (a re-open after
    // the obstruction is cleared retries materialization from scratch).
    db.exec(`PRAGMA user_version = ${PROJECT_ARTIFACT_STORE_SCHEMA_VERSION}`)
  }
}
