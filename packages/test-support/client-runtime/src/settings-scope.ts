/** Test double for the client settings-scope seam. */
import { vi } from 'vitest'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'

/** Handle over one stubbed scope: the scope, its write spies, and publication controls. */
export interface StubSettingsScope<T> {
  /** The scope face handed to the service under test. */
  scope: SettingsScope<T>
  /** Spy behind `scope.setPath`; resolves immediately. `scope.set` delegates here, as production does. */
  setPath: ReturnType<typeof vi.fn>
  /** Spy behind `scope.set`; resolves immediately. */
  set: ReturnType<typeof vi.fn>
  /** Spy behind `scope.unsetPath`; resolves immediately. `scope.unset` delegates here, as production does. */
  unsetPath: ReturnType<typeof vi.fn>
  /** Spy behind `scope.unset`; resolves immediately. */
  unset: ReturnType<typeof vi.fn>
  /** @returns how many listeners are currently subscribed (disposal assertions). */
  listenerCount(): number
  /**
   * Replace part of the snapshot and notify subscribers, as a Host
   * acceptance would.
   * @param next - snapshot fields to replace.
   */
  publish(next: Partial<SettingsScopeSnapshot<T>>): void
}

/**
 * Build an in-memory settings scope for service specs: starts in the host
 * loading state, records writes, and lets the test publish Host acceptances.
 * `set`/`unset` default to delegating into `setPath`/`unsetPath` with a
 * one-element path, mirroring the production controller; overriding one spy's
 * `mockImplementation` replaces that delegation for the test that needs to.
 * @returns the stub handle.
 */
export function stubSettingsScope<T>(): StubSettingsScope<T> {
  let snapshot: SettingsScopeSnapshot<T> = {
    status: 'loading', value: undefined, base: undefined, user: undefined, secrets: [],
    revision: undefined, writable: false, mode: 'host',
  }
  const listeners = new Set<() => void>()
  const setPath = vi.fn((_path: readonly string[], _value: unknown) => Promise.resolve())
  const unsetPath = vi.fn((_path: readonly string[]) => Promise.resolve())
  const set = vi.fn((field: string, value: unknown) => setPath([field], value))
  const unset = vi.fn((field: string) => unsetPath([field]))
  return {
    scope: {
      getSnapshot: () => snapshot,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      setPath,
      set,
      unsetPath,
      unset,
    },
    setPath,
    set,
    unsetPath,
    unset,
    listenerCount: () => listeners.size,
    publish: (next) => {
      snapshot = { ...snapshot, ...next }
      for (const listener of [...listeners]) listener()
    },
  }
}
