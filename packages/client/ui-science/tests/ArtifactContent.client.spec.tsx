// @vitest-environment jsdom
/**
 * `ArtifactContent` in isolation: the top-level `previewSrc` override that
 * replaces the raster's displayed source, and the region-select targeting
 * flow. The live chart-edit panel (element-level annotation targeting,
 * direct title/legend/grid/font operations) is not covered here: it never
 * mounts, since no client-facing read path supplies its `ScienceChartState`
 * — see `ArtifactContent.tsx`'s own JSDoc and the package README's Known
 * Limitation.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { ArtifactContent } from '../src/client/ArtifactContent.tsx'
import type { ScienceRenderableVersion } from '../src/client/version-summaries.ts'
import { en } from '../src/client/locales.ts'

const t = makeTranslate(en)

afterEach(cleanup)

function chart(over: Partial<ScienceRenderableVersion> = {}): ScienceRenderableVersion {
  return {
    artifactId: 'chart-1' as never, logicalName: 'loss.png',
    version: 1, title: 'Loss', versionId: 'version-1', sha256: 'a'.repeat(64),
    mediaType: 'image/png', byteCount: 100, contentOrigin: 'run-auto', createdAt: 1,
    ...over,
  }
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
})
