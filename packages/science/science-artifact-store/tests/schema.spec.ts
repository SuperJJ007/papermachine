import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PROJECT_ARTIFACT_STORE_SCHEMA_VERSION, openStoreDatabase } from '../src/schema.ts'
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
    const db = await openStoreDatabase(path, 'wal', 1000)
    const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
    expect(version).toBe(PROJECT_ARTIFACT_STORE_SCHEMA_VERSION)
    db.close()
  })

  it('reopens a database it already stamped without error', async () => {
    const path = await makeDbPath()
    const first = await openStoreDatabase(path, 'wal', 1000)
    first.close()
    const second = await openStoreDatabase(path, 'wal', 1000)
    second.close()
  })

  it('propagates a non-EEXIST failure creating the database file', async () => {
    const path = await makeDbPath()
    openControl.forcedErrorCode = 'EACCES'
    try {
      await expect(openStoreDatabase(path, 'wal', 1000)).rejects.toMatchObject({ code: 'EACCES' })
    } finally {
      openControl.forcedErrorCode = undefined
    }
  })

  it('rejects an on-disk schema version other than the current one', async () => {
    const path = await makeDbPath()
    const seed = new DatabaseSync(path)
    seed.exec('PRAGMA user_version = 999')
    seed.close()

    await expect(openStoreDatabase(path, 'wal', 1000)).rejects.toMatchObject({
      code: 'SCHEMA_VERSION_MISMATCH',
    } satisfies Partial<ProjectArtifactStoreError>)
  })
})
