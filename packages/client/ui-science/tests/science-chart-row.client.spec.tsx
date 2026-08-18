// @vitest-environment jsdom
// Dedicated save_chart row: lifecycle states, presentation parsing (valid,
// stale/absent/invalid falls back to a plain row), the compact settled-row
// content (thumbnail, logical name, version, title — no caption/dimensions),
// activating the row selects the exact version and opens the Details
// column, the thumbnail's hover control never triggers that activation, and
// image loading through the owner-supplied loadImage.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RunningToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { ScienceChartRow } from '../src/client/ScienceChartRow.tsx'
import { zh } from '../src/client/locales.ts'
import { testScienceSelectionStore } from './selection-store-test-helpers.client.ts'

type ScienceChartRowProps = Parameters<typeof ScienceChartRow>[0]

const t: ScienceChartRowProps['t'] = makeTranslate(zh, commonZh)

afterEach(cleanup)

const validMeta = {
  kind: 'science/chart', version: 1,
  chartId: 'chart-1', logicalName: 'loss-curve', chartVersion: 2,
  title: 'Loss curve', caption: 'Training loss over epochs',
  runId: 'run-1',
  attachment: { attachmentId: 'sha256:abc', mediaType: 'image/png', bytes: 2048, width: 640, height: 480, name: 'loss.png' },
  createdAt: 1000,
}

function settled(over: Partial<ToolResultNode> = {}): ToolResultNode {
  return {
    kind: 'tool-result',
    seq: 3,
    time: 3_000,
    callId: 'call-chart',
    call: { name: 'save_chart', argsRaw: '{}' },
    callTime: 2_000,
    content: [{ type: 'text', text: 'chart "loss-curve" v2 (chart-1) saved from run run-1' }],
    isError: false,
    callView: null,
    resultView: null,
    subCalls: [],
    ...over,
  }
}

function running(): RunningToolCall {
  return { callId: 'call-chart', name: 'save_chart', argsRaw: '{}', turn: 1, step: 1, time: 2_000, callView: null, subCalls: [] }
}

function props(
  block: ScienceChartRowProps['block'],
  over: { load?: ScienceChartRowProps['loadImage']; openDetailsView?: (id: string) => void; store?: ReturnType<typeof testScienceSelectionStore> } = {},
): ScienceChartRowProps {
  const store = over.store ?? testScienceSelectionStore()
  return {
    callId: block.callId,
    toolName: 'save_chart',
    block,
    openFile: vi.fn(),
    cwd: undefined,
    loadImage: over.load ?? vi.fn().mockResolvedValue('blob:fake-url'),
    openDetailsView: over.openDetailsView ?? vi.fn(),
    useStore: store.useStore,
    actions: store.actions,
    useProjection: vi.fn(),
    sessionId: 'session-1',
    t,
  } as unknown as ScienceChartRowProps
}

