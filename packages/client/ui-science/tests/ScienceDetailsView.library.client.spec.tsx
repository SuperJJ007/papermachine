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
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { ScienceDetailsView } from '../src/client/ScienceDetailsView.tsx'
import { zh } from '../src/client/locales.ts'
import { testScienceSelectionStore } from './selection-store-test-helpers.client.ts'
import { baseProjection, libraryArtifact, props, SESSION, statusText, versionSummary } from './science-details-view-fixtures.client.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ScienceDetailsView: missing projection support', () => {
  it('reports the capability gap distinctly', () => {
    render(<ScienceDetailsView {...props(undefined)} />)
    expect(statusText()).toBe('This deployment does not report Science session state.')
  })

  it('publishes whether the mounted view is the artifact-library landing page', () => {
    const reads: Array<() => boolean> = []
    const bindArtifactLibraryView = vi.fn((read: () => boolean) => {
      reads.push(read)
      return vi.fn()
    })
    const store = testScienceSelectionStore()
    render(<ScienceDetailsView {...props(baseProjection(), { store, bindArtifactLibraryView })} />)
    expect(reads.at(-1)?.()).toBe(true)
    act(() => { store.actions.setLibraryPage('files') })
    expect(reads.at(-1)?.()).toBe(false)
  })
})

describe('ScienceDetailsView: projection not yet bound (science === null)', () => {
  it('renders the artifact library from the project-wide loadLibrary read, without an unbound notice', async () => {
    const loadLibrary = vi.fn().mockResolvedValue({
      ok: true,
      value: { projectId: 'project-1', artifacts: [libraryArtifact({ title: 'Loss curve', originSessionTitle: 'Current analysis' })] },
    })
    render(<ScienceDetailsView {...props(null, { loadLibrary })} />)
    expect(await screen.findByText('Loss curve')).toBeTruthy()
    expect(screen.getByText(/^Current analysis/)).toBeTruthy()
    expect(loadLibrary).toHaveBeenCalled()
    expect(screen.queryByText('This deployment does not report Science session state.')).toBeNull()
  })

  it('reports no artifacts for an empty library, same as a bound session with none', async () => {
    render(<ScienceDetailsView {...props(null)} />)
    expect(await screen.findByText('No artifacts yet.')).toBeTruthy()
  })
})

