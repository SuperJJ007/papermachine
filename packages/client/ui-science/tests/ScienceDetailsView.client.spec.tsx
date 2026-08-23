// @vitest-environment jsdom
/**
 * The Science Details entry (the artifact viewer): every reachable state
 * from the accepted client-safe `science` projection (missing projection
 * support, unbound, no-tab landing view with gallery/Outcome, opening a tab,
 * the tab strip across multiple open artifacts, the toolbar's version
 * stepper/provenance/download/maximize/close-tab controls, content dispatch
 * across every accepted media type, the provenance drill-in reached from the
 * toolbar, a stale tab, and distinct accessible text per top-level state).
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { TextMediaType } from '@deepseek-ai/dsh-attachment'
import { createSnapshotStore, type ConversationSnapshot, type SessionId, type SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ScienceClientArtifactVersion, ScienceClientHumanEditArtifactVersion, ScienceClientProjection,
  ScienceClientRun, ScienceClientRunArtifactVersion,
} from '@deepseek-ai/dsh-science-session/types'
import type { ScienceEditSelection, ScienceStyleEditReceipt, ScienceStyleEditRequest } from '@deepseek-ai/dsh-tool-science/types'
import {
  ScienceDetailsView,
  type ScienceDetailsViewProps,
} from '../src/client/ScienceDetailsView.tsx'
import { applyStyle, restrictedVegaLoader, selectableSpecPaths, specPathLabel } from '../src/client/ArtifactContent.tsx'
import { ScienceComposerSelections } from '../src/client/composer-selections.ts'
import { en } from '../src/client/locales.ts'
import { testScienceSelectionStore } from './selection-store-test-helpers.client.ts'

const { embedMock, finalizeMock, loaderLoadMock, loaderSanitizeMock } = vi.hoisted(() => ({
  embedMock: vi.fn(), finalizeMock: vi.fn(), loaderLoadMock: vi.fn(), loaderSanitizeMock: vi.fn(),
}))
vi.mock('vega-embed', () => ({
  default: embedMock,
  vega: {
    loader: () => ({
      load: loaderLoadMock,
      sanitize: loaderSanitizeMock,
      http: vi.fn(),
      file: vi.fn(),
    }),
  },
}))

type Props = ScienceDetailsViewProps
type CommitStyleEdit = (request: ScienceStyleEditRequest) => Promise<
  | { readonly ok: true; readonly value: ScienceStyleEditReceipt }
  | { readonly ok: false; readonly error: { readonly message: string } }
>

const SESSION = 'session-1' as SessionId
const t: Props['t'] = makeTranslate(en)

afterEach(() => {
  cleanup()
  embedMock.mockReset()
  finalizeMock.mockReset()
  loaderLoadMock.mockReset()
  loaderSanitizeMock.mockReset()
})

describe('Vega-Lite style helpers', () => {
  it('delegates local sanitize requests to the underlying loader and blocks protocol-relative/HTTP(S) URIs before they reach it', async () => {
    loaderSanitizeMock.mockResolvedValue({ href: 'local data' })
    await expect(restrictedVegaLoader.sanitize('data/values.csv', { context: 'href' })).resolves.toEqual({ href: 'local data' })
    expect(loaderSanitizeMock).toHaveBeenCalledWith('data/values.csv', { context: 'href' })
    await expect(restrictedVegaLoader.sanitize('//data.example/values.csv', { context: 'href' }))
      .rejects.toThrow(/external Vega-Lite resource URLs are disabled/)
    // `context: 'image'` is exactly how vega-scenegraph's ResourceLoader
    // sanitizes an image mark's `href`/`url` before setting `img.src` — this
    // proves the restriction reaches that path, not only `load()`'s own data
    // fetches.
    await expect(restrictedVegaLoader.sanitize('https://data.example/logo.png', { context: 'image' }))
      .rejects.toThrow(/external Vega-Lite resource URLs are disabled/)
    expect(loaderSanitizeMock).toHaveBeenCalledTimes(1)
  })

  it('enumerates every supported composition operator and ignores non-spec members', () => {
    expect(selectableSpecPaths({
      title: 'Chart title',
      layer: [{ mark: 'bar' }, null],
      hconcat: [{ encoding: { x: { field: 'x' } } }],
      concat: [{ mark: 'point' }],
      spec: [],
    })).toEqual(['title', 'layer.0.mark', 'hconcat.0.encoding.x', 'concat.0.mark'])
  })

  it('localizes the bounded target labels and preserves an unknown nested path', () => {
    expect(['title', 'encoding.y', 'encoding.x', 'mark', 'encoding.color', 'layer.0.mark'].map(path => specPathLabel(path, t)))
      .toEqual(['Title', 'Y axis', 'X axis', 'Mark style', 'Color / legend', 'layer.0.mark'])
  })

  it('immutably applies every bounded style field and leaves invalid structural paths unchanged', () => {
    const source = {
      layer: [{ mark: 'bar' }],
      mark: { type: 'text' },
      encoding: {
        x: { field: 'x', axis: { title: 'X' } },
        y: { field: 'y', axis: null },
        color: { field: 'group', scale: { domain: ['a'] }, legend: { title: 'Group' } },
        size: [],
      },
    }
    expect(applyStyle(source, 'mark', 'font-size', 14)).toMatchObject({ mark: { type: 'text', fontSize: 14 } })
    expect(applyStyle({ title: 'Before' }, 'title', 'label', 'After')).toEqual({ title: 'After' })
    expect(applyStyle({ title: { text: 'Before' } }, 'title', 'label', 'After')).toEqual({ title: { text: 'After' } })
    expect(applyStyle({ title: 'Before' }, 'title', 'font-size', 18)).toEqual({ title: { text: 'Before', fontSize: 18 } })
    expect(applyStyle({ title: { text: 'Before' } }, 'title', 'color', '#fff')).toEqual({ title: { text: 'Before', color: '#fff' } })
    expect(applyStyle({ title: 7 }, 'title', 'color', '#fff')).toEqual({ title: { color: '#fff' } })
    expect(applyStyle({ title: [] }, 'title', 'label', 'After')).toEqual({ title: { text: 'After' } })
    expect(applyStyle({ title: null }, 'title', 'font-size', 18)).toEqual({ title: { fontSize: 18 } })
    expect(applyStyle({ title: [] }, 'title', 'color', '#fff')).toEqual({ title: { color: '#fff' } })
    expect(applyStyle({ mark: 7 }, 'mark', 'color', '#fff')).toEqual({ mark: { color: '#fff' } })
    expect(applyStyle(source, 'encoding.x', 'label', 'Axis')).toMatchObject({ encoding: { x: { title: 'Axis' } } })
    expect(applyStyle(source, 'encoding.color', 'color', '#f00')).toMatchObject({ encoding: { color: { scale: { domain: ['a'], range: ['#f00'] } } } })
    expect(applyStyle(source, 'encoding.size', 'color', '#0f0')).toMatchObject({ encoding: { size: { scale: { range: ['#0f0'] } } } })
    expect(applyStyle(source, 'encoding.x', 'font-size', 12)).toMatchObject({ encoding: { x: { axis: { title: 'X', labelFontSize: 12 } } } })
    expect(applyStyle(source, 'encoding.y', 'font-size', 13)).toMatchObject({ encoding: { y: { axis: { labelFontSize: 13 } } } })
    expect(applyStyle(source, 'encoding.color', 'font-size', 15)).toMatchObject({ encoding: { color: { legend: { title: 'Group', labelFontSize: 15 } } } })
    expect(applyStyle(source, 'layer.0.mark', 'color', '#00f')).toMatchObject({ layer: [{ mark: { type: 'bar', color: '#00f' } }] })
    expect(applyStyle(source, 'layer.bad.mark', 'color', '#000')).toEqual(source)
    expect(applyStyle(source, 'layer.-1.mark', 'color', '#000')).toEqual(source)
    expect(applyStyle(source, 'layer.9.mark', 'color', '#000')).toEqual(source)
    expect(applyStyle({ layer: null }, 'layer.0.mark', 'color', '#000')).toEqual({ layer: null })
  })
})

function baseProjection(over: Partial<ScienceClientProjection> = {}): ScienceClientProjection {
  return {
    mode: { modeId: 'science', presetId: 'science', modeRevision: 'r' },
    environment: null,
    runs: [],
    kernels: [],
    artifacts: [],
    outcome: null,
    metrics: { runCount: 0, successfulRunCount: 0, artifactCount: 0, artifactVersionCount: 0, outcomeRevision: 0, kernelCount: 0 },
    lastScienceEventSeq: 1,
    ...over,
  }
}

function chart(over: Partial<ScienceClientRunArtifactVersion> = {}): ScienceClientRunArtifactVersion {
  return {
    artifactId: 'chart-1' as never,
    logicalName: 'loss-curve.png',
    version: 1,
    title: 'Loss curve',
    origin: 'model',
    attachment: { attachmentId: 'sha256:abc' as never, mediaType: 'image/png', bytes: 100, width: 10, height: 10 },
    runId: 'run-1' as never,
    toolCallId: 'call-chart-1' as never,
    requestHeaderSeq: 4,
    environmentRevision: 1,
    environmentFingerprintPreview: 'f'.repeat(12),
    createdAt: 500,
    ...over,
  }
}

function humanEditChart(over: Partial<ScienceClientHumanEditArtifactVersion> = {}): ScienceClientHumanEditArtifactVersion {
  return {
    artifactId: 'chart-1' as never,
    logicalName: 'summary.vl.json',
    version: 2,
    title: 'summary.vl.json',
    origin: 'human-edit',
    parent: { artifactId: 'chart-1' as never, version: 1 },
    attachment: { attachmentId: 'sha256:human' as never, mediaType: 'application/vnd.vega-lite+json', bytes: 40 },
    environmentRevision: 1,
    environmentFingerprintPreview: 'f'.repeat(12),
    createdAt: 700,
    ...over,
  }
}

function run(over: Partial<ScienceClientRun> = {}): ScienceClientRun {
  return {
    runId: 'run-1' as never,
    language: 'python',
    toolCallId: 'call-run-1' as never,
    requestHeaderSeq: 3,
    environmentRevision: 1,
    environmentFingerprintPreview: 'f'.repeat(12),
    startedAt: 1_000,
    codeSha256: 'c'.repeat(64),
    kernelEpoch: 1,
    status: 'success',
    finishedAt: 2_000,
    stdoutBytes: 0,
    stderrBytes: 0,
    stdoutTruncated: false,
    stderrTruncated: false,
    ...over,
    // `over` can widen `status` to any ScienceClientRun member (e.g.
    // 'interrupted'), which no single discriminated member's field set
    // matches on its own; the cast asserts the caller's own override is
    // internally consistent.
  } as ScienceClientRun
}

function emptySnapshot(): ConversationSnapshot {
  return { nodes: [], chat: { nodes: { get: () => undefined, values: () => [] } } } as unknown as ConversationSnapshot
}

function props(
  science: ScienceClientProjection | null | undefined,
  over: {
    agentPreset?: string
    loadImage?: Props['loadImage']
    loadText?: Props['loadText']
    addToConversation?: Props['addToConversation']
    removeFromConversation?: Props['removeFromConversation']
    composerSelections?: Props['composerSelections']
    commitStyleEdit?: CommitStyleEdit
    store?: ReturnType<typeof testScienceSelectionStore>
    inspectCall?: (callId: string) => void
    snapshot?: ConversationSnapshot
  } = {},
): Props {
  const state = {
    ids: [SESSION],
    byId: {
      [SESSION]: {
        id: SESSION, displayTitle: SESSION, running: false, blank: false, updatedAt: 0,
        ...over.agentPreset === undefined ? {} : { agentPreset: over.agentPreset },
      },
    },
    current: SESSION,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  } satisfies SessionListState
  function useSessions<T>(select: (snapshot: SessionListState) => T): T {
    return select(state)
  }
  const snapshot = over.snapshot ?? emptySnapshot()
  const store = over.store ?? testScienceSelectionStore()
  return {
    sessionId: SESSION,
    useSessions,
    useSession: (select: (s: ConversationSnapshot) => unknown) => select(snapshot),
    useProjection: vi.fn(() => science),
    useStore: store.useStore,
    actions: store.actions,
    inspectCall: over.inspectCall ?? vi.fn(),
    loadImage: over.loadImage ?? vi.fn().mockResolvedValue('data:image/png;base64,abc'),
    loadText: over.loadText ?? vi.fn().mockResolvedValue('a,b\n1,2\n'),
    addToConversation: over.addToConversation ?? vi.fn(),
    removeFromConversation: over.removeFromConversation ?? vi.fn(),
    composerSelections: over.composerSelections ?? createSnapshotStore([]),
    openTrace: vi.fn(),
    commitStyleEdit: over.commitStyleEdit ?? vi.fn().mockResolvedValue({
      ok: true, value: { artifactId: 'chart-1', version: 2, origin: 'human-edit' },
    }),
    t,
  } as unknown as Props
}

/** The whole-panel status text, valid only for a single-paragraph state. */
function statusText(): string {
  return screen.getByRole('status').textContent ?? ''
}

