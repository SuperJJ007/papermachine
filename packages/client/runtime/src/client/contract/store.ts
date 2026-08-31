/**
 * Snapshot store engine (zustand vanilla + immer + subscribeWithSelector +
 * rafFlush middleware + opt-in persist + dev freeze) plus the declarative
 * shell over it: {@link defineStore} bakes an init/persist/actions literal
 * into a {@link StoreHandle}, the registration-side store seat of slot
 * terminals. Lives in the React-free runtime (the data layer owns its
 * engine; ui-renderer is shell-only React
 * glue): engine products are bare observables — subscribe/getSnapshot/
 * update/set, NO selector hook. Hook synthesis is ui-renderer's (the one
 * uSES bridge, cached per source at the binding site).
 *
 * Persistence rehydrates by merging the stored payload's top-level keys over
 * `init()`'s value rather than replacing the state wholesale, so a field
 * added since an older build wrote the payload keeps its init value instead
 * of coming back `undefined`; see {@link attachPersistence} for the merge
 * contract.
 */
import { createStore, type StoreApi } from 'zustand/vanilla'
import { subscribeWithSelector } from 'zustand/middleware'
import { shallow } from 'zustand/shallow'
import { produce } from 'immer'
import type {
  ActionsDecl, BakedActions, StoreHandle, StoreInstance, StoreSpec,
} from '@deepseek-ai/dsh-client-ui-slots'

// Store contract types are ui-slots authority; re-exported beside the engine
// so store consumers get one import path.
export type {
  ActionsDecl, BakedActions, BoundActions, StoreFactory, StoreHandle, StoreInstance, StoreSpec,
} from '@deepseek-ai/dsh-client-ui-slots'

/** Minimal observable snapshot source: Session objects and snapshot stores both satisfy it. */
export interface ObservableSnapshot<T> { getSnapshot(): T; subscribe(fn: () => void): () => void }

/** Writable snapshot store (bare data face; React selector hooks are synthesized in ui-renderer). */
export interface SnapshotStore<T> extends ObservableSnapshot<T> {
  /**
   * Mutate the state through an immer draft.
   * @param mutator - draft mutator.
   */
  update(mutator: (draft: T) => void): void
  /**
   * Replace the state wholesale.
   * @param next - next state.
   */
  set(next: T): void
}

/**
 * Shallow equality for selector slices (zustand/shallow semantics; travels
 * with the engine so hook consumers need no zustand dependency).
 * @param a - left value.
 * @param b - right value.
 * @returns whether the values are shallowly equal.
 */
export function shallowEqual(a: unknown, b: unknown): boolean {
  return shallow(a, b)
}

/** Batches subscriber notification into one flush per animation frame. */
function rafBatch(notify: () => void): () => void {
  // Fall back to microtask batching where rAF is absent (node unit tests);
  // both preserve the N-changes=1-notification contract within a tick.
  const schedule: (fn: () => void) => void =
    typeof requestAnimationFrame === 'function'
      ? (fn) => { requestAnimationFrame(() => { fn() }) }
      : (fn) => { queueMicrotask(fn) }
  let scheduled = false
  return () => {
    if (scheduled) return
    scheduled = true
    schedule(() => {
      scheduled = false
      notify()
    })
  }
}

/**
 * Create a snapshot store.
 *
 * Flush default is 'sync' (controlled inputs need same-tick echo); frame-driven
 * stores opt into 'raf', where a frame's worth of updates coalesces into one
 * notification. Known raf-mode tradeoff: a component mounting mid-frame reads
 * fresh state while existing subscribers hear it next flush — transient
 * frame-level skew, same nature as the object layer's microtask batching.
 *
 * @param init - initial state.
 * @param opts - flush mode and opt-in persistence (localStorage, keyed by name).
 * @returns the store.
 */
