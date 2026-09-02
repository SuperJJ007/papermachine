// @vitest-environment jsdom
/**
 * The Science Details entry's open-tab surface: opening a live in-session
 * artifact tab (store-sourced facts through `loadVersions`, including the
 * version stepper's own per-version title/caption — D9), the toolbar
 * (download through the raw-bytes endpoint's HEAD pre-flight, save-as,
 * maximize/lightbox, provenance navigation, the export placeholder), private
 * review notes, content dispatch, and the read-only tab opened from a
 * cross-session library artifact (`activeLibraryChart`, distinct from a live
 * `science.artifacts` tab: a single disabled stepper, no chart-edit panel, no
 * private notes).
 *
 * The provenance drill-in's former Code/Execution-log/Messages/Environment
 * sub-tabs are gone with the T1/T2 artifact-authority migration (see
 * `ScienceArtifactProvenance.tsx`'s own module JSDoc); this file only proves
 * the toolbar opens/closes the drill-in, not sub-tab content — that removal
 * is a regression pending its own product decision, not re-asserted here.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { scienceArtifactUrl } from '@deepseek-ai/dsh-client-runtime/client'
import { ScienceDetailsView } from '../src/client/ScienceDetailsView.tsx'
import { testScienceSelectionStore } from './selection-store-test-helpers.client.ts'
import {
  baseProjection, libraryArtifact, note, openTab, props, rawArtifact, SESSION, statusText, versionSummary,
} from './science-details-view-fixtures.client.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** One open live tab at v1, with a matching store summary — the shared shape save-as, download, and maximize each need. */
function withDefaultOpenTab() {
  const store = testScienceSelectionStore()
  openTab(store, 'chart-1', 1)
  return { store, science: baseProjection({ artifacts: [rawArtifact()] }), summaries: [versionSummary()] }
}

describe('ScienceDetailsView: opening a live tab', () => {
  it('switches the active artifact body without advancing a sibling tab\'s own version', () => {
    const store = testScienceSelectionStore()
    const science = baseProjection({ artifacts: [
      rawArtifact(), rawArtifact({ artifactId: 'chart-2', title: 'Second chart', versionId: 'v-chart-2' }),
    ] })
    const summaries = [versionSummary(), versionSummary({ artifactId: 'chart-2', versionId: 'v-chart-2', title: 'Second chart' })]
    openTab(store, 'chart-1', 1)
    render(<ScienceDetailsView {...props(science, { store, summaries })} />)
    act(() => { openTab(store, 'chart-2', 1) })
    expect(store.instance.getSnapshot().activeTabId).toBe('artifact:chart-2')
    expect(store.instance.getSnapshot().openArtifacts.find(tab => tab.kind === 'artifact' && tab.artifactId === 'chart-1')).toMatchObject({ version: 1 })
  })

  it('reports a missing open version, with no toolbar to interact with', () => {
    const store = testScienceSelectionStore()
    openTab(store, 'missing', 1)
    render(<ScienceDetailsView {...props(baseProjection({ artifacts: [rawArtifact()] }), { store })} />)
    expect(statusText()).toBe('This artifact version is no longer available.')
    expect(screen.queryByRole('button', { name: 'Close tab' })).toBeNull()
    act(() => { store.actions.showLibrary() })
    expect(screen.getByRole('textbox', { name: 'Search' })).toBeTruthy()
  })

  it('resolves the open tab\'s current title/caption from the store, not the session-log snapshot', async () => {
    const store = testScienceSelectionStore()
    openTab(store, 'chart-1', 1)
    const science = baseProjection({ artifacts: [rawArtifact({ title: 'stale session-log title' })] })
    const summaries = [versionSummary({ title: 'Fresh store title', caption: 'Fresh caption' })]
    render(<ScienceDetailsView {...props(science, { store, summaries })} />)
    await waitFor(() => { expect(document.querySelector('img')).not.toBeNull() })
    expect(screen.queryByText('stale session-log title')).toBeNull()
    expect(screen.getByText('Fresh caption')).toBeTruthy()
  })
})

