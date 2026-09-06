import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HarnessHomeSpaceError } from '../src/harness-home.ts'
import {
  classifyBootInstallLocationFailure,
  clearInstallLocationPointer,
  confirmsInstallLocation,
  hasNonAsciiCharacters,
  installLocationConfirmationDialog,
  installLocationPointerPath,
  isInstallLocationUnavailable,
  readInstallLocationPointer,
  resolveChosenInstallLocationPath,
  UNREADABLE_INSTALL_LOCATION_POINTER_TARGET,
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

describe('resolveChosenInstallLocationPath', () => {
  it('appends the PaperMachine subdirectory to a chosen directory', () => {
    expect(resolveChosenInstallLocationPath('/Volumes/Data', 'darwin')).toBe('/Volumes/Data/PaperMachine')
  })

  it('does not duplicate the subdirectory when the chosen directory already ends in it', () => {
    expect(resolveChosenInstallLocationPath('/Volumes/Data/PaperMachine', 'darwin')).toBe('/Volumes/Data/PaperMachine')
  })

  it('compares the basename case-insensitively on darwin', () => {
    expect(resolveChosenInstallLocationPath('/Volumes/Data/papermachine', 'darwin')).toBe('/Volumes/Data/papermachine')
  })

  it('compares the basename case-insensitively on win32', () => {
    expect(resolveChosenInstallLocationPath('D:\\papermachine', 'win32')).toBe('D:\\papermachine')
  })

  it('compares the basename case-sensitively on linux', () => {
    expect(resolveChosenInstallLocationPath('/mnt/data/papermachine', 'linux')).toBe('/mnt/data/papermachine/PaperMachine')
  })

  it('is idempotent: calling it again on its own return value is a no-op', () => {
    const once = resolveChosenInstallLocationPath('/Volumes/Data', 'darwin')

    expect(resolveChosenInstallLocationPath(once, 'darwin')).toBe(once)
  })

  it('appends to a Windows drive root, parsed with the win32 path module regardless of the test host', () => {
    expect(resolveChosenInstallLocationPath('D:\\', 'win32')).toBe('D:\\PaperMachine')
  })
})

describe('installLocationConfirmationDialog', () => {
  it('names the resolved target in bilingual message and detail text, with OK/Cancel buttons', () => {
    const dialog = installLocationConfirmationDialog('/Volumes/Data/PaperMachine')

    expect(dialog.message).toContain('确认安装位置')
    expect(dialog.message).toContain('Confirm install location')
    expect(dialog.detail).toContain('/Volumes/Data/PaperMachine')
    expect(dialog.buttons).toEqual(['确定 · OK', '取消 · Cancel'])
    expect(dialog.defaultId).toBe(0)
    expect(dialog.cancelId).toBe(1)
  })
})

describe('confirmsInstallLocation', () => {
  it('is true only for the dialog\'s first ("确定 · OK") button', () => {
    expect(confirmsInstallLocation(0)).toBe(true)
  })

  it('is false for the "取消 · Cancel" button', () => {
    expect(confirmsInstallLocation(1)).toBe(false)
  })
})

describe('isInstallLocationUnavailable', () => {
  it('is true when a pointer is set and its target does not exist', () => {
    expect(isInstallLocationUnavailable('/Volumes/Data/PaperMachine', new Error('ENOENT: no such file or directory, mkdir \'/Volumes/Data/PaperMachine\''))).toBe(true)
  })

  it('is true when a pointer is set and its target is not writable', () => {
    expect(isInstallLocationUnavailable('/Volumes/Data/PaperMachine', new Error('EPERM: operation not permitted, mkdir \'/Volumes/Data/PaperMachine\''))).toBe(true)
  })

  it('is false for the ordinary case: no pointer in effect', () => {
    expect(isInstallLocationUnavailable(undefined, new Error('ENOENT: no such file or directory'))).toBe(false)
  })

  it('is false for a space-containing path, which classifyBootInstallLocationFailure routes to the dedicated space-error recovery page instead', () => {
    expect(isInstallLocationUnavailable('/a user/.papermachine', new HarnessHomeSpaceError('/a user/.papermachine'))).toBe(false)
  })
})

describe('classifyBootInstallLocationFailure', () => {
  it('routes a pointer file that could not be read at all to the placeholder target', () => {
    expect(classifyBootInstallLocationFailure(undefined, true, new Error('desktop install location: /home/.papermachine-home is empty')))
      .toEqual({ kind: 'unavailable-pointer', target: UNREADABLE_INSTALL_LOCATION_POINTER_TARGET })
  })

  it('routes a pointer whose target is unreachable to that target, same as isInstallLocationUnavailable', () => {
    expect(classifyBootInstallLocationFailure('/Volumes/Data/PaperMachine', false, new Error('ENOENT: no such file or directory')))
      .toEqual({ kind: 'unavailable-pointer', target: '/Volumes/Data/PaperMachine' })
  })

  it('rethrows when no pointer is in effect and reading it did not fail', () => {
    expect(classifyBootInstallLocationFailure(undefined, false, new Error('ENOENT: no such file or directory'))).toBeUndefined()
  })

  it('routes a space-containing default home (no pointer in effect) to the space-error recovery page', () => {
    const error = new HarnessHomeSpaceError('/Users/John Smith/.papermachine')
    expect(classifyBootInstallLocationFailure(undefined, false, error)).toEqual({ kind: 'space', error })
  })

  it('routes a space-containing pointer target to the space-error recovery page too, not the pointer-unavailable one', () => {
    const error = new HarnessHomeSpaceError('/a user/.papermachine')
    expect(classifyBootInstallLocationFailure('/a user/.papermachine', false, error)).toEqual({ kind: 'space', error })
  })
})
