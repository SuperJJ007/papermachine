// @vitest-environment jsdom
/** Native Sidebar title and content-menu behavior replaces the private Details chrome. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { ScienceArtifactMenu, ScienceArtifactTitle } from '../src/client/sidebar-entries.tsx'
import { en } from '../src/client/locales.ts'
import { testScienceSelectionStore } from './selection-store-test-helpers.client.ts'
import { baseProjection, libraryArtifact, rawArtifact } from './science-details-view-fixtures.client.ts'

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

it('falls back to the resource id and logical name without replacing a new title with a stale read', async () => {
  type Result = Awaited<ReturnType<Parameters<typeof ScienceArtifactTitle>[0]['loadLibrary']>>
  let resolve!: (result: Result) => void
  const pending = new Promise<Result>((accept) => { resolve = accept })
  const input = {
    useTabInfo: () => ({ tab: { contentId: 'dsh-resource://science-artifact/chart-1' } }),
    useProjection: () => null,
    loadLibrary: vi.fn().mockReturnValueOnce(pending),
  } as unknown as Parameters<typeof ScienceArtifactTitle>[0]
  const view = render(<ScienceArtifactTitle {...input} />)
  expect(screen.getByText('chart-1')).toBeTruthy()
  const loadLibrary = vi.fn().mockResolvedValue({ ok: true, value: { artifacts: [libraryArtifact({ title: undefined, logicalName: 'result.csv' })] } })
  view.rerender(<ScienceArtifactTitle {...input} loadLibrary={loadLibrary} />)
  expect(await screen.findByText('result.csv')).toBeTruthy()
  await act(async () => { resolve({ ok: true, value: { projectId: 'p', artifacts: [libraryArtifact({ title: 'Stale title' })] } }); await pending })
  expect(screen.queryByText('Stale title')).toBeNull()
  expect(screen.getByText('result.csv')).toBeTruthy()
})
