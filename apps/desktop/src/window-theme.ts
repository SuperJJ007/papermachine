/** BrowserWindow background colors that match the Web shell's fallback palette. */
export const WINDOW_BACKGROUND = {
  light: '#f5f7fa',
  dark: '#111827',
} as const

/**
 * Select the BrowserWindow background for Electron's resolved system theme.
 * @param shouldUseDarkColors - Electron's current native dark-mode decision.
 * @returns The matching opaque CSS color.
 */
export function windowBackgroundColor(shouldUseDarkColors: boolean): string {
  return shouldUseDarkColors ? WINDOW_BACKGROUND.dark : WINDOW_BACKGROUND.light
}
