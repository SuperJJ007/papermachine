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
import { useRef } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { TextMediaType } from '@deepseek-ai/dsh-attachment'
import { createSnapshotStore, type ConversationSnapshot, type SessionId, type SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ScienceClientArtifactVersion, ScienceClientHumanEditArtifactVersion, ScienceClientProjection,
  ScienceClientRun, ScienceClientRunArtifactVersion,
} from '@deepseek-ai/dsh-science-session/types'
import {
  ScienceDetailsView,
  type ScienceDetailsViewProps,
} from '../src/client/ScienceDetailsView.tsx'
import { ScienceComposerSelections } from '../src/client/composer-selections.ts'
import { en, zh } from '../src/client/locales.ts'
import { testScienceSelectionStore } from './selection-store-test-helpers.client.ts'

type Props = ScienceDetailsViewProps

const SESSION = 'session-1' as SessionId
const t: Props['t'] = makeTranslate(en)

interface ArtifactContentFixture {
  readonly attachmentId: string
  readonly mediaType: ScienceClientArtifactVersion['mediaType']
  readonly bytes: number
  readonly width?: number
  readonly height?: number
}

type RunChartOverrides = Omit<Partial<ScienceClientRunArtifactVersion>, 'mediaType' | 'byteCount'> & {
  readonly attachment?: ArtifactContentFixture
}
type HumanChartOverrides = Omit<Partial<ScienceClientHumanEditArtifactVersion>, 'mediaType' | 'byteCount'> & {
  readonly attachment?: ArtifactContentFixture
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
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

function chart(over: RunChartOverrides = {}): ScienceClientRunArtifactVersion {
  const { attachment, ...fields } = over
  const content = attachment ?? { attachmentId: 'sha256:abc', mediaType: 'image/png', bytes: 100 }
  // `turn` defaults to the version number: distinct versions land in distinct
  // default turns, so fixtures built without any C2 intent never collide on
  // the same turn by accident. A C2-specific fixture overrides `turn`
  // explicitly to put two versions in the same one.
  const version = fields.version ?? 1
  return {
    artifactId: 'chart-1' as never,
    producerSessionId: SESSION,
    logicalName: 'loss-curve.png',
    version,
    title: 'Loss curve',
    origin: 'model',
    versionId: `version:${content.attachmentId}` as never,
    sha256: content.attachmentId,
    mediaType: content.mediaType,
    byteCount: content.bytes,
    runId: 'run-1' as never,
    toolCallId: 'call-chart-1' as never,
    requestHeaderSeq: 4,
    turn: version,
    environmentRevision: 1,
    environmentFingerprintPreview: 'f'.repeat(12),
    createdAt: 500,
    ...fields,
  }
}

function humanEditChart(over: HumanChartOverrides = {}): ScienceClientHumanEditArtifactVersion {
  const { attachment, ...fields } = over
  const content = attachment ?? {
    attachmentId: 'sha256:human', mediaType: 'image/png' as const, bytes: 40,
  }
  return {
    artifactId: 'chart-1' as never,
    producerSessionId: SESSION,
    logicalName: 'summary.png',
    version: 2,
    title: 'summary.png',
    origin: 'human-edit',
    parent: { artifactId: 'chart-1' as never, version: 1 },
    versionId: `version:${content.attachmentId}` as never,
    sha256: content.attachmentId,
    mediaType: 'image/png',
    byteCount: content.bytes,
    environmentRevision: 1,
    environmentFingerprintPreview: 'f'.repeat(12),
    createdAt: 700,
    ...fields,
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
    loadLibrary?: Props['loadLibrary']
    loadWorkspaceFiles?: Props['loadWorkspaceFiles']
    loadWorkspaceFile?: Props['loadWorkspaceFile']
    addToConversation?: Props['addToConversation']
    removeFromConversation?: Props['removeFromConversation']
    composerSelections?: Props['composerSelections']
    store?: ReturnType<typeof testScienceSelectionStore>
    inspectCall?: (callId: string) => void
    selectDetailed?: () => void
    snapshot?: ConversationSnapshot
    notes?: readonly import('@deepseek-ai/dsh-science-session/types').ScienceArtifactNote[]
    returnToConversation?: Props['returnToConversation']
    addArtifactNote?: Props['addArtifactNote']
    removeArtifactNote?: Props['removeArtifactNote']
    applyChartOps?: Props['applyChartOps']
    previewChartOps?: Props['previewChartOps']
    displayTitle?: string
    includeUnknownSession?: boolean
  } = {},
): Props {
  const state = {
    ids: over.includeUnknownSession ? [SESSION, 'unknown-session' as SessionId] : [SESSION],
    byId: {
      [SESSION]: {
        id: SESSION, displayTitle: over.displayTitle ?? SESSION, running: false, blank: false, updatedAt: 0,
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
  const latestByArtifact = new Map<string, ScienceClientArtifactVersion>()
  for (const item of science?.artifacts ?? []) {
    const current = latestByArtifact.get(item.artifactId)
    if (current === undefined || current.version < item.version) latestByArtifact.set(item.artifactId, item)
  }
  const libraryArtifacts = [...latestByArtifact.values()].map(item => ({
    artifactId: item.artifactId, logicalName: item.logicalName, title: item.title,
    ...(item.caption === undefined ? {} : { caption: item.caption }), originSessionId: item.producerSessionId, originSessionTitle: 'Current analysis',
    latest: {
      versionId: item.versionId, ordinal: item.version, mediaType: item.mediaType,
      byteCount: item.byteCount, createdAt: item.createdAt,
    },
  }))
  return {
    sessionId: SESSION,
    useSessions,
    // Mirrors the production `useSyncExternalStoreWithSelector` selector-hook
    // contract closely enough to exercise a caller's `eq`: keep the previous
    // selected value across renders unless `eq` (when supplied) reports it changed.
    useSession: (select: (s: ConversationSnapshot) => unknown, eq?: (a: unknown, b: unknown) => boolean) => {
      const ref = useRef<{ value: unknown } | undefined>(undefined)
      const next = select(snapshot)
      if (ref.current === undefined || eq === undefined || !eq(ref.current.value, next)) ref.current = { value: next }
      return ref.current.value
    },
    useProjection: vi.fn((key: string) => key === 'science' ? science : over.notes),
    useStore: store.useStore,
    actions: store.actions,
    inspectCall: over.inspectCall ?? vi.fn(),
    selectDetailed: over.selectDetailed ?? vi.fn(),
    loadImage: over.loadImage ?? vi.fn().mockResolvedValue('data:image/png;base64,abc'),
    loadText: over.loadText ?? vi.fn().mockResolvedValue('a,b\n1,2\n'),
    loadLibrary: over.loadLibrary ?? vi.fn().mockResolvedValue({ ok: true, value: { projectId: 'project-1', artifacts: libraryArtifacts } }),
    loadWorkspaceFiles: over.loadWorkspaceFiles ?? vi.fn().mockResolvedValue({ ok: true, value: { root: '', entries: [] } }),
    loadWorkspaceFile: over.loadWorkspaceFile ?? vi.fn().mockResolvedValue({ ok: false, error: { code: 'internal', message: 'missing', details: {} } }),
    addToConversation: over.addToConversation ?? vi.fn(),
    removeFromConversation: over.removeFromConversation ?? vi.fn(),
    composerSelections: over.composerSelections ?? createSnapshotStore([]),
    returnToConversation: over.returnToConversation ?? vi.fn(),
    addArtifactNote: over.addArtifactNote ?? vi.fn().mockResolvedValue({ ok: true, value: { accepted: true } }),
    removeArtifactNote: over.removeArtifactNote ?? vi.fn().mockResolvedValue({ ok: true, value: { accepted: true } }),
    applyChartOps: over.applyChartOps ?? vi.fn().mockResolvedValue({
      ok: true, value: { artifactId: 'chart-1', version: 2, origin: 'human-edit', failedOps: [] },
    }),
    previewChartOps: over.previewChartOps ?? vi.fn().mockResolvedValue({
      ok: true, value: { pngBase64: 'cHJldmlldw==', chart: addressablePreviewChart(), failedOps: [] },
    }),
    t,
  } as unknown as Props
}

function addressablePreviewChart() {
  return {
    runtime: 'matplotlib' as const,
    figureKey: 'fig',
    png: { width: 200, height: 100, dpi: 150 },
    hitmapStatus: 'unavailable' as const,
    hitmap: [],
    elements: [{ id: 'title', kind: 'title' as const, axes: null, label: null, current: 'Loss' }],
    ops: [],
  }
}

/** The whole-panel status text, valid only for a single-paragraph state. */
function statusText(): string {
  return screen.getByRole('status').textContent ?? ''
}

describe('ScienceDetailsView: session snapshot selection', () => {
  it('rebuilds the derived session snapshot only when nodes or chat actually change', () => {
    const nodes: ConversationSnapshot['nodes'] = []
    const chat = { nodes: { get: () => undefined, values: () => [] } } as unknown as ConversationSnapshot['chat']
    const snapshotA = { nodes, chat } as unknown as ConversationSnapshot
    const view = render(<ScienceDetailsView {...props(baseProjection(), { snapshot: snapshotA })} />)

    // Same `nodes`/`chat` references from a re-render: the equality check
    // must report no change (the flicker fix's "unrelated event" case).
    view.rerender(<ScienceDetailsView {...props(baseProjection(), { snapshot: { ...snapshotA } })} />)

    // A new `chat` reference with the same `nodes`: the equality check must report a change.
    const snapshotB = { nodes, chat: { ...chat } } as unknown as ConversationSnapshot
    view.rerender(<ScienceDetailsView {...props(baseProjection(), { snapshot: snapshotB })} />)

    // A new `nodes` reference: the equality check must report a change.
    const snapshotC = { nodes: [...nodes], chat } as unknown as ConversationSnapshot
    view.rerender(<ScienceDetailsView {...props(baseProjection(), { snapshot: snapshotC })} />)
  })
})

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
  it('reports no artifacts for an empty history', () => {
    render(<ScienceDetailsView {...props(baseProjection())} />)
    const statuses = screen.getAllByRole('status')
    expect(statuses.map(el => el.textContent)).toEqual(['No artifacts yet.'])
  })

  it('renders one gallery entry per logical chart at its latest accepted version', async () => {
    const science = baseProjection({
      artifacts: [
        chart({ version: 1 }), chart({ version: 2 }), chart({ version: 1 }),
        chart({ artifactId: 'chart-2' as never, title: 'Other', version: 1 }),
      ],
    })
    render(<ScienceDetailsView {...props(science)} />)
    expect(await screen.findByText('v2 · image/png')).toBeTruthy()
    expect(screen.getByText('Loss curve')).toBeTruthy()
    expect(screen.getByText('Other')).toBeTruthy()
  })

  it('keeps byte counts out of artifact cards', () => {
    const science = baseProjection({ artifacts: [
      chart({ artifactId: 'chart-kb' as never, title: 'Kilobytes', attachment: { attachmentId: 'sha256:kb', mediaType: 'image/png', bytes: 2_048, width: 10, height: 10 } }),
      chart({ artifactId: 'chart-mb' as never, title: 'Megabytes', attachment: { attachmentId: 'sha256:mb', mediaType: 'image/png', bytes: 2_097_152, width: 10, height: 10 } }),
    ] })
    render(<ScienceDetailsView {...props(science)} />)
    expect(screen.queryByText(/2.0 KB/)).toBeNull()
    expect(screen.queryByText(/2.0 MB/)).toBeNull()
  })

  it('labels a generated artifact with its turn, version, and parent version', async () => {
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
    expect(await screen.findByText('v5 · image/png')).toBeTruthy()
  })

  it('labels first-generation and human-edited artifacts without internal generation facts', async () => {
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
    expect(await screen.findByText('v1 · image/png')).toBeTruthy()
    expect(screen.getByText('v2 · image/png')).toBeTruthy()
  })

  it('loads a gallery thumbnail through the injected session-scoped loader', async () => {
    const loadImage = vi.fn().mockResolvedValue('data:image/png;base64,abc')
    const science = baseProjection({ artifacts: [chart()] })
    const view = render(<ScienceDetailsView {...props(science, { loadImage })} />)
    await waitFor(() => { expect(loadImage).toHaveBeenCalledTimes(1) })
    expect(loadImage.mock.calls[0]?.[0]).toMatchObject({ versionId: 'version:sha256:abc' })
    await waitFor(() => { expect(view.container.querySelector('img')).not.toBeNull() })
  })

  it('reports unavailable attachments distinctly when the loader rejects', async () => {
    const loadImage = vi.fn().mockRejectedValue(new Error('network'))
    const science = baseProjection({ artifacts: [chart()] })
    render(<ScienceDetailsView {...props(science, { loadImage })} />)
    expect(await screen.findByRole('button', { name: 'Failed to load, click to retry' })).toBeTruthy()
  })

  it('renders a file-type tile (never an <img>) for a non-image artifact\'s gallery entry', async () => {
    const science = baseProjection({
      artifacts: [chart({ logicalName: 'summary.csv', attachment: { attachmentId: 'sha256:csv', mediaType: 'text/csv', bytes: 40 } })],
    })
    render(<ScienceDetailsView {...props(science)} />)
    expect(await screen.findByText('CSV')).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('activates a gallery entry on Enter/Space and ignores every other key', async () => {
    const science = baseProjection({ artifacts: [chart({ version: 1 })] })
    render(<ScienceDetailsView {...props(science)} />)
    const gallery = await screen.findByRole('button', { name: 'Open Loss curve, version 1' })
    expect(screen.queryByRole('tablist', { name: 'Open artifacts' })).toBeNull()
    fireEvent.keyDown(gallery, { key: 'a' })
    expect(screen.queryByRole('tab', { name: 'File library' })).toBeNull()
    fireEvent.keyDown(gallery, { key: 'Enter' })
    expect(screen.queryByRole('tablist', { name: 'Open artifacts' })).toBeNull()
  })

  it('filters and opens a latest artifact produced by another project session', async () => {
    const loadLibrary = vi.fn().mockResolvedValue({ ok: true, value: {
      projectId: 'project-1',
      artifacts: [{
        artifactId: 'cross-chart', logicalName: 'cross.png', title: 'Cross-session chart', caption: 'Cross caption',
        originSessionId: 'session-a', originSessionTitle: 'Source experiment',
        latest: {
          versionId: 'cross-version', ordinal: 3, mediaType: 'image/png', byteCount: 1, createdAt: 10,
        },
      }],
    } })
    render(<ScienceDetailsView {...props(baseProjection(), { loadLibrary })} />)
    const search = screen.getByRole('textbox', { name: 'Search' })
    fireEvent.change(search, { target: { value: 'Cross-session' } })
    expect(await screen.findByText('v3 · image/png')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open Cross-session chart, version 3' }))
    expect(screen.queryByText('Cross-session chart')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Provenance' }))
    expect(screen.getByText('Source experiment')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Back to original conversation' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Cross-session chart' }))
    fireEvent.click(screen.getByRole('button', { name: 'File library' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Open Cross-session chart, version 3' }))
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close tab' }))
    expect(screen.queryByRole('tab', { name: 'Cross-session chart' })).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Search' })).toBeTruthy()
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
    fireEvent.click(screen.getByRole('button', { name: '‹ File library' }))
    expect(screen.queryByRole('tab', { name: 'File library' })).toBeNull()
  })

  it('exercises project-library sorting, layout, keyboard activation, and directory breadcrumbs', async () => {
    const loadLibrary = vi.fn().mockResolvedValue({ ok: true, value: {
      projectId: 'project-1',
      artifacts: [
        { artifactId: 'z', logicalName: 'z.png', originSessionId: 'unknown-session', latest: { versionId: 'z1', ordinal: 1, mediaType: 'image/png', byteCount: 1, createdAt: 30 } },
        { artifactId: 'y', logicalName: 'y.txt', originSessionId: 'unknown-session', latest: { versionId: 'y1', ordinal: 1, mediaType: 'text/plain', byteCount: 1, createdAt: 25 } },
        { artifactId: 'a', logicalName: 'a.md', title: 'Alpha', originSessionId: SESSION, latest: { versionId: 'a1', ordinal: 1, mediaType: 'text/markdown', byteCount: 2, createdAt: 10 } },
        { artifactId: 'b', logicalName: 'b.json', title: 'Beta', originSessionId: 'source', originSessionTitle: 'Source', latest: { versionId: 'b1', ordinal: 1, mediaType: 'application/json', byteCount: 3, createdAt: 20 } },
      ],
    } })
    const loadWorkspaceFiles = vi.fn().mockImplementation((path: string) => Promise.resolve({ ok: true, value: path === ''
      ? { root: '', entries: [{ name: 'data', kind: 'dir', modifiedAt: 1 }, { name: 'root.bin', kind: 'file', byteCount: 2_048, modifiedAt: 1 }, { name: 'unknown.bin', kind: 'file', modifiedAt: 1 }] }
      : path === 'data'
        ? { root: path, entries: [{ name: 'sub', kind: 'dir', modifiedAt: 1 }, { name: 'large.bin', kind: 'file', byteCount: 2_097_152, modifiedAt: 1 }] }
        : { root: path, entries: [{ name: 'leaf.bin', kind: 'file', byteCount: 1, modifiedAt: 1 }] } }))
    const store = testScienceSelectionStore()
    const view = render(<ScienceDetailsView {...props(baseProjection(), { loadLibrary, loadWorkspaceFiles, store })} />)
    expect(await screen.findByText('v1 · image/png')).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox', { name: 'Artifact sort' }), { target: { value: 'oldest' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Artifact sort' }), { target: { value: 'name' } })
    fireEvent.click(screen.getByRole('button', { name: 'Switch grid or list view' }))
    fireEvent.click(screen.getByRole('button', { name: 'Switch grid or list view' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: 'z.png' } })
    const z = screen.getByRole('button', { name: 'Open z.png, version 1' })
    fireEvent.keyDown(z, { key: 'x' })
    fireEvent.keyDown(z, { key: ' ' })
    expect(screen.queryByText('z.png')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Provenance' }))
    expect(screen.getByText('unknown-session')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'z.png' }))
    fireEvent.click(screen.getByRole('button', { name: 'File library' }))
    act(() => { store.actions.setLibraryPage('files') })
    fireEvent.click(await screen.findByRole('button', { name: /data/ }))
    expect((await screen.findByRole('button', { name: /large\.bin/ })).textContent).toContain('2.0 MB')
    fireEvent.click(screen.getByRole('button', { name: /sub/ }))
    // Two crumbs now ('data', 'sub'): the non-last 'data' segment renders
    // the plain (non-current) breadcrumb style and still navigates on click.
    await screen.findByRole('button', { name: /leaf\.bin/ })
    fireEvent.click(screen.getByRole('button', { name: 'data' }))
    fireEvent.click(screen.getByRole('button', { name: 'Project' }))
    expect((await screen.findByRole('button', { name: /root\.bin/ })).textContent).toContain('2.0 KB')
    expect((await screen.findByRole('button', { name: /unknown\.bin/ })).textContent).toContain('0 B')
    act(() => { store.actions.setLibraryPage('artifacts') })
    expect(await screen.findByRole('combobox', { name: 'Artifact sort' })).toBeTruthy()
    view.unmount()
  })

  it('keeps the artifact library search across a switch to the file library and back', async () => {
    const loadLibrary = vi.fn().mockResolvedValue({ ok: true, value: {
      projectId: 'project-1',
      artifacts: [
        { artifactId: 'z', logicalName: 'z.png', originSessionId: 'unknown-session', latest: { versionId: 'z1', ordinal: 1, mediaType: 'image/png', byteCount: 1, createdAt: 30 } },
        { artifactId: 'a', logicalName: 'a.md', title: 'Alpha', originSessionId: SESSION, latest: { versionId: 'a1', ordinal: 1, mediaType: 'text/markdown', byteCount: 2, createdAt: 10 } },
      ],
    } })
    const loadWorkspaceFiles = vi.fn().mockResolvedValue({ ok: true, value: { root: '', entries: [] } })
    const store = testScienceSelectionStore()
    render(<ScienceDetailsView {...props(baseProjection(), { loadLibrary, loadWorkspaceFiles, store })} />)
    expect(await screen.findByText('v1 · image/png')).toBeTruthy()

    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: 'z.png' } })
    expect(screen.queryByText('v1 · image/png')).toBeTruthy()
    expect(screen.queryByText('Alpha')).toBeNull()

    // Switching library pages is a prop change, not a remount: the ProjectLibrary
    // key names only the artifact list, so search/sort/path state survives it.
    act(() => { store.actions.setLibraryPage('files') })
    await screen.findByRole('navigation', { name: 'Project file path' })
    act(() => { store.actions.setLibraryPage('artifacts') })

    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Search' }).value).toBe('z.png')
    expect(screen.queryByText('v1 · image/png')).toBeTruthy()
    expect(screen.queryByText('Alpha')).toBeNull()
  })

  it('reports library and workspace failures plus unsupported and PNG file previews', async () => {
    const failedStore = testScienceSelectionStore()
    const failed = render(<ScienceDetailsView {...props(baseProjection(), {
      loadLibrary: vi.fn().mockResolvedValue({ ok: false, error: { message: 'library offline' } }),
      loadWorkspaceFiles: vi.fn().mockResolvedValue({ ok: false, error: { message: 'workspace offline' } }),
      store: failedStore,
    })} />)
    expect((await screen.findByRole('alert')).textContent).toContain('library offline')
    act(() => { failedStore.actions.setLibraryPage('files') })
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('workspace offline') })
    failed.unmount()

    const entries = vi.fn().mockResolvedValue({ ok: true, value: { root: '', entries: [
      { name: 'raw.bin', kind: 'file', byteCount: 1_048_576, modifiedAt: 1, mediaType: 'application/octet-stream' },
      { name: 'pixel.png', kind: 'file', byteCount: 1, modifiedAt: 1, mediaType: 'image/png' },
      { name: 'broken.txt', kind: 'file', byteCount: 1, modifiedAt: 1, mediaType: 'text/plain' },
    ] } })
    const file = vi.fn().mockImplementation((path: string) => Promise.resolve(path === 'broken.txt'
      ? { ok: false, error: { message: 'file unavailable' } }
      : { ok: true, value: path === 'pixel.png'
        ? { mediaType: 'image/png', byteCount: 1, data: Uint8Array.of(255) }
        : { mediaType: 'application/octet-stream', byteCount: 1_048_576, data: Uint8Array.of() } }))
    const unsupportedStore = testScienceSelectionStore()
    unsupportedStore.actions.setLibraryPage('files')
    const unsupported = render(<ScienceDetailsView {...props(baseProjection(), {
      loadWorkspaceFiles: entries,
      loadWorkspaceFile: file,
      store: unsupportedStore,
    })} />)
    fireEvent.click(await screen.findByRole('button', { name: /raw\.bin/ }))
    expect(await screen.findByText('Preview unavailable, 1.0 MB')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /File library/ }))
    fireEvent.click(await screen.findByRole('button', { name: /pixel\.png/ }))
    expect(await screen.findByRole('img', { name: 'pixel.png' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /File library/ }))
    fireEvent.click(await screen.findByRole('button', { name: /broken\.txt/ }))
    expect((await screen.findByRole('alert')).textContent).toContain('file unavailable')
    unsupported.unmount()
  })

  it('ignores workspace listing and file reads that settle after the library unmounts', async () => {
    let settleListing!: (value: unknown) => void
    const listing = new Promise((resolve) => { settleListing = resolve })
    const firstStore = testScienceSelectionStore()
    firstStore.actions.setLibraryPage('files')
    const first = render(<ScienceDetailsView {...props(baseProjection(), {
      loadWorkspaceFiles: vi.fn().mockReturnValue(listing),
      store: firstStore,
    })} />)
    first.unmount()
    await act(async () => { settleListing({ ok: true, value: { root: '', entries: [] } }); await listing })

    let settleFile!: (value: unknown) => void
    const pendingFile = new Promise((resolve) => { settleFile = resolve })
    const secondStore = testScienceSelectionStore()
    secondStore.actions.setLibraryPage('files')
    const second = render(<ScienceDetailsView {...props(baseProjection(), {
      loadWorkspaceFiles: vi.fn().mockResolvedValue({ ok: true, value: { root: '', entries: [{ name: 'late.txt', kind: 'file', byteCount: 1, modifiedAt: 1, mediaType: 'text/plain' }] } }),
      loadWorkspaceFile: vi.fn().mockReturnValue(pendingFile),
      store: secondStore,
    })} />)
    fireEvent.click(await screen.findByRole('button', { name: /late\.txt/ }))
    second.unmount()
    await act(async () => { settleFile({ ok: true, value: { mediaType: 'text/plain', byteCount: 1, data: Uint8Array.of(65) } }); await pendingFile })
  })

})

