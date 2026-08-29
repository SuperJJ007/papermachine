// @vitest-environment jsdom
/**
 * The chart editing panel in isolation: every extracted element has a precise
 * composer reference, while only titles, axis labels, legend position, and
 * grid expose direct controls and live preview.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ScienceChartElement, ScienceChartOp, ScienceChartState } from '@deepseek-ai/dsh-science-session/types'
import type { ScienceEditTarget } from '@deepseek-ai/dsh-tool-science/types'
import { ScienceChartEditPanel, type ScienceChartPreview, type ScienceChartSaveOutcome } from '../src/client/ScienceChartEditPanel.tsx'
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
  element({ id: 'font', kind: 'font', current: { family: ['sans'], size: 12 } }),
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
  onPreview?: ScienceChartPreview
  onPreviewSrc?: (src: string | undefined) => void
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
      {...over.onPreview === undefined ? {} : { onPreview: over.onPreview }}
      {...over.onPreviewSrc === undefined ? {} : { onPreviewSrc: over.onPreviewSrc }}
      isTargetAdded={isTargetAdded} onAddTarget={onAddTarget} onRemoveTarget={onRemoveTarget}
      t={t}
    />,
  )
  return { view, onSave, isTargetAdded, onAddTarget, onRemoveTarget }
}

function expandRow(name: string): HTMLElement {
  const row = screen.getByText(name).closest('li')
  if (row === null) throw new Error('expected element row')
  fireEvent.click(within(row).getByRole('button', { name: new RegExp(`^${name}`) }))
  return row
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
    expect(screen.queryByLabelText('Enter text')).toBeNull()
    const title = screen.getByText('Title').closest('li')
    if (title === null) throw new Error('expected element row')
    expect(within(title).getByRole('button', { name: /^Title/ }).getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(within(title).getByRole('button', { name: /^Title/ }))
    expect(within(title).getByLabelText('Enter text')).toBeTruthy()
    const series = screen.getByText('Series · treatment').closest('li')
    if (series === null) throw new Error('expected series row')
    expect(within(series).queryByLabelText('Color')).toBeNull()
    expect(within(series).getByRole('button', { name: /^Series/ }).getAttribute('aria-expanded')).toBeNull()
  })

  it('lists directly-editable rows first (title, subtitle, x_label, y_label, legend, grid), then the rest in extraction order', () => {
    panel()
    const rows = screen.getAllByRole('listitem')
    const names = rows.map(row => row.querySelector('strong')?.textContent)
    expect(names).toEqual([
      'Title', 'Subtitle', 'X-axis label', 'Y-axis label', 'Legend', 'Grid',
      'Series · treatment', 'Tick labels', 'Axis range', 'Axis scale', 'Figure size', 'Font', 'Annotation · hi',
    ])
  })

  it('breaks a directly-editable-kind tie by ascending axes, not extraction order', () => {
    // `label` carries no meaning for a grid element, but scienceElementLabel
    // appends it whenever present, so it doubles as a name here to
    // distinguish which physical axes[N].grid row rendered where — the
    // extracted order below deliberately lists axes: 1 first, so a row
    // order of "earlier" then "later" proves axes, not extraction order, won.
    panel({ chart: chartState({
      elements: [
        element({ id: 'axes[1].grid', kind: 'grid', axes: 1, label: 'later' }),
        element({ id: 'axes[0].grid', kind: 'grid', axes: 0, label: 'earlier' }),
        element({ id: 'title', kind: 'title', current: 'Loss' }),
      ],
    }) })
    const rows = screen.getAllByRole('listitem')
    const names = rows.map(row => row.querySelector('strong')?.textContent)
    expect(names).toEqual(['Title', 'Grid · earlier', 'Grid · later'])
  })

  it.each(['Title', 'Subtitle'])('stages set_title for the %s row', async (name) => {
    const onSave = vi.fn().mockResolvedValue({ ok: true, failedOps: [] } satisfies ScienceChartSaveOutcome)
    panel({ onSave })
    const row = expandRow(name)
    fireEvent.change(within(row).getByLabelText('Enter text'), { target: { value: 'New title' } })
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))
    expect(onSave).toHaveBeenCalledWith([{ op: 'set_title', axes: null, text: 'New title' }])
  })

  it('stages set_axis_label with axis x for the X-axis label row and axis y for the Y-axis label row', async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true, failedOps: [] } satisfies ScienceChartSaveOutcome)
    panel({ onSave })
    const xRow = expandRow('X-axis label')
    fireEvent.change(within(xRow).getByLabelText('Enter text'), { target: { value: 'Epoch' } })
    const yRow = expandRow('Y-axis label')
    fireEvent.change(within(yRow).getByLabelText('Enter text'), { target: { value: 'Loss' } })
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))
    expect(onSave).toHaveBeenCalledWith([
      { op: 'set_axis_label', axes: 0, axis: 'x', text: 'Epoch' },
      { op: 'set_axis_label', axes: 0, axis: 'y', text: 'Loss' },
    ])
  })

  it('stages set_legend_position from the closed 6-value segmented control', async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true, failedOps: [] } satisfies ScienceChartSaveOutcome)
    panel({ onSave })
    const row = expandRow('Legend')
    fireEvent.click(within(row).getByRole('button', { name: 'Upper left' }))
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))
    expect(onSave).toHaveBeenCalledWith([{ op: 'set_legend_position', axes: 0, position: 'upper left' }])
  })

  it('stages toggle_grid from the grid switch', async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true, failedOps: [] } satisfies ScienceChartSaveOutcome)
    panel({ onSave })
    const row = expandRow('Grid')
    fireEvent.click(within(row).getByLabelText('Show grid'))
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))
    expect(onSave).toHaveBeenCalledWith([{ op: 'toggle_grid', axes: 0, visible: true }])
  })

  it('truncates a current-value summary and referenced-element current past 60 characters', () => {
    const long = 'x'.repeat(80)
    const chart = chartState({ elements: [element({ id: 'title', kind: 'title', current: long })] })
    const onAddTarget = vi.fn()
    panel({ chart, onAddTarget })
    const truncated = `${'x'.repeat(60)}…`
    expect(screen.getByText(truncated)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add Title to the conversation' }))
    expect(onAddTarget).toHaveBeenCalledWith({
      kind: 'element', elementId: 'title', elementKind: 'title', axes: null, label: null, current: truncated,
    }, '')
  })

  it('turns a reference-only row click into a precise composer reference without previewing', () => {
    const onAddTarget = vi.fn()
    const onPreview = vi.fn()
    panel({ onAddTarget, onPreview })
    const row = screen.getByText('Series · treatment').closest('li')
    if (row === null) throw new Error('expected series row')
    fireEvent.click(within(row).getByRole('button', { name: /^Series/ }))
    expect(onAddTarget).toHaveBeenCalledWith({
      kind: 'element', elementId: 'axes[0].series[treatment]', elementKind: 'series', axes: 0,
      label: 'treatment', current: 'null',
    }, '')
    expect(onPreview).not.toHaveBeenCalled()
  })
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
      { kind: 'element', elementId: 'title', elementKind: 'title', axes: null, label: null, current: 'Loss' }, '',
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
    expect(onRemoveTarget).toHaveBeenCalledWith({
      kind: 'element', elementId: 'title', elementKind: 'title', axes: null, label: null, current: 'Loss',
    })
  })
})

describe('ScienceChartEditPanel: pending accumulation and the op list', () => {
  it('previews a parameter change after the debounce and replaces the displayed image source', async () => {
    const onPreview = vi.fn().mockResolvedValue({ ok: true, pngBase64: 'cHJldmlldw==', failedOps: [] })
    const onPreviewSrc = vi.fn()
    panel({ onPreview, onPreviewSrc })
    const row = expandRow('Title')
    fireEvent.change(within(row).getByLabelText('Enter text'), { target: { value: 'Preview title' } })
    await vi.waitFor(() => {
      expect(onPreview).toHaveBeenCalledWith([{ op: 'set_title', axes: null, text: 'Preview title' }])
      expect(onPreviewSrc).toHaveBeenCalledWith('data:image/png;base64,cHJldmlldw==')
    })
  })

  it('accumulates multiple staged ops before Save, and lists committed plus pending ops', () => {
    const chart = chartState({ ops: [{ op: 'set_title', axes: null, text: 'Old' }] })
    panel({ chart, version: 5 })
    expect(screen.getByText('Committed operations · v5')).toBeTruthy()
    expect(screen.getByText('set_title → title')).toBeTruthy()

    const titleRow = expandRow('Title')
    fireEvent.change(within(titleRow).getByLabelText('Enter text'), { target: { value: 'A' } })
    const yRow = expandRow('Y-axis label')
    fireEvent.change(within(yRow).getByLabelText('Enter text'), { target: { value: 'B' } })

    expect(screen.getByText('Pending changes')).toBeTruthy()
    // One committed and one pending entry now share this exact text.
    expect(screen.getAllByText('set_title → title')).toHaveLength(2)
    expect(screen.getByText('set_axis_label → axes[0].y_label')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Commit as new version' }).hasAttribute('disabled')).toBe(false)
  })

  it('Discard changes clears pending ops and is disabled with none pending', () => {
    panel()
    expect(screen.getByRole('button', { name: 'Discard changes' }).hasAttribute('disabled')).toBe(true)
    const row = expandRow('Title')
    fireEvent.change(within(row).getByLabelText('Enter text'), { target: { value: 'A' } })
    expect(screen.getByRole('button', { name: 'Discard changes' }).hasAttribute('disabled')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(screen.queryByText('Pending changes')).toBeNull()
    expect(screen.getByRole('button', { name: 'Commit as new version' }).hasAttribute('disabled')).toBe(true)
  })
})

describe('ScienceChartEditPanel: Save', () => {
  function stageOneTitleEdit(onSave: (ops: readonly ScienceChartOp[]) => Promise<ScienceChartSaveOutcome>): void {
    panel({ onSave })
    const row = expandRow('Title')
    fireEvent.change(within(row).getByLabelText('Enter text'), { target: { value: 'A' } })
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

    const yRow = expandRow('Y-axis label')
    fireEvent.change(within(yRow).getByLabelText('Enter text'), { target: { value: 'C' } })
    expect(screen.queryByText('Change #1 did not apply: gone')).toBeNull()
    expect(screen.queryByText('Human-edited version committed.')).toBeNull()
  })
})