describe('ScienceDetailsView: landing gallery', () => {
  it('reports no artifacts for an empty library', () => {
    render(<ScienceDetailsView {...props(baseProjection())} />)
    expect(screen.getAllByRole('status').map(el => el.textContent)).toEqual(['No artifacts yet.'])
  })

  it('renders one gallery entry per library artifact at its latest version', async () => {
    const loadLibrary = vi.fn().mockResolvedValue({ ok: true, value: { projectId: 'project-1', artifacts: [
      libraryArtifact({ title: 'Loss curve', latest: { versionId: 'v1', ordinal: 2, mediaType: 'image/png', byteCount: 100, createdAt: 500 } }),
      libraryArtifact({ artifactId: 'chart-2', title: 'Other', latest: { versionId: 'v2', ordinal: 1, mediaType: 'image/png', byteCount: 50, createdAt: 200 } }),
    ] } })
    render(<ScienceDetailsView {...props(baseProjection(), { loadLibrary })} />)
    expect(await screen.findByText(/^v2 · /)).toBeTruthy()
    expect(screen.getByText('Loss curve')).toBeTruthy()
    expect(screen.getByText('Other')).toBeTruthy()
  })

  it('renders the grid gallery thumbnail as the square card variant', async () => {
    const loadLibrary = vi.fn().mockResolvedValue({ ok: true, value: { projectId: 'project-1', artifacts: [libraryArtifact()] } })
    render(<ScienceDetailsView {...props(baseProjection(), { loadLibrary })} />)
    await waitFor(() => { expect(document.querySelector('[data-variant="card"]')).toBeTruthy() })
    expect(document.querySelector('[data-variant="tile"]')).toBeNull()
  })

  it('keeps byte counts out of artifact cards', async () => {
    const loadLibrary = vi.fn().mockResolvedValue({ ok: true, value: { projectId: 'project-1', artifacts: [
      libraryArtifact({ artifactId: 'chart-mb', title: 'Megabytes', latest: { versionId: 'mb', ordinal: 1, mediaType: 'image/png', byteCount: 2_097_152, createdAt: 1 } }),
    ] } })
    render(<ScienceDetailsView {...props(baseProjection(), { loadLibrary })} />)
    expect(await screen.findByText('Megabytes')).toBeTruthy()
    expect(screen.queryByText(/2.0 MB/)).toBeNull()
  })

  it('loads a gallery thumbnail through the injected session-scoped loader', async () => {
    const loadImage = vi.fn().mockResolvedValue('data:image/png;base64,abc')
    const loadLibrary = vi.fn().mockResolvedValue({ ok: true, value: { projectId: 'project-1', artifacts: [libraryArtifact({ latest: { versionId: 'version:abc', ordinal: 1, mediaType: 'image/png', byteCount: 100, createdAt: 500 } })] } })
    const view = render(<ScienceDetailsView {...props(baseProjection(), { loadImage, loadLibrary })} />)
    await waitFor(() => { expect(loadImage).toHaveBeenCalledTimes(1) })
    expect(loadImage.mock.calls[0]?.[0]).toMatchObject({ versionId: 'version:abc' })
    await waitFor(() => { expect(view.container.querySelector('img')).not.toBeNull() })
  })

  it('reports unavailable attachments distinctly when the loader rejects', async () => {
    const loadImage = vi.fn().mockRejectedValue(new Error('network'))
    const loadLibrary = vi.fn().mockResolvedValue({ ok: true, value: { projectId: 'project-1', artifacts: [libraryArtifact()] } })
    render(<ScienceDetailsView {...props(baseProjection(), { loadImage, loadLibrary })} />)
    expect(await screen.findByRole('button', { name: 'Failed to load, click to retry' })).toBeTruthy()
  })

  it('renders a file-type tile (never an <img>) for a non-image artifact\'s gallery entry', async () => {
    const loadLibrary = vi.fn().mockResolvedValue({ ok: true, value: { projectId: 'project-1', artifacts: [
      libraryArtifact({ logicalName: 'summary.csv', latest: { versionId: 'csv', ordinal: 1, mediaType: 'text/csv', byteCount: 40, createdAt: 1 } }),
    ] } })
    render(<ScienceDetailsView {...props(baseProjection(), { loadLibrary })} />)
    expect(await screen.findByText('CSV')).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('activates a gallery entry on Enter/Space and ignores every other key', async () => {
    const loadLibrary = vi.fn().mockResolvedValue({ ok: true, value: { projectId: 'project-1', artifacts: [libraryArtifact()] } })
    render(<ScienceDetailsView {...props(baseProjection(), { loadLibrary })} />)
    const gallery = await screen.findByRole('button', { name: 'Open Loss curve, version 1' })
    expect(screen.queryByRole('button', { name: 'Artifact library' })).toBeNull()
    fireEvent.keyDown(gallery, { key: 'a' })
    expect(screen.queryByRole('button', { name: 'Artifact library' })).toBeNull()
    fireEvent.keyDown(gallery, { key: 'Enter' })
    expect(await screen.findByRole('button', { name: 'Artifact library' })).toBeTruthy()
  })

  it('browses a workspace directory and opens a supported file preview', async () => {
    const loadWorkspaceFiles = vi.fn().mockResolvedValue({ ok: true, value: {
      root: '', entries: [{ name: 'results.csv', kind: 'file', byteCount: 8, modifiedAt: 1, mediaType: 'text/csv' }],
    } })
    const loadWorkspaceFile = vi.fn().mockResolvedValue({ ok: true, value: {
      mediaType: 'text/csv', byteCount: 8, data: new TextEncoder().encode('a,b\n1,2\n'),
    } })
    const store = testScienceSelectionStore()
    act(() => { store.actions.setLibraryPage('files') })
    render(<ScienceDetailsView {...props(baseProjection(), { loadWorkspaceFiles, loadWorkspaceFile, store })} />)
    fireEvent.click(await screen.findByRole('button', { name: /results\.csv/ }))
    expect(await screen.findByRole('table', { name: 'results.csv' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '‹ Artifact library' }))
    expect(screen.queryByRole('button', { name: '‹ Artifact library' })).toBeNull()
  })

  it('exercises project-library sorting, layout, keyboard activation, and directory breadcrumbs', async () => {
    const loadLibrary = vi.fn().mockResolvedValue({ ok: true, value: { projectId: 'project-1', artifacts: [
      libraryArtifact({ artifactId: 'z', logicalName: 'z.png', title: undefined, originSessionId: 'unknown-session', originSessionTitle: undefined, latest: { versionId: 'z1', ordinal: 1, mediaType: 'image/png', byteCount: 1, createdAt: 30 } }),
      libraryArtifact({ artifactId: 'y', logicalName: 'y.txt', title: undefined, originSessionId: 'unknown-session', originSessionTitle: undefined, latest: { versionId: 'y1', ordinal: 1, mediaType: 'text/plain', byteCount: 1, createdAt: 25 } }),
      libraryArtifact({ artifactId: 'a', logicalName: 'a.md', title: 'Alpha', originSessionId: SESSION, originSessionTitle: 'Current analysis', latest: { versionId: 'a1', ordinal: 1, mediaType: 'text/markdown', byteCount: 2, createdAt: 10 } }),
      libraryArtifact({ artifactId: 'b', logicalName: 'b.json', title: 'Beta', originSessionId: 'source', originSessionTitle: 'Source', latest: { versionId: 'b1', ordinal: 1, mediaType: 'application/json', byteCount: 3, createdAt: 20 } }),
    ] } })
    const loadWorkspaceFiles = vi.fn().mockImplementation((path: string) => Promise.resolve({ ok: true, value: path === ''
      ? { root: '', entries: [{ name: 'data', kind: 'dir', modifiedAt: 1 }, { name: 'root.bin', kind: 'file', byteCount: 2_048, modifiedAt: 1 }] }
      : { root: path, entries: [{ name: 'leaf.bin', kind: 'file', byteCount: 1, modifiedAt: 1 }] } }))
    const store = testScienceSelectionStore()
    render(<ScienceDetailsView {...props(baseProjection(), {
      loadLibrary,
      loadWorkspaceFiles,
      store,
      summaries: [versionSummary({
        versionId: 'z1', artifactId: 'z',
        producer: { sessionId: 'unknown-session' },
      })],
    })} />)
    expect(await screen.findAllByText(/^v1 · /)).toHaveLength(4)
    fireEvent.change(screen.getByRole('combobox', { name: 'Artifact sort' }), { target: { value: 'oldest' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Artifact sort' }), { target: { value: 'name' } })
    expect(document.querySelector('[data-variant="card"]')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Switch grid or list view' }))
    expect(document.querySelector('[data-variant="tile"]')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Switch grid or list view' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: 'z.png' } })
    const z = screen.getByRole('button', { name: 'Open z.png, version 1' })
    fireEvent.keyDown(z, { key: 'x' })
    fireEvent.keyDown(z, { key: ' ' })
    expect(screen.queryByText('z.png')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Provenance' }))
    await waitFor(() => { expect(screen.getByRole('status').textContent).toContain('unknown-session') })
    fireEvent.click(screen.getByRole('button', { name: 'z.png' }))
    fireEvent.click(screen.getByRole('button', { name: 'Artifact library' }))
    act(() => { store.actions.setLibraryPage('files') })
    fireEvent.click(await screen.findByRole('button', { name: /data/ }))
    expect((await screen.findByRole('button', { name: /leaf\.bin/ })).textContent).toContain('1 B')
    fireEvent.click(screen.getByRole('button', { name: 'Project' }))
    expect((await screen.findByRole('button', { name: /root\.bin/ })).textContent).toContain('2.0 KB')
  })

  it('navigates nested breadcrumbs and treats a file without a byte count as empty', async () => {
    const loadWorkspaceFiles = vi.fn((path: string = '') => Promise.resolve({ ok: true as const, value: {
      root: path,
      entries: path === ''
        ? [{ name: 'data', kind: 'dir' as const, modifiedAt: 1 }]
        : path === 'data'
          ? [{ name: 'nested', kind: 'dir' as const, modifiedAt: 1 }, { name: 'empty.bin', kind: 'file' as const, modifiedAt: 1 }]
          : [{ name: 'leaf.txt', kind: 'file' as const, byteCount: 1, modifiedAt: 1 }],
    } }))
    const store = testScienceSelectionStore()
    store.actions.setLibraryPage('files')
    render(<ScienceDetailsView {...props(baseProjection(), { store, loadWorkspaceFiles })} />)
    fireEvent.click(await screen.findByRole('button', { name: /data/u }))
    expect((await screen.findByRole('button', { name: /empty\.bin/u })).textContent).toContain('0 B')
    fireEvent.click(screen.getByRole('button', { name: /nested/u }))
    await screen.findByRole('button', { name: /leaf\.txt/u })
    fireEvent.click(screen.getByRole('button', { name: 'data' }))
    expect(await screen.findByRole('button', { name: /empty\.bin/u })).toBeTruthy()
  })

  it('ignores directory and file reads that resolve after their views unmount', async () => {
    let resolveDirectory!: (value: { ok: true; value: { root: string; entries: [] } }) => void
    const loadWorkspaceFiles = vi.fn(() => new Promise<{ ok: true; value: { root: string; entries: [] } }>((resolve) => {
      resolveDirectory = resolve
    }))
    const directoryStore = testScienceSelectionStore()
    directoryStore.actions.setLibraryPage('files')
    const directory = render(<ScienceDetailsView {...props(baseProjection(), {
      store: directoryStore, loadWorkspaceFiles,
    })} />)
    directory.unmount()
    resolveDirectory({ ok: true, value: { root: '', entries: [] } })
    await act(async () => {})

    type FileResult = { ok: true; value: { mediaType: string; byteCount: number; data: Uint8Array } }
    let resolveFile!: (value: FileResult) => void
    const loadWorkspaceFile = vi.fn(() => new Promise<FileResult>((resolve) => {
      resolveFile = resolve
    }))
    const fileStore = testScienceSelectionStore()
    fileStore.actions.openFileTab('late.txt')
    const file = render(<ScienceDetailsView {...props(baseProjection(), { store: fileStore, loadWorkspaceFile })} />)
    file.unmount()
    resolveFile({ ok: true, value: { mediaType: 'text/plain', byteCount: 4, data: new TextEncoder().encode('late') } })
    await act(async () => {})
  })

  it('reports library and workspace RPC failures without leaking the host\'s raw message', async () => {
    const failedStore = testScienceSelectionStore()
    const failed = render(<ScienceDetailsView {...props(baseProjection(), {
      loadLibrary: vi.fn().mockResolvedValue({ ok: false, error: { code: 'internal', message: 'library offline', details: {} } }),
      loadWorkspaceFiles: vi.fn().mockResolvedValue({ ok: false, error: { code: 'internal', message: 'workspace offline', details: {} } }),
      store: failedStore,
    })} />)
    const libraryAlert = await screen.findByRole('alert')
    expect(libraryAlert.textContent).toContain('Unable to load the artifact library.')
    expect(libraryAlert.textContent).not.toContain('library offline')
    act(() => { failedStore.actions.setLibraryPage('files') })
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('Unable to load the project file list.') })
    expect(screen.getByRole('alert').textContent).not.toContain('workspace offline')
    failed.unmount()
  })

  it('reports unsupported and PNG workspace-file previews, and a broken read', async () => {
    const entries = vi.fn().mockResolvedValue({ ok: true, value: { root: '', entries: [
      { name: 'raw.bin', kind: 'file', byteCount: 1_048_576, modifiedAt: 1, mediaType: 'application/octet-stream' },
      { name: 'pixel.png', kind: 'file', byteCount: 1, modifiedAt: 1, mediaType: 'image/png' },
      { name: 'broken.txt', kind: 'file', byteCount: 1, modifiedAt: 1, mediaType: 'text/plain' },
    ] } })
    const file = vi.fn().mockImplementation((path: string) => Promise.resolve(path === 'broken.txt'
      ? { ok: false, error: { code: 'internal', message: 'file unavailable', details: {} } }
      : { ok: true, value: path === 'pixel.png'
        ? { mediaType: 'image/png', byteCount: 1, data: Uint8Array.of(255) }
        : { mediaType: 'application/octet-stream', byteCount: 1_048_576, data: Uint8Array.of() } }))
    const store = testScienceSelectionStore()
    store.actions.setLibraryPage('files')
    const view = render(
      <ScienceDetailsView {...props(baseProjection(), { loadWorkspaceFiles: entries, loadWorkspaceFile: file, store })} />,
    )
    fireEvent.click(await screen.findByRole('button', { name: /raw\.bin/ }))
    expect(await screen.findByText('Preview unavailable, 1.0 MB')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Artifact library/ }))
    fireEvent.click(await screen.findByRole('button', { name: /pixel\.png/ }))
    expect(await screen.findByRole('img', { name: 'pixel.png' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Artifact library/ }))
    fireEvent.click(await screen.findByRole('button', { name: /broken\.txt/ }))
    expect((await screen.findByRole('alert')).textContent).toContain('Unable to open this file.')
    view.unmount()
  })

  it('localizes each closed WorkspaceReadError reason and falls back for an unrecognized one', async () => {
    const cases: readonly [reason: string | undefined, en: string, zhText: string][] = [
      ['NO_WORKSPACE', 'This session has no workspace directory, so the file cannot be opened.', '该会话没有工作区，无法打开项目文件。'],
      ['PATH_OUTSIDE_WORKSPACE', 'This path is outside the project workspace and cannot be opened.', '该路径不在项目工作区内，无法打开。'],
      ['FILE_TOO_LARGE', 'File is too large to preview.', '文件过大，不支持预览。'],
      [undefined, 'Unable to open this file.', '无法打开该文件。'],
      ['SOME_FUTURE_REASON', 'Unable to open this file.', '无法打开该文件。'],
    ]
    for (const [reason, enText, zhText] of cases) {
      const loadWorkspaceFile = vi.fn().mockResolvedValue({
        ok: false, error: { code: 'science-artifact-error', message: 'Workspace file exceeds the 2 MiB preview limit.', details: { reason } },
      })
      const store = testScienceSelectionStore()
      store.actions.openFileTab('bad.csv')
      const rendered = render(<ScienceDetailsView {...props(baseProjection(), { loadWorkspaceFile, store })} />)
      expect((await screen.findByRole('alert')).textContent).toContain(enText)
      rendered.unmount()

      const zhStore = testScienceSelectionStore()
      zhStore.actions.openFileTab('bad.csv')
      const zhRendered = render(
        <ScienceDetailsView {...props(baseProjection(), { loadWorkspaceFile, store: zhStore })} t={makeTranslate(zh)} />,
      )
      expect((await screen.findByRole('alert')).textContent).toContain(zhText)
      zhRendered.unmount()
    }
  })

  it('localizes the science-library and project-files RPC failures by reason, and falls back for an unrecognized one', async () => {
    const libraryCases: readonly [reason: string | undefined, enText: string, zhText: string][] = [
      ['NO_WORKSPACE', 'This session has no workspace directory, so the artifact library cannot be loaded.', '该会话没有工作区，无法加载成果库。'],
      ['BLOB_CORRUPT', 'Unable to load the artifact library.', '成果库加载失败。'],
    ]
    for (const [reason, enText, zhText] of libraryCases) {
      const loadLibrary = vi.fn().mockResolvedValue({
        ok: false, error: { code: 'science-artifact-error', message: 'Artifact blob is corrupt.', details: { reason } },
      })
      const rendered = render(<ScienceDetailsView {...props(baseProjection(), { loadLibrary })} />)
      expect((await screen.findByRole('alert')).textContent).toContain(enText)
      rendered.unmount()
      const zhRendered = render(<ScienceDetailsView {...props(baseProjection(), { loadLibrary })} t={makeTranslate(zh)} />)
      expect((await screen.findByRole('alert')).textContent).toContain(zhText)
      zhRendered.unmount()
    }

    const filesCases: readonly [reason: string | undefined, enText: string][] = [
      ['NO_WORKSPACE', 'This session has no workspace directory, so the project file list cannot be loaded.'],
      ['PATH_OUTSIDE_WORKSPACE', 'This path is outside the project workspace and cannot be listed.'],
      ['SOME_FUTURE_REASON', 'Unable to load the project file list.'],
    ]
    for (const [reason, enText] of filesCases) {
      const loadWorkspaceFiles = vi.fn().mockResolvedValue({
        ok: false, error: { code: 'science-artifact-error', message: 'Path is outside the session workspace.', details: { reason } },
      })
      const store = testScienceSelectionStore()
      store.actions.setLibraryPage('files')
      const rendered = render(<ScienceDetailsView {...props(baseProjection(), { loadWorkspaceFiles, store })} />)
      expect((await screen.findByRole('alert')).textContent).toContain(enText)
      rendered.unmount()
    }
  })
})

describe('ScienceDetailsView: T3 store↔session reconciliation health', () => {
  it('shows the non-modal banner and expandable per-artifact list for reconstructed/missing-content counts', async () => {
    const loadLibrary = vi.fn().mockResolvedValue({ ok: true, value: {
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
    render(<ScienceDetailsView {...props(baseProjection(), { loadLibrary })} />)
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
    const loadLibrary = vi.fn().mockResolvedValue({ ok: true, value: {
      projectId: 'project-1', artifacts: [], health: { orphan: 2, reconstructed: 0, missingContent: 0 },
    } })
    render(<ScienceDetailsView {...props(baseProjection(), { loadLibrary })} />)
    await waitFor(() => { expect(loadLibrary).toHaveBeenCalled() })
    expect(screen.queryByText(/repaired/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'View affected artifacts' })).toBeNull()
  })

  it('shows explicit missing-content text in the detail panel and disables download/maximize, without loading content', async () => {
    const loadLibrary = vi.fn().mockResolvedValue({ ok: true, value: {
      projectId: 'project-1',
      artifacts: [libraryArtifact({
        artifactId: 'missing-chart', logicalName: 'missing.png', title: 'Missing content chart',
        originSessionId: 'session-a', originSessionTitle: 'Source experiment',
        latest: { versionId: 'missing-version', ordinal: 1, mediaType: 'image/png', byteCount: 1, createdAt: 10, health: { missingContent: true } },
      })],
      health: { orphan: 0, reconstructed: 0, missingContent: 1 },
    } })
    const loadImage = vi.fn().mockResolvedValue('data:image/png;base64,abc')
    render(<ScienceDetailsView {...props(baseProjection(), { loadLibrary, loadImage })} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open Missing content chart, version 1' }))
    expect(screen.getByText("This version's content is missing and cannot be downloaded or previewed.")).toBeTruthy()
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
    const loadLibrary = vi.fn().mockResolvedValue({ ok: true, value: { projectId: 'project-1', artifacts: [
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
    render(<ScienceDetailsView {...value} />)
    await screen.findByRole('region', { name: 'Current analysis · This session' })
    const titles = ['Current analysis · This session', 'Recent analysis', 'Earlier analysis', 'Deleted session']
    expect(groupTitles()).toEqual(titles)
    expect(screen.getByText('5 artifacts')).toBeTruthy()
    expect(cards(titles[0]!)).toEqual(['Open Zeta, version 1', 'Open Alpha, version 1'])
    fireEvent.change(screen.getByRole('combobox', { name: 'Artifact sort' }), { target: { value: 'oldest' } })
    expect(cards(titles[0]!)).toEqual(['Open Alpha, version 1', 'Open Zeta, version 1'])
  })

  it('removes collapsed cards, restores after reopening, and persists expansion across scope keys', async () => {
    const scopeKey = crypto.randomUUID()
    const { value, store } = groupedProps(scopeKey)
    const view = render(<ScienceDetailsView {...value} />)
    const toggle = await screen.findByRole('button', { name: /^Current analysis · This session/ })
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: 'Open Alpha, version 1' })).toBeNull()
    expect(store.instance.getSnapshot().libraryCollapsed).toEqual({ [SESSION]: true })
    view.unmount()
    const restored = groupedProps(scopeKey)
    render(<ScienceDetailsView {...restored.value} />)
    const restoredToggle = await screen.findByRole('button', { name: /^Current analysis · This session/ })
    expect(restoredToggle.getAttribute('aria-expanded')).toBe('false')
  })

  it('filters cards before grouping, hides empty groups, and counts only matching cards', async () => {
    const { value } = groupedProps()
    render(<ScienceDetailsView {...value} />)
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
    const scopeKey = crypto.randomUUID()
    localStorage.setItem(`dsh.science.selection.v1.${scopeKey}`, JSON.stringify({
      openArtifacts: [], activeTabId: null, libraryPage: 'artifacts', view: 'content', provenanceSubTab: 'code', lightboxOpen: false,
    }))
    const { value, store } = groupedProps(scopeKey)
    expect(() => { render(<ScienceDetailsView {...value} />) }).not.toThrow()
    fireEvent.click(await screen.findByRole('button', { name: 'Open Alpha, version 1' }))
    expect(await screen.findByRole('button', { name: 'Artifact library' })).toBeTruthy()
    expect(store.instance.getSnapshot().libraryTabs['alpha']).toBeDefined()
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
    render(<ScienceDetailsView {...props(baseProjection())} />)
    for (const status of screen.getAllByRole('status')) texts.push(status.textContent ?? '')
    cleanup()
    expect(new Set(texts).size).toBe(texts.length)
    expect(texts).toHaveLength(2)
  })
})
