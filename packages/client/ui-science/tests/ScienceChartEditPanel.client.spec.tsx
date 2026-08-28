// @vitest-environment jsdom
/**
 * The chart editing panel in isolation: the hitmap click overlay and its
 * degraded element-list picker, one property control dispatched per
 * `ScienceChartElement.kind` (the six writable v1 operations plus the
 * read-only display for the remaining five kinds), pending-op accumulation
 * across selections, the committed/pending op list, and Discard/Save.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ScienceChartElement, ScienceChartOp, ScienceChartState } from '@deepseek-ai/dsh-science-session/types'
import { ScienceChartEditPanel, type ScienceChartSaveOutcome } from '../src/client/ScienceChartEditPanel.tsx'
import type { ScienceArtifactContentRef } from '../src/client/science-attachment-loader.ts'
import { en } from '../src/client/locales.ts'

const t = makeTranslate(en)
const content: ScienceArtifactContentRef = { versionId: 'version-1', mediaType: 'image/png', byteCount: 100 }

afterEach(cleanup)

function element(over: Partial<ScienceChartElement> & Pick<ScienceChartElement, 'id' | 'kind'>): ScienceChartElement {
  return { axes: null, label: null, current: null, ...over }
}

const ALL_ELEMENTS: readonly ScienceChartElement[] = [
  element({ id: 'title', kind: 'title', current: 'Loss' }),
  element({ id: 'subtitle', kind: 'subtitle' }),
  element({ id: 'axes[0].x_label', kind: 'x_label', axes: 0 }),
  element({ id: 'axes[0].y_label', kind: 'y_label', axes: 0 }),
  element({ id: 'axes[0].series[treatment]', kind: 'series', axes: 0, label: 'treatment' }),
  element({ id: 'axes[0].tick_labels', kind: 'tick_labels', axes: 0 }),
  element({ id: 'axes[0].legend', kind: 'legend', axes: 0 }),
  element({ id: 'axes[0].grid', kind: 'grid', axes: 0 }),
  element({ id: 'axes[0].axis_range', kind: 'axis_range', axes: 0, current: [0, 10] }),
  element({ id: 'axes[0].axis_scale', kind: 'axis_scale', axes: 0, current: 'linear' }),
  element({ id: 'figure_size', kind: 'figure_size', current: [6, 4] }),
  element({ id: 'font', kind: 'font', current: 'sans-serif' }),
  element({ id: 'axes[0].annotation[text:hi]', kind: 'annotation', axes: 0, label: 'hi', current: { text: 'hi' } }),
]

function chartState(over: Partial<ScienceChartState> = {}): ScienceChartState {
  return {
    runtime: 'matplotlib',
    figureKey: 'fig',
    png: { width: 200, height: 100, dpi: 150 },
    hitmap: [],
    hitmapStatus: 'unavailable',
    elements: ALL_ELEMENTS,
    ops: [],
    ...over,
  }
}

function panel(over: {
  chart?: ScienceChartState
  version?: number
  onSave?: (ops: readonly ScienceChartOp[]) => Promise<ScienceChartSaveOutcome>
  loadImage?: () => Promise<string>
} = {}) {
  const loadImage = over.loadImage ?? vi.fn().mockResolvedValue('data:image/png;base64,abc')
  const onSave = over.onSave ?? vi.fn().mockResolvedValue({ ok: true, failedOps: [] } satisfies ScienceChartSaveOutcome)
  const view = render(
    <ScienceChartEditPanel
      version={over.version ?? 3} chart={over.chart ?? chartState()} content={content} loadImage={loadImage} onSave={onSave} t={t}
    />,
  )
  return { view, loadImage, onSave }
}

describe('ScienceChartEditPanel: element-list picker (hitmapStatus: unavailable)', () => {
  it('shows the select prompt until an element is picked', async () => {
    panel()
    await waitFor(() => { expect(document.querySelector('img')).not.toBeNull() })
    expect(screen.getByText('Select an element to edit its properties')).toBeTruthy()
  })

  it.each(['title', 'subtitle'])('stages set_title for %s', async (id) => {
    const onSave = vi.fn().mockResolvedValue({ ok: true, failedOps: [] } satisfies ScienceChartSaveOutcome)
    panel({ onSave })
    await waitFor(() => { expect(document.querySelector('img')).not.toBeNull() })
    fireEvent.click(screen.getByRole('button', { name: id }))
    fireEvent.change(screen.getByLabelText('Enter text'), { target: { value: 'New title' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add change' }))
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))
    expect(onSave).toHaveBeenCalledWith([{ op: 'set_title', axes: null, text: 'New title' }])
  })

  it('stages set_axis_label with axis x for x_label and axis y for y_label', async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true, failedOps: [] } satisfies ScienceChartSaveOutcome)
    panel({ onSave })
    await waitFor(() => { expect(document.querySelector('img')).not.toBeNull() })
    fireEvent.click(screen.getByRole('button', { name: 'axes[0].x_label' }))
    fireEvent.change(screen.getByLabelText('Enter text'), { target: { value: 'Epoch' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add change' }))
    fireEvent.click(screen.getByRole('button', { name: 'axes[0].y_label' }))
    fireEvent.change(screen.getByLabelText('Enter text'), { target: { value: 'Loss' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add change' }))
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))
    expect(onSave).toHaveBeenCalledWith([
      { op: 'set_axis_label', axes: 0, axis: 'x', text: 'Epoch' },
      { op: 'set_axis_label', axes: 0, axis: 'y', text: 'Loss' },
    ])
  })

  it('stages set_series_color from a preset swatch', async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true, failedOps: [] } satisfies ScienceChartSaveOutcome)
    panel({ onSave })
    await waitFor(() => { expect(document.querySelector('img')).not.toBeNull() })
    fireEvent.click(screen.getByRole('button', { name: 'axes[0].series[treatment]' }))
    fireEvent.click(screen.getByRole('button', { name: 'Color #dc2626' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add change' }))
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))
    expect(onSave).toHaveBeenCalledWith([{ op: 'set_series_color', axes: 0, label: 'treatment', color: '#dc2626' }])
  })

  it('stages set_series_color from the native color input, and falls back to an empty label when the element has none', async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true, failedOps: [] } satisfies ScienceChartSaveOutcome)
    const chart = chartState({ elements: [element({ id: 'axes[0].series[]', kind: 'series', axes: 0, label: null })] })
    panel({ chart, onSave })
    await waitFor(() => { expect(document.querySelector('img')).not.toBeNull() })
    fireEvent.click(screen.getByRole('button', { name: 'axes[0].series[]' }))
    fireEvent.change(screen.getByLabelText('Color'), { target: { value: '#123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add change' }))
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))
    expect(onSave).toHaveBeenCalledWith([{ op: 'set_series_color', axes: 0, label: '', color: '#123456' }])
  })

  it('stages set_tick_font_size from the 4-72 slider', async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true, failedOps: [] } satisfies ScienceChartSaveOutcome)
    panel({ onSave })
    await waitFor(() => { expect(document.querySelector('img')).not.toBeNull() })
    fireEvent.click(screen.getByRole('button', { name: 'axes[0].tick_labels' }))
    fireEvent.change(screen.getByLabelText('Font size (4–72)'), { target: { value: '18' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add change' }))
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))
    expect(onSave).toHaveBeenCalledWith([{ op: 'set_tick_font_size', axes: 0, size: 18 }])
  })

  it('stages set_legend_position from the closed 6-value segmented control', async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true, failedOps: [] } satisfies ScienceChartSaveOutcome)
    panel({ onSave })
    await waitFor(() => { expect(document.querySelector('img')).not.toBeNull() })
    fireEvent.click(screen.getByRole('button', { name: 'axes[0].legend' }))
    fireEvent.click(screen.getByRole('button', { name: 'Upper left' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add change' }))
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))
    expect(onSave).toHaveBeenCalledWith([{ op: 'set_legend_position', axes: 0, position: 'upper left' }])
  })

  it('stages add_reference_line with the chosen orientation and numeric value, disabled until valid', async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true, failedOps: [] } satisfies ScienceChartSaveOutcome)
    panel({ onSave })
    await waitFor(() => { expect(document.querySelector('img')).not.toBeNull() })
    fireEvent.click(screen.getByRole('button', { name: 'axes[0].grid' }))
    expect(screen.getByRole('button', { name: 'Add change' }).hasAttribute('disabled')).toBe(true)
    // Horizontal is the default orientation; clicking it re-confirms that
    // choice before switching to Vertical below.
    fireEvent.click(screen.getByRole('button', { name: 'Horizontal' }))
    fireEvent.click(screen.getByRole('button', { name: 'Vertical' }))
    fireEvent.change(screen.getByLabelText('Reference line value'), { target: { value: '3.5' } })
    expect(screen.getByRole('button', { name: 'Add change' }).hasAttribute('disabled')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Add change' }))
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))
    expect(onSave).toHaveBeenCalledWith([{ op: 'add_reference_line', axes: 0, orientation: 'v', value: 3.5 }])
  })

  it.each(['axes[0].axis_range', 'axes[0].axis_scale', 'figure_size', 'font', 'axes[0].annotation[text:hi]'])(
    'shows a read-only current-value display for %s with no write control',
    async (id) => {
      panel()
      await waitFor(() => { expect(document.querySelector('img')).not.toBeNull() })
      fireEvent.click(screen.getByRole('button', { name: id }))
      expect(screen.getByText('This property is view-only in this version and cannot be edited yet.')).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Add change' })).toBeNull()
    },
  )
})

describe('ScienceChartEditPanel: hitmap point-select (hitmapStatus: ok)', () => {
  it('clicking a hit rectangle selects its element and shows the matching control', async () => {
    const hitElements: readonly ScienceChartElement[] = [
      element({ id: 'title', kind: 'title' }),
      element({ id: 'axes[0].legend', kind: 'legend', axes: 0 }),
    ]
    const chart = chartState({
      hitmapStatus: 'ok',
      elements: hitElements,
      hitmap: [
        { id: 'title', bbox: [0, 0, 40, 10], z: 1 },
        { id: 'axes[0].legend', bbox: [0, 10, 40, 20], z: 2 },
      ],
    })
    panel({ chart })
    await waitFor(() => { expect(document.querySelector('img')).not.toBeNull() })
    // The degraded list picker never renders once the hitmap is usable.
    expect(document.querySelector('ul')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'title' }))
    expect(screen.getByLabelText('Enter text')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'axes[0].legend' }))
    expect(screen.getByRole('radiogroup', { name: 'Legend position' })).toBeTruthy()
  })
})

describe('ScienceChartEditPanel: pending accumulation and the op list', () => {
  it('accumulates multiple staged ops before Save, and lists committed plus pending ops', async () => {
    const chart = chartState({ ops: [{ op: 'set_title', axes: null, text: 'Old' }] })
    panel({ chart, version: 5 })
    await waitFor(() => { expect(document.querySelector('img')).not.toBeNull() })
    expect(screen.getByText('Committed operations · v5')).toBeTruthy()
    expect(screen.getByText('set_title → title')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'title' }))
    fireEvent.change(screen.getByLabelText('Enter text'), { target: { value: 'A' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add change' }))
    fireEvent.click(screen.getByRole('button', { name: 'axes[0].y_label' }))
    fireEvent.change(screen.getByLabelText('Enter text'), { target: { value: 'B' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add change' }))

    expect(screen.getByText('Pending changes')).toBeTruthy()
    // One committed and one pending entry now share this exact text.
    expect(screen.getAllByText('set_title → title')).toHaveLength(2)
    expect(screen.getByText('set_axis_label → axes[0].y_label')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Commit as new version' }).hasAttribute('disabled')).toBe(false)
  })

  it('Discard changes clears pending ops and is disabled with none pending', async () => {
    panel()
    await waitFor(() => { expect(document.querySelector('img')).not.toBeNull() })
    expect(screen.getByRole('button', { name: 'Discard changes' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'title' }))
    fireEvent.change(screen.getByLabelText('Enter text'), { target: { value: 'A' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add change' }))
    expect(screen.getByRole('button', { name: 'Discard changes' }).hasAttribute('disabled')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(screen.queryByText('Pending changes')).toBeNull()
    expect(screen.getByRole('button', { name: 'Commit as new version' }).hasAttribute('disabled')).toBe(true)
  })
})

describe('ScienceChartEditPanel: Save', () => {
  async function stageOneTitleEdit(onSave: (ops: readonly ScienceChartOp[]) => Promise<ScienceChartSaveOutcome>): Promise<void> {
    panel({ onSave })
    await waitFor(() => { expect(document.querySelector('img')).not.toBeNull() })
    fireEvent.click(screen.getByRole('button', { name: 'title' }))
    fireEvent.change(screen.getByLabelText('Enter text'), { target: { value: 'A' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add change' }))
  }

  it('clears pending and shows a confirmation on a clean success', async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true, failedOps: [] } satisfies ScienceChartSaveOutcome)
    await stageOneTitleEdit(onSave)
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))
    expect(await screen.findByText('Human-edited version committed.')).toBeTruthy()
    expect(screen.queryByText('Pending changes')).toBeNull()
    expect(screen.getByRole('button', { name: 'Commit as new version' }).hasAttribute('disabled')).toBe(true)
  })

  it('reports unresolved operations by index and reason', async () => {
    const onSave = vi.fn().mockResolvedValue({
      ok: true, failedOps: [{ index: 0, reason: 'element not found' }],
    } satisfies ScienceChartSaveOutcome)
    await stageOneTitleEdit(onSave)
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))
    expect(await screen.findByText('Change #1 did not apply: element not found')).toBeTruthy()
  })

  it('keeps pending ops and shows the rejection message on failure', async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: false, error: 'stale version' } satisfies ScienceChartSaveOutcome)
    await stageOneTitleEdit(onSave)
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))
    expect(await screen.findByText('Commit failed: stale version')).toBeTruthy()
    expect(screen.getByText('Pending changes')).toBeTruthy()
  })

  it('staging a further change after Save clears the prior confirmation, error, and failed-op notices', async () => {
    const onSave = vi.fn()
      .mockResolvedValueOnce({ ok: true, failedOps: [{ index: 0, reason: 'gone' }] } satisfies ScienceChartSaveOutcome)
    await stageOneTitleEdit(onSave)
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))
    expect(await screen.findByText('Change #1 did not apply: gone')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'axes[0].y_label' }))
    fireEvent.change(screen.getByLabelText('Enter text'), { target: { value: 'C' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add change' }))
    expect(screen.queryByText('Change #1 did not apply: gone')).toBeNull()
    expect(screen.queryByText('Human-edited version committed.')).toBeNull()
  })
})

describe('ScienceChartEditPanel: image loading', () => {
  it('stays on the loading state, without throwing, when the image load rejects', async () => {
    const loadImage = vi.fn().mockRejectedValue(new Error('network'))
    panel({ loadImage })
    await waitFor(() => { expect(loadImage).toHaveBeenCalledOnce() })
    expect(screen.getByText('Loading…')).toBeTruthy()
  })

  it('discards an image load that resolves after the panel already unmounted', async () => {
    let resolveLoad: ((url: string) => void) | undefined
    const loadImage = vi.fn(() => new Promise<string>((resolve) => { resolveLoad = resolve }))
    const { view } = panel({ loadImage })
    view.unmount()
    // No "state update on an unmounted component" throw: the effect's
    // liveness guard discards this late resolution.
    expect(() => { resolveLoad?.('too late') }).not.toThrow()
  })
})
