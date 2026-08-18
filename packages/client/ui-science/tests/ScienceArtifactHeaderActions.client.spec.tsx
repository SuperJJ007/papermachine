// @vitest-environment jsdom
/**
 * The Details column header controls (`conversation.details.header.actions`,
 * key `science`): both controls absent with no selection, both present once
 * an artifact version is selected, provenance opens the `science.provenance`
 * view tab, and expand writes the shared store's lightboxOpen flag rather
 * than reaching into a sibling component's private state.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { ScienceArtifactHeaderActions, type ScienceArtifactHeaderActionsProps } from '../src/client/ScienceArtifactHeaderActions.tsx'
import { en } from '../src/client/locales.ts'
import { testScienceSelectionStore } from './selection-store-test-helpers.client.ts'

type Props = ScienceArtifactHeaderActionsProps
const t: Props['t'] = makeTranslate(en)

afterEach(cleanup)

function props(over: { openView?: (id: string) => void; store?: ReturnType<typeof testScienceSelectionStore> } = {}): Props {
  const store = over.store ?? testScienceSelectionStore()
  return {
    useStore: store.useStore,
    actions: store.actions,
    openView: over.openView ?? vi.fn(),
    t,
  } as unknown as Props
}

describe('ScienceArtifactHeaderActions', () => {
  it('renders neither control while no artifact is selected', () => {
    const view = render(<ScienceArtifactHeaderActions {...props()} />)
    expect(view.container.innerHTML).toBe('')
  })

  it('renders both controls once an artifact version is selected', () => {
    const store = testScienceSelectionStore()
    store.actions.select({ chartId: 'chart-1' as never, version: 2 })
    render(<ScienceArtifactHeaderActions {...props({ store })} />)
    expect(screen.getByRole('button', { name: 'Provenance' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Expand' })).toBeTruthy()
  })

  it('provenance opens the science.provenance view tab', () => {
    const store = testScienceSelectionStore()
    store.actions.select({ chartId: 'chart-1' as never, version: 2 })
    const openView = vi.fn()
    render(<ScienceArtifactHeaderActions {...props({ store, openView })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Provenance' }))
    expect(openView).toHaveBeenCalledWith('science.provenance')
  })

  it('expand writes the shared store\'s lightboxOpen flag', () => {
    const store = testScienceSelectionStore()
    store.actions.select({ chartId: 'chart-1' as never, version: 2 })
    render(<ScienceArtifactHeaderActions {...props({ store })} />)
    expect(store.instance.getSnapshot().lightboxOpen).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }))
    expect(store.instance.getSnapshot().lightboxOpen).toBe(true)
  })

  it('hides both controls again once the selection clears', () => {
    const store = testScienceSelectionStore()
    store.actions.select({ chartId: 'chart-1' as never, version: 2 })
    const view = render(<ScienceArtifactHeaderActions {...props({ store })} />)
    expect(screen.getByRole('button', { name: 'Provenance' })).toBeTruthy()
    act(() => { store.actions.select(null) })
    expect(view.container.innerHTML).toBe('')
  })
})
