// @vitest-environment jsdom
/**
 * `ArtifactContent` in isolation: the top-level `previewSrc` override that
 * replaces the raster's displayed source, and the three optional chart-edit
 * callbacks a caller may omit (a read-only viewer over a version with no
 * preview/pending-edit support, distinct from `ScienceDetailsView.tsx`'s own
 * always-supplying `ArtifactTab` caller).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ScienceClientArtifactVersion } from '@deepseek-ai/dsh-science-session/types'
import { ArtifactContent } from '../src/client/ArtifactContent.tsx'
import { en } from '../src/client/locales.ts'

const t = makeTranslate(en)

afterEach(cleanup)

function chart(over: Partial<ScienceClientArtifactVersion> = {}): ScienceClientArtifactVersion {
  return {
    artifactId: 'chart-1' as never, producerSessionId: 'session-1' as never, logicalName: 'loss.png',
    version: 1, title: 'Loss', origin: 'auto', versionId: 'version-1' as never, sha256: 'a'.repeat(64),
    mediaType: 'image/png', byteCount: 100, runId: 'run-1' as never, toolCallId: 'call-1' as never,
    requestHeaderSeq: 1, turn: 1, environmentRevision: 1, environmentFingerprintPreview: 'f'.repeat(12), createdAt: 1,
    chart: {
      runtime: 'matplotlib', figureKey: 'fig', png: { width: 200, height: 100, dpi: 150 },
      hitmapStatus: 'unavailable', hitmap: [], ops: [],
      elements: [{ id: 'title', kind: 'title', axes: null, label: null, current: 'Loss' }],
    },
    ...over,
  } as ScienceClientArtifactVersion
}

function baseProps() {
  return {
    chart: chart(),
    loadImage: vi.fn().mockResolvedValue('data:image/png;base64,loaded'),
    loadText: vi.fn().mockResolvedValue(''),
    selectionTarget: undefined,
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

describe('ArtifactContent: optional chart-edit callbacks', () => {
  it('renders the chart edit panel when onPreviewChartOps, onPreviewSrc, and onPendingChartEditsChange are all omitted', () => {
    // A caller with no preview/pending-edit support (unlike ScienceDetailsView.tsx's
    // ArtifactTab, which always supplies all three) still gets a working panel:
    // Save stays reachable, it only degrades preview and pending-edit reporting.
    render(<ArtifactContent {...baseProps()} />)
    expect(screen.getByLabelText('Enter text')).toBeTruthy()
  })
})


describe('ArtifactContent: region references', () => {
  it.each([true, false])('offers region selection with chart metadata: %s', async (addressable) => {
    const props = baseProps()
    if (!addressable) {
      const { chart: _chart, ...raster } = props.chart
      props.chart = raster
    }
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
})


describe('ArtifactContent: element references', () => {
  it('keeps the image unobscured when an element with saved bounds is focused, hovered, or referenced', async () => {
    const props = baseProps()
    props.chart = chart({ chart: { ...props.chart.chart!, hitmapStatus: 'ok', hitmap: [{ id: 'title', bbox: [20, 10, 180, 30], z: 3 }] } })
    render(<ArtifactContent {...props} />)
    const image = await screen.findByRole('img')
    const reference = screen.getByRole('button', { name: 'Add Title to the conversation' })
    fireEvent.focus(reference)
    fireEvent.mouseEnter(reference.closest('li')!)
    expect(screen.queryByLabelText('Title', { selector: 'span' })).toBeNull()
    expect(props.onAddTarget).not.toHaveBeenCalled()
    fireEvent.click(reference)
    expect(props.onAddTarget).toHaveBeenCalledWith(expect.objectContaining({ kind: 'element', elementId: 'title' }), '')
    expect(image.getAttribute('src')).toBe('data:image/png;base64,loaded')
    expect(screen.queryByRole('status')).toBeNull()
  })
})
