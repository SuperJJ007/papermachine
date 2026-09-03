// @vitest-environment jsdom
/**
 * The chart editing panel in isolation: every extracted element has a precise
 * composer reference, while titles, axis labels, grid, font, and legend
 * expose compact direct controls and live preview.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ScienceChartElement, ScienceChartOp, ScienceChartState } from '@deepseek-ai/dsh-science-session/types'
import type { ScienceEditTarget } from '@deepseek-ai/dsh-tool-science/types'
import { ScienceChartEditPanel, type ScienceChartPreview, type ScienceChartSaveOutcome } from '../src/client/ScienceChartEditPanel.tsx'
import { en, zh } from '../src/client/locales.ts'

const t = makeTranslate(en)

afterEach(cleanup)

function element(over: Partial<ScienceChartElement> & Pick<ScienceChartElement, 'id' | 'kind'>): ScienceChartElement {
  return { axes: null, label: null, current: null, ...over }
}

const ALL_ELEMENTS: readonly ScienceChartElement[] = [
  element({ id: 'title', kind: 'title', current: 'Loss' }),
  element({ id: 'subtitle', kind: 'subtitle' }),
  element({ id: 'x_label', kind: 'x_label', axes: 0 }),
  element({ id: 'y_label', kind: 'y_label', axes: 0 }),
  element({ id: 'series[treatment]', kind: 'series', axes: 0, label: 'treatment' }),
  element({ id: 'tick_labels', kind: 'tick_labels', axes: 0 }),
  element({ id: 'legend', kind: 'legend', axes: 0 }),
  element({ id: 'grid', kind: 'grid', axes: 0 }),
  element({ id: 'axis_range', kind: 'axis_range', axes: 0, current: [0, 10] }),
  element({ id: 'axis_scale', kind: 'axis_scale', axes: 0, current: 'linear' }),
  element({ id: 'figure_size', kind: 'figure_size', current: [6, 4] }),
  element({ id: 'font', kind: 'font', current: { family: ['sans'], size: 12 } }),
  element({ id: 'annotation[text:hi]', kind: 'annotation', axes: 0, label: 'hi', current: { text: 'hi' } }),
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
  t?: typeof t
  chart?: ScienceChartState
  version?: number
  onSave?: (ops: readonly ScienceChartOp[]) => Promise<ScienceChartSaveOutcome>
  onPreview?: ScienceChartPreview
  onPreviewSrc?: (src: string | undefined) => void
  isTargetAdded?: (target: ScienceEditTarget) => boolean
  onAddTarget?: (target: ScienceEditTarget, comment: string) => void
  onRemoveTarget?: (target: ScienceEditTarget) => void
  onPendingChange?: (hasPending: boolean) => void
  referencesDisabled?: boolean
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
      {...over.onPendingChange === undefined ? {} : { onPendingChange: over.onPendingChange }}
      {...over.referencesDisabled === undefined ? {} : { referencesDisabled: over.referencesDisabled }}
      isTargetAdded={isTargetAdded} onAddTarget={onAddTarget} onRemoveTarget={onRemoveTarget}
      t={over.t ?? t}
    />,
  )
  return { view, onSave, isTargetAdded, onAddTarget, onRemoveTarget }
}

function expandRow(name: string): HTMLElement {
  const row = screen.getByText(name).closest('li')
  if (row === null) throw new Error('expected element row')
  return row
}

describe('ScienceChartEditPanel: two-column layout', () => {
  it('renders one columns container with direct edits on the left and reference chips on the right', () => {
    panel()
    const heading = screen.getByText('Modify elements')
    const directSection = heading.closest('section')
    if (directSection === null) throw new Error('expected direct-edit section')
    const columns = directSection.parentElement
    if (columns === null) throw new Error('expected columns container')
    const [left, right] = columns.children
    expect(left).toBe(directSection)
    expect(within(directSection).getAllByRole('listitem').length).toBeGreaterThan(0)
    expect(right?.querySelector('h4')?.textContent).toBe('Reference for AI editing')
    expect(within(right as HTMLElement).getByRole('button', { name: 'Add Series · treatment to the conversation' })).toBeTruthy()
  })

  it('does not render a separate Direct edits heading', () => {
    panel()
    expect(screen.queryByText('Direct edits')).toBeNull()
  })
})

describe('ScienceChartEditPanel: full element list', () => {
  it('splits every chart element between always-visible direct rows and reference chips', () => {
    panel()
    expect(document.querySelector('img')).toBeNull()
    expect(screen.getAllByRole('listitem')).toHaveLength(ALL_ELEMENTS.length)
    for (const name of ['Title', 'Subtitle', 'X-axis title', 'Y-axis title', 'Series · treatment', 'Tick labels',
      'Legend', 'Grid', 'Axis range', 'Axis scale', 'Figure size', 'Font', 'Annotation · hi']) {
      expect(screen.getByText(name)).toBeTruthy()
    }
    expect(screen.getAllByLabelText('Enter text')).toHaveLength(4)
    const title = screen.getByText('Title').closest('li')
    if (title === null) throw new Error('expected element row')
    expect(title.getAttribute('data-editable')).toBe('true')
    expect(within(title).getByLabelText('Enter text')).toBeTruthy()
    const series = screen.getByText('Series · treatment').closest('li')
    if (series === null) throw new Error('expected series row')
    expect(within(series).queryByLabelText('Color')).toBeNull()
    expect(within(series).getByRole('button', { name: 'Add Series · treatment to the conversation' })).toBeTruthy()
  })

  it('orders compact direct rows independently from reference chips', () => {
    panel()
    const directNames = [...document.querySelectorAll('[data-editable="true"]')]
      .map(row => row.firstElementChild?.textContent)
    expect(directNames).toEqual(['Title', 'Subtitle', 'Font', 'X-axis title', 'Y-axis title', 'Legend', 'Grid'])
  })

  it('groups repeated direct kinds by ascending panel number', () => {
    panel({ chart: chartState({
      elements: [
        element({ id: 'axes[1].grid', kind: 'grid', axes: 1, label: 'later' }),
        element({ id: 'axes[0].grid', kind: 'grid', axes: 0, label: 'earlier' }),
        element({ id: 'title', kind: 'title', current: 'Loss' }),
      ],
    }) })
    const names = [...document.querySelectorAll('[data-editable="true"]')]
      .map(row => row.firstElementChild?.textContent)
    expect(names).toEqual(['Title', 'Grid', 'Grid'])
  })

  it('breaks a same-kind-same-axes tie by extraction order', () => {
    panel({ chart: chartState({
      elements: [
        element({ id: 'axes[0].grid#2', kind: 'grid', axes: 0, label: 'second' }),
        element({ id: 'axes[0].grid', kind: 'grid', axes: 0, label: 'first' }),
      ],
    }) })
    const names = [...document.querySelectorAll('[data-editable="true"]')]
      .map(row => row.firstElementChild?.textContent)
    expect(names).toEqual(['Grid', 'Grid'])
  })

  it('stages nothing when a text control is cleared to empty or whitespace', () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true, failedOps: [] } satisfies ScienceChartSaveOutcome)
    panel({ onSave })
    const row = expandRow('Title')
    const input = within(row).getByLabelText('Enter text')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.change(input, { target: { value: '' } })
    expect(screen.getByRole('button', { name: 'Commit as new version' }).hasAttribute('disabled')).toBe(true)
  })

  it.each(['X-axis title', 'Y-axis title'])('shows the %s control empty when current is not a string', (name) => {
    const kind = name === 'X-axis title' ? 'x_label' : 'y_label'
    panel({ chart: chartState({
      elements: [element({ id: `axes[0].${kind}`, kind, axes: 0, current: null })],
    }) })
    const row = expandRow(name)
    const input = within(row).getByLabelText('Enter text') as HTMLInputElement
    expect(input.value).toBe('')
  })

  it.each(['X-axis title', 'Y-axis title'])('pre-fills the %s control from a string current', (name) => {
    const kind = name === 'X-axis title' ? 'x_label' : 'y_label'
    panel({ chart: chartState({
      elements: [element({ id: `axes[0].${kind}`, kind, axes: 0, current: 'Epoch' })],
    }) })
    const row = expandRow(name)
    const input = within(row).getByLabelText('Enter text') as HTMLInputElement
    expect(input.value).toBe('Epoch')
  })

  it('does not change composer references when an editable row itself is clicked', () => {
    const onAddTarget = vi.fn()
    panel({ onAddTarget })
    fireEvent.click(screen.getByText('Title'))
    expect(onAddTarget).not.toHaveBeenCalled()
  })

  it.each([['Title', 'set_title'], ['Subtitle', 'set_subtitle']])('stages a distinct operation for the %s row', async (name, op) => {
    const onSave = vi.fn().mockResolvedValue({ ok: true, failedOps: [] } satisfies ScienceChartSaveOutcome)
    panel({ onSave })
    const row = expandRow(name)
    fireEvent.change(within(row).getByLabelText('Enter text'), { target: { value: 'New title' } })
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))
    expect(onSave).toHaveBeenCalledWith([{ op, axes: null, text: 'New title' }])
  })

  it('keeps ggplot2 title and subtitle edits together', () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true, failedOps: [] } satisfies ScienceChartSaveOutcome)
    panel({ onSave, chart: chartState({ runtime: 'ggplot2' }) })
    fireEvent.change(within(expandRow('Title')).getByLabelText('Enter text'), { target: { value: 'Main title' } })
    fireEvent.change(within(expandRow('Subtitle')).getByLabelText('Enter text'), { target: { value: 'Subtitle text' } })
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))
    expect(onSave).toHaveBeenCalledWith([
      { op: 'set_title', axes: null, text: 'Main title' },
      { op: 'set_subtitle', axes: null, text: 'Subtitle text' },
    ])
  })

  it('stages set_axis_label with axis x for the X-axis title row and axis y for the Y-axis title row', async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true, failedOps: [] } satisfies ScienceChartSaveOutcome)
    panel({ onSave })
    const xRow = expandRow('X-axis title')
    fireEvent.change(within(xRow).getByLabelText('Enter text'), { target: { value: 'Epoch' } })
    const yRow = expandRow('Y-axis title')
    fireEvent.change(within(yRow).getByLabelText('Enter text'), { target: { value: 'Loss' } })
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))
    expect(onSave).toHaveBeenCalledWith([
      { op: 'set_axis_label', axes: 0, axis: 'x', text: 'Epoch' },
      { op: 'set_axis_label', axes: 0, axis: 'y', text: 'Loss' },
    ])
  })

  it('stages set_legend_position from the closed 7-value select', async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true, failedOps: [] } satisfies ScienceChartSaveOutcome)
    panel({ onSave })
    const row = expandRow('Legend')
    for (const label of ['Best', 'Right', 'Upper left', 'Upper right', 'Lower left', 'Lower right', 'Center']) {
      expect(within(row).getByRole('option', { name: label })).toBeTruthy()
    }
    fireEvent.change(within(row).getByLabelText('Legend position'), { target: { value: 'upper left' } })
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))
    expect(onSave).toHaveBeenCalledWith([{ op: 'set_legend_position', axes: 0, position: 'upper left' }])
  })

  it.each<[string, ScienceChartElement['current']]>([
    ['best', { loc: 0 }],
    ['upper right', { loc: 1 }],
    ['upper left', { loc: 2 }],
    ['lower left', { loc: 3 }],
    ['lower right', { loc: 4 }],
    ['right', { loc: 5 }],
    ['center', { loc: 10 }],
    ['right', { position: 'right' }],
    ['upper left', { position: 'inside', inside: [0, 1] }],
    ['upper right', { position: 'inside', inside: [1, 1] }],
    ['lower left', { position: 'inside', inside: [0, 0] }],
    ['lower right', { position: 'inside', inside: [1, 0] }],
    ['center', { position: 'inside', inside: [0.5, 0.5] }],
  ])('selects %s for legend current %j', (expected, current) => {
    panel({ chart: chartState({
      elements: [element({ id: 'axes[0].legend', kind: 'legend', axes: 0, current })],
    }) })
    const row = expandRow('Legend')
    expect(within(row).getByLabelText('Legend position')).toHaveProperty('value', expected)
  })

  it.each<[string, ScienceChartElement['current']]>([
    ['mpl center-left (no matching segment)', { loc: 6 }],
    ['mpl center-right (no matching segment)', { loc: 7 }],
    ['mpl lower-center (no matching segment)', { loc: 8 }],
    ['mpl upper-center (no matching segment)', { loc: 9 }],
    ['ggplot2 center-left inside coordinate', { position: 'inside', inside: [0, 0.5] }],
    ['ggplot2 none', { position: 'none' }],
    ['ggplot2 inside with a malformed (non-pair) coordinate', { position: 'inside', inside: [0] }],
    ['ggplot2 inside with a non-array coordinate', { position: 'inside', inside: 'bad' }],
  ])('shows a disabled current-value placeholder for %s', (_label, current) => {
    panel({ chart: chartState({
      elements: [element({ id: 'axes[0].legend', kind: 'legend', axes: 0, current })],
    }) })
    const row = expandRow('Legend')
    const select = within(row).getByLabelText('Legend position') as HTMLSelectElement
    expect(select.value).toBe('')
    expect(select.selectedOptions[0]?.disabled).toBe(true)
  })

  it('stages toggle_grid from the grid switch', async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true, failedOps: [] } satisfies ScienceChartSaveOutcome)
    panel({ onSave })
    const row = expandRow('Grid')
    fireEvent.click(within(row).getByLabelText('Show grid'))
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))
    expect(onSave).toHaveBeenCalledWith([{ op: 'toggle_grid', axes: 0, visible: true }])
  })

  it('stages set_font from family and size changes', async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true, failedOps: [] } satisfies ScienceChartSaveOutcome)
    panel({ onSave })
    const row = expandRow('Font')
    const family = within(row).getByLabelText('Font family')
    expect(family.getAttribute('list')).toBe('science-font-families-font')
    fireEvent.change(family, { target: { value: 'DejaVu Sans' } })
    fireEvent.change(within(row).getByLabelText('Font size'), { target: { value: '14' } })
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))
    expect(onSave).toHaveBeenCalledWith([{ op: 'set_font', axes: null, family: 'DejaVu Sans', size: 14 }])
  })

  it('uses the current font family when the family input is cleared', async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true, failedOps: [] } satisfies ScienceChartSaveOutcome)
    panel({ onSave })
    const row = expandRow('Font')
    fireEvent.change(within(row).getByLabelText('Font family'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))
    expect(onSave).toHaveBeenCalledWith([{ op: 'set_font', axes: null, family: 'sans', size: 12 }])
  })

  it.each<[ScienceChartElement['current'], string, number]>([
    [null, 'sans-serif', 10],
    [[], 'sans-serif', 10],
    [{ family: 'serif', size: 11 }, 'serif', 11],
    [{ family: [], size: 'bad' }, 'sans-serif', 10],
    [{ family: '', size: 12 }, 'sans-serif', 12],
  ])('normalizes font current %j to %s/%i', (current, family, size) => {
    panel({ chart: chartState({ elements: [element({ id: 'font', kind: 'font', current })] }) })
    expect(screen.getByLabelText('Font family')).toHaveProperty('value', family)
    expect(screen.getByLabelText('Font size')).toHaveProperty('valueAsNumber', size)
  })

  it('ignores an invalid font size until it falls within the codec bounds', () => {
    panel()
    const row = expandRow('Font')
    fireEvent.change(within(row).getByLabelText('Font size'), { target: { value: '3' } })
    expect(screen.getByRole('button', { name: 'Commit as new version' }).hasAttribute('disabled')).toBe(true)
  })

  it('keeps readable labels separate from bounded wire summaries', () => {
    const long = 'x'.repeat(80)
    const chart = chartState({ elements: [element({ id: 'series[long]', kind: 'series', label: 'long', current: long })] })
    const onAddTarget = vi.fn()
    panel({ chart, onAddTarget })
    expect(screen.getByText('Series · long')).toBeTruthy()
    expect(screen.queryByText(`${'x'.repeat(16)}…`)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add Series · long to the conversation' }))
    expect(onAddTarget).toHaveBeenCalledWith({
      kind: 'element', elementId: 'series[long]', elementKind: 'series', axes: null, label: 'long', current: `${'x'.repeat(60)}…`,
    }, '')
  })

  it('turns a reference-only row click into a precise composer reference without previewing', () => {
    const onAddTarget = vi.fn()
    const onPreview = vi.fn()
    panel({ onAddTarget, onPreview })
    fireEvent.click(screen.getByRole('button', { name: 'Add Series · treatment to the conversation' }))
    expect(onAddTarget).toHaveBeenCalledWith({
      kind: 'element', elementId: 'series[treatment]', elementKind: 'series', axes: 0,
      label: 'treatment', current: 'null',
    }, '')
    expect(onPreview).not.toHaveBeenCalled()
  })

  it('folds annotations after six and expands the remainder through the count chip', () => {
    const annotations = Array.from({ length: 8 }, (_, index) => element({
      id: `annotation[${String(index)}]`, kind: 'annotation', label: String(index), current: { text: String(index) },
    }))
    panel({ chart: chartState({ elements: annotations }) })
    expect(screen.queryByText('Annotation · 6')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Annotations ×2' }))
    expect(screen.getByText('Annotation · 6')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse annotations' }))
    expect(screen.queryByText('Annotation · 6')).toBeNull()
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

  it('shows the default help text with references enabled when nothing is staged', () => {
    panel()
    expect(screen.getByText('Select an element to reference, then describe your edit in chat.')).toBeTruthy()
    const button = screen.getByRole('button', { name: 'Add Title to the conversation' })
    expect(button.hasAttribute('disabled')).toBe(false)
    expect(button.hasAttribute('title')).toBe(false)
  })

  it('disables the + buttons and swaps the notice once a direct edit is staged', () => {
    panel()
    const row = expandRow('Grid')
    fireEvent.click(within(row).getByRole('checkbox'))

    expect(screen.getByText('References are unavailable until the staged edits are committed or discarded.')).toBeTruthy()
    expect(screen.queryByText('Select an element to reference, then describe your edit in chat.')).toBeNull()

    const directButton = within(row).getByRole('button', { name: 'Add Grid to the conversation' })
    expect(directButton.hasAttribute('disabled')).toBe(true)
    expect(directButton.getAttribute('title')).toBe('References are unavailable until the staged edits are committed or discarded.')

    const chipButton = screen.getByRole('button', { name: 'Add Series · treatment to the conversation' })
    expect(chipButton.hasAttribute('disabled')).toBe(true)
    expect(chipButton.getAttribute('title')).toBe('References are unavailable until the staged edits are committed or discarded.')
  })

  it('does not disable an already-added chip while edits are staged', () => {
    panel({ isTargetAdded: () => true })
    const row = expandRow('Grid')
    fireEvent.click(within(row).getByRole('checkbox'))

    const directButton = within(row).getByRole('button', { name: 'Remove Grid' })
    expect(directButton.hasAttribute('disabled')).toBe(false)
  })

  it('shows the preview-blocked notice and disables + while a preview is displayed', () => {
    panel({ referencesDisabled: true })
    expect(screen.getByText('References are unavailable while a preview is displayed.')).toBeTruthy()
    const button = screen.getByRole('button', { name: 'Add Title to the conversation' })
    expect(button.hasAttribute('disabled')).toBe(true)
    expect(button.getAttribute('title')).toBe('References are unavailable while a preview is displayed.')
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

  it('shows the rejection message when a debounced preview fails', async () => {
    const onPreview = vi.fn().mockResolvedValue({ ok: false, error: 'kernel unavailable' })
    panel({ onPreview })
    const row = expandRow('Title')
    fireEvent.change(within(row).getByLabelText('Enter text'), { target: { value: 'Preview title' } })
    await screen.findByText('Commit failed: kernel unavailable')
  })

  it('ignores a still-pending preview response after the panel unmounts', async () => {
    let resolvePreview: (outcome: { ok: true; pngBase64: string; failedOps: [] }) => void = () => {}
    const onPreview = vi.fn(() => new Promise<{ ok: true; pngBase64: string; failedOps: [] }>((resolve) => { resolvePreview = resolve }))
    const onPreviewSrc = vi.fn()
    const { view } = panel({ onPreview, onPreviewSrc })
    const row = expandRow('Title')
    fireEvent.change(within(row).getByLabelText('Enter text'), { target: { value: 'Preview title' } })
    await vi.waitFor(() => { expect(onPreview).toHaveBeenCalled() })
    onPreviewSrc.mockClear()
    view.unmount()
    resolvePreview({ ok: true, pngBase64: 'cG9zdA==', failedOps: [] })
    await Promise.resolve()
    // The debounce effect's own cleanup already ran on unmount (`live = false`),
    // so the resolved preview must never reach `onPreviewSrc` after this point.
    expect(onPreviewSrc).not.toHaveBeenCalled()
  })

  it('accumulates multiple staged ops before Save, and lists committed plus pending ops', () => {
    const chart = chartState({ ops: [{ op: 'set_title', axes: null, text: 'Old' }] })
    panel({ chart, version: 5 })
    const committed = screen.getByText('1 committed · v5 ›')
    expect(committed).toBeTruthy()
    expect(committed.closest('details')?.open).toBe(false)
    fireEvent.click(committed)
    expect(committed.closest('details')?.open).toBe(true)
    expect(screen.getByText('set_title → Title')).toBeTruthy()

    const titleRow = expandRow('Title')
    fireEvent.change(within(titleRow).getByLabelText('Enter text'), { target: { value: 'A' } })
    const yRow = expandRow('Y-axis title')
    fireEvent.change(within(yRow).getByLabelText('Enter text'), { target: { value: 'B' } })

    expect(screen.getByText('2 pending: set_title, set_axis_label')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Commit as new version' }).hasAttribute('disabled')).toBe(false)
  })

  it('Discard changes clears pending ops and is disabled with none pending', () => {
    panel()
    expect(screen.getByRole('button', { name: 'Discard changes' }).hasAttribute('disabled')).toBe(true)
    const row = expandRow('Title')
    fireEvent.change(within(row).getByLabelText('Enter text'), { target: { value: 'A' } })
    expect(screen.getByRole('button', { name: 'Discard changes' }).hasAttribute('disabled')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(screen.queryByText(/pending:/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Commit as new version' }).hasAttribute('disabled')).toBe(true)
  })

  it('reports onPendingChange(true) on the first staged op and onPendingChange(false) once Discard clears it (B4)', () => {
    const onPendingChange = vi.fn()
    panel({ onPendingChange })
    expect(onPendingChange).toHaveBeenLastCalledWith(false)
    const row = expandRow('Title')
    fireEvent.change(within(row).getByLabelText('Enter text'), { target: { value: 'A' } })
    expect(onPendingChange).toHaveBeenLastCalledWith(true)
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(onPendingChange).toHaveBeenLastCalledWith(false)
  })

  it('reports onPendingChange(false) once a successful Save clears pending ops (B4)', async () => {
    const onPendingChange = vi.fn()
    const onSave = vi.fn().mockResolvedValue({ ok: true, failedOps: [] } satisfies ScienceChartSaveOutcome)
    panel({ onSave, onPendingChange })
    const row = expandRow('Title')
    fireEvent.change(within(row).getByLabelText('Enter text'), { target: { value: 'A' } })
    expect(onPendingChange).toHaveBeenLastCalledWith(true)
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))
    await vi.waitFor(() => { expect(onPendingChange).toHaveBeenLastCalledWith(false) })
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
    expect(screen.queryByText(/pending:/)).toBeNull()
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

  it('localizes the explicit missing-font reason', async () => {
    const onSave = vi.fn().mockResolvedValue({
      ok: true, failedOps: [{ index: 0, reason: 'font_not_found' }],
    } satisfies ScienceChartSaveOutcome)
    panel({ onSave })
    const row = expandRow('Font')
    fireEvent.change(within(row).getByLabelText('Font family'), { target: { value: 'Missing' } })
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))
    expect(await screen.findByText('Change #1 did not apply: Font is not installed')).toBeTruthy()
  })

  it('keeps pending ops and shows the rejection message on failure', async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: false, error: 'stale version' } satisfies ScienceChartSaveOutcome)
    stageOneTitleEdit(onSave)
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))
    expect(await screen.findByText('Commit failed: stale version')).toBeTruthy()
    expect(screen.getByText('1 pending: set_title')).toBeTruthy()
  })

  it('staging a further change after Save clears the prior confirmation, error, and failed-op notices', async () => {
    const onSave = vi.fn()
      .mockResolvedValueOnce({ ok: true, failedOps: [{ index: 0, reason: 'gone' }] } satisfies ScienceChartSaveOutcome)
    stageOneTitleEdit(onSave)
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))
    expect(await screen.findByText('Change #1 did not apply: gone')).toBeTruthy()

    const yRow = expandRow('Y-axis title')
    fireEvent.change(within(yRow).getByLabelText('Enter text'), { target: { value: 'C' } })
    expect(screen.queryByText('Change #1 did not apply: gone')).toBeNull()
    expect(screen.queryByText('Human-edited version committed.')).toBeNull()
  })
})

describe('localized panel grouping', () => {
  const kinds = ['title', 'x_label', 'y_label', 'legend', 'grid'] as const
  const globalElements = [
    element({ id: 'title', kind: 'title', current: 'Overall' }),
    element({ id: 'font', kind: 'font' }),
  ]
  const panels = [0, 1].flatMap(axes => kinds.map(kind => element({ id: `axes[${axes}].${kind}`, kind, axes })))
  it.each([['zh', zh], ['en', en]] as const)('shows complete direct names and ordered panel headings in %s', (_locale, dictionary) => {
    const translate = makeTranslate(dictionary)
    panel({ t: translate, chart: chartState({ elements: [...panels.toReversed(), ...globalElements] }) })
    const rows = [...document.querySelectorAll('[data-editable="true"]')]
    const allowed = kinds.map(kind => ({ title: 'Title', x_label: 'XLabel', y_label: 'YLabel', legend: 'Legend', grid: 'Grid' })[kind])
      .map(key => dictionary[`panel.kind${key}` as keyof typeof dictionary])
    allowed.push(dictionary['panel.kindFont'])
    for (const row of rows) {
      const name = row.firstElementChild?.textContent
      expect(allowed).toContain(name)
      expect(name).not.toContain('axes[')
      expect(name).not.toContain('·')
    }
    const heading = screen.getByText(translate('panel.panelHeading', { index: 1 }))
    expect(screen.getByText(translate('panel.panelHeading', { index: 2 }))).toBeTruthy()
    for (const row of rows.slice(0, 2)) {
      expect(row.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })
  it('leaves single-panel direct rows without headings or suffixes', () => {
    panel({ chart: chartState({ elements: ALL_ELEMENTS }) })
    expect(screen.queryByText('Panel 1')).toBeNull()
    for (const row of document.querySelectorAll('[data-editable="true"]')) {
      expect(row.firstElementChild?.textContent).not.toContain('·')
    }
  })
  it.each([false, true])('localizes committed operation targets (multiple panels: %s)', (multi) => {
    panel({ t: makeTranslate(zh), chart: chartState({
      elements: multi ? panels : ALL_ELEMENTS,
      ops: [{ op: 'set_title', axes: 0, text: 'Changed' }],
    }) })
    expect(screen.getByText(multi ? 'set_title → 子图 1 · 标题' : 'set_title → 标题')).toBeTruthy()
  })
})

it('identifies a reference-only series by its localized panel suffix', () => {
  panel({ t: makeTranslate(zh), chart: chartState({ elements: [
    element({ id: 'axes[1].series[sales]', kind: 'series', axes: 1, label: 'Sales' }),
  ] }) })
  expect(screen.getByRole('button', { name: '将 数据系列 · Sales · 子图 2 加入对话' })).toBeTruthy()
})

it('places a color swatch after a colored element name and omits empty swatches', () => {
  panel({ chart: chartState({ elements: [
    element({ id: 'series[blue]', kind: 'series', label: 'blue', current: { color: '#006ba2' } }),
    element({ id: 'axis_range', kind: 'axis_range', current: [0, 10] }),
  ] }) })
  const colored = screen.getByRole('button', { name: 'Add Series · blue to the conversation' })
  expect(colored.firstElementChild?.textContent).toBe('Series · blue')
  expect((colored.children[1] as HTMLElement).style.backgroundColor).toBe('rgb(0, 107, 162)')
  const plain = screen.getByRole('button', { name: 'Add Axis range to the conversation' })
  expect(plain.firstElementChild?.textContent).toBe('Axis range')
  expect(plain.querySelector('[style]')).toBeNull()
})
