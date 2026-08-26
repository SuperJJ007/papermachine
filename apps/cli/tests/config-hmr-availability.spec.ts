import { describe, expect, it } from 'vitest'
import type { ModuleLoader } from '@deepseek-ai/cordis-plugin-loader'
import { canMountConfigHmr } from '../src/profile-boot.ts'

describe('canMountConfigHmr', () => {
  it('allows config-only HMR when the Loader resolved a Node internal module loader', () => {
    // A real ModuleLoaderV1/V2 has fields this spec has no reason to fake;
    // canMountConfigHmr only checks presence, so an empty stand-in narrowed
    // to the type here is enough to exercise that check.
    expect(canMountConfigHmr({} as ModuleLoader)).toBe(true)
  })

  it('refuses config-only HMR when the Loader found no internal module loader', () => {
    // Every Electron-hosted Host process lands here: its forked Node exposes
    // neither `--expose-internals` nor a working `node-addon-require-builtin`.
    expect(canMountConfigHmr(undefined)).toBe(false)
  })
})
