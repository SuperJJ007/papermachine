import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  clearInstallLocationPointer,
  hasNonAsciiCharacters,
  installLocationPointerPath,
  readInstallLocationPointer,
  writeInstallLocationPointer,
} from '../src/install-location.ts'

async function makeHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'dsh-desktop-install-location-'))
}

describe('installLocationPointerPath', () => {
  it('names an ASCII-only dotfile directly under the OS home directory', async () => {
    const home = await makeHome()

    expect(installLocationPointerPath(home)).toBe(join(home, '.papermachine-home'))
  })
})

describe('readInstallLocationPointer', () => {
  it('returns undefined when no pointer file exists', async () => {
    const home = await makeHome()

    expect(await readInstallLocationPointer(home)).toBeUndefined()
  })

  it('returns the trimmed absolute path a pointer file names', async () => {
    const home = await makeHome()
    const target = join(home, 'elsewhere')
    await writeInstallLocationPointer(home, target)

    expect(await readInstallLocationPointer(home)).toBe(target)
  })

  it('throws naming the file when the pointer file is empty', async () => {
    const home = await makeHome()
    await writeFile(installLocationPointerPath(home), '', 'utf8')

    await expect(readInstallLocationPointer(home)).rejects.toThrow(installLocationPointerPath(home))
  })

  it('throws naming the file when the pointer file is whitespace-only', async () => {
    const home = await makeHome()
    await writeFile(installLocationPointerPath(home), '   \n\t\n', 'utf8')

    await expect(readInstallLocationPointer(home)).rejects.toThrow(installLocationPointerPath(home))
  })

  it('throws naming the file when the pointer file names a relative path', async () => {
    const home = await makeHome()
    await writeFile(installLocationPointerPath(home), 'relative/path\n', 'utf8')

    await expect(readInstallLocationPointer(home)).rejects.toThrow(installLocationPointerPath(home))
  })
})

describe('writeInstallLocationPointer', () => {
  it('round-trips through readInstallLocationPointer', async () => {
    const home = await makeHome()
    const target = join(home, 'a-chosen-drive')

    await writeInstallLocationPointer(home, target)

    expect(await readInstallLocationPointer(home)).toBe(target)
  })

  it('replaces an existing pointer atomically, leaving no temp file behind', async () => {
    const home = await makeHome()
    await writeInstallLocationPointer(home, join(home, 'first'))

    await writeInstallLocationPointer(home, join(home, 'second'))

    expect(await readInstallLocationPointer(home)).toBe(join(home, 'second'))
    const entries = await readdir(home)
    expect(entries).toEqual(['.papermachine-home'])
  })

  it('persists a trailing-newline-terminated single-path file', async () => {
    const home = await makeHome()
    const target = join(home, 'chosen')

    await writeInstallLocationPointer(home, target)

    expect(await readFile(installLocationPointerPath(home), 'utf8')).toBe(`${target}\n`)
  })
})

describe('clearInstallLocationPointer', () => {
  it('removes an existing pointer file', async () => {
    const home = await makeHome()
    await writeInstallLocationPointer(home, join(home, 'chosen'))

    await clearInstallLocationPointer(home)

    expect(await readInstallLocationPointer(home)).toBeUndefined()
  })

  it('is a no-op when no pointer file exists', async () => {
    const home = await makeHome()

    await expect(clearInstallLocationPointer(home)).resolves.toBeUndefined()
  })
})

describe('hasNonAsciiCharacters', () => {
  it('is false for an ASCII-only path', () => {
    expect(hasNonAsciiCharacters('/Users/scientist/.papermachine')).toBe(false)
  })

  it('is true for a path containing CJK characters', () => {
    expect(hasNonAsciiCharacters('/Users/科学家/.papermachine')).toBe(true)
  })

  it('is false for a path containing only spaces (a distinct, separately-checked risk)', () => {
    expect(hasNonAsciiCharacters('/Users/a user/.papermachine')).toBe(false)
  })
})