describe('ScienceDetailsView: toolbar version stepper (D9 — store-sourced per-version facts)', () => {
  function threeVersions() {
    const science = baseProjection({ artifacts: [
      rawArtifact({ version: 1, versionId: 'v1' }), rawArtifact({ version: 2, versionId: 'v2' }), rawArtifact({ version: 3, versionId: 'v3' }),
    ] })
    const summaries = [
      versionSummary({ versionId: 'v1', ordinal: 1, title: 'v1 title', caption: 'First pass' }),
      versionSummary({ versionId: 'v2', ordinal: 2, title: 'v2 title' }),
      versionSummary({ versionId: 'v3', ordinal: 3, title: 'v3 title' }),
    ]
    const store = testScienceSelectionStore()
    openTab(store, 'chart-1', 2)
    return { science, summaries, store }
  }

  it('disables ‹ at the earliest version and › at the latest, showing each version\'s own store-sourced title', async () => {
    const { science, summaries, store } = threeVersions()
    render(<ScienceDetailsView {...props(science, { store, summaries })} />)
    await waitFor(() => { expect(document.querySelector('img')).not.toBeNull() })
    expect(screen.getByRole('button', { name: 'Previous version' }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('button', { name: 'Next version' }).hasAttribute('disabled')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Next version' }))
    expect(screen.getByRole('button', { name: 'Previous version' }).nextElementSibling?.textContent).toBe('v3')
    expect(screen.getByRole('button', { name: 'Next version' }).hasAttribute('disabled')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Previous version' }))
    fireEvent.click(screen.getByRole('button', { name: 'Previous version' }))
    expect(screen.getByRole('button', { name: 'Previous version' }).nextElementSibling?.textContent).toBe('v1')
    expect(screen.getByText('First pass')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Previous version' }).hasAttribute('disabled')).toBe(true)
  })

  it('a disabled stepper button never invokes the step callback', async () => {
    const { science, summaries, store } = threeVersions()
    render(<ScienceDetailsView {...props(science, { store, summaries })} />)
    await waitFor(() => { expect(document.querySelector('img')).not.toBeNull() })
    fireEvent.click(screen.getByRole('button', { name: 'Next version' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next version' }))
    expect(store.instance.getSnapshot().openArtifacts.find(tab => tab.kind === 'artifact')).toMatchObject({ version: 3 })
  })
})

describe('ScienceDetailsView: content dispatch', () => {
  it('renders a PNG through the injected loadImage', async () => {
    const store = testScienceSelectionStore()
    openTab(store, 'chart-1', 1)
    const loadImage = vi.fn().mockResolvedValue('data:image/png;base64,abc')
    const science = baseProjection({ artifacts: [rawArtifact()] })
    render(<ScienceDetailsView {...props(science, { store, loadImage, summaries: [versionSummary()] })} />)
    await waitFor(() => { expect(document.querySelector('img')).not.toBeNull() })
    expect(loadImage).toHaveBeenCalled()
  })

  it('renders a CSV attachment as a sortable table through the injected loadText', async () => {
    const store = testScienceSelectionStore()
    openTab(store, 'chart-1', 1)
    const loadText = vi.fn().mockResolvedValue('a,b\n1,2\n')
    const science = baseProjection({ artifacts: [rawArtifact({ logicalName: 'summary.csv' })] })
    const summaries = [versionSummary({ mediaType: 'text/csv', logicalName: 'summary.csv' })]
    render(<ScienceDetailsView {...props(science, { store, loadText, summaries })} />)
    expect(await screen.findByRole('table')).toBeTruthy()
  })
})

describe('ScienceDetailsView: private review notes', () => {
  function withOneTab() {
    const store = testScienceSelectionStore()
    openTab(store, 'chart-1', 2)
    return { store, science: baseProjection({ artifacts: [rawArtifact({ version: 2 })] }), summaries: [versionSummary({ ordinal: 2, versionId: 'version:2' })] }
  }

  it('shows versioned private notes and submits trimmed text', async () => {
    const { store, science, summaries } = withOneTab()
    const addArtifactNote = vi.fn().mockResolvedValue({ ok: true, value: { accepted: true } })
    const removeArtifactNote = vi.fn().mockResolvedValue({ ok: true, value: { accepted: true } })
    render(<ScienceDetailsView {...props(science, {
      store, summaries, addArtifactNote, removeArtifactNote,
      notes: [note({ seq: 19, text: 'Keep this label' })],
    })} />)
    expect(await screen.findByRole('region', { name: 'Notes' })).toBeTruthy()
    expect(screen.getByText('Keep this label')).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: 'Artifact note' }), { target: { value: '  New note  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => { expect(addArtifactNote).toHaveBeenCalledWith({ artifactId: 'chart-1', version: 2, text: 'New note' }) })
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }))
    await waitFor(() => { expect(removeArtifactNote).toHaveBeenCalledWith({ artifactId: 'chart-1', noteSeq: 19 }) })
  })

  it('surfaces the Host rejection for an over-limit note without truncating the draft', async () => {
    const { store, science, summaries } = withOneTab()
    const addArtifactNote = vi.fn().mockResolvedValue({ ok: false, error: { message: 'note text must be at most 8192 characters' } })
    render(<ScienceDetailsView {...props(science, { store, summaries, addArtifactNote })} />)
    const longNote = 'x'.repeat(8_193)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Artifact note' }), { target: { value: longNote } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'note text must be at most 8192 characters')
    expect(screen.getByLabelText<HTMLTextAreaElement>('Artifact note').value).toBe(longNote)
  })

  it('ignores an empty submission and surfaces a delete rejection', async () => {
    const { store, science, summaries } = withOneTab()
    const removeArtifactNote = vi.fn().mockResolvedValue({ ok: false, error: { message: 'delete rejected' } })
    const view = render(<ScienceDetailsView {...props(science, {
      store, summaries, removeArtifactNote, notes: [note({ seq: 19 })],
    })} />)
    await screen.findByRole('region', { name: 'Notes' })
    fireEvent.submit(view.container.querySelector('form')!)
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'delete rejected')
  })
})

describe('ScienceDetailsView: save-as', () => {
  it('duplicates the open version and switches the active tab to the new artifact', async () => {
    const { store, science, summaries } = withDefaultOpenTab()
    const saveArtifactAs = vi.fn().mockResolvedValue({ ok: true, value: { artifactId: 'chart-copy', logicalName: 'copy.png', version: 1 } })
    render(<ScienceDetailsView {...props(science, { store, summaries, saveArtifactAs })} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Save as' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'New artifact name' }), { target: { value: 'copy.png' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => { expect(saveArtifactAs).toHaveBeenCalledWith({ sourceVersionId: 'version:1', newLogicalName: 'copy.png' }) })
    await waitFor(() => { expect(store.instance.getSnapshot().activeTabId).toBe('artifact:chart-copy') })
  })

  it('shows a localized rejection without switching tabs', async () => {
    const { store, science, summaries } = withDefaultOpenTab()
    const saveArtifactAs = vi.fn().mockResolvedValue({ ok: false, error: { code: 'SAVE_AS_NAME_CONFLICT', message: 'conflict', details: {} } })
    render(<ScienceDetailsView {...props(science, { store, summaries, saveArtifactAs })} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Save as' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'New artifact name' }), { target: { value: 'copy.png' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByText('That name is already used. Choose another name.')).toBeTruthy()
    expect(store.instance.getSnapshot().activeTabId).toBe('artifact:chart-1')
  })
})

describe('ScienceDetailsView: download (raw-bytes endpoint, HEAD pre-flight)', () => {
  it('HEAD-checks the raw-bytes URL, then clicks a bare anchor with no download attribute', async () => {
    const { store, science, summaries } = withDefaultOpenTab()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })))
    const created: HTMLAnchorElement[] = []
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { created.push(this) })
    render(<ScienceDetailsView {...props(science, { store, summaries })} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Download' }))
    await waitFor(() => { expect(clickSpy).toHaveBeenCalledTimes(1) })
    expect(fetch).toHaveBeenCalledWith(scienceArtifactUrl(SESSION, 'version:1' as never), { method: 'HEAD' })
    expect(created[0]?.href).toBe(scienceArtifactUrl(SESSION, 'version:1' as never))
    expect(created[0]?.hasAttribute('download')).toBe(false)
  })

  it('shows the missing-content notice for a 410 with x-science-artifact-error: missing_content', async () => {
    const { store, science, summaries } = withDefaultOpenTab()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 410, headers: { 'x-science-artifact-error': 'missing_content' } })))
    render(<ScienceDetailsView {...props(science, { store, summaries })} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Download' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Content is missing, so this cannot be downloaded.')
  })

  it('shows the corrupt-content notice for a 409 with x-science-artifact-error: content_corrupt', async () => {
    const { store, science, summaries } = withDefaultOpenTab()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 409, headers: { 'x-science-artifact-error': 'content_corrupt' } })))
    render(<ScienceDetailsView {...props(science, { store, summaries })} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Download' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', "This version's bytes failed integrity verification and cannot be downloaded.")
  })

  it('falls back to the generic download-failed notice for any other non-2xx status, and never clicks an anchor', async () => {
    const { store, science, summaries } = withDefaultOpenTab()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })))
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click')
    render(<ScienceDetailsView {...props(science, { store, summaries })} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Download' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Download failed. Try again.')
    expect(clickSpy).not.toHaveBeenCalled()
  })

  it('reports a network failure the same way as a non-2xx status', async () => {
    const { store, science, summaries } = withDefaultOpenTab()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    render(<ScienceDetailsView {...props(science, { store, summaries })} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Download' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Download failed. Try again.')
  })
})