describe('ScienceDetailsView: missing projection support', () => {
  it('reports the capability gap distinctly, without a preset line', () => {
    render(<ScienceDetailsView {...props(undefined, { agentPreset: 'science' })} />)
    expect(statusText()).toBe('This deployment does not report Science session state.')
  })
})

describe('ScienceDetailsView: unbound', () => {
  it('shows the selected preset and an unbound state before the first Science event', () => {
    const view = render(<ScienceDetailsView {...props(null, { agentPreset: 'science' })} />)
    expect(view.container.textContent).toContain('Preset: science')
    expect(statusText()).toBe('No Science activity yet in this session.')
  })

  it('omits the preset line when the session summary carries none', () => {
    const view = render(<ScienceDetailsView {...props(null)} />)
    expect(view.container.textContent).not.toContain('Preset:')
    expect(statusText()).toBe('No Science activity yet in this session.')
  })
})

describe('ScienceDetailsView: landing view (no open tabs)', () => {
  it('reports no charts yet and no outcome yet for an empty history', () => {
    render(<ScienceDetailsView {...props(baseProjection())} />)
    const statuses = screen.getAllByRole('status')
    expect(statuses.map(el => el.textContent)).toEqual(['No artifacts yet.', 'No outcome published yet.'])
  })

  it('renders one gallery entry per logical chart at its latest accepted version', () => {
    const science = baseProjection({
      artifacts: [
        chart({ version: 1 }), chart({ version: 2 }), chart({ version: 1 }),
        chart({ artifactId: 'chart-2' as never, title: 'Other', version: 1 }),
      ],
    })
    render(<ScienceDetailsView {...props(science)} />)
    expect(screen.getByText('Image · v2 · 10 × 10 · 100 B')).toBeTruthy()
    expect(screen.getByText('Loss curve')).toBeTruthy()
    expect(screen.getByText('Other')).toBeTruthy()
  })

  it('formats kilobyte and megabyte artifact sizes', () => {
    const science = baseProjection({ artifacts: [
      chart({ artifactId: 'chart-kb' as never, title: 'Kilobytes', attachment: { attachmentId: 'sha256:kb' as never, mediaType: 'image/png', bytes: 2_048, width: 10, height: 10 } }),
      chart({ artifactId: 'chart-mb' as never, title: 'Megabytes', attachment: { attachmentId: 'sha256:mb' as never, mediaType: 'image/png', bytes: 2_097_152, width: 10, height: 10 } }),
    ] })
    render(<ScienceDetailsView {...props(science)} />)
    expect(screen.getByText(/2.0 KB/)).toBeTruthy()
    expect(screen.getByText(/2.0 MB/)).toBeTruthy()
  })

  it('labels a generated artifact with its turn, version, and parent version', () => {
    const science = baseProjection({
      artifacts: [chart({
        version: 5,
        parent: { artifactId: 'chart-1' as never, version: 4 },
      })],
    })
    const snapshot = {
      ...emptySnapshot(),
      nodes: [{
        kind: 'assistant', seq: 8, time: 8_000, turn: 3, step: 1,
        blocks: [{ kind: 'tool-call', callId: 'call-chart-1', name: 'annotate_artifact', argsRaw: '{}' }],
      }],
    } as ConversationSnapshot
    render(<ScienceDetailsView {...props(science, { snapshot })} />)
    expect(screen.getByText('Image · v5 · 10 × 10 · 100 B')).toBeTruthy()
  })

  it('labels first-generation and human-edited artifacts without internal generation facts', () => {
    const generated = chart({ artifactId: 'chart-generated' as never, version: 1, title: 'Generated' })
    const edited = humanEditChart({ artifactId: 'chart-edited' as never, version: 2, title: 'Edited' })
    const snapshot = {
      ...emptySnapshot(),
      nodes: [{
        kind: 'assistant', seq: 3, time: 3_000, turn: 2, step: 1,
        blocks: [{ kind: 'tool-call', callId: 'call-chart-1', name: 'annotate_artifact', argsRaw: '{}' }],
      }],
    } as ConversationSnapshot
    render(<ScienceDetailsView {...props(baseProjection({ artifacts: [generated, edited] }), { snapshot })} />)
    expect(screen.getByText('Image · v1 · 10 × 10 · 100 B')).toBeTruthy()
    expect(screen.getByText('Chart · v2 · 40 B')).toBeTruthy()
  })

  it('loads a gallery thumbnail through the injected session-scoped loader', async () => {
    const loadImage = vi.fn().mockResolvedValue('data:image/png;base64,abc')
    const science = baseProjection({ artifacts: [chart()] })
    const view = render(<ScienceDetailsView {...props(science, { loadImage })} />)
    await waitFor(() => { expect(loadImage).toHaveBeenCalledTimes(1) })
    expect(loadImage.mock.calls[0]?.[0]).toMatchObject({ attachmentId: 'sha256:abc' })
    await waitFor(() => { expect(view.container.querySelector('img')).not.toBeNull() })
  })

  it('reports unavailable attachments distinctly when the loader rejects', async () => {
    const loadImage = vi.fn().mockRejectedValue(new Error('network'))
    const science = baseProjection({ artifacts: [chart()] })
    render(<ScienceDetailsView {...props(science, { loadImage })} />)
    expect(await screen.findByRole('button', { name: 'Failed to load, click to retry' })).toBeTruthy()
  })

  it('renders a file-type tile (never an <img>) for a non-image artifact\'s gallery entry', () => {
    const science = baseProjection({
      artifacts: [chart({ logicalName: 'summary.csv', attachment: { attachmentId: 'sha256:csv' as never, mediaType: 'text/csv', bytes: 40 } })],
    })
    render(<ScienceDetailsView {...props(science)} />)
    expect(screen.getByText('CSV')).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('activates a gallery entry on Enter/Space and ignores every other key', () => {
    const science = baseProjection({ artifacts: [chart({ version: 1 })] })
    render(<ScienceDetailsView {...props(science)} />)
    const gallery = document.querySelector('[role="button"]') as HTMLElement
    fireEvent.keyDown(gallery, { key: 'a' })
    expect(screen.queryByRole('tablist', { name: 'Open artifacts' })).toBeNull()
    fireEvent.keyDown(gallery, { key: 'Enter' })
    expect(screen.getByRole('tablist', { name: 'Open artifacts' })).toBeTruthy()
  })

  it('reports no outcome published yet before publication, and renders the latest Outcome with evidence once published', () => {
    const science = baseProjection({
      outcome: {
        revision: 3, title: 'Model converges', summaryMarkdown: 'The **loss** dropped.',
        evidence: [
          { kind: 'run', runId: 'run-1' as never },
          { kind: 'chart', chartId: 'chart-1' as never, version: 2 },
          { kind: 'message', seq: 7 },
        ],
        publishedAt: 5_000,
        environmentRevisions: [1],
      },
    })
    render(<ScienceDetailsView {...props(science)} />)
    expect(screen.getByText('Model converges')).toBeTruthy()
    expect(screen.getByText(/revision 3/)).toBeTruthy()
    expect(document.querySelector('strong')?.textContent).toBe('loss')
    expect(screen.getByText('run run-1')).toBeTruthy()
    expect(screen.getByText('chart chart-1 v2')).toBeTruthy()
    expect(screen.getByText('message #7')).toBeTruthy()
  })
})

describe('ScienceDetailsView: opening a tab', () => {
  it('clicking a gallery entry opens its tab, shows the tab strip and toolbar, and switches away from the landing view', () => {
    const science = baseProjection({ artifacts: [chart({ version: 1, title: 'v1 title' }), chart({ version: 2, title: 'v2 title' })] })
    render(<ScienceDetailsView {...props(science)} />)
    fireEvent.click(screen.getByText('v2 title'))

    expect(screen.getByRole('tab', { name: 'v2 title' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'File library' })).toBeTruthy()
    expect(screen.getByText('Format')).toBeTruthy()
    expect(screen.queryByText('No artifacts yet.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'File library' }))
    expect(screen.queryByRole('tablist', { name: 'Open artifacts' })).toBeNull()
    expect(screen.getByText('v2 title')).toBeTruthy()
  })

  it('shows the generating turn in the viewer source rail after skipping unrelated nodes and calls', () => {
    const science = baseProjection({ artifacts: [chart()] })
    const snapshot = {
      ...emptySnapshot(),
      nodes: [
        { kind: 'user', seq: 1, content: [{ type: 'text', text: 'Create it' }] },
        { kind: 'assistant', seq: 2, turn: 1, blocks: [{ kind: 'text', text: 'Working' }] },
        { kind: 'assistant', seq: 3, turn: 2, blocks: [{ kind: 'tool-call', callId: 'other-call', name: 'run_python' }] },
        { kind: 'assistant', seq: 4, turn: 3, blocks: [{ kind: 'tool-call', callId: 'call-chart-1', name: 'annotate_artifact' }] },
      ],
    } as unknown as ConversationSnapshot
    render(<ScienceDetailsView {...props(science, { snapshot })} />)
    fireEvent.click(screen.getByText('Loss curve'))
    expect(screen.getByText('Generated in turn 3')).toBeTruthy()
    expect(screen.getByText('Read-only')).toBeTruthy()
  })
})

describe('ScienceDetailsView: tab strip', () => {
  function twoTabs() {
    const science = baseProjection({
      artifacts: [chart({ artifactId: 'chart-1' as never, title: 'Alpha' }), chart({ artifactId: 'chart-2' as never, title: 'Beta' })],
    })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 1 })
    store.actions.openTab({ artifactId: 'chart-2' as never, version: 1 })
    return { science, store }
  }

  it('renders one tab per opened artifact, the most recently opened active', () => {
    const { science, store } = twoTabs()
    render(<ScienceDetailsView {...props(science, { store })} />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map(tab => tab.textContent)).toEqual(['Alpha', 'Beta'])
    expect(screen.getByRole('tab', { name: 'Beta' }).getAttribute('aria-selected')).toBe('true')
  })

  it('clicking an inactive tab activates it', () => {
    const { science, store } = twoTabs()
    render(<ScienceDetailsView {...props(science, { store })} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Alpha' }))
    expect(store.instance.getSnapshot().activeArtifactId).toBe('chart-1')
  })

  it('closing a tab through its own close control removes it; closing the last tab returns to the landing view', () => {
    const { science, store } = twoTabs()
    render(<ScienceDetailsView {...props(science, { store })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close Alpha' }))
    expect(screen.queryByRole('tab', { name: 'Alpha' })).toBeNull()
    expect(screen.getByRole('tab', { name: 'Beta' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Close tab' }))
    expect(screen.queryByRole('tablist', { name: 'Open artifacts' })).toBeNull()
    // Back to the landing view: the gallery lists both charts again (closing
    // a tab never removes the chart itself from the projection).
    expect(screen.getByRole('button', { name: 'Open Alpha, version 1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open Beta, version 1' })).toBeTruthy()
  })

  it('a stale tab (chart no longer present in the projection) shows its raw id and the unavailable notice', () => {
    const science = baseProjection({ artifacts: [chart()] })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'missing-chart' as never, version: 1 })
    render(<ScienceDetailsView {...props(science, { store })} />)
    expect(screen.getByRole('tab', { name: 'missing-chart' })).toBeTruthy()
    expect(statusText()).toBe('This artifact version is no longer available.')
  })
})

describe('ScienceDetailsView: toolbar version stepper', () => {
  function threeVersions() {
    const science = baseProjection({
      artifacts: [
        chart({ version: 1, title: 'v1 title', caption: 'First pass', attachment: { attachmentId: 'sha256:abc' as never, mediaType: 'image/png', bytes: 512, width: 10, height: 10 } }),
        chart({ version: 2, title: 'v2 title', attachment: { attachmentId: 'sha256:abc' as never, mediaType: 'image/png', bytes: 2048, width: 10, height: 10 } }),
        chart({ version: 3, title: 'v3 title', attachment: { attachmentId: 'sha256:abc' as never, mediaType: 'image/png', bytes: 5 * 1024 * 1024, width: 10, height: 10 } }),
      ],
    })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 2 })
    return { science, store }
  }

  it('disables ‹ at the earliest version and › at the latest, and steps between them otherwise', () => {
    const { science, store } = threeVersions()
    render(<ScienceDetailsView {...props(science, { store })} />)
    expect(screen.getByRole('button', { name: 'Previous version' }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('button', { name: 'Next version' }).hasAttribute('disabled')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Next version' }))
    // The stepped-to title shows twice: once as the tab label, once in the toolbar.
    expect(screen.getAllByText('v3 title')).toHaveLength(2)
    expect(screen.queryByText(/5\.0 MB/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Next version' }).hasAttribute('disabled')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Previous version' }))
    fireEvent.click(screen.getByRole('button', { name: 'Previous version' }))
    expect(screen.getAllByText('v1 title')).toHaveLength(2)
    expect(screen.getByText('First pass')).toBeTruthy()
    expect(screen.queryByText(/512 B/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Previous version' }).hasAttribute('disabled')).toBe(true)
  })

  it('a disabled stepper button never invokes the step callback', () => {
    const { science, store } = threeVersions()
    render(<ScienceDetailsView {...props(science, { store })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Next version' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next version' }))
    expect(screen.getAllByText('v3 title')).toHaveLength(2)
  })
})

describe('ScienceDetailsView: viewer title', () => {
  it('shows the human title without repeating the logical filename', () => {
    const science = baseProjection({
      artifacts: [chart({ title: 'Loss curve', logicalName: 'loss-curve.png' })],
    })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 1 })
    render(<ScienceDetailsView {...props(science, { store })} />)
    expect(screen.getAllByText('Loss curve')).toHaveLength(2)
    expect(screen.queryByText('loss-curve.png')).toBeNull()
  })

  it('shows the name once when an auto-captured artifact\'s title equals its logical name', () => {
    const science = baseProjection({
      artifacts: [chart({ title: 'plot.png', logicalName: 'plot.png', origin: 'auto' })],
    })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 1 })
    render(<ScienceDetailsView {...props(science, { store })} />)
    // Once as the tab label, once as the toolbar title — never a second,
    // redundant logicalName line beside it.
    expect(screen.getAllByText('plot.png')).toHaveLength(2)
  })
})

describe('ScienceDetailsView: content dispatch', () => {
  it.each(['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const)('renders an image for %s attachments', async (mediaType) => {
    const science = baseProjection({
      artifacts: [chart({ attachment: { attachmentId: 'sha256:abc' as never, mediaType, bytes: 100, width: 10, height: 10 } })],
    })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 1 })
    const loadImage = vi.fn().mockResolvedValue(`data:${mediaType};base64,abc`)
    render(<ScienceDetailsView {...props(science, { store, loadImage })} />)
    await waitFor(() => { expect(document.querySelector('img')).not.toBeNull() })
  })

  it('does not expose source run ids or attachment dimensions in artifact content', () => {
    const science = baseProjection({ artifacts: [chart()] })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 1 })
    render(<ScienceDetailsView {...props(science, { store })} />)
    expect(screen.queryByText('from run run-1')).toBeNull()
    expect(screen.queryByText(/10×10/)).toBeNull()
  })

  function textArtifact(
    mediaType: TextMediaType, over: Partial<ScienceClientRunArtifactVersion> = {},
  ): { science: ScienceClientProjection; store: ReturnType<typeof testScienceSelectionStore> } {
    const science = baseProjection({
      artifacts: [chart({ logicalName: 'data.txt', attachment: { attachmentId: 'sha256:txt' as never, mediaType, bytes: 20 }, ...over })],
    })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 1 })
    return { science, store }
  }

  it('renders a CSV attachment as a sortable table', async () => {
    const loadText = vi.fn().mockResolvedValue('name,score\nada,10\nbob,2\n')
    const { science, store } = textArtifact('text/csv')
    render(<ScienceDetailsView {...props(science, { store, loadText })} />)
    await waitFor(() => { expect(screen.getByRole('table')).toBeTruthy() })
    expect(screen.getAllByRole('columnheader').map(th => th.textContent)).toEqual(['name', 'score'])
    expect(loadText.mock.calls[0]?.[0]).toMatchObject({ attachmentId: 'sha256:txt' })
    // No dimensions fact for a non-image artifact — only the byte size.
    expect(screen.queryByText(/×/)).toBeNull()
  })

  it('renders a JSON attachment as a JSON tree', async () => {
    const loadText = vi.fn().mockResolvedValue('{"ok":true}')
    const { science, store } = textArtifact('application/json')
    const view = render(<ScienceDetailsView {...props(science, { store, loadText })} />)
    await waitFor(() => { expect(screen.getByRole('tree')).toBeTruthy() })
    expect(view.container.textContent).toContain('ok')
    expect(view.container.textContent).toContain('true')
  })

  it('falls back to raw text for malformed JSON instead of throwing', async () => {
    const loadText = vi.fn().mockResolvedValue('{not valid json')
    const { science, store } = textArtifact('application/json')
    render(<ScienceDetailsView {...props(science, { store, loadText })} />)
    await waitFor(() => { expect(screen.getByText('{not valid json')).toBeTruthy() })
  })

  it('falls back to raw text for valid JSON that parses to a non-object/array (a bare number)', async () => {
    const loadText = vi.fn().mockResolvedValue('5')
    const { science, store } = textArtifact('application/json')
    render(<ScienceDetailsView {...props(science, { store, loadText })} />)
    await waitFor(() => { expect(screen.getByText('5').tagName).toBe('PRE') })
  })

  it('renders a Vega-Lite attachment as SVG and finalizes the renderer on unmount', async () => {
    embedMock.mockImplementation(async (element: HTMLElement) => {
      element.innerHTML = '<svg aria-label="Rendered Vega-Lite chart"></svg>'
      return { view: { finalize: finalizeMock } }
    })
    const loadText = vi.fn().mockResolvedValue('{"$schema":"https://vega.github.io/schema/vega-lite/v6.json","mark":"bar"}')
    const { science, store } = textArtifact('application/vnd.vega-lite+json', { logicalName: 'summary.vl.json' })
    const view = render(<ScienceDetailsView {...props(science, { store, loadText })} />)

    await waitFor(() => { expect(screen.getByLabelText('Rendered Vega-Lite chart')).toBeTruthy() })
    expect(embedMock).toHaveBeenCalledTimes(1)
    const embedCall = embedMock.mock.calls[0] as unknown[] | undefined
    expect(embedCall?.[0]).toBeInstanceOf(HTMLElement)
    expect(embedCall?.[1]).toMatchObject({ mark: 'bar' })
    expect(embedCall?.[2]).toMatchObject({ actions: false, mode: 'vega-lite', renderer: 'svg' })
    expect((embedCall?.[2] as { loader?: unknown } | undefined)?.loader).toBeDefined()
    view.unmount()
    expect(finalizeMock).toHaveBeenCalledTimes(1)
  })

  it('adds the selected Vega-Lite structural path and exact open version to the main composer', async () => {
    embedMock.mockResolvedValue({ view: { finalize: finalizeMock } })
    const loadText = vi.fn().mockResolvedValue('{"mark":"bar","encoding":{"x":{"field":"name"},"color":{"field":"group"}}}')
    const addToConversation = vi.fn<Props['addToConversation']>()
    const { science, store } = textArtifact('application/vnd.vega-lite+json', { logicalName: 'summary.vl.json', version: 3 })
    store.actions.setTabVersion({ artifactId: 'chart-1' as never, version: 3 })
    render(<ScienceDetailsView {...props(science, { store, loadText, addToConversation })} />)

    const comment = await screen.findByRole('textbox', { name: 'Edit note for Color / legend' })
    fireEvent.change(comment, { target: { value: 'make it blue' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add Color / legend to the conversation' }))

    await waitFor(() => {
      expect(addToConversation).toHaveBeenCalledWith([{
        artifactId: 'chart-1', version: 3,
        target: { kind: 'spec-path', path: 'encoding.color' },
        comment: 'make it blue',
      }])
    })
  })

  it('opens the human style panel when the rendered chart is activated', async () => {
    embedMock.mockResolvedValue({ view: { finalize: finalizeMock } })
    const loadText = vi.fn().mockResolvedValue('{"mark":"bar","encoding":{"y":{"field":"value"}}}')
    const { science, store } = textArtifact('application/vnd.vega-lite+json')
    render(<ScienceDetailsView {...props(science, { store, loadText })} />)

    const chartButton = await screen.findByRole('button', { name: 'Open chart style editor' })
    fireEvent.keyDown(chartButton, { key: 'a' })
    expect(screen.queryByRole('region', { name: 'Style' })).toBeNull()
    fireEvent.keyDown(chartButton, { key: ' ' })
    expect(screen.getByRole('region', { name: 'Style' })).toBeTruthy()
    fireEvent.click(chartButton)
  })

  it('does not expose chart-selection handlers when a spec has no structural targets', async () => {
    embedMock.mockResolvedValue({ view: { finalize: finalizeMock } })
    const loadText = vi.fn().mockResolvedValue('{"data":{"values":[]}}')
    const { science, store } = textArtifact('application/vnd.vega-lite+json')
    render(<ScienceDetailsView {...props(science, { store, loadText })} />)
    await waitFor(() => { expect(embedMock).toHaveBeenCalledTimes(1) })
    expect(screen.queryByRole('button', { name: 'Open chart style editor' })).toBeNull()
  })

  it('removes an element from the composer through the row minus control', async () => {
    embedMock.mockResolvedValue({ view: { finalize: finalizeMock } })
    const loadText = vi.fn().mockResolvedValue('{"mark":"bar"}')
    const selection: ScienceEditSelection = {
      artifactId: 'chart-1' as never, version: 1, target: { kind: 'spec-path', path: 'mark' },
    }
    const composerSelections = createSnapshotStore<readonly ScienceEditSelection[]>([selection])
    const removeFromConversation = vi.fn<Props['removeFromConversation']>()
    const { science, store } = textArtifact('application/vnd.vega-lite+json')
    render(<ScienceDetailsView {...props(science, {
      store, loadText, composerSelections, removeFromConversation,
    })} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Mark style' }))
    expect(removeFromConversation).toHaveBeenCalledWith(selection)
  })

  it('keeps each element row synchronized with removals from the main composer', async () => {
    embedMock.mockResolvedValue({ view: { finalize: finalizeMock } })
    const loadText = vi.fn().mockResolvedValue('{"mark":"bar","encoding":{"y":{"field":"value"}}}')
    const composerSelections = createSnapshotStore<readonly ScienceEditSelection[]>([])
    const addToConversation: Props['addToConversation'] = (targets) => { composerSelections.set(targets) }
    const removeFromConversation: Props['removeFromConversation'] = () => { composerSelections.set([]) }
    const { science, store } = textArtifact('application/vnd.vega-lite+json', { logicalName: 'chart.vl.json', version: 5 })
    store.actions.setTabVersion({ artifactId: 'chart-1' as never, version: 5 })
    render(<ScienceDetailsView {...props(science, {
      store, loadText, composerSelections, addToConversation, removeFromConversation,
    })} />)

    const add = await screen.findByRole('button', { name: 'Add Y axis to the conversation' })
    fireEvent.click(add)
    expect(await screen.findByRole('button', { name: 'Remove Y axis' })).toBeTruthy()
    act(() => { composerSelections.set([]) })
    expect(await screen.findByRole('button', { name: 'Add Y axis to the conversation' })).toBeTruthy()
  })

  it('never pre-fills one artifact\'s typed comment from another artifact sharing the same spec path (scenario A)', async () => {
    embedMock.mockResolvedValue({ view: { finalize: finalizeMock } })
    const loadText = vi.fn().mockResolvedValue('{"mark":"bar"}')
    const science = baseProjection({
      artifacts: [
        chart({
          artifactId: 'chart-1' as never, logicalName: 'a.vl.json', version: 1,
          attachment: { attachmentId: 'sha256:a' as never, mediaType: 'application/vnd.vega-lite+json', bytes: 10 },
        }),
        chart({
          artifactId: 'chart-2' as never, logicalName: 'b.vl.json', version: 1,
          attachment: { attachmentId: 'sha256:b' as never, mediaType: 'application/vnd.vega-lite+json', bytes: 10 },
        }),
      ],
    })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 1 })
    store.actions.openTab({ artifactId: 'chart-2' as never, version: 1 })
    act(() => { store.actions.activateTab('chart-1' as never) })
    render(<ScienceDetailsView {...props(science, { store, loadText })} />)

    const commentA = await screen.findByRole('textbox', { name: 'Edit note for Mark style' }) as HTMLInputElement
    fireEvent.change(commentA, { target: { value: 'artifact A note' } })
    expect(commentA.value).toBe('artifact A note')

    act(() => { store.actions.activateTab('chart-2' as never) })
    const commentB = await screen.findByRole('textbox', { name: 'Edit note for Mark style' }) as HTMLInputElement
    expect(commentB.value).toBe('')

    act(() => { store.actions.activateTab('chart-1' as never) })
    const commentAAgain = await screen.findByRole('textbox', { name: 'Edit note for Mark style' }) as HTMLInputElement
    expect(commentAAgain.value).toBe('')
  })

  it('updates the already-staged selection as the comment is edited further, keeping the store in sync (scenario B)', async () => {
    embedMock.mockResolvedValue({ view: { finalize: finalizeMock } })
    const loadText = vi.fn().mockResolvedValue('{"mark":"bar"}')
    const composerSelections = createSnapshotStore<readonly ScienceEditSelection[]>([])
    const addToConversation: Props['addToConversation'] = (targets) => { composerSelections.set(targets) }
    const { science, store } = textArtifact('application/vnd.vega-lite+json', { logicalName: 'chart.vl.json' })
    render(<ScienceDetailsView {...props(science, { store, loadText, composerSelections, addToConversation })} />)

    const comment = await screen.findByRole('textbox', { name: 'Edit note for Mark style' })
    fireEvent.change(comment, { target: { value: 'first note' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add Mark style to the conversation' }))
    expect(composerSelections.getSnapshot()).toEqual([{
      artifactId: 'chart-1', version: 1, target: { kind: 'spec-path', path: 'mark' }, comment: 'first note',
    }])

    // No further Add click: editing while staged must still reach the store,
    // or the chip and the outgoing science-edit message keep the stale text.
    fireEvent.change(comment, { target: { value: 'revised note' } })
    expect(composerSelections.getSnapshot()).toEqual([{
      artifactId: 'chart-1', version: 1, target: { kind: 'spec-path', path: 'mark' }, comment: 'revised note',
    }])
  })

  it('previews safe style controls and commits a human-edited next version', async () => {
    embedMock.mockResolvedValue({ view: { finalize: finalizeMock } })
    const loadText = vi.fn().mockResolvedValue('{"mark":"bar","encoding":{"color":{"field":"group"}}}')
    const commitStyleEdit = vi.fn<CommitStyleEdit>().mockResolvedValue({
      ok: true, value: { artifactId: 'chart-1' as never, version: 4, origin: 'human-edit' },
    })
    const { science, store } = textArtifact('application/vnd.vega-lite+json', { version: 3 })
    store.actions.setTabVersion({ artifactId: 'chart-1' as never, version: 3 })
    render(<ScienceDetailsView {...props(science, { store, loadText, commitStyleEdit })} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Color / legend' }))
    fireEvent.change(screen.getByLabelText('Color'), { target: { value: '#ff0000' } })
    fireEvent.change(screen.getByLabelText('Font size'), { target: { value: '200' } })
    fireEvent.change(screen.getByLabelText('Title text'), { target: { value: 'Group' } })
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))

    await waitFor(() => { expect(commitStyleEdit).toHaveBeenCalledTimes(1) })
    const request = commitStyleEdit.mock.calls[0]?.[0]
    expect(request).toMatchObject({ artifactId: 'chart-1', version: 3 })
    expect(JSON.parse(request?.spec ?? '{}')).toMatchObject({
      encoding: { color: { title: 'Group', scale: { range: ['#ff0000'] }, legend: { labelFontSize: 96 } } },
    })
    expect(store.instance.getSnapshot().openArtifacts[0]?.version).toBe(4)
  })

  it('shows the style commit success status once the committed version is live', async () => {
    embedMock.mockResolvedValue({ view: { finalize: finalizeMock } })
    const loadText = vi.fn().mockResolvedValue('{"mark":"bar"}')
    const commitStyleEdit = vi.fn<CommitStyleEdit>().mockResolvedValue({
      ok: true, value: { artifactId: 'chart-1' as never, version: 2, origin: 'human-edit' },
    })
    const science = baseProjection({
      artifacts: [
        chart({
          logicalName: 'summary.vl.json', version: 1,
          attachment: { attachmentId: 'sha256:v1' as never, mediaType: 'application/vnd.vega-lite+json', bytes: 30 },
        }),
        humanEditChart({ version: 2 }),
      ],
    })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 1 })
    render(<ScienceDetailsView {...props(science, { store, loadText, commitStyleEdit })} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Mark style' }))
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))

    await waitFor(() => { expect(screen.getByText('Human-edited version committed.')).toBeTruthy() })
    expect(store.instance.getSnapshot().openArtifacts[0]?.version).toBe(2)
  })

  it('renders Host style-commit failures and rejected calls without changing versions', async () => {
    embedMock.mockResolvedValue({ view: { finalize: finalizeMock } })
    const loadText = vi.fn().mockResolvedValue('{"mark":"bar"}')
    const failedCommit = vi.fn<CommitStyleEdit>().mockResolvedValue({ ok: false, error: { message: 'style version is stale' } })
    const first = textArtifact('application/vnd.vega-lite+json')
    const failedView = render(<ScienceDetailsView {...props(first.science, {
      store: first.store, loadText, commitStyleEdit: failedCommit,
    })} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Mark style' }))
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))
    expect((await screen.findByRole('alert')).textContent).toContain('style version is stale')
    expect(first.store.instance.getSnapshot().openArtifacts[0]?.version).toBe(1)
    failedView.unmount()

    const rejectedCommit = vi.fn<CommitStyleEdit>().mockRejectedValue('offline')
    const second = textArtifact('application/vnd.vega-lite+json')
    const rejectedView = render(<ScienceDetailsView {...props(second.science, {
      store: second.store, loadText, commitStyleEdit: rejectedCommit,
    })} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Mark style' }))
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))
    expect((await screen.findByRole('alert')).textContent).toContain('offline')
    expect(second.store.instance.getSnapshot().openArtifacts[0]?.version).toBe(1)
    rejectedView.unmount()

    const errorCommit = vi.fn<CommitStyleEdit>().mockRejectedValue(new Error('commit transport failed'))
    const third = textArtifact('application/vnd.vega-lite+json')
    render(<ScienceDetailsView {...props(third.science, {
      store: third.store, loadText, commitStyleEdit: errorCommit,
    })} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Mark style' }))
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))
    expect((await screen.findByRole('alert')).textContent).toContain('commit transport failed')
  })

  it('offers structural targets inside concatenated and faceted compositions', async () => {
    embedMock.mockResolvedValue({ view: { finalize: finalizeMock } })
    const loadText = vi.fn().mockResolvedValue(JSON.stringify({
      vconcat: [
        { mark: 'bar', encoding: { x: { field: 'name' } } },
        { facet: { row: { field: 'group' } }, spec: { mark: 'line', encoding: { y: { field: 'value' } } } },
      ],
    }))
    const { science, store } = textArtifact('application/vnd.vega-lite+json', { logicalName: 'summary.vl.json' })
    render(<ScienceDetailsView {...props(science, { store, loadText })} />)

    expect(await screen.findByRole('button', { name: 'vconcat.0.mark' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'vconcat.0.encoding.x' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'vconcat.1.spec.mark' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'vconcat.1.spec.encoding.y' })).toBeDefined()
  })

  it('normalizes a raster drag into a drawn region, without auto-staging an AI edit', async () => {
    const science = baseProjection({ artifacts: [chart({ version: 2 })] })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 2 })
    const addToConversation = vi.fn<Props['addToConversation']>()
    render(<ScienceDetailsView {...props(science, { store, addToConversation })} />)

    fireEvent.click(screen.getByRole('button', { name: 'Select region to edit' }))
    const gesture = screen.getByLabelText('Drag to select an edit region')
    vi.spyOn(gesture, 'getBoundingClientRect').mockReturnValue({
      x: 10, y: 20, left: 10, top: 20, right: 210, bottom: 120, width: 200, height: 100,
      toJSON: () => ({}),
    })
    fireEvent.mouseDown(gesture, { clientX: 30, clientY: 40 })
    fireEvent.mouseMove(gesture, { clientX: 130, clientY: 90 })
    fireEvent.mouseUp(gesture, { clientX: 130, clientY: 90 })
    expect(addToConversation).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Select region to edit' }).getAttribute('aria-pressed')).toBe('false')
    // The drawn region now offers its own staging control — a comment field
    // and an explicit Add button — rather than the dead end this drag used
    // to be with no way to reach the composer at all.
    expect(screen.getByRole('button', { name: 'Add region 10%,20% to the conversation' })).toBeTruthy()
  })

  it('stages a drawn region with its typed comment, and un-stages it through the same control', () => {
    const science = baseProjection({ artifacts: [chart({ version: 2 })] })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 2 })
    const selections = new ScienceComposerSelections()
    render(<ScienceDetailsView {...props(science, {
      store,
      addToConversation: (targets) => { selections.add(SESSION, targets) },
      removeFromConversation: (target) => { selections.removeSelection(SESSION, target) },
      composerSelections: selections.store(SESSION),
    })} />)

    fireEvent.click(screen.getByRole('button', { name: 'Select region to edit' }))
    const gesture = screen.getByLabelText('Drag to select an edit region')
    // Corners chosen as exact binary fractions (0.25/0.75) so the derived
    // width/height compare exactly, with no float-rounding slack.
    vi.spyOn(gesture, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100,
      toJSON: () => ({}),
    })
    fireEvent.mouseDown(gesture, { clientX: 25, clientY: 25 })
    fireEvent.mouseMove(gesture, { clientX: 75, clientY: 75 })
    fireEvent.mouseUp(gesture, { clientX: 75, clientY: 75 })

    fireEvent.change(screen.getByLabelText('Edit note for region 25%,25%'), { target: { value: 'brighten this' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add region 25%,25% to the conversation' }))
    fireEvent.change(screen.getByLabelText('Edit note for region 25%,25%'), { target: { value: 'brighten this more' } })
    expect(selections.store(SESSION).getSnapshot()).toEqual([{
      artifactId: 'chart-1', version: 2,
      target: { kind: 'normalized-region', x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
      comment: 'brighten this more',
    }])
    // The control now offers Remove; un-staging clears it back out.
    expect(screen.queryByRole('button', { name: 'Add region 25%,25% to the conversation' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Remove region 25%,25%' }))
    expect(selections.store(SESSION).getSnapshot()).toEqual([])
  })

  it('ignores incomplete raster gestures and clears a draft when the pointer leaves', () => {
    const science = baseProjection({ artifacts: [chart()] })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 1 })
    render(<ScienceDetailsView {...props(science, { store })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Select region to edit' }))
    const gesture = screen.getByLabelText('Drag to select an edit region')
    vi.spyOn(gesture, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100,
      toJSON: () => ({}),
    })
    fireEvent.mouseMove(gesture, { clientX: 20, clientY: 20 })
    fireEvent.mouseUp(gesture, { clientX: 20, clientY: 20 })
    fireEvent.mouseDown(gesture, { clientX: 30, clientY: 30 })
    fireEvent.mouseUp(gesture, { clientX: 30, clientY: 30 })
    fireEvent.mouseDown(gesture, { clientX: 10, clientY: 10 })
    fireEvent.mouseMove(gesture, { clientX: 40, clientY: 40 })
    fireEvent.mouseLeave(gesture)
    expect(screen.getByRole('button', { name: 'Cancel region selection' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('finalizes a Vega-Lite view that resolves after unmount', async () => {
    let resolveEmbed: ((result: { view: { finalize: typeof finalizeMock } }) => void) | undefined
    embedMock.mockImplementation(() => new Promise((resolve) => { resolveEmbed = resolve }))
    const loadText = vi.fn().mockResolvedValue('{"mark":"bar"}')
    const { science, store } = textArtifact('application/vnd.vega-lite+json')
    const view = render(<ScienceDetailsView {...props(science, { store, loadText })} />)

    await waitFor(() => { expect(embedMock).toHaveBeenCalledTimes(1) })
    view.unmount()
    await act(async () => { resolveEmbed?.({ view: { finalize: finalizeMock } }) })
    expect(finalizeMock).toHaveBeenCalledTimes(1)
  })

  it('discards a Vega-Lite rejection that arrives after unmount', async () => {
    let rejectEmbed: ((reason: Error) => void) | undefined
    embedMock.mockImplementation(() => new Promise((_resolve, reject) => { rejectEmbed = reject }))
    const loadText = vi.fn().mockResolvedValue('{"mark":"bar"}')
    const { science, store } = textArtifact('application/vnd.vega-lite+json')
    const view = render(<ScienceDetailsView {...props(science, { store, loadText })} />)

    await waitFor(() => { expect(embedMock).toHaveBeenCalledTimes(1) })
    view.unmount()
    await act(async () => { rejectEmbed?.(new Error('late rejection')) })
    expect(finalizeMock).not.toHaveBeenCalled()
  })

  it('falls back to the JSON tree when Vega-Lite rejects a parsed document', async () => {
    embedMock.mockRejectedValue(new Error('invalid Vega-Lite specification'))
    const loadText = vi.fn().mockResolvedValue('{"mark":"not-a-mark","data":{"values":[]}}')
    const { science, store } = textArtifact('application/vnd.vega-lite+json', { logicalName: 'invalid.vl.json' })
    const view = render(<ScienceDetailsView {...props(science, { store, loadText })} />)

    await waitFor(() => { expect(screen.getByRole('tree')).toBeTruthy() })
    expect(view.container.textContent).toContain('not-a-mark')
  })

  it('blocks external Vega-Lite data URLs through the embed loader\'s sanitize seam and explains the JSON fallback', async () => {
    // `load()`'s real implementation (unmocked in production) calls
    // `this.sanitize` before fetching a `data.url`'s bytes; this models that
    // call directly since `vega-embed`/`vega.loader` are fully mocked here.
    embedMock.mockImplementation(async (_element: HTMLElement, _document: object, options: {
      loader: { sanitize: (uri: string, opts: { context: string }) => Promise<{ href: string }> }
    }) => {
      await options.loader.sanitize('https://data.example/values.csv', { context: 'href' })
      return { view: { finalize: finalizeMock } }
    })
    const loadText = vi.fn().mockResolvedValue('{"mark":"bar","data":{"url":"https://data.example/values.csv"}}')
    const { science, store } = textArtifact('application/vnd.vega-lite+json', { logicalName: 'external.vl.json' })
    render(<ScienceDetailsView {...props(science, { store, loadText })} />)

    await waitFor(() => { expect(screen.getByRole('note').textContent).toContain('disabled external resource') })
    expect(screen.getByRole('tree')).toBeTruthy()
    expect(loaderLoadMock).not.toHaveBeenCalled()
    expect(loaderSanitizeMock).not.toHaveBeenCalled()
  })

  it('rejects an external Vega-Lite image mark through the embed loader\'s sanitize seam (never reaching `load`, which image marks never call)', async () => {
    // vega-scenegraph's `ResourceLoader.loadImage` calls
    // `sanitize(uri, {context: 'image'})` directly and never calls `load()`
    // at all — an image mark is exactly the bypass this restriction closes.
    // Driving that rejection out through `embed()` here (as production's
    // `ResourceLoader.loadImage` does not: it catches the rejection and
    // resolves to an empty placeholder image instead of rejecting) is a
    // testing simplification that isolates the one property this test
    // exists to prove — `sanitize` itself rejects a `context: 'image'`
    // request for a blocked URI — without reproducing that catch. The
    // JSON-tree fallback this produces below is this test's own artifact,
    // not what a real image mark renders: in production the image mark
    // simply fails to load and the rest of the chart renders normally.
    embedMock.mockImplementation(async (_element: HTMLElement, _document: object, options: {
      loader: { sanitize: (uri: string, opts: { context: string }) => Promise<{ href: string }> }
    }) => {
      await options.loader.sanitize('https://data.example/logo.png', { context: 'image' })
      return { view: { finalize: finalizeMock } }
    })
    const loadText = vi.fn().mockResolvedValue(
      '{"mark":"image","encoding":{"url":{"value":"https://data.example/logo.png"}}}',
    )
    const { science, store } = textArtifact('application/vnd.vega-lite+json', { logicalName: 'image-mark.vl.json' })
    render(<ScienceDetailsView {...props(science, { store, loadText })} />)

    await waitFor(() => { expect(screen.getByRole('note').textContent).toContain('disabled external resource') })
    expect(screen.getByRole('tree')).toBeTruthy()
    expect(loaderLoadMock).not.toHaveBeenCalled()
    expect(loaderSanitizeMock).not.toHaveBeenCalled()
  })

  it('falls back to raw text without loading Vega for malformed .vl.json bytes', async () => {
    const loadText = vi.fn().mockResolvedValue('{not valid Vega-Lite')
    const { science, store } = textArtifact('application/vnd.vega-lite+json', { logicalName: 'invalid.vl.json' })
    render(<ScienceDetailsView {...props(science, { store, loadText })} />)

    await waitFor(() => { expect(screen.getByText('{not valid Vega-Lite').tagName).toBe('PRE') })
    expect(embedMock).not.toHaveBeenCalled()
  })

  it('does not re-embed the same Vega-Lite spec on a parent re-render', async () => {
    embedMock.mockImplementation(async (element: HTMLElement) => {
      element.innerHTML = '<svg aria-label="Rendered Vega-Lite chart"></svg>'
      return { view: { finalize: finalizeMock } }
    })
    const loadText = vi.fn().mockResolvedValue('{"mark":"bar"}')
    const { science, store } = textArtifact('application/vnd.vega-lite+json', { logicalName: 'summary.vl.json' })
    const view = render(<ScienceDetailsView {...props(science, { store, loadText })} />)

    await waitFor(() => { expect(screen.getByLabelText('Rendered Vega-Lite chart')).toBeTruthy() })
    view.rerender(<ScienceDetailsView {...props(science, { store, loadText })} />)
    view.rerender(<ScienceDetailsView {...props(science, { store, loadText })} />)
    expect(embedMock).toHaveBeenCalledTimes(1)
    expect(finalizeMock).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Rendered Vega-Lite chart')).toBeTruthy()
  })

  it('keeps the JSON-tree fallback alive across a re-render after the renderer rejected the spec', async () => {
    embedMock.mockRejectedValue(new Error('invalid Vega-Lite specification'))
    const loadText = vi.fn().mockResolvedValue('{"mark":"not-a-mark","data":{"values":[]}}')
    const { science, store } = textArtifact('application/vnd.vega-lite+json', { logicalName: 'invalid.vl.json' })
    const view = render(<ScienceDetailsView {...props(science, { store, loadText })} />)

    await waitFor(() => { expect(screen.getByRole('tree')).toBeTruthy() })
    expect(screen.getByTestId('vega-lite-view').hidden).toBe(true)
    view.rerender(<ScienceDetailsView {...props(science, { store, loadText })} />)
    expect(screen.getByRole('tree')).toBeTruthy()
    expect(view.container.textContent).toContain('not-a-mark')
  })

  it('discards a text load that resolves after the component already unmounted', async () => {
    let resolveLoad: ((text: string) => void) | undefined
    const loadText = vi.fn(() => new Promise<string>((resolve) => { resolveLoad = resolve }))
    const { science, store } = textArtifact('text/plain')
    const view = render(<ScienceDetailsView {...props(science, { store, loadText })} />)
    await waitFor(() => { expect(loadText).toHaveBeenCalledTimes(1) })
    view.unmount()
    // No "state update on an unmounted component" throw or warning: the
    // effect's liveness guard discards this late resolution.
    expect(() => { resolveLoad?.('too late') }).not.toThrow()
  })

  it('discards a text load that rejects after the component already unmounted', async () => {
    let rejectLoad: ((error: Error) => void) | undefined
    const loadText = vi.fn(() => new Promise<string>((_resolve, reject) => { rejectLoad = reject }))
    const { science, store } = textArtifact('text/plain')
    const view = render(<ScienceDetailsView {...props(science, { store, loadText })} />)
    await waitFor(() => { expect(loadText).toHaveBeenCalledTimes(1) })
    view.unmount()
    expect(() => { rejectLoad?.(new Error('too late')) }).not.toThrow()
  })

  it('renders a Markdown attachment through MarkdownText', async () => {
    const loadText = vi.fn().mockResolvedValue('**bold**')
    const { science, store } = textArtifact('text/markdown')
    render(<ScienceDetailsView {...props(science, { store, loadText })} />)
    await waitFor(() => { expect(screen.getByText('bold').tagName).toBe('STRONG') })
  })

  it('renders a plain text attachment preformatted', async () => {
    const loadText = vi.fn().mockResolvedValue('raw log line')
    const { science, store } = textArtifact('text/plain')
    render(<ScienceDetailsView {...props(science, { store, loadText })} />)
    await waitFor(() => { expect(screen.getByText('raw log line').tagName).toBe('PRE') })
  })

  it('caps a CSV table at 500 rendered rows and shows a truncation notice', async () => {
    const rows = Array.from({ length: 800 }, (_, i) => `r${String(i)},${String(i)}`).join('\n')
    const loadText = vi.fn().mockResolvedValue(`name,score\n${rows}\n`)
    const { science, store } = textArtifact('text/csv')
    render(<ScienceDetailsView {...props(science, { store, loadText })} />)
    await waitFor(() => { expect(screen.getByRole('table')).toBeTruthy() })
    expect(screen.getAllByRole('row')).toHaveLength(501) // header row + 500 data rows
    expect(screen.getByText('Showing first 500 of 800 rows.')).toBeTruthy()
  })

  it('does not show a truncation notice for a CSV table at or under the row cap', async () => {
    const loadText = vi.fn().mockResolvedValue('name,score\nada,10\nbob,2\n')
    const { science, store } = textArtifact('text/csv')
    render(<ScienceDetailsView {...props(science, { store, loadText })} />)
    await waitFor(() => { expect(screen.getByRole('table')).toBeTruthy() })
    expect(screen.queryByText(/Showing first/)).toBeNull()
  })

  it('caps an oversized JSON attachment at 100,000 characters before parsing, falling back to truncated raw text', async () => {
    const big = `{"pad":"${'x'.repeat(100_000)}"}`
    const loadText = vi.fn().mockResolvedValue(big)
    const { science, store } = textArtifact('application/json')
    render(<ScienceDetailsView {...props(science, { store, loadText })} />)
    await waitFor(() => { expect(screen.getByText(`Showing first 100000 of ${String(big.length)} characters.`)).toBeTruthy() })
    expect(screen.queryByRole('tree')).toBeNull()
    const pre = document.querySelector('pre')
    expect(pre?.textContent).toHaveLength(100_000)
  })

  it('caps an oversized plain text attachment at 100,000 characters with a truncation notice', async () => {
    const big = 'y'.repeat(150_000)
    const loadText = vi.fn().mockResolvedValue(big)
    const { science, store } = textArtifact('text/plain')
    render(<ScienceDetailsView {...props(science, { store, loadText })} />)
    await waitFor(() => { expect(screen.getByText('Showing first 100000 of 150000 characters.')).toBeTruthy() })
    const pre = document.querySelector('pre')
    expect(pre?.textContent).toHaveLength(100_000)
  })

  it('shows a loading notice, then a retry control that re-fetches on failure', async () => {
    const loadText = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce('ok text')
    const { science, store } = textArtifact('text/plain')
    render(<ScienceDetailsView {...props(science, { store, loadText })} />)
    const retry = await screen.findByRole('button', { name: 'Failed to load, click to retry' })
    fireEvent.click(retry)
    await waitFor(() => { expect(screen.getByText('ok text')).toBeTruthy() })
    expect(loadText).toHaveBeenCalledTimes(2)
  })
})

describe('ScienceDetailsView: maximize (toolbar-triggered lightbox)', () => {
  it('opens when maximize is clicked, and closes back through the same store', async () => {
    const loadImage = vi.fn().mockResolvedValue('data:image/png;base64,abc')
    const science = baseProjection({ artifacts: [chart()] })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 1 })
    render(<ScienceDetailsView {...props(science, { store, loadImage })} />)

    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => { expect(store.instance.getSnapshot().lightboxOpen).toBe(false) })
  })

  it('reports the lightbox image as unavailable when the loader rejects (no dialog, no crash)', async () => {
    const loadImage = vi.fn().mockRejectedValue(new Error('network'))
    const science = baseProjection({ artifacts: [chart()] })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 1 })
    render(<ScienceDetailsView {...props(science, { store, loadImage })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }))
    await waitFor(() => { expect(loadImage.mock.calls.length).toBeGreaterThan(1) })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('has no maximize control for a non-image artifact — nothing to raster-maximize', () => {
    const science = baseProjection({
      artifacts: [chart({ attachment: { attachmentId: 'sha256:txt' as never, mediaType: 'text/plain', bytes: 5 } })],
    })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 1 })
    render(<ScienceDetailsView {...props(science, { store })} />)
    expect(screen.queryByRole('button', { name: 'Expand' })).toBeNull()
  })

  it('discards a lightbox load that resolves after the lightbox already closed', async () => {
    let resolveLoad: ((url: string) => void) | undefined
    const loadImage = vi.fn((attachment: { attachmentId: string }) => {
      if (loadImage.mock.calls.length === 1) return Promise.resolve('data:image/png;base64,thumb')
      void attachment
      return new Promise<string>((resolve) => { resolveLoad = resolve })
    })
    const science = baseProjection({ artifacts: [chart()] })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 1 })
    render(<ScienceDetailsView {...props(science, { store, loadImage })} />)

    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Expand' })) })
    await waitFor(() => { expect(loadImage.mock.calls.length).toBeGreaterThanOrEqual(2) })
    act(() => { store.actions.setLightboxOpen(false) })
    act(() => { resolveLoad?.('data:image/png;base64,late') })
    await Promise.resolve()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('ScienceDetailsView: download', () => {
  function withOneTab(attachmentOver: Partial<ScienceClientArtifactVersion['attachment']> = {}) {
    const science = baseProjection({
      artifacts: [chart({ attachment: { attachmentId: 'sha256:abc' as never, mediaType: 'image/png', bytes: 100, width: 10, height: 10, ...attachmentOver } })],
    })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 1 })
    return { science, store }
  }

  it('resolves the durable bytes and triggers a browser save through a throwaway anchor named for the attachment', async () => {
    const loadImage = vi.fn().mockResolvedValue('data:image/png;base64,xyz')
    const { science, store } = withOneTab({ name: 'observed.png' })
    const created: HTMLAnchorElement[] = []
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      created.push(this)
    })
    render(<ScienceDetailsView {...props(science, { store, loadImage })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Download' }))
    await waitFor(() => { expect(clickSpy).toHaveBeenCalledTimes(1) })
    expect(created[0]?.href).toBe('data:image/png;base64,xyz')
    expect(created[0]?.download).toBe('observed.png')
    clickSpy.mockRestore()
  })

  it('falls back to a logicalName-version filename when the attachment carries no name', async () => {
    const loadImage = vi.fn().mockResolvedValue('data:image/png;base64,xyz')
    const { science, store } = withOneTab()
    const created: HTMLAnchorElement[] = []
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      created.push(this)
    })
    render(<ScienceDetailsView {...props(science, { store, loadImage })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Download' }))
    await waitFor(() => { expect(clickSpy).toHaveBeenCalledTimes(1) })
    expect(created[0]?.download).toBe('loss-curve-v1.png')
    clickSpy.mockRestore()
  })

  it('builds a text/csv data URI (not loadImage) for a non-image artifact\'s download', async () => {
    const loadImage = vi.fn()
    const loadText = vi.fn().mockResolvedValue('a,b\n1,2\n')
    const science = baseProjection({
      artifacts: [chart({ logicalName: 'summary.csv', attachment: { attachmentId: 'sha256:csv' as never, mediaType: 'text/csv', bytes: 40 } })],
    })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 1 })
    const created: HTMLAnchorElement[] = []
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      created.push(this)
    })
    render(<ScienceDetailsView {...props(science, { store, loadImage, loadText })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Download' }))
    await waitFor(() => { expect(clickSpy).toHaveBeenCalledTimes(1) })
    expect(created[0]?.href).toBe(`data:text/csv;charset=utf-8,${encodeURIComponent('a,b\n1,2\n')}`)
    expect(created[0]?.download).toBe('summary-v1.csv')
    expect(loadImage).not.toHaveBeenCalled()
    clickSpy.mockRestore()
  })

  it('inserts the version ahead of the whole .vl.json two-part suffix, not inside it', async () => {
    embedMock.mockResolvedValue({ view: { finalize: finalizeMock } })
    const loadImage = vi.fn()
    const loadText = vi.fn().mockResolvedValue('{"mark":"bar"}')
    const science = baseProjection({
      artifacts: [chart({ logicalName: 'summary.vl.json', attachment: { attachmentId: 'sha256:vl' as never, mediaType: 'application/vnd.vega-lite+json', bytes: 14 } })],
    })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 1 })
    const created: HTMLAnchorElement[] = []
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      created.push(this)
    })
    render(<ScienceDetailsView {...props(science, { store, loadImage, loadText })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Download' }))
    await waitFor(() => { expect(clickSpy).toHaveBeenCalledTimes(1) })
    expect(created[0]?.download).toBe('summary-v1.vl.json')
    clickSpy.mockRestore()
  })

  it('inserts the version with no extension when the logical name (and the attachment) carry none', async () => {
    const loadImage = vi.fn().mockResolvedValue('data:image/png;base64,xyz')
    const science = baseProjection({
      artifacts: [chart({ logicalName: 'no-extension', attachment: { attachmentId: 'sha256:abc' as never, mediaType: 'image/png', bytes: 100, width: 10, height: 10 } })],
    })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 1 })
    const created: HTMLAnchorElement[] = []
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      created.push(this)
    })
    render(<ScienceDetailsView {...props(science, { store, loadImage })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Download' }))
    await waitFor(() => { expect(clickSpy).toHaveBeenCalledTimes(1) })
    expect(created[0]?.download).toBe('no-extension-v1')
    clickSpy.mockRestore()
  })

  it('a rejected download is swallowed (no dialog, no crash, no anchor click)', async () => {
    const loadImage = vi.fn()
      .mockResolvedValueOnce('data:image/png;base64,thumb')
      .mockRejectedValueOnce(new Error('network'))
    const { science, store } = withOneTab()
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<ScienceDetailsView {...props(science, { store, loadImage })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Download' }))
    await waitFor(() => { expect(loadImage).toHaveBeenCalledTimes(2) })
    expect(clickSpy).not.toHaveBeenCalled()
    clickSpy.mockRestore()
  })
})

