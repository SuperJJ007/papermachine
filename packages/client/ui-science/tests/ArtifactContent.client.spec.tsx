// @vitest-environment jsdom
/**
 * `ArtifactContent` in isolation: the top-level `previewSrc` override that
 * replaces the raster's displayed source, the region-select targeting flow,
 * and `ChartEditSlot`'s chart-state fetch/mount gate for the live chart-edit
 * panel (element-level annotation targeting, direct title/legend/grid/font
 * operations).
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ScienceChartState } from '@deepseek-ai/dsh-science-session/types'
import type { ScienceEditTarget } from '@deepseek-ai/dsh-tool-science/types'
import { ArtifactContent } from '../src/client/ArtifactContent.tsx'
import type { ScienceRenderableVersion } from '../src/client/version-summaries.ts'
import { en } from '../src/client/locales.ts'

const t = makeTranslate(en)

afterEach(cleanup)

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept
    reject = decline
  })
  return { promise, resolve, reject }
}

function chart(over: Partial<ScienceRenderableVersion> = {}): ScienceRenderableVersion {
  return {
    artifactId: 'chart-1' as never, logicalName: 'loss.png',
    version: 1, title: 'Loss', versionId: 'version-1', sha256: 'a'.repeat(64),
    mediaType: 'image/png', byteCount: 100, contentOrigin: 'run-auto', createdAt: 1,
    ...over,
  }
}

function chartState(over: Partial<ScienceChartState> = {}): ScienceChartState {
  return {
    runtime: 'matplotlib', figureKey: 'loss.png', png: { width: 100, height: 80, dpi: 100 },
    elements: [{ id: 'title', kind: 'title', axes: null, label: null, current: 'Loss' }],
    ops: [], hitmap: [], hitmapStatus: 'unavailable',
    ...over,
  }
}

function baseProps() {
  return {
    chart: chart(),
    loadImage: vi.fn().mockResolvedValue('data:image/png;base64,loaded'),
    loadText: vi.fn().mockResolvedValue(''),
    loadChartState: vi.fn().mockResolvedValue(null),
    selectionTarget: undefined as ScienceEditTarget | undefined,
    onSelectTarget: vi.fn(),
    isTargetAdded: vi.fn().mockReturnValue(false),
    targetComment: vi.fn().mockReturnValue(''),
    onAddTarget: vi.fn(),
    onRemoveTarget: vi.fn(),
    onSaveChartOps: vi.fn().mockResolvedValue({ ok: true, failedOps: [] }),
    t,
  }
}

describe('ArtifactContent: previewSrc override', () => {
  it('shows the loaded image when no preview override is given', async () => {
    render(<ArtifactContent {...baseProps()} />)
    await screen.findByRole('img')
    expect(document.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,loaded')
  })

  it('overrides the displayed source with previewSrc, ahead of the loaded image', () => {
    render(<ArtifactContent {...baseProps()} previewSrc="data:image/png;base64,preview" />)
    expect(document.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,preview')
  })
})

describe('ArtifactContent: region references', () => {
  it('offers region selection over the raster regardless of chart-edit-panel availability', async () => {
    const props = baseProps()
    render(<ArtifactContent {...props} />)
    await screen.findByRole('img')
    fireEvent.click(screen.getByRole('button', { name: 'Select region to edit' }))
    expect(screen.getByLabelText('Drag to select an edit region')).toBeTruthy()
  })

  it('blocks references against an unsaved preview, then restores selection on discard', () => {
    const props = baseProps()
    const view = render(<ArtifactContent {...props} previewSrc="data:image/png;base64,preview" />)
    expect(screen.getByRole('button', { name: 'Select region to edit' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('Save or discard the preview before referencing elements or selecting a region.')).toBeTruthy()
    view.rerender(<ArtifactContent {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Select region to edit' }))
    expect(screen.getByLabelText('Drag to select an edit region')).toBeTruthy()
  })

  it('draws a clamped region, ignores empty gestures, and clears an abandoned drag', async () => {
    const props = baseProps()
    render(<ArtifactContent {...props} />)
    await screen.findByRole('img')
    fireEvent.click(screen.getByRole('button', { name: 'Select region to edit' }))
    const gesture = screen.getByLabelText('Drag to select an edit region')
    vi.spyOn(gesture, 'getBoundingClientRect').mockReturnValue({
      left: 10, top: 20, width: 100, height: 200, right: 110, bottom: 220,
      x: 10, y: 20, toJSON: () => ({}),
    })

    fireEvent.mouseMove(gesture, { clientX: 50, clientY: 100 })
    fireEvent.mouseUp(gesture, { clientX: 50, clientY: 100 })
    fireEvent.mouseDown(gesture, { clientX: 20, clientY: 40 })
    fireEvent.mouseUp(gesture, { clientX: 20, clientY: 40 })
    expect(props.onSelectTarget).not.toHaveBeenCalled()

    fireEvent.mouseDown(gesture, { clientX: 0, clientY: 40 })
    fireEvent.mouseMove(gesture, { clientX: 140, clientY: 240 })
    expect(document.querySelector('[class*="regionBox"]')).not.toBeNull()
    fireEvent.mouseLeave(gesture)
    expect(document.querySelector('[class*="regionBox"]')).toBeNull()

    fireEvent.mouseDown(gesture, { clientX: 0, clientY: 40 })
    fireEvent.mouseUp(gesture, { clientX: 140, clientY: 240 })
    expect(props.onSelectTarget).toHaveBeenCalledWith({
      kind: 'normalized-region', x: 0, y: 0.1, width: 1, height: 0.9,
    })
    expect(screen.getByRole('button', { name: 'Select region to edit' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('adds, updates, and removes one staged region comment', async () => {
    const target = { kind: 'normalized-region' as const, x: 0.1, y: 0.2, width: 0.3, height: 0.4 }
    const props = baseProps()
    props.selectionTarget = target
    props.targetComment.mockReturnValue('existing')
    const view = render(<ArtifactContent {...props} />)
    await screen.findByRole('img')
    const input = screen.getByRole('textbox', { name: 'Edit note for region 10%,20%' })
    expect((input as HTMLInputElement).value).toBe('existing')
    fireEvent.change(input, { target: { value: 'new note' } })
    expect(props.onAddTarget).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Add region 10%,20% to the conversation' }))
    expect(props.onAddTarget).toHaveBeenCalledWith(target, 'new note')

    props.isTargetAdded.mockReturnValue(true)
    view.rerender(<ArtifactContent {...props} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit note for region 10%,20%' }), { target: { value: 'updated' } })
    expect(props.onAddTarget).toHaveBeenLastCalledWith(target, 'updated')
    fireEvent.click(screen.getByRole('button', { name: 'Remove region 10%,20%' }))
    expect(props.onRemoveTarget).toHaveBeenCalledWith(target)
  })

  it('disables an unstaged region action while a preview is open', () => {
    const props = baseProps()
    props.selectionTarget = { kind: 'normalized-region', x: 0.2, y: 0.3, width: 0.1, height: 0.1 }
    render(<ArtifactContent {...props} previewSrc="data:image/png;base64,preview" />)
    expect(screen.getByRole('button', { name: 'Add region 20%,30% to the conversation' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('textbox', { name: 'Edit note for region 20%,30%' }).hasAttribute('disabled')).toBe(true)
  })
})

describe('ArtifactContent: chart-edit panel mount', () => {
  it('mounts the panel once loadChartState resolves a non-null chart', async () => {
    const props = baseProps()
    props.loadChartState = vi.fn().mockResolvedValue(chartState())
    render(<ArtifactContent {...props} />)
    await screen.findByRole('button', { name: 'Discard changes' })
    expect(props.loadChartState).toHaveBeenCalledWith(props.chart)
  })

  it('renders nothing for the panel when loadChartState resolves null', async () => {
    const props = baseProps()
    render(<ArtifactContent {...props} />)
    await screen.findByRole('img')
    expect(props.loadChartState).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Discard changes' })).toBeNull()
  })

  it('renders nothing for the panel when loadChartState rejects', async () => {
    const props = baseProps()
    props.loadChartState = vi.fn().mockRejectedValue(new Error('nope'))
    render(<ArtifactContent {...props} />)
    await screen.findByRole('img')
    await vi.waitFor(() => { expect(props.loadChartState).toHaveBeenCalledOnce() })
    expect(screen.queryByRole('button', { name: 'Discard changes' })).toBeNull()
  })

  it('ignores a chart-state rejection that settles after unmount', async () => {
    const pending = deferred<ScienceChartState | null>()
    const props = baseProps()
    props.loadChartState = vi.fn().mockReturnValue(pending.promise)
    const view = render(<ArtifactContent {...props} />)
    view.unmount()
    pending.reject(new Error('late failure'))
    await pending.promise.catch(() => undefined)
  })

  it('ignores chart state that resolves after unmount', async () => {
    const pending = deferred<ScienceChartState | null>()
    const props = baseProps()
    props.loadChartState = vi.fn().mockReturnValue(pending.promise)
    const view = render(<ArtifactContent {...props} />)
    view.unmount()
    pending.resolve(chartState())
    await pending.promise
  })

  it('passes the optional preview callbacks to a mounted chart editor', async () => {
    const props = baseProps()
    props.loadChartState = vi.fn().mockResolvedValue(chartState())
    render(
      <ArtifactContent
        {...props}
        onPreviewChartOps={vi.fn().mockResolvedValue({ ok: true, pngBase64: '', failedOps: [] })}
        onPreviewSrc={vi.fn()}
        onPendingChartEditsChange={vi.fn()}
      />,
    )
    expect(await screen.findByRole('button', { name: 'Discard changes' })).toBeTruthy()
  })

  it('fetches chart state exactly once per mounted PNG version, not once per re-render', async () => {
    const props = baseProps()
    props.loadChartState = vi.fn().mockResolvedValue(chartState())
    const view = render(<ArtifactContent {...props} />)
    await screen.findByRole('button', { name: 'Discard changes' })
    // Re-render with the exact same versionId and the same `loadChartState`
    // reference: the effect's dependency array does not change, so the
    // fetch must not fire again.
    view.rerender(<ArtifactContent {...props} previewSrc="data:image/png;base64,preview" />)
    expect(props.loadChartState).toHaveBeenCalledOnce()
  })

  it('never mounts the panel for a text artifact', async () => {
    const props = baseProps()
    props.chart = chart({ mediaType: 'text/plain' })
    props.loadText = vi.fn().mockResolvedValue('plain text body')
    props.loadChartState = vi.fn().mockResolvedValue(chartState())
    render(<ArtifactContent {...props} />)
    await screen.findByText('plain text body')
    expect(props.loadChartState).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Discard changes' })).toBeNull()
  })
})

describe('ArtifactContent: text content and human-edit ancestry', () => {
  it('dispatches text content by media type and shows the caption when present', async () => {
    const props = baseProps()
    props.chart = chart({ mediaType: 'text/plain', caption: 'A caption' })
    props.loadText = vi.fn().mockResolvedValue('plain text body')
    render(<ArtifactContent {...props} />)
    await screen.findByText('plain text body')
    expect(screen.getByText('A caption')).toBeTruthy()
  })

  it('names the immediately preceding version for a human-edit version, without a parent reference', async () => {
    const props = baseProps()
    props.chart = chart({ version: 3, contentOrigin: 'human-edit' })
    render(<ArtifactContent {...props} />)
    await screen.findByRole('img')
    expect(screen.getByText('Human style edit based on v2')).toBeTruthy()
  })

  it('shows a text load failure and retries the exact version', async () => {
    const props = baseProps()
    props.chart = chart({ mediaType: 'text/plain' })
    props.loadText = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('recovered')
    render(<ArtifactContent {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Failed to load, click to retry' }))
    expect(await screen.findByText('recovered')).toBeTruthy()
    expect(props.loadText).toHaveBeenCalledTimes(2)
  })

  it('ignores text resolution and rejection after their mounts are gone', async () => {
    const resolution = deferred<string>()
    const first = baseProps()
    first.chart = chart({ mediaType: 'text/plain' })
    first.loadText = vi.fn().mockReturnValue(resolution.promise)
    const resolvedView = render(<ArtifactContent {...first} />)
    resolvedView.unmount()
    resolution.resolve('late text')
    await resolution.promise

    const rejection = deferred<string>()
    const second = baseProps()
    second.chart = chart({ mediaType: 'text/plain' })
    second.loadText = vi.fn().mockReturnValue(rejection.promise)
    const rejectedView = render(<ArtifactContent {...second} />)
    rejectedView.unmount()
    rejection.reject(new Error('late failure'))
    await rejection.promise.catch(() => undefined)
  })

  it('renders CSV, invokes its localized sort label, and reports a row cap', async () => {
    const props = baseProps()
    props.chart = chart({ mediaType: 'text/csv', logicalName: 'large.csv' })
    props.loadText = vi.fn().mockResolvedValue([
      'name,value',
      'short',
      ...Array.from({ length: 500 }, (_, index) => `row-${String(index)},${String(index)}`),
    ].join('\n'))
    render(<ArtifactContent {...props} />)
    const table = await screen.findByRole('table', { name: 'large.csv' })
    expect(table).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Sort by value' }))
    expect(screen.getByRole('status').textContent).toBe('Showing first 500 of 501 rows.')
  })

  it.each([
    ['application/json', '{"answer":42}', 'answer:'],
    ['application/json', 'not json', 'not json'],
    ['application/json', '42', '42'],
    ['text/markdown', '# Results', 'Results'],
  ] as const)('renders %s content through its matching body', async (mediaType, text, expected) => {
    const props = baseProps()
    props.chart = chart({ mediaType })
    props.loadText = vi.fn().mockResolvedValue(text)
    render(<ArtifactContent {...props} />)
    expect(await screen.findByText(expected)).toBeTruthy()
  })

  it('caps oversized plain text and reports the original character count', async () => {
    const props = baseProps()
    props.chart = chart({ mediaType: 'text/plain' })
    props.loadText = vi.fn().mockResolvedValue('x'.repeat(100_001))
    render(<ArtifactContent {...props} />)
    await waitFor(() => { expect(document.querySelector('pre')?.textContent?.length).toBe(100_000) })
    expect(screen.getByRole('status').textContent).toBe('Showing first 100000 of 100001 characters.')
  })
})