describe('ScienceDetailsView: opening a tab', () => {
  it('switches the active artifact body without advancing the selected version', () => {
    const store = testScienceSelectionStore()
    const science = baseProjection({ artifacts: [chart(), chart({ artifactId: 'chart-2' as never, title: 'Second chart' })] })
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 1 })
    render(<ScienceDetailsView {...props(science, { store })} />)
    act(() => { store.actions.openTab({ artifactId: 'chart-2' as never, version: 1 }) })
    expect(screen.queryByText('Second chart')).toBeNull()
    expect(store.instance.getSnapshot().activeTabId).toBe('artifact:chart-2')
  })

  it('reports a missing open version and closes the last valid tab back to the library', async () => {
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'missing' as never, version: 1 })
    render(<ScienceDetailsView {...props(baseProjection({ artifacts: [chart()] }), { store })} />)
    expect(statusText()).toBe('This artifact version is no longer available.')
    act(() => { store.actions.closeTab('missing'); store.actions.openTab({ artifactId: 'chart-1' as never, version: 1 }) })
    fireEvent.click(screen.getByRole('button', { name: 'Close tab' }))
    expect(await screen.findByRole('button', { name: 'Open Loss curve, version 1' })).toBeTruthy()
  })

  it('clicking a gallery entry opens its toolbar and returning to the library restores the gallery', async () => {
    const science = baseProjection({ artifacts: [chart({ version: 1, title: 'v1 title' }), chart({ version: 2, title: 'v2 title' })] })
    render(<ScienceDetailsView {...props(science)} />)
    fireEvent.click(await screen.findByText('v2 title'))

    expect(screen.queryByText('v2 title')).toBeNull()
    expect(screen.getByRole('button', { name: 'File library' })).toBeTruthy()
    expect(screen.queryByText('Format')).toBeNull()
    expect(screen.queryByText('No artifacts yet.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'File library' }))
    expect(screen.queryByRole('tab', { name: 'File library' })).toBeNull()
    expect(await screen.findByText('v2 title')).toBeTruthy()
  })

  it('omits the redundant source and status metadata rail', async () => {
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
    fireEvent.click(await screen.findByText('Loss curve'))
    expect(screen.queryByText('Generated in turn 3')).toBeNull()
    expect(screen.queryByText('Read-only')).toBeNull()
  })

  it('shows versioned private notes in Review position and submits trimmed text', async () => {
    const science = baseProjection({ artifacts: [chart({ version: 2 })] })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 2 })
    const addArtifactNote = vi.fn().mockResolvedValue({ ok: true, value: { accepted: true } })
    const removeArtifactNote = vi.fn().mockResolvedValue({ ok: true, value: { accepted: true } })
    render(<ScienceDetailsView {...props(science, {
      store, addArtifactNote, removeArtifactNote,
      notes: [{ seq: 19, artifactId: 'chart-1' as never, version: 1, text: 'Keep this label', createdAt: 1_000 }],
    })} />)
    expect(screen.getByRole('region', { name: 'Notes' })).toBeTruthy()
    expect(screen.getByText('Keep this label')).toBeTruthy()
    expect(screen.getByText('These notes belong only to you and never enter model context.')).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: 'Artifact note' }), { target: { value: '  New note  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => { expect(addArtifactNote).toHaveBeenCalledWith({ artifactId: 'chart-1', version: 2, text: 'New note' }) })
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }))
    await waitFor(() => { expect(removeArtifactNote).toHaveBeenCalledWith({ artifactId: 'chart-1', noteSeq: 19 }) })
  })

  it('shows the note input without empty-state copy when no notes exist', () => {
    const science = baseProjection({ artifacts: [chart()] })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 1 })
    render(<ScienceDetailsView {...props(science, { store, notes: [] })} />)
    expect(screen.getByRole('textbox', { name: 'Artifact note' })).toBeTruthy()
    expect(screen.queryByText('No notes yet.')).toBeNull()
  })

  it('surfaces the Host rejection for an over-limit note without truncating the draft', async () => {
    const science = baseProjection({ artifacts: [chart()] })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 1 })
    const addArtifactNote = vi.fn().mockResolvedValue({ ok: false, error: { message: 'note text must be at most 8192 characters' } })
    render(<ScienceDetailsView {...props(science, { store, addArtifactNote })} />)
    const longNote = 'x'.repeat(8_193)
    fireEvent.change(screen.getByRole('textbox', { name: 'Artifact note' }), { target: { value: longNote } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'note text must be at most 8192 characters')
    expect(screen.getByLabelText<HTMLTextAreaElement>('Artifact note').value).toBe(longNote)
  })

  it('ignores an empty review submission and surfaces a delete rejection', async () => {
    const science = baseProjection({ artifacts: [chart()] })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 1 })
    const removeArtifactNote = vi.fn().mockResolvedValue({ ok: false, error: { message: 'delete rejected' } })
    const view = render(<ScienceDetailsView {...props(science, {
      store,
      removeArtifactNote,
      notes: [{ seq: 19, artifactId: 'chart-1' as never, version: 1, text: 'Keep this label', createdAt: 1_000 }],
    })} />)
    fireEvent.submit(view.container.querySelector('form')!)
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'delete rejected')
  })

  it('accepts a known session display title while resolving the active artifact', () => {
    const localScience = baseProjection({ artifacts: [chart()] })
    const localStore = testScienceSelectionStore()
    localStore.actions.openTab({ artifactId: 'chart-1' as never, version: 1 })
    localStore.actions.setView('provenance')
    localStore.actions.setProvenanceSubTab('messages')
    const view = render(<ScienceDetailsView {...props(localScience, {
      store: localStore, displayTitle: 'Named session', includeUnknownSession: true,
    })} />)
    expect(view.container.textContent).not.toContain('session-1')
  })

})