export function createSnapshotStore<T>(
  init: T, opts?: { flush?: 'raf' | 'sync'; persist?: { name: string } }): SnapshotStore<T> {
  // Immer enters through produce() in update() below (identical semantics to
  // the immer middleware without its setState-signature mutator generics).
  const withSelector = subscribeWithSelector(() => init)
  const api: StoreApi<T> = createStore<T>()(withSelector)
  if (opts?.persist) attachPersistence(api, opts.persist.name)

  let subscribe = (fn: () => void) => api.subscribe(fn)
  if (opts?.flush === 'raf') {
    const listeners = new Set<() => void>()
    const flush = rafBatch(() => { for (const fn of [...listeners]) fn() })
    api.subscribe(flush)
    subscribe = (fn: () => void) => {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    }
  }

  return {
    getSnapshot: () => api.getState(),
    subscribe: fn => subscribe(fn),
    update: (mutator) => {
      // Immer's produce (not setState's partial-merge path) so scalar and
      // array roots replace correctly; produce also freezes in dev.
      api.setState(produce(api.getState(), (draft) => { mutator(draft as T) }), true)
    },
    set: (next) => {
      api.setState(devFreeze(next), true)
    },
  }
}

/**
 * Whole-value JSON persistence to localStorage, merged over `init()` on
 * read. Hand-rolled instead of the zustand persist middleware: its write
 * path spreads state into an object (`partialize({ ...get() })`), exploding
 * primitive state (a persisted string draft becomes {0:'h',1:'e',...}) — not
 * fixable via merge/deserialize options because the corruption happens
 * before serialization. Storage failures (quota, private mode) only disable
 * persistence, never break the store.
 *
 * Rehydration takes the store's state at call time — `init()`'s value; no
 * mutation has happened yet — as the base and overlays only the persisted
 * payload's own top-level keys that the base already has: a field added to
 * `init()` since the payload was written keeps its init value instead of
 * coming back `undefined`, and a field the current build no longer declares
 * is dropped instead of reappearing. This is a shallow, one-level merge —
 * nested shape drift (a field whose own internal shape changed) is not
 * reconciled and stays the version-suffix's job. A payload that does not
 * match the base's kind (a plain object where the base is a plain object;
 * the same primitive/array kind otherwise) is rejected outright and
 * `init()` is kept, through the same non-fatal log path as a storage or
 * parse failure.
 * @param api - the store to attach persistence to.
 * @param name - localStorage key.
 */
function attachPersistence<T>(api: StoreApi<T>, name: string): void {
  // Non-browser runs (node e2e booting the client tree) have no localStorage:
  // persistence silently disables — same contract as a storage failure, minus
  // the per-store console noise a ReferenceError would produce.
  if (typeof localStorage === 'undefined') return
  try {
    const raw = localStorage.getItem(name)
    if (raw !== null) {
      const merged = mergeRehydrated(api.getState(), JSON.parse(raw) as unknown)
      if (merged === undefined) throw new Error('persisted payload does not match the state init() declares')
      api.setState(devFreeze(merged), true)
    }
  } catch (error) {
    console.error(`snapshot store '${name}' rehydration failed:`, error)
  }
  api.subscribe((state) => {
    try {
      localStorage.setItem(name, JSON.stringify(state))
    } catch (error) {
      console.error(`snapshot store '${name}' persistence failed:`, error)
    }
  })
}

/** Type guard for plain JSON objects: excludes arrays, `null`, and every non-object JSON value. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Reconcile a rehydrated payload against the live base state (see
 * {@link attachPersistence} for the merge contract). Object states merge
 * top-level keys the base already has; scalar/array states declare no
 * fields to merge, so the payload is accepted whole only when it is the
 * same kind of value as the base.
 * @param base - the store's state at rehydration time (`init()`'s value).
 * @param parsed - the JSON-parsed persisted payload.
 * @returns the merged state, or `undefined` to reject the payload.
 */
function mergeRehydrated<T>(base: T, parsed: unknown): T | undefined {
  if (isPlainObject(base)) {
    if (!isPlainObject(parsed)) return undefined
    const merged: Record<string, unknown> = { ...base }
    for (const key of Object.keys(base)) {
      if (key in parsed) merged[key] = parsed[key]
    }
    return merged as T
  }
  if (isPlainObject(parsed)) return undefined
  if (Array.isArray(base) !== Array.isArray(parsed)) return undefined
  if (typeof parsed !== typeof base) return undefined
  return parsed as T
}

