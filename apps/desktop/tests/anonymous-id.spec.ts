/**
 * The anonymous id must be byte-for-byte compatible with
 * `packages/identity/anonymous-user-id/src/index.ts`'s
 * `getOrCreateAnonymousUserId`: a bare `${uuid}\n` line in
 * `.anonymous-user-id`, so a Host launched after desktop's own first
 * `app.launch` reads the identical id this module created.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ANONYMOUS_USER_ID_FILE_NAME, getOrCreateAnonymousId } from '../src/anonymous-id.ts'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u

const homes: string[] = []

async function makeDshHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-desktop-anon-id-'))
  homes.push(home)
  return home
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map(async path => rm(path, { recursive: true, force: true })))
})

describe('getOrCreateAnonymousId', () => {
  it('creates the file in the identity package\'s exact format when missing', async () => {
    const dshHome = await makeDshHome()

    const id = await getOrCreateAnonymousId(dshHome)

    expect(id).toMatch(UUID_PATTERN)
    const contents = await readFile(join(dshHome, ANONYMOUS_USER_ID_FILE_NAME), 'utf8')
    expect(contents).toBe(`${id}\n`)
  })

  it('reuses an id an identity-package-format file already carries', async () => {
    const dshHome = await makeDshHome()
    const existing = '11111111-2222-3333-4444-555555555555'
    await writeFile(join(dshHome, ANONYMOUS_USER_ID_FILE_NAME), `${existing}\n`, 'utf8')

    const id = await getOrCreateAnonymousId(dshHome)

    expect(id).toBe(existing)
  })

  it('mints and persists a fresh id when the existing file is corrupt', async () => {
    const dshHome = await makeDshHome()
    await writeFile(join(dshHome, ANONYMOUS_USER_ID_FILE_NAME), 'not-a-uuid\n', 'utf8')

    const id = await getOrCreateAnonymousId(dshHome)

    expect(id).toMatch(UUID_PATTERN)
    expect(await readFile(join(dshHome, ANONYMOUS_USER_ID_FILE_NAME), 'utf8')).toBe(`${id}\n`)
  })

  it('is stable across repeated calls against the same home', async () => {
    const dshHome = await makeDshHome()

    const first = await getOrCreateAnonymousId(dshHome)
    const second = await getOrCreateAnonymousId(dshHome)

    expect(second).toBe(first)
  })
})
