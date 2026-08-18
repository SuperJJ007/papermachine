// The open-tabs selection store: opening a new tab, re-opening an already-open
// tab at a different version, activating/closing tabs (including the
// browser-tab-convention neighbor fallback and the empty-ledger landing
// case), stepping a tab's version, and the view/provenance-sub-tab/lightbox
// fields' own transitions — including the ones a no-op guards against
// (activating or stepping a tab id that isn't open).
import { describe, expect, it } from 'vitest'
import { createScienceSelectionStore } from '../src/client/selection-store.ts'
import type { ScienceChartId } from '@deepseek-ai/dsh-science-session/types'

const A = 'chart-a' as ScienceChartId
const B = 'chart-b' as ScienceChartId
const C = 'chart-c' as ScienceChartId

function store() {
  return createScienceSelectionStore().create()
}

describe('selection-store: openTab', () => {
  it('opens a new tab, activates it, switches to content, and closes the lightbox', () => {
    const s = store()
    s.actions.setLightboxOpen(true)
    s.actions.openTab({ chartId: A, version: 1 })
    expect(s.getSnapshot()).toMatchObject({
      openArtifacts: [{ chartId: A, version: 1 }], activeChartId: A, view: 'content', lightboxOpen: false,
    })
  })

  it('re-opening an already-open chart updates its version in place rather than adding a second tab', () => {
    const s = store()
    s.actions.openTab({ chartId: A, version: 1 })
    s.actions.openTab({ chartId: B, version: 1 })
    s.actions.openTab({ chartId: A, version: 2 })
    expect(s.getSnapshot().openArtifacts).toEqual([{ chartId: A, version: 2 }, { chartId: B, version: 1 }])
    expect(s.getSnapshot().activeChartId).toBe(A)
  })

  it('opening a tab while viewing another tab\'s provenance drill-in returns to content', () => {
    const s = store()
    s.actions.openTab({ chartId: A, version: 1 })
    s.actions.setView('provenance')
    s.actions.openTab({ chartId: B, version: 1 })
    expect(s.getSnapshot().view).toBe('content')
    expect(s.getSnapshot().activeChartId).toBe(B)
  })
})

describe('selection-store: activateTab', () => {
  it('activates an already-open tab and returns its view to content', () => {
    const s = store()
    s.actions.openTab({ chartId: A, version: 1 })
    s.actions.openTab({ chartId: B, version: 1 })
    s.actions.setView('provenance')
    s.actions.setLightboxOpen(true)
    s.actions.activateTab(A)
    expect(s.getSnapshot()).toMatchObject({ activeChartId: A, view: 'content', lightboxOpen: false })
  })

  it('activating a chart id that is not open is a no-op', () => {
    const s = store()
    s.actions.openTab({ chartId: A, version: 1 })
    s.actions.activateTab(C)
    expect(s.getSnapshot().activeChartId).toBe(A)
  })
})

describe('selection-store: closeTab', () => {
  it('closing a tab that is not open is a no-op', () => {
    const s = store()
    s.actions.openTab({ chartId: A, version: 1 })
    s.actions.closeTab(C)
    expect(s.getSnapshot().openArtifacts).toEqual([{ chartId: A, version: 1 }])
  })

  it('closing an inactive tab removes it without disturbing the active tab', () => {
    const s = store()
    s.actions.openTab({ chartId: A, version: 1 })
    s.actions.openTab({ chartId: B, version: 1 })
    s.actions.activateTab(A)
    s.actions.closeTab(B)
    expect(s.getSnapshot().openArtifacts).toEqual([{ chartId: A, version: 1 }])
    expect(s.getSnapshot().activeChartId).toBe(A)
  })

  it('closing the active tab activates the tab that now sits at its position', () => {
    const s = store()
    s.actions.openTab({ chartId: A, version: 1 })
    s.actions.openTab({ chartId: B, version: 1 })
    s.actions.openTab({ chartId: C, version: 1 })
    s.actions.activateTab(B)
    s.actions.closeTab(B)
    expect(s.getSnapshot().openArtifacts).toEqual([{ chartId: A, version: 1 }, { chartId: C, version: 1 }])
    expect(s.getSnapshot().activeChartId).toBe(C)
  })

  it('closing the last (active) tab activates the one before it', () => {
    const s = store()
    s.actions.openTab({ chartId: A, version: 1 })
    s.actions.openTab({ chartId: B, version: 1 })
    s.actions.closeTab(B)
    expect(s.getSnapshot().activeChartId).toBe(A)
  })

  it('closing the only open tab falls back to the landing view (activeChartId null)', () => {
    const s = store()
    s.actions.openTab({ chartId: A, version: 1 })
    s.actions.setView('provenance')
    s.actions.closeTab(A)
    expect(s.getSnapshot()).toMatchObject({ openArtifacts: [], activeChartId: null, view: 'content' })
  })
})

describe('selection-store: setTabVersion', () => {
  it('steps an open tab to a different version and closes the lightbox', () => {
    const s = store()
    s.actions.openTab({ chartId: A, version: 1 })
    s.actions.setLightboxOpen(true)
    s.actions.setTabVersion({ chartId: A, version: 2 })
    expect(s.getSnapshot().openArtifacts).toEqual([{ chartId: A, version: 2 }])
    expect(s.getSnapshot().lightboxOpen).toBe(false)
  })

  it('stepping a chart id that is not open is a no-op', () => {
    const s = store()
    s.actions.openTab({ chartId: A, version: 1 })
    s.actions.setTabVersion({ chartId: B, version: 2 })
    expect(s.getSnapshot().openArtifacts).toEqual([{ chartId: A, version: 1 }])
  })
})

describe('selection-store: view, provenance sub-tab, and lightbox', () => {
  it('switching to provenance closes the lightbox; switching to content does not touch it', () => {
    const s = store()
    s.actions.setLightboxOpen(true)
    s.actions.setView('provenance')
    expect(s.getSnapshot().lightboxOpen).toBe(false)
    s.actions.setLightboxOpen(true)
    s.actions.setView('content')
    expect(s.getSnapshot().lightboxOpen).toBe(true)
  })

  it('the provenance sub-tab is a sticky preference independent of the active tab', () => {
    const s = store()
    expect(s.getSnapshot().provenanceSubTab).toBe('code')
    s.actions.setProvenanceSubTab('environment')
    expect(s.getSnapshot().provenanceSubTab).toBe('environment')
    s.actions.openTab({ chartId: A, version: 1 })
    expect(s.getSnapshot().provenanceSubTab).toBe('environment')
  })

  it('setLightboxOpen writes the flag directly', () => {
    const s = store()
    s.actions.setLightboxOpen(true)
    expect(s.getSnapshot().lightboxOpen).toBe(true)
    s.actions.setLightboxOpen(false)
    expect(s.getSnapshot().lightboxOpen).toBe(false)
  })
})