describe('ScienceDetailsView: export placeholder', () => {
  it('stays reachable in the tab order and names the reason through aria-describedby, instead of a native disabled', async () => {
    const store = testScienceSelectionStore()
    openTab(store, 'chart-1', 1)
    render(<ScienceDetailsView {...props(baseProjection({ artifacts: [rawArtifact()] }), { store, summaries: [versionSummary()] })} />)
    const exportButton = await screen.findByRole('button', { name: 'Export' })
    expect(exportButton.hasAttribute('disabled')).toBe(false)
    expect(exportButton.getAttribute('aria-disabled')).toBe('true')
    const reasonId = exportButton.getAttribute('aria-describedby')
    expect(reasonId).toBeTruthy()
    expect(document.getElementById(reasonId!)?.textContent).toBe('Export will be available in C4')
  })
})

describe('ScienceDetailsView: maximize (toolbar-triggered lightbox)', () => {
  it('opens when maximize is clicked, and closes back through the same store', async () => {
    const { store, science, summaries } = withDefaultOpenTab()
    render(<ScienceDetailsView {...props(science, { store, summaries })} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: 'Expand' }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => { expect(store.instance.getSnapshot().lightboxOpen).toBe(false) })
  })

  it('reports the lightbox image as unavailable when the loader rejects (no dialog, no crash)', async () => {
    const { store, science, summaries } = withDefaultOpenTab()
    const loadImage = vi.fn().mockRejectedValue(new Error('network'))
    render(<ScienceDetailsView {...props(science, { store, summaries, loadImage })} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Expand' }))
    await waitFor(() => { expect(loadImage.mock.calls.length).toBeGreaterThan(1) })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('has no maximize control for a non-image artifact', async () => {
    const { store, science, summaries } = withDefaultOpenTab()
    summaries[0]!.mediaType = 'text/plain'
    render(<ScienceDetailsView {...props(science, { store, summaries })} />)
    await screen.findByRole('button', { name: 'Download' })
    expect(screen.queryByRole('button', { name: 'Expand' })).toBeNull()
  })
})

describe('ScienceDetailsView: provenance navigation', () => {
  function withOneTab() {
    const store = testScienceSelectionStore()
    openTab(store, 'chart-1', 1)
    return { store, science: baseProjection({ artifacts: [rawArtifact()] }), summaries: [versionSummary({ title: 'Loss curve' })] }
  }

  it('opens from the toolbar, and the breadcrumb root returns to content', async () => {
    const { store, science, summaries } = withOneTab()
    render(<ScienceDetailsView {...props(science, { store, summaries })} />)
    await waitFor(() => { expect(document.querySelector('img')).not.toBeNull() })
    fireEvent.click(screen.getByRole('button', { name: 'Provenance' }))
    expect(screen.getByRole('navigation', { name: 'Provenance' })).toBeTruthy()
    expect(store.instance.getSnapshot().view).toBe('provenance')
    fireEvent.click(screen.getByRole('button', { name: 'Loss curve' }))
    expect(store.instance.getSnapshot().view).toBe('content')
  })

  it('reports the artifact as unavailable when its session-log identity no longer resolves', () => {
    const store = testScienceSelectionStore()
    openTab(store, 'chart-1', 1)
    store.actions.setView('provenance')
    render(<ScienceDetailsView {...props(baseProjection({ artifacts: [] }), { store })} />)
    expect(statusText()).toBe('This artifact version is no longer available.')
  })
})

describe('ScienceDetailsView: read-only tab opened from a cross-session library artifact', () => {
  it('opens a single-version, disabled-stepper toolbar and a read-only preview', async () => {
    const loadLibrary = vi.fn().mockResolvedValue({ ok: true, value: { projectId: 'project-1', artifacts: [
      libraryArtifact({
        artifactId: 'cross-chart', logicalName: 'cross.png', title: 'Cross-session chart', caption: 'Cross caption',
        originSessionId: 'session-a', originSessionTitle: 'Source experiment',
        latest: { versionId: 'cross-version', ordinal: 3, mediaType: 'image/png', byteCount: 1, createdAt: 10 },
      }),
    ] } })
    // No live `science.artifacts` entry for this artifactId/version: the
    // read-only library path is the only one that can resolve it.
    render(<ScienceDetailsView {...props(baseProjection(), { loadLibrary })} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open Cross-session chart, version 3' }))
    expect(screen.queryByText('Cross-session chart')).toBeNull()
    expect(screen.getByRole('button', { name: 'Previous version' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Next version' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Provenance' }))
    expect(screen.getByText('Source experiment')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Back to original conversation' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Cross-session chart' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close tab' }))
    expect(screen.getByRole('textbox', { name: 'Search' })).toBeTruthy()
  })
})
