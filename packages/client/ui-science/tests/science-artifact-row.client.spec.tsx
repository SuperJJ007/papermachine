// @vitest-environment jsdom
// Dedicated annotate_artifact row: lifecycle states, presentation parsing
// (valid single-item image or non-image, stale/absent/invalid falls back to
// a plain row), the compact settled-row content (thumbnail or file-type
// tile, logical name, version, title — no caption/dimensions), activating
// the row selects the exact version and opens the Details column, the
// thumbnail's hover control never triggers that activation, and image
// loading through the owner-supplied loadImage.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RunningToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { ScienceArtifactRow } from '../src/client/ScienceArtifactRow.tsx'
import { zh } from '../src/client/locales.ts'
import { testScienceSelectionStore } from './selection-store-test-helpers.client.ts'

type ScienceArtifactRowProps = Parameters<typeof ScienceArtifactRow>[0]

const t: ScienceArtifactRowProps['t'] = makeTranslate(zh, commonZh)

afterEach(cleanup)

const validMeta = {
  kind: 'science/artifact', version: 1,
  artifacts: [{
    artifactId: 'chart-1', logicalName: 'loss-curve.png', version: 2,
    title: 'Loss curve',
    attachment: { attachmentId: 'sha256:abc', mediaType: 'image/png', bytes: 2048, width: 640, height: 480, name: 'loss.png' },
  }],
}

const validTextMeta = {
  kind: 'science/artifact', version: 1,
  artifacts: [{
    artifactId: 'chart-2', logicalName: 'summary.csv', version: 1,
    title: 'Result summary',
    attachment: { attachmentId: 'sha256:def', mediaType: 'text/csv', bytes: 512 },
  }],
}

function settled(over: Partial<ToolResultNode> = {}): ToolResultNode {
  return {
    kind: 'tool-result',
    seq: 3,
    time: 3_000,
    callId: 'call-artifact',
    call: { name: 'annotate_artifact', argsRaw: '{}' },
    callTime: 2_000,
    content: [{ type: 'text', text: 'artifact "loss-curve.png" v2 (chart-1) curated from run run-1' }],
    isError: false,
    callView: null,
    resultView: null,
    subCalls: [],
    ...over,
  }
}

function running(): RunningToolCall {
  return { callId: 'call-artifact', name: 'annotate_artifact', argsRaw: '{}', turn: 1, step: 1, time: 2_000, callView: null, subCalls: [] }
}

function props(
  block: ScienceArtifactRowProps['block'],
  over: { load?: ScienceArtifactRowProps['loadImage']; openDetailsView?: (id: string) => void; store?: ReturnType<typeof testScienceSelectionStore> } = {},
): ScienceArtifactRowProps {
  const store = over.store ?? testScienceSelectionStore()
  return {
    callId: block.callId,
    toolName: 'annotate_artifact',
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
  } as unknown as ScienceArtifactRowProps
}

