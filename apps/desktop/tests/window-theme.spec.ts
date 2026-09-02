import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveWindowThemePreference, WINDOW_BACKGROUND, windowBackgroundColor } from '../src/window-theme.ts'

async function makeDshHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'dsh-desktop-window-theme-'))
}

describe('windowBackgroundColor', () => {
  it('paints the light fallback for an explicit light preference regardless of the OS theme', () => {
    expect(windowBackgroundColor('light', true)).toBe(WINDOW_BACKGROUND.light)
    expect(windowBackgroundColor('light', false)).toBe(WINDOW_BACKGROUND.light)
  })

  it('paints the dark fallback for an explicit dark preference regardless of the OS theme', () => {
    expect(windowBackgroundColor('dark', true)).toBe(WINDOW_BACKGROUND.dark)
    expect(windowBackgroundColor('dark', false)).toBe(WINDOW_BACKGROUND.dark)
  })

  it('follows the resolved OS theme only for a system preference', () => {
    expect(windowBackgroundColor('system', true)).toBe(WINDOW_BACKGROUND.dark)
    expect(windowBackgroundColor('system', false)).toBe(WINDOW_BACKGROUND.light)
  })
})

describe('resolveWindowThemePreference', () => {
  it('resolves to system when settings.yaml does not exist', async () => {
    const dshHome = await makeDshHome()

    await expect(resolveWindowThemePreference(dshHome)).resolves.toBe('system')
  })

  it('reads an explicit light preference from settings.yaml', async () => {
    const dshHome = await makeDshHome()
    await writeFile(join(dshHome, 'settings.yaml'), 'ui-theme:\n  preference: light\n')

    await expect(resolveWindowThemePreference(dshHome)).resolves.toBe('light')
  })

  it('reads an explicit dark preference from settings.yaml', async () => {
    const dshHome = await makeDshHome()
    await writeFile(join(dshHome, 'settings.yaml'), 'ui-theme:\n  preference: dark\n')

    await expect(resolveWindowThemePreference(dshHome)).resolves.toBe('dark')
  })

  it('reads an explicit system preference from settings.yaml', async () => {
    const dshHome = await makeDshHome()
    await writeFile(join(dshHome, 'settings.yaml'), 'ui-theme:\n  preference: system\n')

    await expect(resolveWindowThemePreference(dshHome)).resolves.toBe('system')
  })

  it('resolves to system when the document has no ui-theme section', async () => {
    const dshHome = await makeDshHome()
    await writeFile(join(dshHome, 'settings.yaml'), 'some-other-namespace:\n  field: value\n')

    await expect(resolveWindowThemePreference(dshHome)).resolves.toBe('system')
  })

  it('resolves to system when the preference field is not a recognized value', async () => {
    const dshHome = await makeDshHome()
    await writeFile(join(dshHome, 'settings.yaml'), 'ui-theme:\n  preference: neon\n')

    await expect(resolveWindowThemePreference(dshHome)).resolves.toBe('system')
  })

  it('resolves to system when settings.yaml is not valid YAML', async () => {
    const dshHome = await makeDshHome()
    await writeFile(join(dshHome, 'settings.yaml'), '{ not: [valid\n')

    await expect(resolveWindowThemePreference(dshHome)).resolves.toBe('system')
  })

  it('resolves to system when the document top level is not a map', async () => {
    const dshHome = await makeDshHome()
    await writeFile(join(dshHome, 'settings.yaml'), '- a\n- b\n')

    await expect(resolveWindowThemePreference(dshHome)).resolves.toBe('system')
  })
})