/** Deep-freeze wholesale-set state outside production: set() bypasses immer's freeze. */
function devFreeze<T>(value: T): T {
  if (process.env.NODE_ENV === 'production') return value
  deepFreeze(value)
  return value
}

function deepFreeze(value: unknown): void {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return
  Object.freeze(value)
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze((value as Record<PropertyKey, unknown>)[key])
  }
}

// ui-slots owns the contract; this module supplies the engine implementation.

/** A live engine instance: the contract instance plus the raw engine store. */
export interface EngineStoreInstance<T, A extends ActionsDecl<T>> extends StoreInstance<T, A> {
  /** The underlying engine store (framework/test API; components never see it). */
  readonly store: SnapshotStore<T>
}

/** The engine-backed handle: create() narrowed to the engine instance. */
export interface EngineStoreHandle<T, A extends ActionsDecl<T>> extends StoreHandle<T, A> {
  /**
   * Construct a live engine instance (see the contract JSDoc on
   * {@link StoreHandle.create} for scopeKey/persist semantics).
   *
   * Known boundary: the persist key is the storage identity, so multiple live
   * instances created under the same resolved key share (and cross-pollute)
   * one localStorage entry. Instance uniqueness per key is the caller's
   * responsibility — production is safe because the framework caches one
   * instance per handle x scope key; tests wanting isolation use distinct
   * scope keys or persist-free declarations (multi-create freedom is a
   * feature there, so create() deliberately does not dedupe or throw).
   * @param scopeKey - session id for session-scope instances; omitted for root scope.
   * @returns the engine instance.
   */
  create(scopeKey?: string): EngineStoreInstance<T, A>
}

/**
 * Declare a store: initial state, optional persistence, and the full write
 * set as pure draft mutators. The returned handle is the registration
 * currency of the store seat — its identity keys instance sharing. Satisfies
 * ui-slots' DefineStore contract (the handle/instance are the engine-extended
 * subtypes).
 *
 * The `A & ActionsDecl<T>` actions position is load-bearing: T resolves from
 * `init` in the first inference round, and the intersection then contextually
 * types each mutator's draft parameter (context-sensitive functions defer),
 * so call sites write `(d, x: X) => { ... }` with no draft annotation. If a
 * future TS version breaks this single-literal inference, the design's
 * documented fallback is currying (`defineStore(init).actions({...})`).
 * @param decl - init lambda (fresh state per instance), optional persist key, actions table.
 * @returns the store handle.
 */
export function defineStore<T, A extends ActionsDecl<T>>(
  decl: StoreSpec<T, A> & { actions: A & ActionsDecl<T> }): EngineStoreHandle<T, A> {
  return {
    spec: decl,
    create(scopeKey?: string): EngineStoreInstance<T, A> {
      const persistKey = decl.persist === undefined
        ? undefined
        : scopeKey === undefined ? decl.persist : `${decl.persist}.${scopeKey}`
      const store = createSnapshotStore<T>(
        decl.init(),
        persistKey !== undefined ? { persist: { name: persistKey } } : undefined)
      const actions = {} as Record<string, (...params: unknown[]) => void>
      for (const key of Object.keys(decl.actions)) {
        const mutate = decl.actions[key] as (draft: T, ...params: unknown[]) => void
        actions[key] = (...params: unknown[]) => { store.update((draft) => { mutate(draft, ...params) }) }
      }
      return {
        actions: actions as BakedActions<T, A>,
        getSnapshot: () => store.getSnapshot(),
        subscribe: fn => store.subscribe(fn),
        store,
        clearPersisted: () => {
          if (persistKey === undefined || typeof localStorage === 'undefined') return
          try {
            localStorage.removeItem(persistKey)
          } catch {
            // Storage failures (private mode, quota teardown races) only skip
            // cleanup — the same non-fatal contract as attachPersistence.
          }
        },
      }
    },
  }
}