describe('ScienceDetailsView: export placeholder', () => {
  it('stays reachable in the tab order and names the reason through aria-describedby, instead of a native disabled', () => {
    const science = baseProjection({ artifacts: [chart()] })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 1 })
    render(<ScienceDetailsView {...props(science, { store })} />)
    const exportButton = screen.getByRole('button', { name: 'Export' })
    expect(exportButton.hasAttribute('disabled')).toBe(false)
    expect(exportButton.getAttribute('aria-disabled')).toBe('true')
    expect(exportButton.getAttribute('data-unavailable')).toBe('true')
    const reasonId = exportButton.getAttribute('aria-describedby')
    expect(reasonId).toBeTruthy()
    expect(document.getElementById(reasonId!)?.textContent).toBe('Export will be available in C4')
  })
})

describe('ScienceDetailsView: provenance drill-in', () => {
  function withRunAndChart() {
    const science = baseProjection({ runs: [run()], artifacts: [chart()] })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 1 })
    return { science, store }
  }

  it('opens from the toolbar\'s provenance control, showing the breadcrumb and the code sub-tab by default', () => {
    const { science, store } = withRunAndChart()
    render(<ScienceDetailsView {...props(science, { store })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Provenance' }))
    expect(screen.getByRole('navigation', { name: 'Provenance' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Code' }).getAttribute('aria-selected')).toBe('true')
    expect(store.instance.getSnapshot().view).toBe('provenance')
  })

  it('the breadcrumb root returns to the content view', () => {
    const { science, store } = withRunAndChart()
    render(<ScienceDetailsView {...props(science, { store })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Provenance' }))
    fireEvent.click(screen.getByRole('button', { name: 'Loss curve' }))
    expect(store.instance.getSnapshot().view).toBe('content')
    expect(screen.getByRole('button', { name: 'Provenance' })).toBeTruthy()
  })

  it('the Messages sub-tab\'s jump reaches the Details seam\'s inspectCall callback', () => {
    const inspectCall = vi.fn()
    const { science, store } = withRunAndChart()
    render(<ScienceDetailsView {...props(science, { store, inspectCall })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Provenance' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Messages' }))
    fireEvent.click(screen.getByRole('button', { name: 'Jump to transcript' }))
    expect(inspectCall).toHaveBeenCalledWith('call-run-1')
  })

  it('shows direct-edit ancestry without a source run and lets the breadcrumb return to content', () => {
    const parent = chart({
      logicalName: 'chart.vl.json',
      attachment: {
        attachmentId: 'sha256:parent' as never,
        mediaType: 'application/vnd.vega-lite+json',
        bytes: 40,
      },
    })
    const { runId: _runId, toolCallId: _toolCallId, requestHeaderSeq: _requestHeaderSeq, ...base } = parent
    const human: ScienceClientArtifactVersion = {
      ...base,
      version: 2,
      parent: { artifactId: parent.artifactId, version: 1 },
      origin: 'human-edit',
      attachment: {
        attachmentId: 'sha256:human' as never,
        mediaType: 'application/vnd.vega-lite+json',
        bytes: 48,
      },
      createdAt: 600,
    }
    const science = baseProjection({ artifacts: [parent, human] })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: human.artifactId, version: 2 })
    store.actions.setView('provenance')
    render(<ScienceDetailsView {...props(science, { store })} />)

    expect(screen.getByText('Human style edit based on v1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Loss curve' }))
    expect(store.instance.getSnapshot().view).toBe('content')
  })

  it('reports the artifact as unavailable in the drill-in when the source run no longer resolves', () => {
    const science = baseProjection({ runs: [], artifacts: [chart()] })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 1 })
    store.actions.setView('provenance')
    render(<ScienceDetailsView {...props(science, { store })} />)
    expect(statusText()).toBe('This artifact version is no longer available.')
  })
})

describe('ScienceDetailsView: distinct accessible text per top-level state', () => {
  it('never repeats the same status text across missing-support/unbound/landing states', () => {
    const texts: string[] = []

    render(<ScienceDetailsView {...props(undefined)} />)
    texts.push(statusText())
    cleanup()

    render(<ScienceDetailsView {...props(null, { agentPreset: 'science' })} />)
    texts.push(statusText())
    cleanup()

    render(<ScienceDetailsView {...props(baseProjection())} />)
    for (const status of screen.getAllByRole('status')) texts.push(status.textContent ?? '')
    cleanup()

    expect(new Set(texts).size).toBe(texts.length)
    expect(texts).toHaveLength(4)
  })
})
