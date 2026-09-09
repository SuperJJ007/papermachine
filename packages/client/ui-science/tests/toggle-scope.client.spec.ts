import { afterEach, describe, expect, it, vi } from 'vitest'
import { readToggleScope } from '../src/client/toggle-scope.ts'
import { TOGGLE_SCOPE_GLOBAL } from '../src/toggle-scope.ts'

afterEach(() => { vi.unstubAllGlobals() })

describe('readToggleScope', () => {
  it('defaults to session-scoped when the Host boot global is absent', () => {
    expect(readToggleScope()).toBe('session')
  })

  it('reads the Host-injected global placement', () => {
    vi.stubGlobal(TOGGLE_SCOPE_GLOBAL, 'global')
    expect(readToggleScope()).toBe('global')
  })

  it('falls back to session-scoped for a malformed global value', () => {
    vi.stubGlobal(TOGGLE_SCOPE_GLOBAL, 'nonsense')
    expect(readToggleScope()).toBe('session')
  })
})
