// @vitest-environment jsdom
/**
 * The chart editing panel in isolation: the full `chart.elements` list (no
 * duplicate image, no hitmap/click overlay), one property control per
 * `ScienceChartElement.kind` (the six writable v1 operations plus the
 * read-only display for the remaining five kinds) always rendered inline on
 * its row, each row's +/− composer-reference control, pending-op
 * accumulation across rows, the committed/pending op list, and Discard/Save.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ScienceChartElement, ScienceChartOp, ScienceChartState } from '@deepseek-ai/dsh-science-session/types'
import type { ScienceEditTarget } from '@deepseek-ai/dsh-tool-science/types'
import { ScienceChartEditPanel, type ScienceChartSaveOutcome } from '../src/client/ScienceChartEditPanel.tsx'
import { en } from '../src/client/locales.ts'

const t = makeTranslate(en)

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
  isTargetAdded?: (target: ScienceEditTarget) => boolean
  onAddTarget?: (target: ScienceEditTarget, comment: string) => void
  onRemoveTarget?: (target: ScienceEditTarget) => void
} = {}) {
  const onSave = over.onSave ?? vi.fn().mockResolvedValue({ ok: true, failedOps: [] } satisfies ScienceChartSaveOutcome)
  const isTargetAdded = over.isTargetAdded ?? vi.fn().mockReturnValue(false)
  const onAddTarget = over.onAddTarget ?? vi.fn()
  const onRemoveTarget = over.onRemoveTarget ?? vi.fn()
  const view = render(
    <ScienceChartEditPanel
      version={over.version ?? 3} chart={over.chart ?? chartState()} onSave={onSave}
      isTargetAdded={isTargetAdded} onAddTarget={onAddTarget} onRemoveTarget={onRemoveTarget}
      t={t}
    />,
  )
  return { view, onSave, isTargetAdded, onAddTarget, onRemoveTarget }
}

describe('ScienceChartEditPanel: full element list', () => {
  it('lists every chart element as one row with no duplicate image and no hitmap overlay', () => {
    panel()
    expect(document.querySelector('img')).toBeNull()
    expect(screen.getAllByRole('listitem')).toHaveLength(ALL_ELEMENTS.length)
    for (const name of ['Title', 'Subtitle', 'X-axis label', 'Y-axis label', 'Series · treatment', 'Tick labels',
      'Legend', 'Grid', 'Axis range', 'Axis scale', 'Figure size', 'Font', 'Annotation · hi']) {
      expect(screen.getByText(name)).toBeTruthy()
    }
    // Every row's inline control is present directly, with no prior selection step.
    expect(screen.getAllByLabelText('Enter text')).toHaveLength(4) // title, subtitle, x_label, y_label
  })

  it.each(['Title', 'Subtitle'])('stages set_title for the %s row', async (name) => {
    const onSave = vi.fn().mockResolvedValue({ ok: true, failedOps: [] } satisfies ScienceChartSaveOutcome)
    panel({ onSave })
    const row = screen.getByText(name).closest('li')
    if (row === null) throw new Error('expected element row')
    fireEvent.change(within(row).getByLabelText('Enter text'), { target: { value: 'New title' } })
    fireEvent.click(within(row).getByRole('button', { name: 'Add change' }))
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))
    expect(onSave).toHaveBeenCalledWith([{ op: 'set_title', axes: null, text: 'New title' }])
  })

  it('stages set_axis_label with axis x for the X-axis label row and axis y for the Y-axis label row', async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true, failedOps: [] } satisfies ScienceChartSaveOutcome)
    panel({ onSave })
    const xRow = screen.getByText('X-axis label').closest('li')
    const yRow = screen.getByText('Y-axis label').closest('li')
    if (xRow === null || yRow === null) throw new Error('expected element rows')
    fireEvent.change(within(xRow).getByLabelText('Enter text'), { target: { value: 'Epoch' } })
    fireEvent.click(within(xRow).getByRole('button', { name: 'Add change' }))
    fireEvent.change(within(yRow).getByLabelText('Enter text'), { target: { value: 'Loss' } })
    fireEvent.click(within(yRow).getByRole('button', { name: 'Add change' }))
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))
    expect(onSave).toHaveBeenCalledWith([
      { op: 'set_axis_label', axes: 0, axis: 'x', text: 'Epoch' },
      { op: 'set_axis_label', axes: 0, axis: 'y', text: 'Loss' },
    ])
  })

  it('stages set_series_color from a preset swatch', async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true, failedOps: [] } satisfies ScienceChartSaveOutcome)
    panel({ onSave })
    const row = screen.getByText('Series · treatment').closest('li')
    if (row === null) throw new Error('expected element row')
    fireEvent.click(within(row).getByRole('button', { name: 'Color #dc2626' }))
    fireEvent.click(within(row).getByRole('button', { name: 'Add change' }))
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))
    expect(onSave).toHaveBeenCalledWith([{ op: 'set_series_color', axes: 0, label: 'treatment', color: '#dc2626' }])
  })

  it('stages set_series_color from the native color input, and falls back to an empty label when the element has none', async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true, failedOps: [] } satisfies ScienceChartSaveOutcome)
    const chart = chartState({ elements: [element({ id: 'axes[0].series[]', kind: 'series', axes: 0, label: null })] })
    panel({ chart, onSave })
    fireEvent.change(screen.getByLabelText('Color'), { target: { value: '#123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add change' }))
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))
    expect(onSave).toHaveBeenCalledWith([{ op: 'set_series_color', axes: 0, label: '', color: '#123456' }])
  })

  it('stages set_tick_font_size from the 4-72 slider', async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true, failedOps: [] } satisfies ScienceChartSaveOutcome)
    panel({ onSave })
    const row = screen.getByText('Tick labels').closest('li')
    if (row === null) throw new Error('expected element row')
    fireEvent.change(within(row).getByLabelText('Font size (4–72)'), { target: { value: '18' } })
    fireEvent.click(within(row).getByRole('button', { name: 'Add change' }))
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))
    expect(onSave).toHaveBeenCalledWith([{ op: 'set_tick_font_size', axes: 0, size: 18 }])
  })

  it('stages set_legend_position from the closed 6-value segmented control', async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true, failedOps: [] } satisfies ScienceChartSaveOutcome)
    panel({ onSave })
    const row = screen.getByText('Legend').closest('li')
    if (row === null) throw new Error('expected element row')
    fireEvent.click(within(row).getByRole('button', { name: 'Upper left' }))
    fireEvent.click(within(row).getByRole('button', { name: 'Add change' }))
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))
    expect(onSave).toHaveBeenCalledWith([{ op: 'set_legend_position', axes: 0, position: 'upper left' }])
  })

  it('stages add_reference_line with the chosen orientation and numeric value, disabled until valid', async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true, failedOps: [] } satisfies ScienceChartSaveOutcome)
    panel({ onSave })
    const row = screen.getByText('Grid').closest('li')
    if (row === null) throw new Error('expected element row')
    expect(within(row).getByRole('button', { name: 'Add change' }).hasAttribute('disabled')).toBe(true)
    // Horizontal is the default orientation; clicking it re-confirms that
    // choice before switching to Vertical below.
    fireEvent.click(within(row).getByRole('button', { name: 'Horizontal' }))
    fireEvent.click(within(row).getByRole('button', { name: 'Vertical' }))
    fireEvent.change(within(row).getByLabelText('Reference line value'), { target: { value: '3.5' } })
    expect(within(row).getByRole('button', { name: 'Add change' }).hasAttribute('disabled')).toBe(false)
    fireEvent.click(within(row).getByRole('button', { name: 'Add change' }))
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))
    expect(onSave).toHaveBeenCalledWith([{ op: 'add_reference_line', axes: 0, orientation: 'v', value: 3.5 }])
  })

  it('truncates a current-value summary and referenced-element current past 60 characters', () => {
    const long = 'x'.repeat(80)
    const chart = chartState({ elements: [element({ id: 'title', kind: 'title', current: long })] })
    const onAddTarget = vi.fn()
    panel({ chart, onAddTarget })
    const truncated = `${'x'.repeat(60)}…`
    expect(screen.getByText(truncated)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add Title to the conversation' }))
    expect(onAddTarget).toHaveBeenCalledWith({ kind: 'element', elementId: 'title', elementKind: 'title', current: truncated }, '')
  })

  it.each(['Axis range', 'Axis scale', 'Figure size', 'Font', 'Annotation · hi'])(
    'shows a read-only current-value display for the %s row with no write control',
    (name) => {
      panel()
      const row = screen.getByText(name).closest('li')
      if (row === null) throw new Error('expected element row')
      expect(within(row).getByText('This property is view-only in this version and cannot be edited yet.')).toBeTruthy()
      expect(within(row).queryByRole('button', { name: 'Add change' })).toBeNull()
    },
  )
})

describe('ScienceChartEditPanel: element +/- composer reference', () => {
  it('adds an element target without an inline comment, and removes it through the same control', () => {
    const onAddTarget = vi.fn()
    const onRemoveTarget = vi.fn()
    panel({ onAddTarget, onRemoveTarget })
    const row = screen.getByText('Title').closest('li')
    if (row === null) throw new Error('expected element row')
    expect(within(row).queryByLabelText('Edit note for Title')).toBeNull()
    fireEvent.click(within(row).getByRole('button', { name: 'Add Title to the conversation' }))
    expect(onAddTarget).toHaveBeenCalledWith(
      { kind: 'element', elementId: 'title', elementKind: 'title', current: 'Loss' }, '',
    )
    expect(onRemoveTarget).not.toHaveBeenCalled()
  })

  it('shows Remove once staged', () => {
    const onAddTarget = vi.fn()
    const onRemoveTarget = vi.fn()
    panel({ isTargetAdded: () => true, onAddTarget, onRemoveTarget })
    const row = screen.getByText('Title').closest('li')
    if (row === null) throw new Error('expected element row')
    expect(within(row).getByRole('button', { name: 'Remove Title' })).toBeTruthy()
    expect(onAddTarget).not.toHaveBeenCalled()
    fireEvent.click(within(row).getByRole('button', { name: 'Remove Title' }))
    expect(onRemoveTarget).toHaveBeenCalledWith({ kind: 'element', elementId: 'title', elementKind: 'title', current: 'Loss' })
  })
})

describe('ScienceChartEditPanel: pending accumulation and the op list', () => {
  it('accumulates multiple staged ops before Save, and lists committed plus pending ops', () => {
    const chart = chartState({ ops: [{ op: 'set_title', axes: null, text: 'Old' }] })
    panel({ chart, version: 5 })
    expect(screen.getByText('Committed operations · v5')).toBeTruthy()
    expect(screen.getByText('set_title → title')).toBeTruthy()

    const titleRow = screen.getByText('Title').closest('li')
    const yRow = screen.getByText('Y-axis label').closest('li')
    if (titleRow === null || yRow === null) throw new Error('expected element rows')
    fireEvent.change(within(titleRow).getByLabelText('Enter text'), { target: { value: 'A' } })
    fireEvent.click(within(titleRow).getByRole('button', { name: 'Add change' }))
    fireEvent.change(within(yRow).getByLabelText('Enter text'), { target: { value: 'B' } })
    fireEvent.click(within(yRow).getByRole('button', { name: 'Add change' }))

    expect(screen.getByText('Pending changes')).toBeTruthy()
    // One committed and one pending entry now share this exact text.
    expect(screen.getAllByText('set_title → title')).toHaveLength(2)
    expect(screen.getByText('set_axis_label → axes[0].y_label')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Commit as new version' }).hasAttribute('disabled')).toBe(false)
  })

  it('Discard changes clears pending ops and is disabled with none pending', () => {
    panel()
    expect(screen.getByRole('button', { name: 'Discard changes' }).hasAttribute('disabled')).toBe(true)
    const row = screen.getByText('Title').closest('li')
    if (row === null) throw new Error('expected element row')
    fireEvent.change(within(row).getByLabelText('Enter text'), { target: { value: 'A' } })
    fireEvent.click(within(row).getByRole('button', { name: 'Add change' }))
    expect(screen.getByRole('button', { name: 'Discard changes' }).hasAttribute('disabled')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(screen.queryByText('Pending changes')).toBeNull()
    expect(screen.getByRole('button', { name: 'Commit as new version' }).hasAttribute('disabled')).toBe(true)
  })
})

describe('ScienceChartEditPanel: Save', () => {
  function stageOneTitleEdit(onSave: (ops: readonly ScienceChartOp[]) => Promise<ScienceChartSaveOutcome>): void {
    panel({ onSave })
    const row = screen.getByText('Title').closest('li')
    if (row === null) throw new Error('expected element row')
    fireEvent.change(within(row).getByLabelText('Enter text'), { target: { value: 'A' } })
    fireEvent.click(within(row).getByRole('button', { name: 'Add change' }))
  }

  it('clears pending and shows a confirmation on a clean success', async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true, failedOps: [] } satisfies ScienceChartSaveOutcome)
    stageOneTitleEdit(onSave)
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))
    expect(await screen.findByText('Human-edited version committed.')).toBeTruthy()
    expect(screen.queryByText('Pending changes')).toBeNull()
    expect(screen.getByRole('button', { name: 'Commit as new version' }).hasAttribute('disabled')).toBe(true)
  })

  it('reports unresolved operations by index and reason', async () => {
    const onSave = vi.fn().mockResolvedValue({
      ok: true, failedOps: [{ index: 0, reason: 'element not found' }],
    } satisfies ScienceChartSaveOutcome)
    stageOneTitleEdit(onSave)
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))
    expect(await screen.findByText('Change #1 did not apply: element not found')).toBeTruthy()
  })

  it('keeps pending ops and shows the rejection message on failure', async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: false, error: 'stale version' } satisfies ScienceChartSaveOutcome)
    stageOneTitleEdit(onSave)
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))
    expect(await screen.findByText('Commit failed: stale version')).toBeTruthy()
    expect(screen.getByText('Pending changes')).toBeTruthy()
  })

  it('staging a further change after Save clears the prior confirmation, error, and failed-op notices', async () => {
    const onSave = vi.fn()
      .mockResolvedValueOnce({ ok: true, failedOps: [{ index: 0, reason: 'gone' }] } satisfies ScienceChartSaveOutcome)
    stageOneTitleEdit(onSave)
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))
    expect(await screen.findByText('Change #1 did not apply: gone')).toBeTruthy()

    const yRow = screen.getByText('Y-axis label').closest('li')
    if (yRow === null) throw new Error('expected element row')
    fireEvent.change(within(yRow).getByLabelText('Enter text'), { target: { value: 'C' } })
    fireEvent.click(within(yRow).getByRole('button', { name: 'Add change' }))
    expect(screen.queryByText('Change #1 did not apply: gone')).toBeNull()
    expect(screen.queryByText('Human-edited version committed.')).toBeNull()
  })
})
