/** BrowserWindow background colors and durable theme-preference resolution matching the Web shell. */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { load } from 'js-yaml'

/**
 * The `ui-theme.preference` values the Web shell's settings namespace
 * accepts (`packages/client/ui-theme/src/theme-settings.ts`'s
 * `THEME_PREFERENCES`). Duplicated here rather than imported: that package's
 * only runtime export pulls in the Host's Cordis settings/webserver plugin
 * machinery, which this standalone, separately-bundled Electron main process
 * does not otherwise depend on.
 */
const WINDOW_THEME_PREFERENCES = ['light', 'dark', 'system'] as const

/** One of the durable `ui-theme.preference` values the desktop window resolves its background from. */
export type WindowThemePreference = typeof WINDOW_THEME_PREFERENCES[number]

/** BrowserWindow background colors that match the Web shell's fallback palette. */
export const WINDOW_BACKGROUND = {
  light: '#f5f7fa',
  dark: '#111827',
} as const

/**
 * Select the BrowserWindow background for a resolved theme preference.
 * `light`/`dark` paint directly; `system` follows Electron's current native
 * dark-mode decision, matching the page's own `system` resolution
 * (`packages/client/ui-theme/src/boot-theme.ts`).
 * @param preference - the durable `ui-theme.preference` value the window is painting for.
 * @param shouldUseDarkColors - Electron's current native dark-mode decision; consulted only for `'system'`.
 * @returns The matching opaque CSS color.
 */
export function windowBackgroundColor(preference: WindowThemePreference, shouldUseDarkColors: boolean): string {
  const dark = preference === 'dark' || (preference === 'system' && shouldUseDarkColors)
  return dark ? WINDOW_BACKGROUND.dark : WINDOW_BACKGROUND.light
}

function isWindowThemePreference(value: unknown): value is WindowThemePreference {
  return WINDOW_THEME_PREFERENCES.some(candidate => candidate === value)
}

/**
 * Best-effort read of the durable `ui-theme.preference` field from
 * `<dshHome>/settings.yaml` — the same document the Host's `settings-file`
 * plugin owns (`packages/settings/settings-file/src/index.ts`) and the
 * `ui-theme` client plugin resolves the page's own light/dark rendering from
 * (`packages/client/ui-theme/src/index.ts`). Read directly here, before the
 * window exists, because the Host has not started yet at the point
 * `createWindow` needs a background color — there is no running settings
 * service to ask.
 *
 * The Host's `settings-file` plugin is the sole owner of this document's
 * validation and fail-loud behavior. Every way this read can come up empty —
 * no file yet (a fresh install has never saved a preference), a document
 * without a `ui-theme` section, or a value this process cannot parse —
 * resolves to `'system'` here rather than throwing: the window background is
 * a cosmetic pre-paint that avoids a flash before the page loads, and
 * refusing to open the window over a settings-file problem the Host will
 * itself detect and report at boot would turn a decorative mismatch into an
 * outage. `'system'` is always a safe fallback: it reproduces the
 * OS-following background this window painted before preference-awareness
 * existed.
 * @param dshHome - resolved Harness home containing `settings.yaml`.
 * @returns the resolved preference, or `'system'` when the document is
 *   absent, unparseable, or has no readable `ui-theme.preference` field.
 */
export async function resolveWindowThemePreference(dshHome: string): Promise<WindowThemePreference> {
  let text: string
  try {
    text = await readFile(join(dshHome, 'settings.yaml'), 'utf8')
  } catch {
    // Missing file (nothing ever saved) is the expected common case; any
    // other read failure (permissions, a mid-write race) is equally not
    // this cosmetic read's to diagnose — the Host's own read of this same
    // file fails loud on its own schedule.
    return 'system'
  }
  let document: unknown
  try {
    document = load(text)
  } catch {
    // A document this process cannot parse is surfaced by the Host's own
    // settings-file load, which runs the real schema; this best-effort read
    // only paints a window background and must not duplicate that failure.
    return 'system'
  }
  if (typeof document !== 'object' || document === null) return 'system'
  const section = (document as Record<string, unknown>)['ui-theme']
  if (typeof section !== 'object' || section === null) return 'system'
  const preference = (section as Record<string, unknown>).preference
  return isWindowThemePreference(preference) ? preference : 'system'
}
