import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore, defineStore, shallowEqual } from '../src/client/contract/store.ts'

interface State {
  a: { n: number }
  b: { list: string[] }
}

const init = (): State => ({ a: { n: 1 }, b: { list: ['x'] } })

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Stubs a `localStorage` backed by an in-memory map and returns it for direct inspection. */
function stubStorage(): Map<string, string> {
  const backing = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => { backing.set(k, v) },
    removeItem: (k: string) => { backing.delete(k) },
  })
  return backing
}

describe('createSnapshotStore', () => {
  it('applies update through a draft and preserves untouched branch references', () => {
    const store = createSnapshotStore(init())
    const before = store.getSnapshot()
    store.update((d) => { d.a.n = 2 })
    const after = store.getSnapshot()
    expect(after).not.toBe(before)
    expect(after.a.n).toBe(2)
    expect(after.b).toBe(before.b)
  })

  it('notifies synchronously per update by default', () => {
    const store = createSnapshotStore(init())
    const seen: number[] = []
    store.subscribe(() => { seen.push(store.getSnapshot().a.n) })
    store.update((d) => { d.a.n = 2 })
    store.update((d) => { d.a.n = 3 })
    expect(seen).toEqual([2, 3])
  })

  it('coalesces a frame of updates into one notification in raf mode', () => {
    const frame: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frame.push(cb)
      return frame.length
    })
    const store = createSnapshotStore(init(), { flush: 'raf' })
    const spy = vi.fn()
    store.subscribe(spy)
    store.update((d) => { d.a.n = 2 })
    store.update((d) => { d.a.n = 3 })
    store.update((d) => { d.b.list.push('y') })
    expect(spy).not.toHaveBeenCalled()
    expect(frame).toHaveLength(1)
    frame.shift()!(0)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot().a.n).toBe(3)
    // Next frame batches independently.
    store.update((d) => { d.a.n = 4 })
    expect(frame).toHaveLength(1)
    frame.shift()!(0)
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('falls back to microtask batching in raf mode without requestAnimationFrame', async () => {
    const store = createSnapshotStore(init(), { flush: 'raf' })
    const spy = vi.fn()
    store.subscribe(spy)
    store.update((d) => { d.a.n = 2 })
    store.update((d) => { d.a.n = 3 })
    expect(spy).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('unsubscribes raf-mode listeners', () => {
    const frame: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frame.push(cb)
      return frame.length
    })
    const store = createSnapshotStore(init(), { flush: 'raf' })
    const spy = vi.fn()
    const off = store.subscribe(spy)
    store.update((d) => { d.a.n = 2 })
    off()
    frame.shift()!(0)
    expect(spy).not.toHaveBeenCalled()
  })

  it('replaces state wholesale via set and freezes it outside production', () => {
    const store = createSnapshotStore(init())
    const next = init()
    store.set(next)
    expect(store.getSnapshot()).toBe(next)
    expect(() => { (store.getSnapshot().a).n = 9 }).toThrow()
  })

  it('freezes update produce output outside production (immer dev freeze)', () => {
    const store = createSnapshotStore(init())
    store.update((d) => { d.a.n = 2 })
    expect(() => { (store.getSnapshot().a).n = 9 }).toThrow()
  })

  it('rehydrates primitive state whole, not spread into index keys', () => {
    const backing = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => { backing.set(k, v) },
      removeItem: (k: string) => { backing.delete(k) },
    })
    const store = createSnapshotStore<string>('', { persist: { name: 'spec-draft' } })
    store.set('hello')
    const revived = createSnapshotStore<string>('', { persist: { name: 'spec-draft' } })
    expect(revived.getSnapshot()).toBe('hello')
  })

  it('discards a scalar payload of a different kind than the base and keeps init()', () => {
    const backing = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => { backing.set(k, v) },
      removeItem: (k: string) => { backing.delete(k) },
    })
    backing.set('spec-kind-mismatch', JSON.stringify(42))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const revived = createSnapshotStore<string>('fallback', { persist: { name: 'spec-kind-mismatch' } })
    expect(revived.getSnapshot()).toBe('fallback')
    expect(spy).toHaveBeenCalledOnce()
    spy.mockRestore()
  })

  it('persists to localStorage under the given name and rehydrates', () => {
    const backing = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => { backing.set(k, v) },
      removeItem: (k: string) => { backing.delete(k) },
    })
    const store = createSnapshotStore(init(), { persist: { name: 'spec-store' } })
    store.update((d) => { d.a.n = 42 })
    expect(backing.has('spec-store')).toBe(true)
    const revived = createSnapshotStore(init(), { persist: { name: 'spec-store' } })
    expect(revived.getSnapshot().a.n).toBe(42)
  })

  describe('rehydration merge', () => {
    it('keeps init() value for a field absent from the persisted payload', () => {
      const backing = stubStorage()
      backing.set('spec-partial', JSON.stringify({ a: { n: 9 } }))
      const revived = createSnapshotStore(init(), { persist: { name: 'spec-partial' } })
      expect(revived.getSnapshot()).toEqual({ a: { n: 9 }, b: { list: ['x'] } })
    })

    it('drops a payload field the base does not declare', () => {
      const backing = stubStorage()
      backing.set('spec-extra', JSON.stringify({ a: { n: 9 }, b: { list: [] }, ghost: true }))
      const revived = createSnapshotStore(init(), { persist: { name: 'spec-extra' } })
      expect(revived.getSnapshot()).toEqual({ a: { n: 9 }, b: { list: [] } })
      expect('ghost' in revived.getSnapshot()).toBe(false)
    })

    it('discards a non-object payload and keeps init()', () => {
      const backing = stubStorage()
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      for (const malformed of ['null', '[1,2]', '"oops"', '42']) {
        backing.set('spec-malformed', malformed)
        const revived = createSnapshotStore(init(), { persist: { name: 'spec-malformed' } })
        expect(revived.getSnapshot()).toEqual(init())
      }
      expect(spy).toHaveBeenCalledTimes(4)
      spy.mockRestore()
    })

    it('keeps init() when no payload is stored', () => {
      stubStorage()
      const revived = createSnapshotStore(init(), { persist: { name: 'spec-absent' } })
      expect(revived.getSnapshot()).toEqual(init())
    })
  })

  describe('transient fields', () => {
    it('omits a transient field from what is written to storage', () => {
      const backing = stubStorage()
      const store = createSnapshotStore(init(), { persist: { name: 'spec-transient', transient: ['a'] } })
      store.update((d) => { d.a.n = 2; d.b.list.push('y') })
      expect(JSON.parse(backing.get('spec-transient')!)).toEqual({ b: { list: ['x', 'y'] } })
    })

    it('ignores a stored value for a transient field on read', () => {
      const backing = stubStorage()
      backing.set('spec-transient-read', JSON.stringify({ a: { n: 999 }, b: { list: ['stored'] } }))
      const revived = createSnapshotStore(init(), { persist: { name: 'spec-transient-read', transient: ['a'] } })
      expect(revived.getSnapshot()).toEqual({ a: { n: 1 }, b: { list: ['stored'] } })
    })
  })
})

