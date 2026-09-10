// @vitest-environment jsdom
/**
 * The Science Details entry's project-library surface: missing projection
 * support, an unbound session's landing view (`loadLibrary` is a project-wide
 * read, independent of this session's own projection state), the artifact
 * gallery (thumbnails, sorting, layout, session grouping, collapse
 * persistence, search), workspace-file browsing and preview, RPC
 * failure-reason localization, T3 store-session reconciliation health, and
 * distinct top-level accessible text.
 */
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate, RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { ScienceDetailsView, type ScienceDetailsViewProps } from '../src/client/ScienceDetailsView.tsx'
import { ScienceLibrary, type ScienceLibraryProps } from '../src/client/ScienceLibrary.tsx'
import { zh } from '../src/client/locales.ts'
import { testScienceSelectionStore } from './selection-store-test-helpers.client.ts'
import { baseProjection, libraryArtifact, props, SESSION, statusText } from './science-details-view-fixtures.client.ts'


const navigate = { openTab: vi.fn(), openResource: vi.fn(), close: vi.fn() }
/** Bind the library page independently from the artifact body. */
function TestLibrary(input: ScienceDetailsViewProps) {
  return <ScienceLibrary {...input} useTabInfo={(() => ({ tab: { actions: navigate } })) as unknown as ScienceLibraryProps['useTabInfo']} />
}

afterEach(() => {
  vi.clearAllMocks()
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ScienceDetailsView: missing projection support', () => {
  it('reports the capability gap distinctly', () => {
    render(<ScienceDetailsView {...props(undefined)} />)
    expect(statusText()).toBe('This deployment does not report Science session state.')
  })
})

describe('ScienceDetailsView: projection not yet bound (science === null)', () => {
  it('renders the artifact library from the project-wide loadLibrary read, without an unbound notice', async () => {
    const loadLibrary = vi.fn<ScienceDetailsViewProps['loadLibrary']>().mockResolvedValue({
      ok: true,
      value: { projectId: 'project-1', artifacts: [libraryArtifact({ title: 'Loss curve', originSessionTitle: 'Current analysis' })] },
    })
    render(<TestLibrary {...props(null, { loadLibrary })} />)
    expect(await screen.findByText('Loss curve')).toBeTruthy()
    expect(screen.getByText(/^Current analysis/)).toBeTruthy()
    expect(loadLibrary).toHaveBeenCalled()
    expect(screen.queryByText('This deployment does not report Science session state.')).toBeNull()
  })

  it('reports no artifacts for an empty library, same as a bound session with none', async () => {
    render(<TestLibrary {...props(null)} />)
    expect(await screen.findByText('No artifacts yet.')).toBeTruthy()
  })
})

