// @vitest-environment jsdom
/** Open document tabs retain selection and close behavior in the header slot. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ScienceClientProjection } from '@deepseek-ai/dsh-science-session/types'
import { ScienceDetailsTabs } from '../src/client/ScienceDetailsTabs.tsx'
import { testScienceSelectionStore } from './selection-store-test-helpers.client.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
function chart(value: { artifactId: string; title: string } = { artifactId: 'chart-1', title: 'Loss' }) {
  return { ...value, logicalName: 'plot.png', version: 1 }
}
function baseProjection(value: { artifacts: ReturnType<typeof chart>[] }) {
  return value as unknown as ScienceClientProjection
}
function tabProps(science: ScienceClientProjection | null | undefined, store: ReturnType<typeof testScienceSelectionStore>) {
  return {
    useProjection: () => science, useStore: store.useStore, actions: store.actions, t: makeTranslate(en),
  } as unknown as Parameters<typeof ScienceDetailsTabs>[0]
}
describe('ScienceDetailsTabs: tab strip', () => {
  function twoTabs() {
    const science = baseProjection({
      artifacts: [chart({ artifactId: 'chart-1', title: 'Alpha' }), chart({ artifactId: 'chart-2', title: 'Beta' })],
    })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 1 })
    store.actions.openTab({ artifactId: 'chart-2' as never, version: 1 })
    return { science, store }
  }

  it('renders one tab per opened artifact, the most recently opened active', () => {
    const { science, store } = twoTabs()
    render(<ScienceDetailsTabs {...tabProps(science, store)} />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map(tab => tab.textContent)).toEqual(['Alpha', 'Beta'])
    expect(screen.getByRole('tab', { name: 'Beta' }).getAttribute('aria-selected')).toBe('true')
  })

  it('clicking an inactive tab activates it', () => {
    const { science, store } = twoTabs()
    render(<ScienceDetailsTabs {...tabProps(science, store)} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Alpha' }))
    expect(store.instance.getSnapshot().activeTabId).toBe('artifact:chart-1')
  })

  it('closing a tab through its own close control removes it; closing the last tab returns to the landing view', () => {
    const { science, store } = twoTabs()
    render(<ScienceDetailsTabs {...tabProps(science, store)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close Alpha' }))
    expect(screen.queryByRole('tab', { name: 'Alpha' })).toBeNull()
    expect(screen.getByRole('tab', { name: 'Beta' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Close Beta' }))
    expect(screen.queryByRole('tablist', { name: 'Open artifacts' })).toBeNull()
    expect(store.instance.getSnapshot().activeTabId).toBeNull()
  })

  it('a stale tab (chart no longer present in the projection) shows its raw id ', () => {
    const science = baseProjection({ artifacts: [chart()] })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'missing-chart' as never, version: 1 })
    render(<ScienceDetailsTabs {...tabProps(science, store)} />)
    expect(screen.getByRole('tab', { name: 'missing-chart' })).toBeTruthy()
  })
})


it.each([null, undefined])('shows file tabs without a science projection (%s)', (science) => {
  const store = testScienceSelectionStore()
  store.actions.openFileTab('results/table.csv')
  render(<ScienceDetailsTabs {...tabProps(science, store)} />)
  expect(screen.getByRole('tab', { name: 'table.csv' })).toBeTruthy()
})
it('shows no strip when no documents are open', () => {
  const view = render(<ScienceDetailsTabs {...tabProps(null, testScienceSelectionStore())} />)
  expect(view.container.firstChild).toBeNull()
})

it.each([undefined, 'Curated title'])('retains project-library tab titles (%s)', (title) => {
  const store = testScienceSelectionStore()
  store.actions.rememberLibraryArtifact({
    artifactId: 'library-chart', logicalName: 'external.png', originSessionId: 'other',
    ...(title === undefined ? {} : { title }),
    latest: { versionId: 'v1', ordinal: 1, mediaType: 'image/png', byteCount: 42, createdAt: 1 },
  })
  store.actions.openTab({ artifactId: 'library-chart' as never, version: 1 })
  render(<ScienceDetailsTabs {...tabProps(null, store)} />)
  expect(screen.getByRole('tab', { name: title ?? 'external.png' })).toBeTruthy()
})
it('keeps a root file path as its label', () => {
  const store = testScienceSelectionStore()
  store.actions.openFileTab('/')
  render(<ScienceDetailsTabs {...tabProps(null, store)} />)
  expect(screen.getByRole('tab', { name: '/' })).toBeTruthy()
})

it('uses the latest nonempty display fallback while keeping the open version fixed', () => {
  const store = testScienceSelectionStore()
  store.actions.openTab({ artifactId: 'chart-1' as never, version: 1 })
  const science = baseProjection({ artifacts: [
    { ...chart(), version: 2, title: '' },
    { ...chart(), version: 1, title: 'Earlier' },
  ] })
  render(<ScienceDetailsTabs {...tabProps(science, store)} />)
  expect(screen.getByRole('tab', { name: 'plot.png' })).toBeTruthy()
})