describe('ScienceChartRow', () => {
  it('shows a running row while the call is in flight', () => {
    const view = render(<ScienceChartRow {...props(running())} />)
    expect(view.container.querySelector('[data-tool="science-chart"]')?.getAttribute('data-state')).toBe('running')
    expect(view.container.textContent).toContain('正在保存图表')
  })

  it('renders the compact row with logical name, version, and title, but no caption or dimensions', async () => {
    const load = vi.fn().mockResolvedValue('blob:fake-url')
    const view = render(<ScienceChartRow {...props(settled({ meta: validMeta }), { load })} />)
    expect(view.container.textContent).toContain('Loss curve')
    expect(view.container.textContent).toContain('loss-curve')
    expect(view.container.textContent).toContain('v2')
    expect(view.container.textContent).not.toContain('Training loss over epochs')
    expect(view.container.textContent).not.toContain('2.0 KB')
    await waitFor(() => { expect(load).toHaveBeenCalledTimes(1) })
    expect(load.mock.calls[0]?.[0]).toMatchObject({ attachmentId: 'sha256:abc', mediaType: 'image/png' })
    await waitFor(() => { expect(view.container.querySelector('img')).not.toBeNull() })
  })

  it('activating the row selects the exact artifact version and opens the Science Details entry', () => {
    const openDetailsView = vi.fn()
    const store = testScienceSelectionStore()
    const view = render(<ScienceChartRow {...props(settled({ meta: validMeta }), { openDetailsView, store })} />)
    view.getByText('Loss curve').click()
    expect(store.instance.getSnapshot().selected).toEqual({ chartId: 'chart-1', version: 2 })
    expect(openDetailsView).toHaveBeenCalledWith('science')
  })

  it('activates on Enter/Space and ignores every other key', () => {
    const openDetailsView = vi.fn()
    const store = testScienceSelectionStore()
    const view = render(<ScienceChartRow {...props(settled({ meta: validMeta }), { openDetailsView, store })} />)
    const row = view.container.querySelector('[data-tool="science-chart"]') as HTMLElement
    fireEvent.keyDown(row, { key: 'a' })
    expect(openDetailsView).not.toHaveBeenCalled()
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(openDetailsView).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(row, { key: ' ' })
    expect(openDetailsView).toHaveBeenCalledTimes(2)
  })

  it('the thumbnail wrapper stops a keydown from also reaching the row\'s activation handler', () => {
    const openDetailsView = vi.fn()
    const view = render(<ScienceChartRow {...props(settled({ meta: validMeta }), { openDetailsView })} />)
    const hint = view.container.querySelector('[aria-hidden="true"]') as HTMLElement
    fireEvent.keyDown(hint, { key: 'Enter' })
    expect(openDetailsView).not.toHaveBeenCalled()
  })

  it('the thumbnail wrapper lets every other key reach window, so the lightbox still closes on Escape', () => {
    // ImageLightbox closes from a `window` keydown listener. React's synthetic
    // stopPropagation stops the native event at its root container, below
    // `window`, so a blanket stop here would make the thumbnail's own lightbox
    // undismissable — only Enter and Space may be swallowed.
    const view = render(<ScienceChartRow {...props(settled({ meta: validMeta }))} />)
    const hint = view.container.querySelector('[aria-hidden="true"]') as HTMLElement
    const seen: string[] = []
    const listener = (event: KeyboardEvent): void => { seen.push(event.key) }
    window.addEventListener('keydown', listener)
    try {
      fireEvent.keyDown(hint, { key: 'Escape' })
      fireEvent.keyDown(hint, { key: 'Enter' })
    } finally {
      window.removeEventListener('keydown', listener)
    }
    expect(seen).toEqual(['Escape'])
  })

  it('the thumbnail\'s hover control never selects the version or opens the Details column', () => {
    const openDetailsView = vi.fn()
    const store = testScienceSelectionStore()
    const view = render(<ScienceChartRow {...props(settled({ meta: validMeta }), { openDetailsView, store })} />)
    const hint = view.container.querySelector('[aria-hidden="true"]')
    expect(hint).not.toBeNull()
    ;(hint as HTMLElement).click()
    expect(openDetailsView).not.toHaveBeenCalled()
    expect(store.instance.getSnapshot().selected).toBeNull()
  })

  it('omits the caption paragraph when the presentation carries none (compact row never renders one)', () => {
    const { caption: _caption, ...withoutCaption } = validMeta
    const view = render(<ScienceChartRow {...props(settled({ meta: withoutCaption }))} />)
    expect(view.container.textContent).not.toContain('Training loss over epochs')
  })

  it('falls back to a plain row with the rendered text when metadata is absent', () => {
    const view = render(<ScienceChartRow {...props(settled({ meta: undefined }))} />)
    expect(view.container.querySelector('[data-tool="science-chart"]')?.getAttribute('data-state')).toBe('ok')
    expect(view.container.textContent).toContain('chart "loss-curve" v2 (chart-1) saved from run run-1')
    expect(view.container.querySelector('img')).toBeNull()
  })

  it('falls back to a plain row when metadata has an unrecognized kind or version', () => {
    const wrongKind = render(<ScienceChartRow {...props(settled({ meta: { ...validMeta, kind: 'science/other' } }))} />)
    expect(wrongKind.container.querySelector('img')).toBeNull()
    cleanup()
    const wrongVersion = render(<ScienceChartRow {...props(settled({ meta: { ...validMeta, version: 2 } }))} />)
    expect(wrongVersion.container.querySelector('img')).toBeNull()
  })

  it('falls back to a plain row when the attachment metadata is malformed', () => {
    const view = render(<ScienceChartRow {...props(settled({ meta: { ...validMeta, attachment: { ...validMeta.attachment, mediaType: 'application/pdf' } } }))} />)
    expect(view.container.querySelector('img')).toBeNull()
  })

  it('renders an error row without a presentation card even when meta is present', () => {
    const view = render(<ScienceChartRow {...props(settled({
      meta: validMeta, isError: true, error: { name: 'Error', code: 'failed' },
      content: [{ type: 'text', text: 'boom' }],
    }))} />)
    expect(view.container.querySelector('[data-tool="science-chart"]')?.getAttribute('data-state')).toBe('error')
    expect(view.container.textContent).toContain('图表保存失败')
    expect(view.container.textContent).toContain('boom')
    expect(view.container.querySelector('img')).toBeNull()
  })

  it('renders a stopped row for an interrupted call', () => {
    const view = render(<ScienceChartRow {...props(settled({ error: { name: 'InterruptedError', code: 'interrupted' } }))} />)
    expect(view.container.querySelector('[data-tool="science-chart"]')?.getAttribute('data-state')).toBe('stopped')
    expect(view.container.textContent).toContain('图表保存已中止')
  })

  it('rejects every individually malformed presentation field', () => {
    const breakages: Record<string, unknown>[] = [
      { chartId: 1 },
      { chartVersion: 'two' },
      { runId: 1 },
      { caption: 1 },
      { attachment: 'not-an-object' },
      { attachment: { ...validMeta.attachment, attachmentId: 1 } },
      { attachment: { ...validMeta.attachment, bytes: '2048' } },
      { attachment: { ...validMeta.attachment, name: 1 } },
    ]
    for (const breakage of breakages) {
      const view = render(<ScienceChartRow {...props(settled({ meta: { ...validMeta, ...breakage } }))} />)
      expect(view.container.querySelector('img')).toBeNull()
      cleanup()
    }
  })

  it('omits the attachment display name when the durable reference carries none', async () => {
    const { name: _name, ...attachmentWithoutName } = validMeta.attachment
    const load = vi.fn().mockResolvedValue('blob:fake-url')
    render(<ScienceChartRow {...props(settled({ meta: { ...validMeta, attachment: attachmentWithoutName } }), { load })} />)
    await waitFor(() => { expect(load).toHaveBeenCalledTimes(1) })
    expect(load.mock.calls[0]?.[0]).not.toHaveProperty('name')
  })

  it('falls back to a plain row with no text when the durable content is empty', () => {
    const view = render(<ScienceChartRow {...props(settled({ meta: undefined, content: [] }))} />)
    expect(view.container.querySelector('pre')).toBeNull()
  })

  it('renders non-text durable content as formatted JSON in the fallback row', () => {
    const view = render(<ScienceChartRow {...props(settled({ meta: undefined, content: [{ type: 'reasoning', text: 'note' }] }))} />)
    expect(view.container.textContent).toContain('"type": "reasoning"')
  })

  it('shows a retry control and recovers when the image load fails then succeeds', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce('blob:fake-url')
    render(<ScienceChartRow {...props(settled({ meta: validMeta }), { load })} />)
    const retry = await screen.findByRole('button', { name: '加载失败，点击重试' })
    retry.click()
    await waitFor(() => { expect(load).toHaveBeenCalledTimes(2) })
  })
})