describe('ScienceDetailsView: landing gallery', () => {
  it('reports no artifacts for an empty library', () => {
    render(<TestLibrary {...props(baseProjection())} />)
    expect(screen.getAllByRole('status').map(el => el.textContent)).toEqual(['No artifacts yet.'])
  })

  it('renders one gallery entry per library artifact at its latest version', async () => {
    const loadLibrary = vi.fn<ScienceDetailsViewProps['loadLibrary']>().mockResolvedValue({ ok: true, value: { projectId: 'project-1', artifacts: [
      libraryArtifact({ title: 'Loss curve', latest: { versionId: 'v1', ordinal: 2, mediaType: 'image/png', byteCount: 100, createdAt: 500 } }),
      libraryArtifact({ artifactId: 'chart-2', title: 'Other', latest: { versionId: 'v2', ordinal: 1, mediaType: 'image/png', byteCount: 50, createdAt: 200 } }),
    ] } })
    render(<TestLibrary {...props(baseProjection(), { loadLibrary })} />)
    expect(await screen.findByText(/^v2 · /)).toBeTruthy()
    expect(screen.getByText('Loss curve')).toBeTruthy()
    expect(screen.getByText('Other')).toBeTruthy()
  })

  it('renders the grid gallery thumbnail as the square card variant', async () => {
    const loadLibrary = vi.fn<ScienceDetailsViewProps['loadLibrary']>().mockResolvedValue({ ok: true, value: { projectId: 'project-1', artifacts: [libraryArtifact()] } })
    render(<TestLibrary {...props(baseProjection(), { loadLibrary })} />)
    await waitFor(() => { expect(document.querySelector('[data-variant="card"]')).toBeTruthy() })
    expect(document.querySelector('[data-variant="tile"]')).toBeNull()
  })

  it('keeps byte counts out of artifact cards', async () => {
    const loadLibrary = vi.fn<ScienceDetailsViewProps['loadLibrary']>().mockResolvedValue({ ok: true, value: { projectId: 'project-1', artifacts: [
      libraryArtifact({ artifactId: 'chart-mb', title: 'Megabytes', latest: { versionId: 'mb', ordinal: 1, mediaType: 'image/png', byteCount: 2_097_152, createdAt: 1 } }),
    ] } })
    render(<TestLibrary {...props(baseProjection(), { loadLibrary })} />)
    expect(await screen.findByText('Megabytes')).toBeTruthy()
    expect(screen.queryByText(/2.0 MB/)).toBeNull()
  })

  it('loads a gallery thumbnail through the injected session-scoped loader', async () => {
    const loadImage = vi.fn().mockResolvedValue('data:image/png;base64,abc')
    const loadLibrary = vi.fn<ScienceDetailsViewProps['loadLibrary']>().mockResolvedValue({ ok: true, value: { projectId: 'project-1', artifacts: [libraryArtifact({ latest: { versionId: 'version:abc', ordinal: 1, mediaType: 'image/png', byteCount: 100, createdAt: 500 } })] } })
    const view = render(<TestLibrary {...props(baseProjection(), { loadImage, loadLibrary })} />)
    await waitFor(() => { expect(loadImage).toHaveBeenCalledTimes(1) })
    expect(loadImage.mock.calls[0]?.[0]).toMatchObject({ versionId: 'version:abc' })
    await waitFor(() => { expect(view.container.querySelector('img')).not.toBeNull() })
  })

  it('reports unavailable attachments distinctly when the loader rejects', async () => {
    const loadImage = vi.fn().mockRejectedValue(new Error('network'))
    const loadLibrary = vi.fn<ScienceDetailsViewProps['loadLibrary']>().mockResolvedValue({ ok: true, value: { projectId: 'project-1', artifacts: [libraryArtifact()] } })
    render(<TestLibrary {...props(baseProjection(), { loadImage, loadLibrary })} />)
    expect(await screen.findByRole('button', { name: 'Failed to load, click to retry' })).toBeTruthy()
  })

  it('renders a file-type tile (never an <img>) for a non-image artifact\'s gallery entry', async () => {
    const loadLibrary = vi.fn<ScienceDetailsViewProps['loadLibrary']>().mockResolvedValue({ ok: true, value: { projectId: 'project-1', artifacts: [
      libraryArtifact({ logicalName: 'summary.csv', latest: { versionId: 'csv', ordinal: 1, mediaType: 'text/csv', byteCount: 40, createdAt: 1 } }),
    ] } })
    render(<TestLibrary {...props(baseProjection(), { loadLibrary })} />)
    expect(await screen.findByText('CSV')).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('activates a gallery entry on Enter/Space and ignores every other key', async () => {
    const loadLibrary = vi.fn<ScienceDetailsViewProps['loadLibrary']>().mockResolvedValue({ ok: true, value: { projectId: 'project-1', artifacts: [libraryArtifact()] } })
    render(<TestLibrary {...props(baseProjection(), { loadLibrary })} />)
    const gallery = await screen.findByRole('button', { name: 'Open Loss curve, version 1' })
    expect(navigate.openResource).not.toHaveBeenCalled()
    fireEvent.keyDown(gallery, { key: 'a' })
    expect(screen.queryByRole('button', { name: 'Artifact library' })).toBeNull()
    fireEvent.keyDown(gallery, { key: 'Enter' })
    expect(navigate.openResource).toHaveBeenCalledWith('dsh-resource://science-artifact/chart-1', { params: { version: 1 } })
  })
})

describe('ScienceDetailsView: T3 store↔session reconciliation health', () => {
  it('shows the non-modal banner and expandable per-artifact list for reconstructed/missing-content counts', async () => {
    const loadLibrary = vi.fn<ScienceDetailsViewProps['loadLibrary']>().mockResolvedValue({ ok: true, value: {
      projectId: 'project-1',
      artifacts: [
        libraryArtifact({
          artifactId: 'reconstructed-chart', logicalName: 'reconstructed.png', title: 'Reconstructed chart',
          originSessionId: 'session-a', originSessionTitle: 'Source experiment',
          latest: { versionId: 'reconstructed-version', ordinal: 1, mediaType: 'image/png', byteCount: 1, createdAt: 10, health: { reconstructed: true } },
        }),
        libraryArtifact({
          artifactId: 'missing-chart', logicalName: 'missing.png', title: undefined,
          originSessionId: 'session-a', originSessionTitle: 'Source experiment',
          latest: { versionId: 'missing-version', ordinal: 1, mediaType: 'image/png', byteCount: 1, createdAt: 11, health: { missingContent: true } },
        }),
      ],
      health: { orphan: 3, reconstructed: 1, missingContent: 1 },
    } })
    render(<TestLibrary {...props(baseProjection(), { loadLibrary })} />)
    expect(await screen.findByText('Records were repaired for 1 artifacts')).toBeTruthy()
    expect(screen.getByText('Content is missing for 1 artifacts')).toBeTruthy()
    expect(screen.queryByText(/orphan/i)).toBeNull()
    expect(screen.queryByText('Record repaired')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'View affected artifacts' }))
    expect(screen.getByText('Record repaired')).toBeTruthy()
    expect(screen.getByText('Content missing')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }))
    expect(screen.queryByText('Record repaired')).toBeNull()
  })

  it('never shows the banner when only the orphan count is non-zero', async () => {
    const loadLibrary = vi.fn<ScienceDetailsViewProps['loadLibrary']>().mockResolvedValue({ ok: true, value: {
      projectId: 'project-1', artifacts: [], health: { orphan: 2, reconstructed: 0, missingContent: 0 },
    } })
    render(<TestLibrary {...props(baseProjection(), { loadLibrary })} />)
    await waitFor(() => { expect(loadLibrary).toHaveBeenCalled() })
    expect(screen.queryByText(/repaired/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'View affected artifacts' })).toBeNull()
  })

  it('shows explicit missing-content text in the detail panel and disables download/maximize, without loading content', async () => {
    const loadLibrary = vi.fn<ScienceDetailsViewProps['loadLibrary']>().mockResolvedValue({ ok: true, value: {
      projectId: 'project-1',
      artifacts: [libraryArtifact({
        artifactId: 'missing-chart', logicalName: 'missing.png', title: 'Missing content chart',
        originSessionId: 'session-a', originSessionTitle: 'Source experiment',
        latest: { versionId: 'missing-version', ordinal: 1, mediaType: 'image/png', byteCount: 1, createdAt: 10, health: { missingContent: true } },
      })],
      health: { orphan: 0, reconstructed: 0, missingContent: 1 },
    } })
    const loadImage = vi.fn().mockResolvedValue('data:image/png;base64,abc')
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'missing-chart' as Parameters<typeof store.actions.openTab>[0]['artifactId'], version: 1 })
    const library = await loadLibrary()
    if (!library.ok) throw new Error('expected library read success')
    render(<ScienceDetailsView {...props(baseProjection(), { loadLibrary, loadImage, store })} />)
    expect(await screen.findByText("This version's content is missing and cannot be downloaded or previewed.")).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Expand' })).toBeNull()
    const downloadButton = screen.getByRole('button', { name: 'Download' })
    expect(downloadButton.getAttribute('aria-disabled')).not.toBeNull()
    const callsBeforeClick = loadImage.mock.calls.length
    fireEvent.click(downloadButton)
    expect(loadImage.mock.calls.length).toBe(callsBeforeClick)
  })
})