describe('ScienceDetailsView: toolbar version stepper', () => {
  function threeVersions() {
    const science = baseProjection({
      artifacts: [
        chart({ version: 1, title: 'v1 title', caption: 'First pass', attachment: { attachmentId: 'sha256:abc', mediaType: 'image/png', bytes: 512, width: 10, height: 10 } }),
        chart({ version: 2, title: 'v2 title', attachment: { attachmentId: 'sha256:abc', mediaType: 'image/png', bytes: 2048, width: 10, height: 10 } }),
        chart({ version: 3, title: 'v3 title', attachment: { attachmentId: 'sha256:abc', mediaType: 'image/png', bytes: 5 * 1024 * 1024, width: 10, height: 10 } }),
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
    expect(screen.queryByText('v3 title')).toBeNull()
    expect(screen.getByRole('button', { name: 'Previous version' }).nextElementSibling?.textContent).toBe('v3')
    expect(screen.queryByText(/5\.0 MB/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Next version' }).hasAttribute('disabled')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Previous version' }))
    fireEvent.click(screen.getByRole('button', { name: 'Previous version' }))
    expect(screen.queryByText('v3 title')).toBeNull()
    expect(screen.getByRole('button', { name: 'Previous version' }).nextElementSibling?.textContent).toBe('v1')
    expect(screen.getByText('First pass')).toBeTruthy()
    expect(screen.queryByText(/512 B/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Previous version' }).hasAttribute('disabled')).toBe(true)
  })

  it('a disabled stepper button never invokes the step callback', () => {
    const { science, store } = threeVersions()
    render(<ScienceDetailsView {...props(science, { store })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Next version' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next version' }))
    expect(screen.queryByText('v3 title')).toBeNull()
  })

  // C2: a same-turn intermediate draft (occ_emp_wage_scatter's shape — a
  // self-check re-render inside one turn) collapses out of the stepper's
  // default walk order behind an expand toggle.
  function sameTurnPair() {
    const science = baseProjection({
      artifacts: [
        chart({ version: 1, turn: 1, title: 'v1 title', attachment: { attachmentId: 'sha256:a', mediaType: 'image/png', bytes: 100, width: 10, height: 10 } }),
        chart({ version: 2, turn: 1, title: 'v2 title', attachment: { attachmentId: 'sha256:b', mediaType: 'image/png', bytes: 100, width: 10, height: 10 } }),
      ],
    })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 2 })
    return { science, store }
  }

  it('collapses a same-turn superseded version behind an expand toggle, reachable once expanded', () => {
    const { science, store } = sameTurnPair()
    render(<ScienceDetailsView {...props(science, { store })} />)

    const toggle = screen.getByRole('button', { name: 'Intermediate drafts ×1' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    // v1 is collapsed and this tab is open at v2, so ‹ has nothing to step to.
    expect(screen.getByRole('button', { name: 'Previous version' }).hasAttribute('disabled')).toBe(true)

    fireEvent.click(toggle)
    const collapseToggle = screen.getByRole('button', { name: 'Collapse intermediate drafts' })
    expect(collapseToggle.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Previous version' }).hasAttribute('disabled')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Previous version' }))
    expect(screen.getByRole('button', { name: 'Previous version' }).nextElementSibling?.textContent).toBe('v1')

    fireEvent.click(screen.getByRole('button', { name: 'Collapse intermediate drafts' }))
    expect(screen.getByRole('button', { name: 'Intermediate drafts ×1' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('shows no intermediate toggle when a human-edit save splits two different-turn versions', () => {
    // mpl_grouped's shape — v1 auto(turn 1), v2 human-edit, v3 auto(turn 2) —
    // never collapses anything (a human-edit version has no turn to match).
    const science = baseProjection({
      artifacts: [
        chart({ version: 1, turn: 1, title: 'v1 title', attachment: { attachmentId: 'sha256:a', mediaType: 'image/png', bytes: 100, width: 10, height: 10 } }),
        humanEditChart({ version: 2, title: 'v2 title', attachment: { attachmentId: 'sha256:b', mediaType: 'image/png', bytes: 100, width: 10, height: 10 } }),
        chart({ version: 3, turn: 2, title: 'v3 title', attachment: { attachmentId: 'sha256:c', mediaType: 'image/png', bytes: 100, width: 10, height: 10 } }),
      ],
    })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 2 })
    render(<ScienceDetailsView {...props(science, { store })} />)

    expect(screen.queryByRole('button', { name: /Intermediate drafts/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Previous version' }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('button', { name: 'Next version' }).hasAttribute('disabled')).toBe(false)
  })
})

describe('ScienceDetailsView: viewer title', () => {
  it('omits the human title and logical filename from the viewer', () => {
    const science = baseProjection({
      artifacts: [chart({ title: 'Loss curve', logicalName: 'loss-curve.png' })],
    })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 1 })
    render(<ScienceDetailsView {...props(science, { store })} />)
    expect(screen.queryByText('Loss curve')).toBeNull()
    expect(screen.queryByText('loss-curve.png')).toBeNull()
  })

  it('omits the title when an auto-captured artifact\'s title equals its logical name', () => {
    const science = baseProjection({
      artifacts: [chart({ title: 'plot.png', logicalName: 'plot.png', origin: 'auto' })],
    })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 1 })
    render(<ScienceDetailsView {...props(science, { store })} />)
    expect(screen.queryByText('plot.png')).toBeNull()
  })
})

describe('ScienceDetailsView: content dispatch', () => {
  it('renders a PNG from project-store content', async () => {
    const mediaType = 'image/png' as const
    const science = baseProjection({
      artifacts: [chart({ attachment: { attachmentId: 'sha256:abc', mediaType, bytes: 100, width: 10, height: 10 } })],
    })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 1 })
    const loadImage = vi.fn().mockResolvedValue(`data:${mediaType};base64,abc`)
    render(<ScienceDetailsView {...props(science, { store, loadImage })} />)
    await waitFor(() => { expect(document.querySelector('img')).not.toBeNull() })
  })

  it('does not reset or reload a PNG when re-rendered with a new, structurally-equal artifact object for the same version', async () => {
    const mediaType = 'image/png' as const
    const original = chart({ attachment: { attachmentId: 'sha256:abc', mediaType, bytes: 100 } })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 1 })
    const loadImage = vi.fn().mockResolvedValue(`data:${mediaType};base64,abc`)
    const view = render(<ScienceDetailsView {...props(baseProjection({ artifacts: [original] }), { store, loadImage })} />)
    await waitFor(() => { expect(document.querySelector('img')).not.toBeNull() })
    expect(loadImage).toHaveBeenCalledTimes(1)

    // Every projection emission rebuilds fresh artifact objects (session's
    // `clientArtifact`); a structurally-equal rebuild of the same version
    // must not reset the loaded image or refetch it.
    const rebuilt = { ...original }
    view.rerender(<ScienceDetailsView {...props(baseProjection({ artifacts: [rebuilt] }), { store, loadImage })} />)
    expect(screen.queryByText('Loading…')).toBeNull()
    expect(document.querySelector('img')).not.toBeNull()
    expect(loadImage).toHaveBeenCalledTimes(1)
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
      artifacts: [chart({ logicalName: 'data.txt', attachment: { attachmentId: 'sha256:txt', mediaType, bytes: 20 }, ...over })],
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
    expect(loadText.mock.calls[0]?.[0]).toMatchObject({ versionId: 'version:sha256:txt' })
    // No dimensions fact for a non-image artifact — only the byte size.
    expect(screen.queryByText(/×/)).toBeNull()
  })

  it('does not reset or reload text content when re-rendered with a new, structurally-equal artifact object for the same version', async () => {
    const loadText = vi.fn().mockResolvedValue('name,score\nada,10\nbob,2\n')
    const { science, store } = textArtifact('text/csv')
    const original = science.artifacts[0]!
    const view = render(<ScienceDetailsView {...props(science, { store, loadText })} />)
    await waitFor(() => { expect(screen.getByRole('table')).toBeTruthy() })
    expect(loadText).toHaveBeenCalledTimes(1)

    // Every projection emission rebuilds fresh artifact objects (session's
    // `clientArtifact`); a structurally-equal rebuild of the same version
    // must not reset the loaded text and refetch it.
    const rebuilt = { ...original }
    view.rerender(<ScienceDetailsView {...props({ ...science, artifacts: [rebuilt] }, { store, loadText })} />)
    expect(screen.queryByText('Loading…')).toBeNull()
    expect(screen.getByRole('table')).toBeTruthy()
    expect(loadText).toHaveBeenCalledTimes(1)
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
    fireEvent.click(screen.getByRole('button', { name: 'Add region 10%,20% to the conversation' }))
    expect(addToConversation).toHaveBeenCalledOnce()
    const selection = addToConversation.mock.calls[0]![0][0]!
    expect(selection).toMatchObject({ artifactId: 'chart-1', version: 2,
      target: { kind: 'normalized-region', x: 0.1, y: 0.2, width: 0.5 } })
    expect(selection.target.kind === 'normalized-region' && selection.target.height).toBeCloseTo(0.5)
    expect(selection).not.toHaveProperty('comment')
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
      artifactId: 'chart-1', logicalName: 'loss-curve.png', version: 2,
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

describe('ScienceDetailsView: chart edit panel', () => {
  function addressableChart(over: RunChartOverrides = {}) {
    return chart({
      version: 2,
      chart: {
        runtime: 'matplotlib',
        figureKey: 'fig',
        png: { width: 200, height: 100, dpi: 150 },
        hitmapStatus: 'unavailable',
        hitmap: [],
        elements: [{ id: 'title', kind: 'title', axes: null, label: null, current: 'Loss' }],
        ops: [],
      },
      ...over,
    })
  }

  it('has no edit panel and keeps region-select for an artifact with no chart state', async () => {
    const science = baseProjection({ artifacts: [chart({ version: 2 })] })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 2 })
    render(<ScienceDetailsView {...props(science, { store })} />)
    await waitFor(() => { expect(document.querySelector('img')).not.toBeNull() })
    expect(screen.queryByRole('button', { name: 'Commit as new version' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Select region to edit' })).toBeTruthy()
  })

  it('mounts the panel as an element list, with region-select hidden, for a chart-bearing PNG', async () => {
    const science = baseProjection({ artifacts: [addressableChart()] })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 2 })
    render(<ScienceDetailsView {...props(science, { store })} />)
    await waitFor(() => { expect(document.querySelector('img')).not.toBeNull() })
    // The panel carries no image of its own: the single displayed PNG stays
    // the big RasterArtifact image, and manual region drag-select is hidden.
    expect(document.querySelectorAll('img')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Select region to edit' })).toBeNull()
    expect(screen.getByLabelText('Enter text')).toBeTruthy()
  })

  it('references an element via +/- into the composer selections, distinct from a region target', async () => {
    const science = baseProjection({ artifacts: [addressableChart()] })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 2 })
    const addToConversation = vi.fn<Props['addToConversation']>()
    render(<ScienceDetailsView {...props(science, { store, addToConversation })} />)
    await waitFor(() => { expect(document.querySelector('img')).not.toBeNull() })

    fireEvent.click(screen.getByRole('button', { name: 'Add Title to the conversation' }))
    expect(addToConversation).toHaveBeenCalledWith([{
      artifactId: 'chart-1', logicalName: 'loss-curve.png', version: 2,
      target: { kind: 'element', elementId: 'title', elementKind: 'title', axes: null, label: null, current: 'Loss' },
    }])
  })

  it('Save submits pending ops through applyChartOps for the exact artifact/version and steps the tab to the committed version', async () => {
    const science = baseProjection({ artifacts: [addressableChart()] })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 2 })
    const applyChartOps = vi.fn().mockResolvedValue({
      ok: true, value: { artifactId: 'chart-1', version: 3, origin: 'human-edit', failedOps: [] },
    })
    render(<ScienceDetailsView {...props(science, { store, applyChartOps })} />)
    await waitFor(() => { expect(document.querySelector('img')).not.toBeNull() })

    fireEvent.change(screen.getByLabelText('Enter text'), { target: { value: 'New title' } })
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))

    await waitFor(() => { expect(applyChartOps).toHaveBeenCalledOnce() })
    expect(applyChartOps).toHaveBeenCalledWith({
      artifactId: 'chart-1', version: 2, ops: [{ op: 'set_title', axes: null, text: 'New title' }],
    })
    await waitFor(() => {
      const openTab = store.instance.getSnapshot().openArtifacts.find(tab => tab.kind === 'artifact')
      expect(openTab).toMatchObject({ version: 3 })
    })
  })

  it('a rejected applyChartOps call leaves the tab on its current version and surfaces the rejection', async () => {
    const science = baseProjection({ artifacts: [addressableChart()] })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 2 })
    const applyChartOps = vi.fn().mockResolvedValue({ ok: false, error: { message: 'stale version' } })
    render(<ScienceDetailsView {...props(science, { store, applyChartOps })} />)
    await waitFor(() => { expect(document.querySelector('img')).not.toBeNull() })

    fireEvent.change(screen.getByLabelText('Enter text'), { target: { value: 'New title' } })
    fireEvent.click(screen.getByRole('button', { name: 'Commit as new version' }))

    expect(await screen.findByText('Commit failed: stale version')).toBeTruthy()
    const openTab = store.instance.getSnapshot().openArtifacts.find(tab => tab.kind === 'artifact')
    expect(openTab).toMatchObject({ version: 2 })
  })

  it('auto-steps the open tab to a newer committed version with no pending direct edit (B4)', async () => {
    const science = baseProjection({ artifacts: [chart({ version: 1 })] })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 1 })
    const view = render(<ScienceDetailsView {...props(science, { store })} />)
    await waitFor(() => { expect(document.querySelector('img')).not.toBeNull() })

    view.rerender(<ScienceDetailsView {...props(baseProjection({
      artifacts: [chart({ version: 1 }), chart({ version: 2, title: 'Loss curve v2' })],
    }), { store })} />)

    await waitFor(() => {
      const openTab = store.instance.getSnapshot().openArtifacts.find(tab => tab.kind === 'artifact')
      expect(openTab).toMatchObject({ version: 2 })
    })
  })

  it('does not auto-step a tab that has a pending, unsaved direct edit (B4)', async () => {
    const science = baseProjection({ artifacts: [addressableChart()] })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 2 })
    const view = render(<ScienceDetailsView {...props(science, { store })} />)
    await waitFor(() => { expect(document.querySelector('img')).not.toBeNull() })

    fireEvent.change(screen.getByLabelText('Enter text'), { target: { value: 'New title' } })

    view.rerender(<ScienceDetailsView {...props(baseProjection({
      artifacts: [addressableChart(), addressableChart({ version: 3, title: 'Newer render' })],
    }), { store })} />)
    await act(async () => {})

    const openTab = store.instance.getSnapshot().openArtifacts.find(tab => tab.kind === 'artifact')
    expect(openTab).toMatchObject({ version: 2 })
  })

  it('auto-steps once the pending direct edit is discarded (B4)', async () => {
    const science = baseProjection({ artifacts: [addressableChart()] })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 2 })
    const view = render(<ScienceDetailsView {...props(science, { store })} />)
    await waitFor(() => { expect(document.querySelector('img')).not.toBeNull() })

    fireEvent.change(screen.getByLabelText('Enter text'), { target: { value: 'New title' } })
    view.rerender(<ScienceDetailsView {...props(baseProjection({
      artifacts: [addressableChart(), addressableChart({ version: 3, title: 'Newer render' })],
    }), { store })} />)
    await act(async () => {})
    expect(store.instance.getSnapshot().openArtifacts.find(tab => tab.kind === 'artifact')).toMatchObject({ version: 2 })

    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    await waitFor(() => {
      const openTab = store.instance.getSnapshot().openArtifacts.find(tab => tab.kind === 'artifact')
      expect(openTab).toMatchObject({ version: 3 })
    })
  })

  it('debounces a title edit into a live preview through previewChartOps, overriding the displayed image', async () => {
    const science = baseProjection({ artifacts: [addressableChart()] })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 2 })
    const previewChartOps = vi.fn().mockResolvedValue({
      ok: true, value: { pngBase64: 'cHJldmlldw==', chart: addressablePreviewChart(), failedOps: [] },
    })
    render(<ScienceDetailsView {...props(science, { store, previewChartOps })} />)
    await waitFor(() => { expect(document.querySelector('img')).not.toBeNull() })

    fireEvent.change(screen.getByLabelText('Enter text'), { target: { value: 'Preview title' } })

    await waitFor(() => {
      expect(previewChartOps).toHaveBeenCalledWith({
        artifactId: 'chart-1', version: 2, ops: [{ op: 'set_title', axes: null, text: 'Preview title' }],
      })
    })
    await waitFor(() => {
      expect(document.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,cHJldmlldw==')
    })
  })

  it('surfaces a rejected debounced preview without discarding the pending edit', async () => {
    const science = baseProjection({ artifacts: [addressableChart()] })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 2 })
    const previewChartOps = vi.fn().mockResolvedValue({ ok: false, error: { message: 'kernel busy' } })
    render(<ScienceDetailsView {...props(science, { store, previewChartOps })} />)
    await waitFor(() => { expect(document.querySelector('img')).not.toBeNull() })

    fireEvent.change(screen.getByLabelText('Enter text'), { target: { value: 'Preview title' } })

    expect(await screen.findByText('Commit failed: kernel busy')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Commit as new version' }).hasAttribute('disabled')).toBe(false)
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

  it('uses the generic artifact title as the lightbox alt when the stored title is empty', async () => {
    const loadImage = vi.fn().mockResolvedValue('data:image/png;base64,abc')
    const science = baseProjection({ artifacts: [chart({ title: '' })] })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 1 })
    render(<ScienceDetailsView {...props(science, { store, loadImage })} />)

    fireEvent.click(screen.getByRole('button', { name: 'Expand' }))
    expect(await screen.findByRole('img', { name: 'Artifact' })).toBeTruthy()
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
      artifacts: [chart({ attachment: { attachmentId: 'sha256:txt', mediaType: 'text/plain', bytes: 5 } })],
    })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 1 })
    render(<ScienceDetailsView {...props(science, { store })} />)
    expect(screen.queryByRole('button', { name: 'Expand' })).toBeNull()
  })

  it('discards a lightbox load that resolves after the lightbox already closed', async () => {
    let resolveLoad: ((url: string) => void) | undefined
    const loadImage = vi.fn((content: { versionId: string }) => {
      if (loadImage.mock.calls.length === 1) return Promise.resolve('data:image/png;base64,thumb')
      void content
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
  function withOneTab(attachmentOver: Partial<ArtifactContentFixture> = {}) {
    const science = baseProjection({
      artifacts: [chart({ attachment: { attachmentId: 'sha256:abc', mediaType: 'image/png', bytes: 100, width: 10, height: 10, ...attachmentOver } })],
    })
    const store = testScienceSelectionStore()
    store.actions.openTab({ artifactId: 'chart-1' as never, version: 1 })
    return { science, store }
  }

  it('resolves durable bytes and triggers a browser save named for the logical artifact', async () => {
    const loadImage = vi.fn().mockResolvedValue('data:image/png;base64,xyz')
    const { science, store } = withOneTab()
    const created: HTMLAnchorElement[] = []
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      created.push(this)
    })
    render(<ScienceDetailsView {...props(science, { store, loadImage })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Download' }))
    await waitFor(() => { expect(clickSpy).toHaveBeenCalledTimes(1) })
    expect(created[0]?.href).toBe('data:image/png;base64,xyz')
    expect(created[0]?.download).toBe('loss-curve-v1.png')
    clickSpy.mockRestore()
  })

  it('keeps the logicalName-version filename stable across repeated downloads', async () => {
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
      artifacts: [chart({ logicalName: 'summary.csv', attachment: { attachmentId: 'sha256:csv', mediaType: 'text/csv', bytes: 40 } })],
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

  it('inserts the version with no extension when the logical name (and the attachment) carry none', async () => {
    const loadImage = vi.fn().mockResolvedValue('data:image/png;base64,xyz')
    const science = baseProjection({
      artifacts: [chart({ logicalName: 'no-extension', attachment: { attachmentId: 'sha256:abc', mediaType: 'image/png', bytes: 100, width: 10, height: 10 } })],
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

  it('the Messages sub-tab opens detailed trajectory through the Details seam', () => {
    const inspectCall = vi.fn()
    const selectDetailed = vi.fn()
    const { science, store } = withRunAndChart()
    const snapshot = {
      ...emptySnapshot(),
      nodes: [
        { kind: 'user', seq: 1, content: [{ type: 'text', text: 'Plot it' }] },
        { kind: 'assistant', seq: 2, turn: 1, step: 0, blocks: [{ kind: 'tool-call', callId: 'call-run-1', name: 'run_python' }] },
        { kind: 'assistant', seq: 3, turn: 1, step: 1, blocks: [{ kind: 'text', text: 'Done' }] },
      ],
    } as unknown as ConversationSnapshot
    render(<ScienceDetailsView {...props(science, { store, inspectCall, selectDetailed, snapshot })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Provenance' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Messages' }))
    fireEvent.click(screen.getByRole('button', { name: 'View trajectory' }))
    expect(selectDetailed).toHaveBeenCalledOnce()
    expect(inspectCall).toHaveBeenCalledWith('call-run-1')
  })

  it('shows direct-edit ancestry without a source run and lets the breadcrumb return to content', () => {
    const parent = chart({
      logicalName: 'chart.png',
      attachment: {
        attachmentId: 'sha256:parent',
        mediaType: 'image/png',
        bytes: 40,
      },
    })
    const { runId: _runId, toolCallId: _toolCallId, requestHeaderSeq: _requestHeaderSeq, ...base } = parent
    const human: ScienceClientArtifactVersion = {
      ...base,
      version: 2,
      parent: { artifactId: parent.artifactId, version: 1 },
      origin: 'human-edit',
      versionId: 'version:sha256:human' as never,
      sha256: 'sha256:human',
      mediaType: 'image/png',
      byteCount: 48,
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
    expect(texts).toHaveLength(3)
  })
})

describe('ScienceDetailsView: conversation groups', () => {
  const now = 2_000_000_000_000
  const artifact = (id: string, originSessionId: string, createdAt: number, title?: string, originSessionTitle?: string) => ({
    artifactId: id, logicalName: `${id}.png`, originSessionId,
    ...(title === undefined ? {} : { title }),
    ...(originSessionTitle === undefined ? {} : { originSessionTitle }),
    latest: { versionId: `${id}-v1`, ordinal: 1, mediaType: 'image/png' as const, byteCount: 100, createdAt },
  })
  function groupedProps(scopeKey?: string) {
    const store = testScienceSelectionStore(scopeKey)
    const loadLibrary = vi.fn().mockResolvedValue({ ok: true, value: { projectId: 'project-1', artifacts: [
      artifact('old', 'older', now - 7_200_000, 'Old plot', 'Earlier analysis'),
      artifact('alpha', SESSION, now - 3_600_000, 'Alpha', 'Current analysis'),
      artifact('zeta', SESSION, now - 180_000, 'Zeta', 'Current analysis'),
      artifact('recent', 'recent-session', now - 60_000, 'Recent plot', 'Recent analysis'),
      artifact('deleted', 'deleted-session', now - 86_400_000),
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
    expect(screen.getByRole('button', { name: 'Current analysis · This session 2 · 3min ago' })).toBeTruthy()
    expect(screen.getByText('5 artifacts')).toBeTruthy()
    expect(cards(titles[0]!)).toEqual(['Open Zeta, version 1', 'Open Alpha, version 1'])
    expect(screen.getAllByText('v1 · image/png')).toHaveLength(5)
    expect(screen.queryByText(/image\/png ·/)).toBeNull()
    fireEvent.change(screen.getByRole('combobox', { name: 'Artifact sort' }), { target: { value: 'oldest' } })
    expect(groupTitles()).toEqual(titles)
    expect(cards(titles[0]!)).toEqual(['Open Alpha, version 1', 'Open Zeta, version 1'])
    fireEvent.change(screen.getByRole('combobox', { name: 'Artifact sort' }), { target: { value: 'name' } })
    expect(groupTitles()).toEqual(titles)
    expect(cards(titles[0]!)).toEqual(['Open Alpha, version 1', 'Open Zeta, version 1'])
  })

  it('removes collapsed cards, restores the group after reopening and reload, and persists expansion', async () => {
    const scopeKey = crypto.randomUUID()
    const { value, store } = groupedProps(scopeKey)
    const view = render(<ScienceDetailsView {...value} />)
    const toggle = await screen.findByRole('button', { name: /^Current analysis · This session/ })
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: 'Open Alpha, version 1' })).toBeNull()
    expect(store.instance.getSnapshot().libraryCollapsed).toEqual({ [SESSION]: true })
    fireEvent.click(screen.getByRole('button', { name: 'Open Recent plot, version 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'File library' }))
    expect((await screen.findByRole('button', { name: /^Current analysis · This session/ })).getAttribute('aria-expanded')).toBe('false')
    view.unmount()
    const other = groupedProps(crypto.randomUUID())
    const otherView = render(<ScienceDetailsView {...other.value} />)
    expect((await screen.findByRole('button', { name: /^Current analysis · This session/ })).getAttribute('aria-expanded')).toBe('true')
    otherView.unmount()
    const restored = groupedProps(scopeKey)
    render(<ScienceDetailsView {...restored.value} />)
    const restoredToggle = await screen.findByRole('button', { name: /^Current analysis · This session/ })
    expect(restoredToggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(restoredToggle)
    expect(screen.getByRole('button', { name: 'Open Alpha, version 1' })).toBeTruthy()
    expect(restored.store.instance.getSnapshot().libraryCollapsed).toEqual({})
    expect(groupedProps(scopeKey).store.instance.getSnapshot().libraryCollapsed).toEqual({})
  })

  it('filters cards before grouping, hides empty groups, and counts only matching cards', async () => {
    const { value } = groupedProps()
    render(<ScienceDetailsView {...value} />)
    await screen.findByText('5 artifacts')
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: 'alpha' } })
    expect(groupTitles()).toEqual(['Current analysis · This session'])
    expect(screen.getByText('1 artifacts')).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Current analysis · This session 1 ·/ })).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: 'no matching artifact' } })
    expect(screen.queryAllByRole('region')).toHaveLength(0)
    expect(screen.getByText('0 artifacts')).toBeTruthy()
  })

  it('localizes the missing session title and group time in Chinese', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(now)
    const { value } = groupedProps()
    render(<ScienceDetailsView {...value} t={makeTranslate(zh)} />)
    expect(await screen.findByRole('button', { name: '已删除的会话 1 · 1天前' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Current analysis · 本会话 2 · 3分钟前' })).toBeTruthy()
  })
})
