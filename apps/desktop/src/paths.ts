/** Filesystem ownership for the Electron-managed desktop installation. */

import { join } from 'node:path'

/** Stable desktop installation paths under the PaperMachine home. */
export interface DesktopPaths {
  readonly root: string
  readonly profile: string
  readonly staging: string
  readonly rollback: string
  readonly pending: string
  readonly lock: string
  readonly pnpm: {
    readonly root: string
    readonly store: string
    readonly cache: string
    readonly state: string
    readonly config: string
    readonly home: string
  }
}

/**
 * Resolve every Electron-owned path beneath the resolved PaperMachine home.
 * @param dshHome - Resolved PaperMachine home.
 * @returns immutable desktop path set.
 */
export function resolveDesktopPaths(dshHome: string): DesktopPaths {
  const root = join(dshHome, 'desktop')
  const pnpm = join(root, 'pnpm')
  return {
    root,
    profile: join(dshHome, 'profiles', 'desktop'),
    staging: join(root, 'staging'),
    rollback: join(root, 'rollback', 'profile'),
    pending: join(root, 'pending.json'),
    lock: join(root, 'lock'),
    pnpm: {
      root: pnpm,
      store: join(pnpm, 'store'),
      cache: join(pnpm, 'cache'),
      state: join(pnpm, 'state'),
      config: join(pnpm, 'config'),
      home: join(pnpm, 'home'),
    },
  }
}
