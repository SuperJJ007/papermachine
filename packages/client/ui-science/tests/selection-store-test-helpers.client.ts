/** Test-only binding of a real `ScienceSelectionStore` instance to the `useStore`/`actions` share components expect. */
import { useSyncExternalStore } from 'react'
import { createScienceSelectionStore } from '../src/client/selection-store.ts'
import type { ScienceSelectionState } from '../src/client/selection-store.ts'

/**
 * Create one live selection-store instance and its `useStore`/`actions` pair
 * — the same real engine `ctx.slots.register`'s `store:` seat mints in
 * production, bound to `useSyncExternalStore` instead of the framework's own
 * selector-hook cache (which needs a slot render tree these unit tests do
 * not mount).
 * @returns the store instance plus the bound `useStore`/`actions` pair.
 */
export function testScienceSelectionStore() {
  const instance = createScienceSelectionStore().create()
  function useStore<S>(select: (state: ScienceSelectionState) => S): S {
    return useSyncExternalStore(fn => instance.subscribe(fn), () => select(instance.getSnapshot()))
  }
  return { instance, useStore, actions: instance.actions }
}