describe('ScienceArtifactRow', () => {
  it('shows a running row while the call is in flight', () => {
    const view = render(<ScienceArtifactRow {...props(running())} />)
    expect(view.container.querySelector('[data-tool="science-artifact"]')?.getAttribute('data-state')).toBe('running')
    expect(view.container.textContent).toContain('正在标注文件')
  })

  it('renders the compact row with logical name, version, and title, but no caption or dimensions, for an image artifact', async () => {
    const load = vi.fn().mockResolvedValue('blob:fake-url')
    const view = render(<ScienceArtifactRow {...props(settled({ meta: validMeta }), { load })} />)
    expect(view.container.textContent).toContain('Loss curve')
    expect(view.container.textContent).toContain('loss-curve.png')
    expect(view.container.textContent).toContain('v2')
    await waitFor(() => { expect(load).toHaveBeenCalledTimes(1) })
    expect(load.mock.calls[0]?.[0]).toMatchObject({ attachmentId: 'sha256:abc', mediaType: 'image/png' })
    await waitFor(() => { expect(view.container.querySelector('img')).not.toBeNull() })
  })

  it('renders a file-type tile (never an <img>, never loadImage) for a non-image artifact', () => {
    const load = vi.fn()
    const view = render(<ScienceArtifactRow {...props(settled({ meta: validTextMeta }), { load })} />)
    expect(view.container.textContent).toContain('Result summary')
    expect(view.container.textContent).toContain('summary.csv')
    expect(view.container.textContent).toContain('CSV')
    expect(view.container.querySelector('img')).toBeNull()
    expect(load).not.toHaveBeenCalled()
  })

  it('activating the row opens the exact artifact version\'s tab and opens the Science Details entry', () => {
    const openDetailsView = vi.fn()
    const store = testScienceSelectionStore()
    const view = render(<ScienceArtifactRow {...props(settled({ meta: validMeta }), { openDetailsView, store })} />)
    view.getByText('Loss curve').click()
    expect(store.instance.getSnapshot().openArtifacts).toEqual([{ artifactId: 'chart-1', version: 2 }])
    expect(store.instance.getSnapshot().activeArtifactId).toBe('chart-1')
    expect(openDetailsView).toHaveBeenCalledWith('science')
  })

  it('activates on Enter/Space and ignores every other key', () => {
    const openDetailsView = vi.fn()
    const store = testScienceSelectionStore()
    const view = render(<ScienceArtifactRow {...props(settled({ meta: validMeta }), { openDetailsView, store })} />)
    const row = view.container.querySelector('[data-tool="science-artifact"]') as HTMLElement
    fireEvent.keyDown(row, { key: 'a' })
    expect(openDetailsView).not.toHaveBeenCalled()
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(openDetailsView).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(row, { key: ' ' })
    expect(openDetailsView).toHaveBeenCalledTimes(2)
  })

  it('the thumbnail wrapper stops a keydown from also reaching the row\'s activation handler', () => {
    const openDetailsView = vi.fn()
    const view = render(<ScienceArtifactRow {...props(settled({ meta: validMeta }), { openDetailsView })} />)
    const hint = view.container.querySelector('[aria-hidden="true"]') as HTMLElement
    fireEvent.keyDown(hint, { key: 'Enter' })
    expect(openDetailsView).not.toHaveBeenCalled()
  })

  it('the thumbnail wrapper lets every other key reach window, so the lightbox still closes on Escape', () => {
    // ImageLightbox closes from a `window` keydown listener. React's synthetic
    // stopPropagation stops the native event at its root container, below
    // `window`, so a blanket stop here would make the thumbnail's own lightbox
    // undismissable — only Enter and Space may be swallowed.
    const view = render(<ScienceArtifactRow {...props(settled({ meta: validMeta }))} />)
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

  it('the thumbnail\'s hover control never opens a tab or opens the Details column', () => {
    const openDetailsView = vi.fn()
    const store = testScienceSelectionStore()
    const view = render(<ScienceArtifactRow {...props(settled({ meta: validMeta }), { openDetailsView, store })} />)
    const hint = view.container.querySelector('[aria-hidden="true"]')
    expect(hint).not.toBeNull()
    ;(hint as HTMLElement).click()
    expect(openDetailsView).not.toHaveBeenCalled()
    expect(store.instance.getSnapshot().openArtifacts).toEqual([])
  })

  it('falls back to a plain row with the rendered text when metadata is absent', () => {
    const view = render(<ScienceArtifactRow {...props(settled({ meta: undefined }))} />)
    expect(view.container.querySelector('[data-tool="science-artifact"]')?.getAttribute('data-state')).toBe('ok')
    expect(view.container.textContent).toContain('artifact "loss-curve.png" v2 (chart-1) curated from run run-1')
    expect(view.container.querySelector('img')).toBeNull()
  })

  it('falls back to a plain row when metadata has an unrecognized kind or version', () => {
    const wrongKind = render(<ScienceArtifactRow {...props(settled({ meta: { ...validMeta, kind: 'science/other' } }))} />)
    expect(wrongKind.container.querySelector('img')).toBeNull()
    cleanup()
    const wrongVersion = render(<ScienceArtifactRow {...props(settled({ meta: { ...validMeta, version: 2 } }))} />)
    expect(wrongVersion.container.querySelector('img')).toBeNull()
  })

  it('falls back to a plain row when the artifacts list is empty or has more than one entry', () => {
    const empty = render(<ScienceArtifactRow {...props(settled({ meta: { ...validMeta, artifacts: [] } }))} />)
    expect(empty.container.querySelector('img')).toBeNull()
    cleanup()
    const many = render(<ScienceArtifactRow {...props(settled({
      meta: { ...validMeta, artifacts: [validMeta.artifacts[0], validMeta.artifacts[0]] },
    }))} />)
    expect(many.container.querySelector('img')).toBeNull()
  })

  it('falls back to a plain row when the attachment metadata is malformed', () => {
    const view = render(<ScienceArtifactRow {...props(settled({
      meta: { ...validMeta, artifacts: [{ ...validMeta.artifacts[0], attachment: { ...validMeta.artifacts[0]?.attachment, bytes: '2048' } }] },
    }))} />)
    expect(view.container.querySelector('img')).toBeNull()
  })

  it('renders an error row without a presentation card even when meta is present', () => {
    const view = render(<ScienceArtifactRow {...props(settled({
      meta: validMeta, isError: true, error: { name: 'Error', code: 'failed' },
      content: [{ type: 'text', text: 'boom' }],
    }))} />)
    expect(view.container.querySelector('[data-tool="science-artifact"]')?.getAttribute('data-state')).toBe('error')
    expect(view.container.textContent).toContain('文件标注失败')
    expect(view.container.textContent).toContain('boom')
    expect(view.container.querySelector('img')).toBeNull()
  })

  it.each([
    { name: 'InterruptedError', code: 'interrupted' },
    { name: 'AbortError', code: 'ABORTED' },
  ])('renders a stopped row for $code', (error) => {
    const view = render(<ScienceArtifactRow {...props(settled({ error }))} />)
    expect(view.container.querySelector('[data-tool="science-artifact"]')?.getAttribute('data-state')).toBe('stopped')
    expect(view.container.textContent).toContain('文件标注已中止')
  })

  it('rejects every individually malformed presentation field', () => {
    const item = validMeta.artifacts[0]
    const breakages: Record<string, unknown>[] = [
      { artifactId: 1 },
      { version: 'two' },
      { title: 1 },
      { attachment: 'not-an-object' },
      { attachment: { ...item?.attachment, attachmentId: 1 } },
      { attachment: { ...item?.attachment, mediaType: 1 } },
      { attachment: { ...item?.attachment, bytes: '2048' } },
      { attachment: { ...item?.attachment, width: 'wide' } },
      { attachment: { ...item?.attachment, height: 'tall' } },
      { attachment: { ...item?.attachment, name: 1 } },
    ]
    for (const breakage of breakages) {
      const view = render(<ScienceArtifactRow {...props(settled({ meta: { ...validMeta, artifacts: [{ ...item, ...breakage }] } }))} />)
      expect(view.container.querySelector('img')).toBeNull()
      cleanup()
    }
  })

  it('omits the attachment display name when the durable reference carries none', async () => {
    const item = validMeta.artifacts[0]
    const { name: _name, ...attachmentWithoutName } = item?.attachment ?? {}
    const load = vi.fn().mockResolvedValue('blob:fake-url')
    render(<ScienceArtifactRow {...props(settled({
      meta: { ...validMeta, artifacts: [{ ...item, attachment: attachmentWithoutName }] },
    }), { load })} />)
    await waitFor(() => { expect(load).toHaveBeenCalledTimes(1) })
    expect(load.mock.calls[0]?.[0]).not.toHaveProperty('name')
  })

  it('falls back to a plain row with no text when the durable content is empty', () => {
    const view = render(<ScienceArtifactRow {...props(settled({ meta: undefined, content: [] }))} />)
    expect(view.container.querySelector('pre')).toBeNull()
  })

  it('renders non-text durable content as formatted JSON in the fallback row', () => {
    const view = render(<ScienceArtifactRow {...props(settled({ meta: undefined, content: [{ type: 'reasoning', text: 'note' }] }))} />)
    expect(view.container.textContent).toContain('"type": "reasoning"')
  })

  it('shows a retry control and recovers when the image load fails then succeeds', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce('blob:fake-url')
    render(<ScienceArtifactRow {...props(settled({ meta: validMeta }), { load })} />)
    const retry = await screen.findByRole('button', { name: '加载失败，点击重试' })
    retry.click()
    await waitFor(() => { expect(load).toHaveBeenCalledTimes(2) })
  })
})
