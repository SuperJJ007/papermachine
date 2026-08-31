// @vitest-environment jsdom
/**
 * createLayoutStore unit account: init shape, the action write set (clamp
 * inside actions), and the details-only persistence split (details survives
 * a reload; sidebar/narrow/narrowExpanded do not). Uses the
 * test-sanctioned path: factory self-call + .create() gives the
 * real engine instance (same create path as production).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createLayoutStore } from '@deepseek-ai/dsh-client-ui-layout/src/client/stores.ts'
import {
  DETAILS_MAX, DETAILS_MIN,
  SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN,
} from '@deepseek-ai/dsh-client-ui-layout/src/client/columns.ts'

const PERSIST_KEY = 'dsh.layout.panels.v1'

beforeEach(() => { localStorage.clear() })

describe('createLayoutStore', () => {
  it('initializes the sidebar at its default width, details closed, wide viewport assumed', () => {
    const { store } = createLayoutStore().create()
    expect(store.getSnapshot()).toEqual({ sidebar: SIDEBAR_DEFAULT, details: 0, narrow: false, narrowExpanded: false })
  })

  it('each create() is an independent instance (factory is not a singleton)', () => {
    const a = createLayoutStore().create()
    const b = createLayoutStore().create()
    a.actions.setSidebar(400)
    expect(b.store.getSnapshot().sidebar).toBe(SIDEBAR_DEFAULT)
  })

  it('setSidebar/setDetails clamp into the contract ranges', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setSidebar(1)
    expect(store.getSnapshot().sidebar).toBe(SIDEBAR_MIN)
    actions.setSidebar(9999)
    expect(store.getSnapshot().sidebar).toBe(SIDEBAR_MAX)
    actions.setDetails(1)
    expect(store.getSnapshot().details).toBe(DETAILS_MIN)
    actions.setDetails(9999)
    expect(store.getSnapshot().details).toBe(DETAILS_MAX)
  })

  it('toggleSidebar flips closed <-> contract default (drag width forgotten)', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setSidebar(400)
    actions.toggleSidebar()
    expect(store.getSnapshot().sidebar).toBe(0)
    actions.toggleSidebar()
    expect(store.getSnapshot().sidebar).toBe(SIDEBAR_DEFAULT)
  })

  it('narrow toggleSidebar flips only the re-expand override; the width preference survives', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setSidebar(400)
    actions.setNarrow(true)
    actions.toggleSidebar()
    expect(store.getSnapshot()).toEqual({ sidebar: 400, details: 0, narrow: true, narrowExpanded: true })
    actions.toggleSidebar()
    expect(store.getSnapshot().narrowExpanded).toBe(false)
    expect(store.getSnapshot().sidebar).toBe(400)
  })

  it('crossing the breakpoint drops the override; a same-value setNarrow keeps it', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setNarrow(true)
    actions.toggleSidebar()
    expect(store.getSnapshot().narrowExpanded).toBe(true)
    actions.setNarrow(true)
    expect(store.getSnapshot().narrowExpanded).toBe(true)
    actions.setNarrow(false)
    expect(store.getSnapshot()).toMatchObject({ narrow: false, narrowExpanded: false })
    actions.setNarrow(true)
    expect(store.getSnapshot().narrowExpanded).toBe(false)
  })

  it('openDetails uses the contract default, preserves an open width, and closeDetails zeroes', () => {
    const { store, actions } = createLayoutStore().create()
    actions.openDetails()
    expect(store.getSnapshot().details).toBe('default')
    actions.setDetails(500)
    actions.openDetails()
    expect(store.getSnapshot().details).toBe(500)
    actions.closeDetails()
    expect(store.getSnapshot().details).toBe(0)
  })

  it('persists the details width/open-closed preference across a reload, leaving the sidebar transient', () => {
    const first = createLayoutStore().create()
    first.actions.setSidebar(400)
    first.actions.openDetails()
    first.actions.setDetails(500)
    expect(localStorage.getItem(PERSIST_KEY)).not.toBeNull()

    // A fresh create() is the store's own model of "after a reload": rehydration
    // merges the storage payload's own keys over init() (client/runtime's
    // attachPersistence), so details survives while sidebar restarts at its default.
    const second = createLayoutStore().create()
    expect(second.store.getSnapshot()).toEqual({
      sidebar: SIDEBAR_DEFAULT,
      details: 500,
      narrow: false,
      narrowExpanded: false,
    })
  })

  it('never writes narrow/narrowExpanded to storage even while set', () => {
    const { actions } = createLayoutStore().create()
    actions.setNarrow(true)
    actions.toggleSidebar() // sets narrowExpanded: true
    const stored: unknown = JSON.parse(localStorage.getItem(PERSIST_KEY) ?? '{}')
    expect(stored).not.toHaveProperty('narrow')
    expect(stored).not.toHaveProperty('narrowExpanded')
    expect(stored).not.toHaveProperty('sidebar')
  })

  it('ignores a narrow/narrowExpanded value in a stored payload on rehydration (transient fields never read back)', () => {
    // A payload could only carry these keys if a future build regressed the
    // transient declaration, or a hand-edited/forged localStorage entry —
    // exercise the read-side guarantee regardless of how it got there.
    localStorage.setItem(PERSIST_KEY, JSON.stringify({ details: 500, narrow: true, narrowExpanded: true, sidebar: 999 }))
    const { store } = createLayoutStore().create()
    expect(store.getSnapshot()).toEqual({ sidebar: SIDEBAR_DEFAULT, details: 500, narrow: false, narrowExpanded: false })
  })

  it('rehydrates a legacy payload missing fields added since it was written, without throwing', () => {
    // Simulates a payload written before `details` existed in this store (or
    // before persistence existed at all): only an unrelated key survives.
    localStorage.setItem(PERSIST_KEY, JSON.stringify({ unrelatedLegacyField: true }))
    expect(() => createLayoutStore().create()).not.toThrow()
    const { store } = createLayoutStore().create()
    expect(store.getSnapshot()).toEqual({ sidebar: SIDEBAR_DEFAULT, details: 0, narrow: false, narrowExpanded: false })
  })
})
