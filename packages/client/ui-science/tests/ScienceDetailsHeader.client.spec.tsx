// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { ScienceDetailsHeader, type ScienceDetailsHeaderProps } from '../src/client/ScienceDetailsHeader.tsx'
import { en } from '../src/client/locales.ts'
import { testScienceSelectionStore } from './selection-store-test-helpers.client.ts'

afterEach(cleanup)

describe('ScienceDetailsHeader', () => {
  it('selects a top-level library page, preserves open tabs, and returns from an active document', () => {
    const store = testScienceSelectionStore()
    store.actions.openFileTab('data/results.csv')
    render(<ScienceDetailsHeader {...({
      useStore: store.useStore, actions: store.actions, t: makeTranslate(en),
    } as ScienceDetailsHeaderProps)} />)

    expect(screen.getByRole('tab', { name: 'Artifacts' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('tab', { name: 'Project files' }))
    expect(screen.getByRole('tab', { name: 'Project files' }).getAttribute('aria-selected')).toBe('true')
    expect(store.instance.getSnapshot()).toMatchObject({
      openArtifacts: [{ kind: 'file', path: 'data/results.csv' }], activeTabId: null, libraryPage: 'files',
    })
    fireEvent.click(screen.getByRole('tab', { name: 'Artifacts' }))
    expect(store.instance.getSnapshot()).toMatchObject({ activeTabId: null, libraryPage: 'artifacts' })
  })
})
