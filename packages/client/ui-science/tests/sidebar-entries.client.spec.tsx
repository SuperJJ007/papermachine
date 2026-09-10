// @vitest-environment jsdom
/** Native Sidebar title and content-menu behavior replaces the private Details chrome. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { ScienceArtifactMenu, ScienceArtifactTitle, ScienceLibraryFooter } from '../src/client/sidebar-entries.tsx'
import { en } from '../src/client/locales.ts'
import { testScienceSelectionStore } from './selection-store-test-helpers.client.ts'
import { baseProjection, rawArtifact, SESSION } from './science-details-view-fixtures.client.ts'

afterEach(cleanup)
const t = makeTranslate(en)

describe('Science Sidebar contributions', () => {
  it('labels each tab by its address even while another artifact is active', () => {
    const store = testScienceSelectionStore()
    const science = baseProjection({ artifacts: [rawArtifact(), rawArtifact({ artifactId: 'other', title: 'Another result' })] })
    store.actions.openTab({ artifactId: rawArtifact({ artifactId: 'other' }).artifactId, version: 1 })
    const props = {
      useTabInfo: () => ({ tab: { contentId: 'dsh-resource://science-artifact/chart-1' } }),
      useProjection: () => science,
      loadLibrary: async () => ({ ok: true, value: { artifacts: [] } }),
    } as unknown as Parameters<typeof ScienceArtifactTitle>[0]
    render(<ScienceArtifactTitle {...props} />)
    expect(screen.getByText('Loss curve')).toBeTruthy()
    expect(screen.queryByText('Another result')).toBeNull()
  })

  it('dismisses the native menu after opening the artifact library', () => {
    const openLibrary = vi.fn()
    const dismiss = vi.fn()
    const props = { tab: { kind: 'science-artifact' }, openLibrary, dismiss, t } as Parameters<typeof ScienceArtifactMenu>[0]
    render(<ScienceArtifactMenu {...props} />)
    fireEvent.click(screen.getByRole('menuitem', { name: t('library.home') }))
    expect(openLibrary).toHaveBeenCalledTimes(1)
    expect(dismiss).toHaveBeenCalledTimes(1)
  })

  it('does not add artifact actions to unrelated tab kinds', () => {
    const props = { tab: { kind: 'files' }, openLibrary: vi.fn(), dismiss: vi.fn(), t } as Parameters<typeof ScienceArtifactMenu>[0]
    render(<ScienceArtifactMenu {...props} />)
    expect(screen.queryByRole('menuitem')).toBeNull()
  })
})


describe('Science blank-session library entry', () => {
  it('opens the library for a selected blank session', () => {
    const openLibrary = vi.fn()
    const props = {
      useSessions: (select: (state: { current: typeof SESSION }) => unknown) => select({ current: SESSION }), openLibrary, t,
    } as unknown as Parameters<typeof ScienceLibraryFooter>[0]
    render(<ScienceLibraryFooter {...props} />)
    fireEvent.click(screen.getByRole('button', { name: t('library.home') }))
    expect(openLibrary).toHaveBeenCalledWith(SESSION)
  })

  it('hides the action when no session exists', () => {
    const props = {
      useSessions: (select: (state: { current: undefined }) => unknown) => select({ current: undefined }), openLibrary: vi.fn(), t,
    } as unknown as Parameters<typeof ScienceLibraryFooter>[0]
    render(<ScienceLibraryFooter {...props} />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