describe('ScienceDetailsView: session grouping, collapse persistence, and search', () => {
  const now = 2_000_000_000_000
  function groupedProps(scopeKey?: string) {
    const store = testScienceSelectionStore(scopeKey)
    const loadLibrary = vi.fn<ScienceDetailsViewProps['loadLibrary']>().mockResolvedValue({ ok: true, value: { projectId: 'project-1', artifacts: [
      libraryArtifact({ artifactId: 'old', logicalName: 'old.png', title: 'Old plot', originSessionId: 'older', originSessionTitle: 'Earlier analysis', latest: { versionId: 'old-v1', ordinal: 1, mediaType: 'image/png', byteCount: 100, createdAt: now - 7_200_000 } }),
      libraryArtifact({ artifactId: 'alpha', logicalName: 'alpha.png', title: 'Alpha', originSessionId: SESSION, originSessionTitle: 'Current analysis', latest: { versionId: 'alpha-v1', ordinal: 1, mediaType: 'image/png', byteCount: 100, createdAt: now - 3_600_000 } }),
      libraryArtifact({ artifactId: 'zeta', logicalName: 'zeta.png', title: 'Zeta', originSessionId: SESSION, originSessionTitle: 'Current analysis', latest: { versionId: 'zeta-v1', ordinal: 1, mediaType: 'image/png', byteCount: 100, createdAt: now - 180_000 } }),
      libraryArtifact({ artifactId: 'recent', logicalName: 'recent.png', title: 'Recent plot', originSessionId: 'recent-session', originSessionTitle: 'Recent analysis', latest: { versionId: 'recent-v1', ordinal: 1, mediaType: 'image/png', byteCount: 100, createdAt: now - 60_000 } }),
      libraryArtifact({ artifactId: 'deleted', logicalName: 'deleted.png', title: undefined, originSessionId: 'deleted-session', originSessionTitle: undefined, latest: { versionId: 'deleted-v1', ordinal: 1, mediaType: 'image/png', byteCount: 100, createdAt: now - 86_400_000 } }),
    ] } })
    return { store, value: props(baseProjection(), { store, loadLibrary }) }
  }
  const groupTitles = () => screen.getAllByRole('region').map(group => group.getAttribute('aria-label'))
  const cards = (name: string) => within(screen.getByRole('region', { name })).getAllByRole('button', { name: /^Open / }).map(card => card.getAttribute('aria-label'))

  it('pins the current conversation first, orders other groups by time, and keeps sorting inside groups', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(now)
    const { value } = groupedProps()
    render(<TestLibrary {...value} />)
    await screen.findByRole('region', { name: 'Current analysis · This session' })
    const titles = ['Current analysis · This session', 'Recent analysis', 'Earlier analysis', 'Deleted session']
    expect(groupTitles()).toEqual(titles)
    expect(screen.getByText('5 artifacts')).toBeTruthy()
    expect(cards(titles[0]!)).toEqual(['Open Zeta, version 1', 'Open Alpha, version 1'])
    fireEvent.change(screen.getByRole('combobox', { name: 'Artifact sort' }), { target: { value: 'oldest' } })
    expect(cards(titles[0]!)).toEqual(['Open Alpha, version 1', 'Open Zeta, version 1'])
  })

  it('removes collapsed cards, restores after reopening, and persists expansion across scope keys', async () => {
    const scopeKey = randomUUID()
    const { value, store } = groupedProps(scopeKey)
    const view = render(<TestLibrary {...value} />)
    const toggle = await screen.findByRole('button', { name: /^Current analysis · This session/ })
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: 'Open Alpha, version 1' })).toBeNull()
    expect(store.instance.getSnapshot().libraryCollapsed).toEqual({ [SESSION]: true })
    view.unmount()
    const restored = groupedProps(scopeKey)
    render(<TestLibrary {...restored.value} />)
    const restoredToggle = await screen.findByRole('button', { name: /^Current analysis · This session/ })
    expect(restoredToggle.getAttribute('aria-expanded')).toBe('false')
  })

  it('filters cards before grouping, hides empty groups, and counts only matching cards', async () => {
    const { value } = groupedProps()
    render(<TestLibrary {...value} />)
    await screen.findByText('5 artifacts')
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: 'alpha' } })
    expect(groupTitles()).toEqual(['Current analysis · This session'])
    expect(screen.getByText('1 artifacts')).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: 'no matching artifact' } })
    expect(screen.queryAllByRole('region')).toHaveLength(0)
    expect(screen.getByText('0 artifacts')).toBeTruthy()
  })

  it('rehydrates a legacy payload missing libraryCollapsed/libraryTabs and renders without throwing', async () => {
    // A payload written before those fields existed on ScienceSelectionState:
    // whole-value rehydration used to leave both `undefined`, and reading
    // `collapsed[sessionId]` / writing `draft.libraryTabs[...]` threw.
    const scopeKey = randomUUID()
    localStorage.setItem(`dsh.science.selection.v1.${scopeKey}`, JSON.stringify({
      openArtifacts: [], activeTabId: null, libraryPage: 'artifacts', view: 'content', provenanceSubTab: 'code', lightboxOpen: false,
    }))
    const { value } = groupedProps(scopeKey)
    expect(() => { render(<TestLibrary {...value} />) }).not.toThrow()
    fireEvent.click(await screen.findByRole('button', { name: 'Open Alpha, version 1' }))
    expect(navigate.openResource).toHaveBeenCalledWith('dsh-resource://science-artifact/alpha', { params: { version: 1 } })
  })
})

