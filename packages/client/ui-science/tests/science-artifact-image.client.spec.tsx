// @vitest-environment jsdom
/** Project-store images preserve the conversation image interaction states. */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MessageImageLabels } from '@deepseek-ai/dsh-client-ui-attachment/src/MessageImage.tsx'
import { ScienceArtifactImage } from '../src/client/ScienceArtifactImage.tsx'

const content = { versionId: 'version-1', mediaType: 'image/png', byteCount: 3 } as const
const labels: MessageImageLabels = {
  image: 'Image',
  loading: 'Loading',
  loadFailed: 'Load failed',
  open: 'Open image',
  openNamed: label => `Open ${label}`,
  lightbox: { dialog: 'Original image', close: 'Close image' },
}

afterEach(cleanup)

describe('ScienceArtifactImage', () => {
  it('loads, opens, and closes a project-store image while ignoring a pre-load click', async () => {
    let resolveLoad: ((url: string) => void) | undefined
    const load = vi.fn(() => new Promise<string>((resolve) => { resolveLoad = resolve }))
    render(<ScienceArtifactImage content={content} label="Chart" load={load} variant="single" labels={labels} />)

    const trigger = screen.getByRole('button', { name: 'Open Chart' })
    fireEvent.click(trigger)
    expect(screen.queryByRole('dialog')).toBeNull()

    act(() => { resolveLoad?.('data:image/png;base64,AQID') })
    const image = await screen.findByRole('img', { name: 'Chart' })
    expect(image.getAttribute('src')).toBe('data:image/png;base64,AQID')
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: 'Original image' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close image' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('retries a rejected tile load', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce('data:image/png;base64,AQID')
    render(<ScienceArtifactImage content={content} label="Chart" load={load} variant="tile" labels={labels} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Load failed' }))
    await screen.findByRole('img', { name: 'Chart' })
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('surfaces a resolved-but-unloadable image (a raw-bytes URL for a missing blob) as a terminal failure', async () => {
    // `createScienceImageUrlLoader` always resolves a URL without fetching
    // it — the browser's own `<img>` fetch is the only place a missing or
    // unreadable blob (a 409/410 raw-bytes response) can be observed, so
    // this component must translate the image element's own error event
    // into the same terminal `failed` state a rejected `load` produces.
    const load = vi.fn()
      .mockResolvedValueOnce('https://example.test/missing.png')
      .mockResolvedValueOnce('data:image/png;base64,AQID')
    render(<ScienceArtifactImage content={content} label="Chart" load={load} variant="single" labels={labels} />)

    const image = await screen.findByRole('img', { name: 'Chart' })
    fireEvent.error(image)
    const retryButton = await screen.findByRole('button', { name: 'Load failed' })
    fireEvent.click(retryButton)
    await screen.findByRole('img', { name: 'Chart' })
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('recovers when a new chart preview replaces a failed image source', async () => {
    const load = vi.fn().mockResolvedValue('/api/science/artifact/session/version-1')
    const view = render(<ScienceArtifactImage content={content} label="Chart" load={load} variant="single" labels={labels} />)
    fireEvent.error(await screen.findByRole('img', { name: 'Chart' }))
    await screen.findByRole('button', { name: 'Load failed' })
    view.rerender(<ScienceArtifactImage content={content} label="Chart" load={load} variant="single" labels={labels} srcOverride="data:image/png;base64,new-preview" />)
    expect((await screen.findByRole('img', { name: 'Chart' })).getAttribute('src')).toBe('data:image/png;base64,new-preview')
  })

  it('shows an override despite an unrelated original loader rejection', async () => {
    const load = vi.fn().mockRejectedValue(new Error('original unavailable'))
    render(<ScienceArtifactImage content={content} label="Chart" load={load} variant="single" labels={labels} srcOverride="/preview/new.png" />)
    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('img', { name: 'Chart' }).getAttribute('src')).toBe('/preview/new.png')
  })

  it('keeps a new version when the earlier loader resolves late', async () => {
    let resolveFirst: ((url: string) => void) | undefined
    const load = vi.fn().mockImplementationOnce(() => new Promise<string>((resolve) => { resolveFirst = resolve }))
      .mockResolvedValueOnce('/version-2.png')
    const view = render(<ScienceArtifactImage content={content} label="Chart" load={load} variant="single" labels={labels} />)
    view.rerender(<ScienceArtifactImage content={{ ...content, versionId: 'version-2' }} label="Chart" load={load} variant="single" labels={labels} />)
    await screen.findByRole('img', { name: 'Chart' })
    await act(async () => { resolveFirst?.('/version-1.png') })
    expect(screen.getByRole('img', { name: 'Chart' }).getAttribute('src')).toBe('/version-2.png')
  })

  it('isolates a replaced image element from late decode errors', async () => {
    const load = vi.fn().mockResolvedValue('/original.png')
    const view = render(<ScienceArtifactImage content={content} label="Chart" load={load} variant="single" labels={labels} srcOverride="/preview/one.png" />)
    const oldImage = await screen.findByRole('img', { name: 'Chart' })
    view.rerender(<ScienceArtifactImage content={content} label="Chart" load={load} variant="single" labels={labels} srcOverride="/preview/two.png" />)
    fireEvent.error(oldImage)
    expect(screen.getByRole('img', { name: 'Chart' }).getAttribute('src')).toBe('/preview/two.png')
  })

  it('discards both late resolution and late rejection after unmount', async () => {
    let resolveLoad: ((url: string) => void) | undefined
    let rejectLoad: ((error: Error) => void) | undefined
    const load = vi.fn()
      .mockImplementationOnce(() => new Promise<string>((resolve) => { resolveLoad = resolve }))
      .mockImplementationOnce(() => new Promise<string>((_resolve, reject) => { rejectLoad = reject }))

    const first = render(<ScienceArtifactImage content={content} label="First" load={load} variant="single" labels={labels} />)
    first.unmount()
    act(() => { resolveLoad?.('data:image/png;base64,late') })

    const second = render(<ScienceArtifactImage content={content} label="Second" load={load} variant="single" labels={labels} />)
    second.unmount()
    act(() => { rejectLoad?.(new Error('late')) })
    await waitFor(() => { expect(load).toHaveBeenCalledTimes(2) })
  })
})
