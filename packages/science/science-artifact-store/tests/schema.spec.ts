import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PROJECT_ARTIFACT_STORE_SCHEMA_VERSION, openStoreDatabase, resolveMigrationChain, type OpenStoreDatabaseOptions, type StoreMigration } from '../src/schema.ts'
import { ProjectArtifactStoreError } from '../src/errors.ts'

const openControl = vi.hoisted(() => ({ forcedErrorCode: undefined as string | undefined }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    async open(...args: Parameters<typeof actual.open>): ReturnType<typeof actual.open> {
      if (openControl.forcedErrorCode !== undefined) {
        const error = Object.assign(new Error('forced failure'), { code: openControl.forcedErrorCode })
        throw error
      }
      return actual.open(...args)
    },
  }
})

const dirs: string[] = []
const OPTIONS: OpenStoreDatabaseOptions = { journalMode: 'wal', busyTimeoutMs: 1000, backupRetention: 1 }

async function makeDbPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-science-artifact-store-schema-'))
  dirs.push(root)
  return join(root, 'store.sqlite')
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('openStoreDatabase', () => {
  it('stamps a fresh database with the current schema version', async () => {
    const path = await makeDbPath()
    const db = await openStoreDatabase(path, 'project-1', OPTIONS)
    const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
    expect(version).toBe(PROJECT_ARTIFACT_STORE_SCHEMA_VERSION)
    db.close()
  })

  it('reopens a database it already stamped without error', async () => {
    const path = await makeDbPath()
    const first = await openStoreDatabase(path, 'project-1', OPTIONS)
    first.close()
    const second = await openStoreDatabase(path, 'project-1', OPTIONS)
    second.close()
  })

  it('propagates a non-EEXIST failure creating the database file', async () => {
    const path = await makeDbPath()
    openControl.forcedErrorCode = 'EACCES'
    try {
      await expect(openStoreDatabase(path, 'project-1', OPTIONS)).rejects.toMatchObject({ code: 'EACCES' })
    } finally {
      openControl.forcedErrorCode = undefined
    }
  })

  it('rejects an on-disk schema version newer than this build writes', async () => {
    const path = await makeDbPath()
    const seed = new DatabaseSync(path)
    seed.exec('PRAGMA user_version = 999')
    seed.close()

    await expect(openStoreDatabase(path, 'project-1', OPTIONS)).rejects.toMatchObject({
      code: 'SCHEMA_VERSION_NEWER',
    } satisfies Partial<ProjectArtifactStoreError>)
  })
})

describe('resolveMigrationChain', () => {
  const step1to2: StoreMigration = { from: 1, to: 2, apply: () => {} }
  const step2to3: StoreMigration = { from: 2, to: 3, apply: () => {} }

  it('chains consecutive steps in order', () => {
    expect(resolveMigrationChain([step1to2, step2to3], 1, 3)).toEqual([step1to2, step2to3])
  })

  it('throws SCHEMA_UPGRADE_UNAVAILABLE synchronously, touching no disk, when no step exists', () => {
    expect(() => resolveMigrationChain([], 1, 2)).toThrow(expect.objectContaining({ code: 'SCHEMA_UPGRADE_UNAVAILABLE' }))
  })

  it('throws SCHEMA_UPGRADE_UNAVAILABLE when the chain has a gap partway to the target', () => {
    expect(() => resolveMigrationChain([step1to2], 1, 3)).toThrow(expect.objectContaining({ code: 'SCHEMA_UPGRADE_UNAVAILABLE' }))
  })

  it('returns an empty chain when already at the target', () => {
    expect(resolveMigrationChain([step1to2], 2, 2)).toEqual([])
  })
})