describe('defineStore', () => {
  const declare = () => defineStore({
    init: () => ({ selection: null as string | null, draft: '' }),
    actions: {
      select: (d, target: string) => { d.selection = target },
      setDraft: (d, text: string) => { d.draft = text },
      clearDraft: (d) => { d.draft = '' },
    },
  })

  it('create() yields a live instance: fresh init state, selector-visible action writes', () => {
    const inst = declare().create()
    expect(inst.store.getSnapshot()).toEqual({ selection: null, draft: '' })
    inst.actions.setDraft('hello')
    inst.actions.select('m1')
    expect(inst.store.getSnapshot()).toEqual({ selection: 'm1', draft: 'hello' })
    inst.actions.clearDraft()
    expect(inst.store.getSnapshot().draft).toBe('')
  })

  it('bakes draft-stripped actions that write through update (draft mutation, not replacement)', () => {
    const inst = declare().create()
    const before = inst.store.getSnapshot()
    inst.actions.setDraft('x')
    const after = inst.store.getSnapshot()
    expect(after).not.toBe(before)
    expect(after.selection).toBe(before.selection)   // untouched branch preserved (immer path)
  })

  it('creates independent instances per create() call (the handle is a spec, not a singleton)', () => {
    const handle = declare()
    const a = handle.create()
    const b = handle.create()
    a.actions.setDraft('only-a')
    expect(b.store.getSnapshot().draft).toBe('')
  })

  it('suffixes the persist key with the scope key: per-session persistence plus clearPersisted cleanup', () => {
    const backing = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => { backing.set(k, v) },
      removeItem: (k: string) => { backing.delete(k) },
    })
    const handle = defineStore({
      init: () => ({ draft: '' }),
      persist: 'spec.chat',
      actions: { setDraft: (d, text: string) => { d.draft = text } },
    })
    handle.create('s1').actions.setDraft('one')
    handle.create('s2').actions.setDraft('two')
    handle.create().actions.setDraft('root')
    expect(JSON.parse(backing.get('spec.chat.s1')!)).toEqual({ draft: 'one' })
    expect(JSON.parse(backing.get('spec.chat.s2')!)).toEqual({ draft: 'two' })
    expect(JSON.parse(backing.get('spec.chat')!)).toEqual({ draft: 'root' })
    // Rehydration honors the same suffixed key.
    expect(handle.create('s1').store.getSnapshot().draft).toBe('one')
    // Scope-death cleanup removes exactly the suffixed key.
    handle.create('s1').clearPersisted()
    expect(backing.has('spec.chat.s1')).toBe(false)
    expect(backing.has('spec.chat.s2')).toBe(true)
    expect(backing.has('spec.chat')).toBe(true)
  })

  it('clearPersisted is a no-op without a persist declaration or without storage', () => {
    const inst = declare().create('s1')   // no persist key declared
    expect(() => { inst.clearPersisted() }).not.toThrow()
    const persisting = defineStore({
      init: () => ({ n: 0 }),
      persist: 'spec.nostorage',
      actions: { inc: (d) => { d.n += 1 } },
    }).create()
    // jsdom-less lane: localStorage may exist here, so simulate its absence.
    vi.stubGlobal('localStorage', undefined)
    expect(() => { persisting.clearPersisted() }).not.toThrow()
  })

  it('excludes declared transient fields from what is written and read', () => {
    const backing = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => { backing.set(k, v) },
      removeItem: (k: string) => { backing.delete(k) },
    })
    const handle = defineStore({
      init: () => ({ draft: '', open: false }),
      persist: 'spec.transient-decl',
      transient: ['open'],
      actions: {
        setDraft: (d, text: string) => { d.draft = text },
        setOpen: (d, open: boolean) => { d.open = open },
      },
    })
    handle.create().actions.setOpen(true)
    expect(JSON.parse(backing.get('spec.transient-decl')!)).toEqual({ draft: '' })
    expect(handle.create().store.getSnapshot().open).toBe(false)
  })

  it('swallows storage failures in clearPersisted (same non-fatal contract as persistence)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => { throw new Error('quota / private mode') },
    })
    const inst = defineStore({
      init: () => ({ n: 0 }),
      persist: 'spec.throwing',
      actions: { inc: (d) => { d.n += 1 } },
    }).create()
    expect(() => { inst.clearPersisted() }).not.toThrow()
  })
})

describe('shallowEqual', () => {
  it('matches one-level-equal objects and rejects deeper drift', () => {
    const leaf = { deep: 1 }
    expect(shallowEqual({ x: 1, y: leaf }, { x: 1, y: leaf })).toBe(true)
    expect(shallowEqual({ x: 1, y: { deep: 1 } }, { x: 1, y: { deep: 1 } })).toBe(false)
    expect(shallowEqual([1, 2], [1, 2])).toBe(true)
    expect(shallowEqual([1, 2], [2, 1])).toBe(false)
  })
})
