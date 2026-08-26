// @vitest-environment jsdom
/** Project-store images preserve the conversation image interaction states. */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MessageImageLabels } from '@deepseek-ai/dsh-client-ui-attachment/client'
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
