// @vitest-environment jsdom
/**
 * The chart-edit panel, wired through the full `ScienceDetailsView` →
 * `ArtifactViewer` → `ArtifactTab` → `ArtifactContent` path: mounts only when
 * the injected `loadChartState` (`sessions.scienceChartState`) resolves a
 * non-null chart for the open live tab, element references into the shared
 * composer selections, `Save` committing through `applyChartOps` and
 * stepping the tab to the returned version, the B4 auto-step-to-newer-version
 * behavior and its pending-edit guard, and the debounced live preview through
 * `previewChartOps`. `ArtifactContent.client.spec.tsx` covers the panel's own
 * mount/unmount contract directly; this file proves `ScienceDetailsView`
 * wires the real per-session loaders and mutations to it correctly.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ScienceChartState } from '@deepseek-ai/dsh-science-session/types'
import { ScienceDetailsView } from '../src/client/ScienceDetailsView.tsx'
import { testScienceSelectionStore } from './selection-store-test-helpers.client.ts'
import { baseProjection, openTab, props, rawArtifact, versionSummary } from './science-details-view-fixtures.client.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function chartState(over: Partial<ScienceChartState> = {}): ScienceChartState {
  return {
    runtime: 'matplotlib', figureKey: 'fig', png: { width: 200, height: 100, dpi: 150 },
    elements: [{ id: 'title', kind: 'title', axes: null, label: null, current: 'Loss' }],
    ops: [], hitmap: [], hitmapStatus: 'unavailable',
    ...over,
  }
}

function withOpenTab(version = 2) {
  const store = testScienceSelectionStore()
  openTab(store, 'chart-1', version)
  const science = baseProjection({ artifacts: [rawArtifact({ version, versionId: `version:${String(version)}` })] })
  const summaries = [versionSummary({ ordinal: version, versionId: `version:${String(version)}` })]
  return { store, science, summaries }
}

describe('ScienceDetailsView: chart-edit panel mount (via loadChartState)', () => {
  it('has no edit panel, keeping region-select only, when loadChartState resolves null', async () => {
    const { store, science, summaries } = withOpenTab()
    render(<ScienceDetailsView {...props(science, { store, summaries })} />)
    await waitFor(() => { expect(document.querySelector('img')).not.toBeNull() })
    expect(screen.queryByRole('button', { name: 'Commit as new version' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Select region to edit' })).toBeTruthy()
  })

  it('mounts the element list alongside region selection when loadChartState resolves a chart', async () => {
    const { store, science, summaries } = withOpenTab()
    const loadChartState = vi.fn().mockResolvedValue(chartState())
    render(<ScienceDetailsView {...props(science, { store, summaries, loadChartState })} />)
    await waitFor(() => { expect(document.querySelector('img')).not.toBeNull() })
    expect(loadChartState).toHaveBeenCalledWith(expect.objectContaining({ versionId: 'version:2' }))
    expect(screen.getByRole('button', { name: 'Select region to edit' })).toBeTruthy()
    expect(screen.getByLabelText('Enter text')).toBeTruthy()
  })

  it('references an element via +/- into the composer selections, distinct from a region target', async () => {
    const { store, science, summaries } = withOpenTab()
    const loadChartState = vi.fn().mockResolvedValue(chartState())
    const addToConversation = vi.fn()
    render(<ScienceDetailsView {...props(science, { store, summaries, loadChartState, addToConversation })} />)
    await waitFor(() => { expect(document.querySelector('img')).not.toBeNull() })
    fireEvent.click(await screen.findByRole('button', { name: 'Add Title to the conversation' }))
    expect(addToConversation).toHaveBeenCalledWith([{
      artifactId: 'chart-1', logicalName: 'loss-curve.png', version: 2,
      target: { kind: 'element', elementId: 'title', elementKind: 'title', axes: null, label: null, current: 'Loss' },
    }])
  })
})

describe('ScienceDetailsView: chart-edit Save (applyChartOps)', () => {
  it('submits pending ops for the exact artifact/version and steps the tab to the committed version', async () => {
    const { store, science, summaries } = withOpenTab()
    const loadChartState = vi.fn().mockResolvedValue(chartState())
    const applyChartOps = vi.fn().mockResolvedValue({ ok: true, value: { artifactId: 'chart-1', version: 3, origin: 'human-edit', failedOps: [] } })
    render(<ScienceDetailsView {...props(science, { store, summaries, loadChartState, applyChartOps })} />)
    await waitFor(() => { expect(document.querySelector('img')).not.toBeNull() })

    fireEvent.change(screen.getByLabelText('Enter text'), { target: { value: 'New title' } })
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))

    await waitFor(() => { expect(applyChartOps).toHaveBeenCalledWith({ artifactId: 'chart-1', version: 2, ops: [{ op: 'set_title', axes: null, text: 'New title' }] }) })
    await waitFor(() => {
      expect(store.instance.getSnapshot().openArtifacts.find(tab => tab.kind === 'artifact')).toMatchObject({ version: 3 })
    })
  })

  it('reflects the newly committed version\'s real font state after Save, not the pre-edit value (rc.3 5.3)', async () => {
    // Per-version chart state, exactly as the real `scienceChartState` RPC
    // resolves it: v2's font is 12 (the pre-edit baseline the panel loads
    // on mount); v3 (the direct-edit commit's own new version) is 15 — the
    // "current" value a real `apply_chart` replay produces for the font the
    // user actually staged and saved. The session's raw artifact list
    // already carries both versions, matching a session projection that has
    // caught up with the commit by the time this component re-renders (the
    // ordinary case: the commit RPC and the session-log update travel the
    // same connection).
    const store = testScienceSelectionStore()
    openTab(store, 'chart-1', 2)
    const science = baseProjection({ artifacts: [
      rawArtifact({ version: 2, versionId: 'version:2' }),
      rawArtifact({ version: 3, versionId: 'version:3' }),
    ] })
    const summaries = [
      versionSummary({ ordinal: 2, versionId: 'version:2' }),
      versionSummary({ ordinal: 3, versionId: 'version:3' }),
    ]
    const chartStates: Record<string, ScienceChartState> = {
      'version:2': chartState({ elements: [
        { id: 'font', kind: 'font', axes: null, label: null, current: { family: ['sans-serif'], size: 12 } },
      ] }),
      'version:3': chartState({ elements: [
        { id: 'font', kind: 'font', axes: null, label: null, current: { family: ['sans-serif'], size: 15 } },
      ] }),
    }
    const loadChartState = vi.fn((content: { versionId: string }) => Promise.resolve(chartStates[content.versionId] ?? null))
    const applyChartOps = vi.fn().mockResolvedValue({ ok: true, value: { artifactId: 'chart-1', version: 3, origin: 'human-edit', failedOps: [] } })
    render(<ScienceDetailsView {...props(science, { store, summaries, loadChartState, applyChartOps })} />)
    await waitFor(() => { expect(document.querySelector('img')).not.toBeNull() })
    expect(await screen.findByLabelText('Font size')).toHaveProperty('valueAsNumber', 12)

    fireEvent.change(screen.getByLabelText('Font size'), { target: { value: '15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))

    await waitFor(() => {
      expect(store.instance.getSnapshot().openArtifacts.find(tab => tab.kind === 'artifact')).toMatchObject({ version: 3 })
    })
    await waitFor(() => { expect(loadChartState).toHaveBeenCalledWith(expect.objectContaining({ versionId: 'version:3' })) })
    await waitFor(() => { expect(screen.getByLabelText('Font size')).toHaveProperty('valueAsNumber', 15) })
  })

  it('leaves the tab on its current version and surfaces the rejection when applyChartOps rejects', async () => {
    const { store, science, summaries } = withOpenTab()
    const loadChartState = vi.fn().mockResolvedValue(chartState())
    const applyChartOps = vi.fn().mockResolvedValue({ ok: false, error: { message: 'stale version' } })
    render(<ScienceDetailsView {...props(science, { store, summaries, loadChartState, applyChartOps })} />)
    await waitFor(() => { expect(document.querySelector('img')).not.toBeNull() })

    fireEvent.change(screen.getByLabelText('Enter text'), { target: { value: 'New title' } })
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))

    expect(await screen.findByText('Commit failed: stale version')).toBeTruthy()
    expect(store.instance.getSnapshot().openArtifacts.find(tab => tab.kind === 'artifact')).toMatchObject({ version: 2 })
  })
})

describe('ScienceDetailsView: B4 auto-step to a newer committed version', () => {
  it('auto-steps the open tab to a newer version with no pending direct edit', async () => {
    const { store, science } = withOpenTab(1)
    const view = render(<ScienceDetailsView {...props(science, { store, summaries: [versionSummary({ ordinal: 1, versionId: 'version:1' })] })} />)
    await waitFor(() => { expect(document.querySelector('img')).not.toBeNull() })

    const nextScience = baseProjection({ artifacts: [
      rawArtifact({ version: 1, versionId: 'version:1' }), rawArtifact({ version: 2, versionId: 'version:2' }),
    ] })
    const nextSummaries = [versionSummary({ ordinal: 1, versionId: 'version:1' }), versionSummary({ ordinal: 2, versionId: 'version:2', title: 'v2' })]
    view.rerender(<ScienceDetailsView {...props(nextScience, { store, summaries: nextSummaries })} />)

    await waitFor(() => {
      expect(store.instance.getSnapshot().openArtifacts.find(tab => tab.kind === 'artifact')).toMatchObject({ version: 2 })
    })
  })

  it('does not auto-step a tab with a pending, unsaved direct edit, and resumes once discarded', async () => {
    const { store, science, summaries } = withOpenTab(2)
    const loadChartState = vi.fn().mockResolvedValue(chartState())
    const view = render(<ScienceDetailsView {...props(science, { store, summaries, loadChartState })} />)
    await waitFor(() => { expect(document.querySelector('img')).not.toBeNull() })

    fireEvent.change(screen.getByLabelText('Enter text'), { target: { value: 'New title' } })

    const nextScience = baseProjection({ artifacts: [
      rawArtifact({ version: 2, versionId: 'version:2' }), rawArtifact({ version: 3, versionId: 'version:3' }),
    ] })
    const nextSummaries = [versionSummary({ ordinal: 2, versionId: 'version:2' }), versionSummary({ ordinal: 3, versionId: 'version:3', title: 'Newer render' })]
    view.rerender(<ScienceDetailsView {...props(nextScience, { store, summaries: nextSummaries, loadChartState })} />)
    await act(async () => {})
    expect(store.instance.getSnapshot().openArtifacts.find(tab => tab.kind === 'artifact')).toMatchObject({ version: 2 })

    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    await waitFor(() => {
      expect(store.instance.getSnapshot().openArtifacts.find(tab => tab.kind === 'artifact')).toMatchObject({ version: 3 })
    })
  })
})

describe('ScienceDetailsView: chart-edit debounced preview (previewChartOps)', () => {
  it('debounces a title edit into a live preview, overriding the displayed image', async () => {
    const { store, science, summaries } = withOpenTab()
    const loadChartState = vi.fn().mockResolvedValue(chartState())
    const previewChartOps = vi.fn().mockResolvedValue({
      ok: true, value: { pngBase64: 'cHJldmlldw==', chart: chartState(), failedOps: [] },
    })
    render(<ScienceDetailsView {...props(science, { store, summaries, loadChartState, previewChartOps })} />)
    await waitFor(() => { expect(document.querySelector('img')).not.toBeNull() })
    vi.useFakeTimers()
    fireEvent.change(screen.getByLabelText('Enter text'), { target: { value: 'Preview title' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(900) })
    vi.useRealTimers()
    expect(previewChartOps).toHaveBeenCalledWith({ artifactId: 'chart-1', version: 2, ops: [{ op: 'set_title', axes: null, text: 'Preview title' }] })
    await waitFor(() => {
      expect(document.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,cHJldmlldw==')
    })
  })

  it('surfaces a rejected debounced preview without discarding the pending edit', async () => {
    const { store, science, summaries } = withOpenTab()
    const loadChartState = vi.fn().mockResolvedValue(chartState())
    const previewChartOps = vi.fn().mockResolvedValue({ ok: false, error: { message: 'kernel busy' } })
    render(<ScienceDetailsView {...props(science, { store, summaries, loadChartState, previewChartOps })} />)
    await waitFor(() => { expect(document.querySelector('img')).not.toBeNull() })
    fireEvent.change(screen.getByLabelText('Enter text'), { target: { value: 'Preview title' } })
    expect(await screen.findByText('Commit failed: kernel busy')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Commit as new version' }).hasAttribute('disabled')).toBe(false)
  })
})
