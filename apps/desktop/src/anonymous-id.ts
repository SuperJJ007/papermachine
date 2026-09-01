/**
 * The Harness-home-scoped anonymous id shared with the Host's identity
 * plugin (`packages/identity/anonymous-user-id/src/index.ts`): a random
 * UUID persisted as a bare `${uuid}\n` line in `<dshHome>/.anonymous-user-id`,
 * never derived from a hostname, network address, or other identifying
 * source. Reimplemented here (rather than imported) because desktop's
 * Electron main process ships with no runtime dependency on `packages/`;
 * the file format below is byte-for-byte what
 * `getOrCreateAnonymousUserId` reads and writes, so the Host launched by
 * this application later reads whatever id desktop's own first
 * `app.launch` event created, and either process can create the file first.
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** File name inside the Harness home; matches `ANONYMOUS_USER_ID_FILE_NAME` in `dsh-anonymous-user-id`. */
export const ANONYMOUS_USER_ID_FILE_NAME = '.anonymous-user-id'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

async function readPersistedId(file: string): Promise<string | undefined> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch {
    // Absent or unreadable: the caller mints and persists a fresh id.
    return undefined
  }
  const value = text.trim()
  return UUID_PATTERN.test(value) ? value : undefined
}

/**
 * Return the Harness home's anonymous id, creating and persisting one in the
 * identity package's exact on-disk format if none exists yet — desktop's
 * first `app.launch` fires during onboarding, before any Host process has
 * run, so this is frequently the id's true point of creation. A concurrent
 * first launch is settled by an exclusive-create write (`wx`); the loser
 * rereads the winner's id. Persistence is best-effort: a write failure still
 * returns a usable id for the current run so telemetry is never blocked.
 * @param dshHome - the Harness home directory.
 * @returns the stable per-Harness-home anonymous id.
 */
export async function getOrCreateAnonymousId(dshHome: string): Promise<string> {
  const file = join(dshHome, ANONYMOUS_USER_ID_FILE_NAME)
  const existing = await readPersistedId(file)
  if (existing !== undefined) return existing

  const created = randomUUID()
  try {
    await mkdir(dshHome, { recursive: true })
    await writeFile(file, `${created}\n`, { encoding: 'utf8', flag: 'wx' })
    return created
  } catch {
    // A wx refusal (EEXIST) covers both a concurrent winner and a
    // pre-existing corrupt file: the reread adopts a valid winner, and an
    // invalid reread falls through to the overwrite path below. Non-EEXIST
    // failures (read-only home) land there too, accepted best-effort.
    const reread = await readPersistedId(file)
    if (reread !== undefined) return reread
    try {
      await writeFile(file, `${created}\n`, 'utf8')
    } catch {
      // Best-effort persistence: keep the fresh id in memory even when the
      // home is unwritable, so this run still reports a consistent id.
    }
    return created
  }
}
