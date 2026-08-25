import { describe, expect, it } from 'vitest'
import type { ScienceArtifactId } from '@deepseek-ai/dsh-science-session/types'
import { createScienceSelectionStore } from '../src/client/selection-store.ts'

const A = 'chart-a' as ScienceArtifactId
const B = 'chart-b' as ScienceArtifactId
const C = 'chart-c' as ScienceArtifactId
const store = () => createScienceSelectionStore().create()

describe('selection-store', () => {
  it('keeps one tab per logical artifact and updates its selected version', () => {
    const subject = store()
    subject.actions.openTab({ artifactId: A, version: 1 })
    subject.actions.openTab({ artifactId: B, version: 1 })
    subject.actions.openTab({ artifactId: A, version: 2 })
    expect(subject.getSnapshot()).toMatchObject({
      openArtifacts: [{ artifactId: A, version: 2 }, { artifactId: B, version: 1 }],
      activeArtifactId: A,
      lightboxOpen: false,
    })
  })

  it('shows the library without closing tabs and closes the lightbox', () => {
    const subject = store()
    subject.actions.openTab({ artifactId: A, version: 1 })
    subject.actions.setLightboxOpen(true)
    subject.actions.showLibrary()
    expect(subject.getSnapshot()).toMatchObject({ activeArtifactId: null, lightboxOpen: false })
    expect(subject.getSnapshot().openArtifacts).toHaveLength(1)
  })

  it('activates only open tabs', () => {
    const subject = store()
    subject.actions.openTab({ artifactId: A, version: 1 })
    subject.actions.activateTab(C)
    expect(subject.getSnapshot().activeArtifactId).toBe(A)
  })

  it('chooses the neighboring tab after closing the active tab', () => {
    const subject = store()
    subject.actions.openTab({ artifactId: A, version: 1 })
    subject.actions.openTab({ artifactId: B, version: 1 })
    subject.actions.openTab({ artifactId: C, version: 1 })
    subject.actions.activateTab(B)
    subject.actions.closeTab(B)
    expect(subject.getSnapshot()).toMatchObject({ activeArtifactId: C })
    subject.actions.closeTab(C)
    expect(subject.getSnapshot()).toMatchObject({ activeArtifactId: A })
    subject.actions.closeTab(A)
    expect(subject.getSnapshot()).toMatchObject({ activeArtifactId: null, openArtifacts: [] })
  })

  it('leaves the ledger and active tab untouched when closing an artifact id that is not open', () => {
    const subject = store()
    subject.actions.openTab({ artifactId: A, version: 1 })
    subject.actions.closeTab(C)
    expect(subject.getSnapshot()).toMatchObject({
      openArtifacts: [{ artifactId: A, version: 1 }], activeArtifactId: A,
    })
  })

  it('steps only an open tab and closes the lightbox', () => {
    const subject = store()
    subject.actions.openTab({ artifactId: A, version: 1 })
    subject.actions.setLightboxOpen(true)
    subject.actions.setTabVersion({ artifactId: A, version: 2 })
    subject.actions.setTabVersion({ artifactId: B, version: 3 })
    expect(subject.getSnapshot()).toMatchObject({
      openArtifacts: [{ artifactId: A, version: 2 }], lightboxOpen: false,
    })
  })
})