describe('ScienceDetailsView: distinct accessible text across top-level states', () => {
  it('never repeats the same status text between missing-support and the landing view', () => {
    // Only two top-level states carry distinct status text: missing
    // projection support (`science === undefined`) and the landing view's
    // own status. An unbound session (`science === null`) renders the same
    // landing view as a bound one with no artifacts — same text, by design.
    const texts: string[] = []
    render(<ScienceDetailsView {...props(undefined)} />)
    texts.push(statusText())
    cleanup()
    render(<TestLibrary {...props(baseProjection())} />)
    for (const status of screen.getAllByRole('status')) texts.push(status.textContent ?? '')
    cleanup()
    expect(new Set(texts).size).toBe(texts.length)
    expect(texts).toHaveLength(2)
  })
})

describe('Science library public navigation and failures', () => {
  it('opens the upstream Files page through the owning guide tab', () => {
    render(<TestLibrary {...props(baseProjection())} />)
    fireEvent.click(screen.getByRole('button', { name: 'Project files' }))
    expect(navigate.openTab).toHaveBeenCalledWith('files')
  })

  it.each([
    ['NO_WORKSPACE', 'library.libraryNoWorkspace'],
    ['UNKNOWN_FUTURE_REASON', 'library.libraryLoadFailed'],
  ] as const)('localizes %s without showing host details', async (reason, key) => {
    const loadLibrary = vi.fn<ScienceDetailsViewProps['loadLibrary']>().mockResolvedValue({ ok: false, error: new RemoteError('science-artifact-error', 'private host details', { reason }) })
    render(<TestLibrary {...props(baseProjection(), { loadLibrary })} t={makeTranslate(zh)} />)
    expect(await screen.findByText(zh[key])).toBeTruthy()
    expect(screen.queryByText('private host details')).toBeNull()
  })
})
