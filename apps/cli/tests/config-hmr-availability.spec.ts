import { describe, expect, it } from 'vitest'
import { canMountConfigHmr } from '../src/profile-boot.ts'

describe('canMountConfigHmr', () => {
  it('allows config-only HMR when the Loader resolved a Node internal module loader', () => {
    expect(canMountConfigHmr({})).toBe(true)
  })

  it('refuses config-only HMR when the Loader found no internal module loader', () => {
    // Every Electron-hosted Host process lands here: its forked Node exposes
    // neither `--expose-internals` nor a working `node-addon-require-builtin`.
    expect(canMountConfigHmr(undefined)).toBe(false)
  })
})
