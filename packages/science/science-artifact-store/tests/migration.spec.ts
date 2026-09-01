import { randomUUID } from 'node:crypto'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  openStoreDatabase,
  type BackfillProvenanceHook,
  type BackfillProvenanceValue,
  type OpenStoreDatabaseOptions,
} from '../src/schema.ts'

const readdirControl = vi.hoisted(() => ({ forceFailure: false }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    async readdir(...args: Parameters<typeof actual.readdir>): ReturnType<typeof actual.readdir> {
      if (readdirControl.forceFailure) throw Object.assign(new Error('forced readdir failure'), { code: 'EACCES' })
      return actual.readdir(...args)
    },
  }
})

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  readdirControl.forceFailure = false
  vi.restoreAllMocks()
})

async function makeDbPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-migration-'))
  dirs.push(root)
  return join(root, 'store.sqlite')
}

/**
 * v1's DDL, verbatim from schema.ts before the v2 migration existed — the
 * test's own record of "what a real rc.3 user's disk looks like".
 */
function applyV1Ddl(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE artifacts (
      artifact_id        TEXT PRIMARY KEY,
      owning_project_id  TEXT NOT NULL,
      origin_session_id  TEXT NOT NULL,
      logical_name       TEXT NOT NULL,
      latest_version_id  TEXT,
      created_at         INTEGER NOT NULL
    ) STRICT
  `)
  db.exec(`
    CREATE TABLE versions (
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
}

interface V1ArtifactSeed {
  readonly artifactId: string
  readonly owningProjectId: string
  readonly originSessionId: string
  readonly logicalName: string
  readonly createdAt: number
}

interface V1VersionSeed {
  readonly versionId: string
  readonly artifactId: string
  readonly ordinal: number
  readonly parentVersionId?: string
  readonly sha256: string
  readonly mediaType: string
  readonly byteCount: number
  readonly origin: 'auto' | 'model' | 'human-edit'
  readonly title?: string
  readonly caption?: string
  readonly producerSessionId: string
  readonly producerToolCallId?: string
  readonly environmentRevision?: string
  readonly environmentFingerprintPreview?: string
  readonly createdAt: number
}

function insertV1Artifact(db: DatabaseSync, seed: V1ArtifactSeed): void {
  db.prepare(`
    INSERT INTO artifacts (artifact_id, owning_project_id, origin_session_id, logical_name, latest_version_id, created_at)
    VALUES (?, ?, ?, ?, NULL, ?)
  `).run(seed.artifactId, seed.owningProjectId, seed.originSessionId, seed.logicalName, seed.createdAt)
}

function insertV1Version(db: DatabaseSync, seed: V1VersionSeed): void {
  db.prepare(`
    INSERT INTO versions (
      version_id, artifact_id, ordinal, parent_version_id, sha256, media_type, byte_count, origin,
      title, caption, producer_session_id, producer_run_id, producer_tool_call_id, producer_request_header_seq,
      environment_revision, environment_fingerprint_preview, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?)
  `).run(
    seed.versionId, seed.artifactId, seed.ordinal, seed.parentVersionId ?? null, seed.sha256, seed.mediaType, seed.byteCount, seed.origin,
    seed.title ?? null, seed.caption ?? null, seed.producerSessionId, seed.producerToolCallId ?? null,
    seed.environmentRevision ?? null, seed.environmentFingerprintPreview ?? null, seed.createdAt,
  )
  db.prepare('UPDATE artifacts SET latest_version_id = ? WHERE artifact_id = ?').run(seed.versionId, seed.artifactId)
}

const PROJECT = 'project-33f37915'

/** Builds the "realistic rc.3 sample" fixture: two ordinary artifacts and one logical_name collision. */
function seedRealisticV1Fixture(path: string): {
  readonly plotArtifactId: string
  readonly plotV1: string
  readonly plotV2: string
  readonly csvArtifactId: string
  readonly csvV1: string
  readonly unknownMediaArtifactId: string
  readonly unknownMediaV1: string
  readonly collisionKeptId: string
  readonly collisionRenamedId: string
  readonly collisionRenamedV1: string
} {
  const db = new DatabaseSync(path)
  applyV1Ddl(db)

  const plotArtifactId = randomUUID()
  const plotV1 = randomUUID()
  const plotV2 = randomUUID()
  insertV1Artifact(db, { artifactId: plotArtifactId, owningProjectId: PROJECT, originSessionId: 'session-a', logicalName: 'plot.png', createdAt: 1000 })
  insertV1Version(db, {
    versionId: plotV1, artifactId: plotArtifactId, ordinal: 1, sha256: 'a'.repeat(64), mediaType: 'image/png', byteCount: 100,
    origin: 'auto', title: 'plot.png', producerSessionId: 'session-a', producerToolCallId: 'call-run-1',
    environmentRevision: '3', environmentFingerprintPreview: 'abc123456789', createdAt: 1000,
  })
  insertV1Version(db, {
    versionId: plotV2, artifactId: plotArtifactId, ordinal: 2, parentVersionId: plotV1, sha256: 'b'.repeat(64), mediaType: 'image/png', byteCount: 120,
    origin: 'model', title: '策展标题', caption: '一段说明', producerSessionId: 'session-a', producerToolCallId: 'call-run-2',
    environmentRevision: '3', createdAt: 1005,
  })

  const csvArtifactId = randomUUID()
  const csvV1 = randomUUID()
  insertV1Artifact(db, { artifactId: csvArtifactId, owningProjectId: PROJECT, originSessionId: 'session-a', logicalName: 'data.csv', createdAt: 1001 })
  insertV1Version(db, {
    versionId: csvV1, artifactId: csvArtifactId, ordinal: 1, sha256: 'c'.repeat(64), mediaType: 'text/csv', byteCount: 200,
    origin: 'human-edit', producerSessionId: 'session-b', createdAt: 1002,
  })

  const unknownMediaArtifactId = randomUUID()
  const unknownMediaV1 = randomUUID()
  insertV1Artifact(db, { artifactId: unknownMediaArtifactId, owningProjectId: PROJECT, originSessionId: 'session-a', logicalName: 'blob.bin', createdAt: 1003 })
  insertV1Version(db, {
    versionId: unknownMediaV1, artifactId: unknownMediaArtifactId, ordinal: 1, sha256: 'd'.repeat(64), mediaType: 'application/octet-stream', byteCount: 10,
    origin: 'auto', producerSessionId: 'session-a', createdAt: 1003,
  })

  // A logical_name collision: two artifacts named "dup.png" in the same project. The earlier-created one keeps the name.
  const collisionKeptId = randomUUID()
  const collisionRenamedId = randomUUID()
  insertV1Artifact(db, { artifactId: collisionKeptId, owningProjectId: PROJECT, originSessionId: 'session-a', logicalName: 'dup.png', createdAt: 900 })
  insertV1Version(db, {
    versionId: randomUUID(), artifactId: collisionKeptId, ordinal: 1, sha256: 'e'.repeat(64), mediaType: 'image/png', byteCount: 10,
    origin: 'auto', producerSessionId: 'session-a', createdAt: 900,
  })
  const collisionRenamedV1 = randomUUID()
  insertV1Artifact(db, { artifactId: collisionRenamedId, owningProjectId: PROJECT, originSessionId: 'session-b', logicalName: 'dup.png', createdAt: 1200 })
  insertV1Version(db, {
    versionId: collisionRenamedV1, artifactId: collisionRenamedId, ordinal: 1, sha256: 'f'.repeat(64), mediaType: 'image/png', byteCount: 10,
    origin: 'auto', producerSessionId: 'session-b', createdAt: 1200,
  })

  db.exec('PRAGMA user_version = 1')
  db.close()
  return {
    plotArtifactId, plotV1, plotV2, csvArtifactId, csvV1, unknownMediaArtifactId, unknownMediaV1,
    collisionKeptId, collisionRenamedId, collisionRenamedV1,
  }
}

const OPTIONS: OpenStoreDatabaseOptions = { journalMode: 'wal', busyTimeoutMs: 1000, backupRetention: 1 }

describe('v1 → v2 migration', () => {
  it('maps the full v1 fixture per design.md §3.3', async () => {
    const path = await makeDbPath()
    const seed = seedRealisticV1Fixture(path)

    const db = await openStoreDatabase(path, PROJECT, OPTIONS)
    try {
      const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
      expect(version).toBe(2)
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])

      // Step 2: artifacts.kind inference, including the "no other media type observed" fallback to document.
      const kindOf = (artifactId: string): string => (db.prepare('SELECT kind FROM artifacts WHERE artifact_id = ?').get(artifactId) as { kind: string }).kind
      expect(kindOf(seed.plotArtifactId)).toBe('figure')
      expect(kindOf(seed.csvArtifactId)).toBe('dataset')
      expect(kindOf(seed.unknownMediaArtifactId)).toBe('document')

      // Step 5: the earlier-created colliding artifact keeps its name; the later one is renamed and gets a note.
      const keptName = (db.prepare('SELECT logical_name FROM artifacts WHERE artifact_id = ?').get(seed.collisionKeptId) as { logical_name: string }).logical_name
      const renamedName = (db.prepare('SELECT logical_name FROM artifacts WHERE artifact_id = ?').get(seed.collisionRenamedId) as { logical_name: string }).logical_name
      expect(keptName).toBe('dup.png')
      expect(renamedName).toMatch(/^dup\.png#[0-9a-f]{8}$/)
      const notes = db.prepare('SELECT * FROM artifact_notes WHERE artifact_id = ?').all(seed.collisionRenamedId) as Array<{ text: string; session_id: string | null }>
      expect(notes).toHaveLength(1)
      expect(notes[0]?.text).toContain('renamed')
      expect(notes[0]?.session_id).toBeNull()

      // Step 2: versions — content_origin mapping, base_version_id carried from parent_version_id but base_explicit always 0,
      // environment_revision TEXT→INTEGER, environment_fingerprint (full) unset (the old preview is not promoted), producer_turn unset.
      const v1Row = db.prepare('SELECT * FROM versions WHERE version_id = ?').get(seed.plotV1) as Record<string, unknown>
      expect(v1Row['content_origin']).toBe('run-auto')
      expect(v1Row['base_version_id']).toBeNull()
      expect(v1Row['base_explicit']).toBe(0)
      expect(v1Row['environment_revision']).toBe(3)
      expect(v1Row['environment_fingerprint']).toBeNull()
      expect(v1Row['producer_turn']).toBeNull()
      expect(v1Row['latest_annotation_id']).not.toBeNull()

      const v2Row = db.prepare('SELECT * FROM versions WHERE version_id = ?').get(seed.plotV2) as Record<string, unknown>
      expect(v2Row['content_origin']).toBe('run-auto') // v1 'model' origin was metadata provenance, not content provenance.
      expect(v2Row['base_version_id']).toBe(seed.plotV1) // carried from parent_version_id...
      expect(v2Row['base_explicit']).toBe(0) // ...but never claimed explicit, since v1 could not tell the difference.

      const csvRow = db.prepare(
        'SELECT content_origin FROM versions WHERE artifact_id = ?',
      ).get(seed.csvArtifactId) as { content_origin: string }
      expect(csvRow.content_origin).toBe('human-edit')

      // Step 3: one annotation per version, actor derived from v1's origin, title/caption carried over, derived=1.
      const v1AnnotationId = (db.prepare('SELECT latest_annotation_id FROM versions WHERE version_id = ?').get(seed.plotV1) as { latest_annotation_id: string }).latest_annotation_id
      const v1Annotation = db.prepare('SELECT * FROM version_annotations WHERE annotation_id = ?').get(v1AnnotationId) as Record<string, unknown>
      expect(v1Annotation['actor']).toBe('capture')
      expect(v1Annotation['title']).toBe('plot.png')
      expect(v1Annotation['session_id']).toBeNull()
      expect(v1Annotation['derived']).toBe(1)
      expect(v1Annotation['created_at']).toBe(1000)

      const v2AnnotationId = (db.prepare('SELECT latest_annotation_id FROM versions WHERE version_id = ?').get(seed.plotV2) as { latest_annotation_id: string }).latest_annotation_id
      const v2Annotation = db.prepare('SELECT * FROM version_annotations WHERE annotation_id = ?').get(v2AnnotationId) as Record<string, unknown>
      expect(v2Annotation['actor']).toBe('model')
      expect(v2Annotation['title']).toBe('策展标题')
      expect(v2Annotation['caption']).toBe('一段说明')
      expect(v2Annotation['session_id']).toBe('session-a')
      expect(v2Annotation['derived']).toBe(1)

      // A backup of the pre-migration file was taken.
      const files = await readdir(join(path, '..'))
      expect(files).toContain('store.sqlite.v1.bak')
    } finally {
      db.close()
    }
  })

  it('is idempotent: closing and reopening an already-migrated store makes no further changes', async () => {
    const path = await makeDbPath()
    seedRealisticV1Fixture(path)

    const first = await openStoreDatabase(path, PROJECT, OPTIONS)
    const versionCountAfterFirst = (first.prepare('SELECT COUNT(*) AS n FROM versions').get() as { n: number }).n
    const annotationCountAfterFirst = (first.prepare('SELECT COUNT(*) AS n FROM version_annotations').get() as { n: number }).n
    first.close()

    const second = await openStoreDatabase(path, PROJECT, OPTIONS)
    try {
      const { user_version: version } = second.prepare('PRAGMA user_version').get() as { user_version: number }
      expect(version).toBe(2)
      expect((second.prepare('SELECT COUNT(*) AS n FROM versions').get() as { n: number }).n).toBe(versionCountAfterFirst)
      expect((second.prepare('SELECT COUNT(*) AS n FROM version_annotations').get() as { n: number }).n).toBe(annotationCountAfterFirst)
    } finally {
      second.close()
    }
  })

  describe('step 4: backfillProvenance', () => {
    it('applies recovered fields only for versionIds the hook returns, and clears derived on the recovered annotation', async () => {
      const path = await makeDbPath()
      const seed = seedRealisticV1Fixture(path)
      const warnings: string[] = []
      const hook: BackfillProvenanceHook = async (projectId, rows) => {
        expect(projectId).toBe(PROJECT)
        expect(rows.some(row => row.versionId === seed.plotV1)).toBe(true)
        const map = new Map<string, BackfillProvenanceValue>()
        map.set(seed.plotV1, {
          environmentFingerprint: 'f'.repeat(64),
          producerTurn: 5,
          figureState: { figureKey: 'fig-1', dpi: 144, stateJson: '{"ops":[]}' },
          annotationToolCallId: 'call-run-1',
          annotationCreatedAt: 999,
        })
        // A partial recovery: figureState only, no environmentFingerprint/producerTurn/annotation fields —
        // exercises the independent-optional-field contract (each left at its migrated default).
        map.set(seed.unknownMediaV1, { figureState: { figureKey: 'fig-2', dpi: 96, stateJson: '{}' } })
        // Annotation fields are ALSO independent of each other: one recovered without the other falls
        // back to the migration-derived annotation's own (null) value for the missing one — covered
        // from both directions.
        map.set(seed.csvV1, { annotationCreatedAt: 500 })
        map.set(seed.collisionRenamedV1, { annotationToolCallId: 'call-recovered' })
        return map
      }

      const db = await openStoreDatabase(
        path, PROJECT, { ...OPTIONS, backfillProvenance: hook, onWarning: message => warnings.push(message) },
      )
      try {
        const v1Row = db.prepare('SELECT environment_fingerprint, producer_turn FROM versions WHERE version_id = ?').get(seed.plotV1) as { environment_fingerprint: string; producer_turn: number }
        expect(v1Row.environment_fingerprint).toBe('f'.repeat(64))
        expect(v1Row.producer_turn).toBe(5)

        const figureState = db.prepare('SELECT * FROM figure_state WHERE version_id = ?').get(seed.plotV1) as Record<string, unknown>
        expect(figureState).toMatchObject({ figure_key: 'fig-1', dpi: 144, state_json: '{"ops":[]}' })

        const annotationId = (db.prepare('SELECT latest_annotation_id FROM versions WHERE version_id = ?').get(seed.plotV1) as { latest_annotation_id: string }).latest_annotation_id
        const annotation = db.prepare('SELECT tool_call_id, created_at, derived FROM version_annotations WHERE annotation_id = ?').get(annotationId) as { tool_call_id: string; created_at: number; derived: number }
        expect(annotation.tool_call_id).toBe('call-run-1')
        expect(annotation.created_at).toBe(999)
        expect(annotation.derived).toBe(0)

        // plotV2 was not in the hook's returned map: it stays at its step-1..3 default and a warning names it.
        const v2Row = db.prepare('SELECT environment_fingerprint, producer_turn FROM versions WHERE version_id = ?').get(seed.plotV2) as { environment_fingerprint: string | null; producer_turn: number | null }
        expect(v2Row.environment_fingerprint).toBeNull()
        expect(v2Row.producer_turn).toBeNull()
        expect(warnings.some(message => message.includes(seed.plotV2))).toBe(true)

        // unknownMediaV1's partial recovery: figureState applied, environmentFingerprint/producerTurn left null,
        // and its annotation's tool_call_id/created_at/derived are untouched (no annotation fields were recovered).
        const partialRow = db.prepare('SELECT environment_fingerprint, producer_turn FROM versions WHERE version_id = ?').get(seed.unknownMediaV1) as { environment_fingerprint: string | null; producer_turn: number | null }
        expect(partialRow.environment_fingerprint).toBeNull()
        expect(partialRow.producer_turn).toBeNull()
        const partialFigureState = db.prepare('SELECT * FROM figure_state WHERE version_id = ?').get(seed.unknownMediaV1) as Record<string, unknown>
        expect(partialFigureState).toMatchObject({ figure_key: 'fig-2', dpi: 96 })
        const partialAnnotationId = (db.prepare('SELECT latest_annotation_id FROM versions WHERE version_id = ?').get(seed.unknownMediaV1) as { latest_annotation_id: string }).latest_annotation_id
        const partialAnnotation = db.prepare('SELECT tool_call_id, derived FROM version_annotations WHERE annotation_id = ?').get(partialAnnotationId) as { tool_call_id: string | null; derived: number }
        expect(partialAnnotation.tool_call_id).toBeNull()
        expect(partialAnnotation.derived).toBe(1)

        // csvV1: only annotationCreatedAt recovered — tool_call_id falls back to the migrated (null) value.
        const csvAnnotationId = (db.prepare('SELECT latest_annotation_id FROM versions WHERE version_id = ?').get(seed.csvV1) as { latest_annotation_id: string }).latest_annotation_id
        const csvAnnotation = db.prepare('SELECT tool_call_id, created_at, derived FROM version_annotations WHERE annotation_id = ?').get(csvAnnotationId) as { tool_call_id: string | null; created_at: number; derived: number }
        expect(csvAnnotation.tool_call_id).toBeNull()
        expect(csvAnnotation.created_at).toBe(500)
        expect(csvAnnotation.derived).toBe(0)

        // collisionRenamedV1: only annotationToolCallId recovered — created_at falls back to the migrated value.
        const renamedAnnotationId = (db.prepare('SELECT latest_annotation_id FROM versions WHERE version_id = ?').get(seed.collisionRenamedV1) as { latest_annotation_id: string }).latest_annotation_id
        const renamedAnnotation = db.prepare('SELECT tool_call_id, created_at, derived FROM version_annotations WHERE annotation_id = ?').get(renamedAnnotationId) as { tool_call_id: string | null; created_at: number; derived: number }
        expect(renamedAnnotation.tool_call_id).toBe('call-recovered')
        expect(renamedAnnotation.created_at).toBe(1200)
        expect(renamedAnnotation.derived).toBe(0)
      } finally {
        db.close()
      }
    })

    it('degrades to a skipped backfill (with a warning) when no hook is supplied, without failing the migration', async () => {
      const path = await makeDbPath()
      seedRealisticV1Fixture(path)
      const warnings: string[] = []

      const db = await openStoreDatabase(path, PROJECT, { ...OPTIONS, onWarning: message => warnings.push(message) })
      try {
        const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
        expect(version).toBe(2)
        expect(warnings.some(message => message.includes('no backfillProvenance hook'))).toBe(true)
      } finally {
        db.close()
      }
    })

    it('degrades (with a warning) instead of failing the migration when the hook itself rejects', async () => {
      const path = await makeDbPath()
      seedRealisticV1Fixture(path)
      const warnings: string[] = []
      const hook: BackfillProvenanceHook = async () => {
        throw new Error('session log directory unreadable')
      }

      const db = await openStoreDatabase(
        path, PROJECT, { ...OPTIONS, backfillProvenance: hook, onWarning: message => warnings.push(message) },
      )
      try {
        const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
        expect(version).toBe(2)
        expect(warnings.some(message => message.includes('session log directory unreadable'))).toBe(true)
      } finally {
        db.close()
      }
    })
  })

  it('rolls back the whole migration on a mid-transaction failure: user_version and data are untouched', async () => {
    const path = await makeDbPath()
    seedRealisticV1Fixture(path)

    const realPrepare: (...args: unknown[]) => unknown = Reflect.get(DatabaseSync.prototype, 'prepare')
    const spy = vi.spyOn(DatabaseSync.prototype, 'prepare').mockImplementation(function (this: DatabaseSync, sql: string, ...rest: unknown[]) {
      if (sql.includes('INSERT INTO version_annotations')) throw new Error('injected mid-migration failure')
      return realPrepare.apply(this, [sql, ...rest])
    })
    try {
      await expect(openStoreDatabase(path, PROJECT, OPTIONS)).rejects.toThrow('injected mid-migration failure')
    } finally {
      spy.mockRestore()
    }

    // Reopen with the raw driver (no migration logic) to inspect on-disk state untouched by the failed attempt.
    const raw = new DatabaseSync(path)
    try {
      const { user_version: version } = raw.prepare('PRAGMA user_version').get() as { user_version: number }
      expect(version).toBe(1)
      const columns = raw.prepare("SELECT name FROM pragma_table_info('artifacts')").all() as Array<{ name: string }>
      expect(columns.some(column => column.name === 'kind')).toBe(false)
      const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%_v2'").all()
      expect(tables).toEqual([])
    } finally {
      raw.close()
    }
  })

  it('rolls back on a foreign_key_check violation left over from a v1 store with a dangling version row', async () => {
    const path = await makeDbPath()
    const db = new DatabaseSync(path)
    applyV1Ddl(db)
    const artifactId = randomUUID()
    insertV1Artifact(db, { artifactId, owningProjectId: PROJECT, originSessionId: 'session-a', logicalName: 'plot.png', createdAt: 1000 })
    insertV1Version(db, {
      versionId: randomUUID(), artifactId, ordinal: 1, sha256: 'a'.repeat(64), mediaType: 'image/png', byteCount: 10,
      origin: 'auto', producerSessionId: 'session-a', createdAt: 1000,
    })
    // A version row naming an artifact_id that was never inserted, reproducing a real pre-migration disk state
    // (e.g. a row surviving a store bug, or hand edits) that this migration's post-step foreign_key_check must catch.
    db.exec('PRAGMA foreign_keys = OFF')
    db.prepare(`
      INSERT INTO versions (version_id, artifact_id, ordinal, sha256, media_type, byte_count, origin, producer_session_id, created_at)
      VALUES (?, ?, 1, ?, ?, ?, 'auto', 'session-a', ?)
    `).run(randomUUID(), 'nonexistent-artifact', 'b'.repeat(64), 'image/png', 10, 1001)
    db.exec('PRAGMA user_version = 1')
    db.close()

    await expect(openStoreDatabase(path, PROJECT, OPTIONS)).rejects.toMatchObject({ code: 'SCHEMA_UPGRADE_UNAVAILABLE' })

    const raw = new DatabaseSync(path)
    try {
      const { user_version: version } = raw.prepare('PRAGMA user_version').get() as { user_version: number }
      expect(version).toBe(1)
    } finally {
      raw.close()
    }
  })

  it('rejects an on-disk version newer than this build writes (duplicated end-to-end from schema.spec.ts for this file\'s own coverage)', async () => {
    const path = await makeDbPath()
    const db = new DatabaseSync(path)
    applyV1Ddl(db)
    db.exec('PRAGMA user_version = 99')
    db.close()
    await expect(openStoreDatabase(path, PROJECT, OPTIONS)).rejects.toMatchObject({ code: 'SCHEMA_VERSION_NEWER' })
  })

  describe('backup retention', () => {
    it('prunes older .bak files beyond retention and ignores non-backup / malformed names', async () => {
      const path = await makeDbPath()
      seedRealisticV1Fixture(path)
      const dir = join(path, '..')
      // Fake backups from (hypothetical) earlier upgrades, spanning version numbers this
      // run's own migration (which writes .v1.bak) does not produce, plus files
      // pruneBackups must leave untouched because they are not backup names at all.
      await writeFile(`${path}.v0.bak`, 'oldest')
      await writeFile(`${path}.v3.bak`, 'newer than this run\'s own .v1.bak')
      await writeFile(`${path}.v5.bak`, 'newest of all')
      await writeFile(`${path}.vNaN.bak`, 'malformed version segment')
      await writeFile(`${path}.README.txt`, 'unrelated file, does not even match the .v prefix')

      const db = await openStoreDatabase(path, PROJECT, { ...OPTIONS, backupRetention: 2 })
      db.close()

      const files = new Set(await readdir(dir))
      // retention=2 keeps only the two highest version numbers: this run's own v1.bak is pruned...
      expect(files.has('store.sqlite.v1.bak')).toBe(false)
      expect(files.has('store.sqlite.v0.bak')).toBe(false)
      // ...and the two highest-numbered fakes survive.
      expect(files.has('store.sqlite.v3.bak')).toBe(true)
      expect(files.has('store.sqlite.v5.bak')).toBe(true)
      // Malformed/unrelated names were never candidates and are untouched.
      expect(files.has('store.sqlite.vNaN.bak')).toBe(true)
      expect(files.has('store.sqlite.README.txt')).toBe(true)
    })

    it('degrades silently when listing the backup directory fails, without failing the migration', async () => {
      const path = await makeDbPath()
      seedRealisticV1Fixture(path)
      readdirControl.forceFailure = true
      const db = await openStoreDatabase(path, PROJECT, OPTIONS)
      const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
      expect(version).toBe(2)
      db.close()
    })
  })
})
