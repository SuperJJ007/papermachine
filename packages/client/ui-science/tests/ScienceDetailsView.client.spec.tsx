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
import type { ConversationSnapshot, SessionId, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ScienceClientChartVersion, ScienceClientProjection, ScienceClientRun,
} from '@deepseek-ai/dsh-science-session/types'
import { ScienceDetailsView, type ScienceDetailsViewProps } from '../src/client/ScienceDetailsView.tsx'
import { en } from '../src/client/locales.ts'
import { testScienceSelectionStore } from './selection-store-test-helpers.client.ts'

type Props = ScienceDetailsViewProps

const SESSION = 'session-1' as SessionId
const t: Props['t'] = makeTranslate(en)

afterEach(cleanup)

function baseProjection(over: Partial<ScienceClientProjection> = {}): ScienceClientProjection {
  return {
    mode: { modeId: 'science', presetId: 'science', modeRevision: 'r' },
    environment: null,
    runs: [],
    charts: [],
    outcome: null,
    metrics: { runCount: 0, successfulRunCount: 0, chartCount: 0, chartVersionCount: 0, outcomeRevision: 0 },
    lastScienceEventSeq: 1,
    ...over,
  }
}

function chart(over: Partial<ScienceClientChartVersion> = {}): ScienceClientChartVersion {
  return {
    chartId: 'chart-1' as never,
    logicalName: 'loss-curve',
    version: 1,
    title: 'Loss curve',
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
    status: 'success',
    finishedAt: 2_000,
    stdoutBytes: 0,
    stderrBytes: 0,
    stdoutTruncated: false,
    stderrTruncated: false,
    ...over,
  } as ScienceClientRun
}

function emptySnapshot(): ConversationSnapshot {
  return { chat: { nodes: { get: () => undefined, values: () => [] } } } as unknown as ConversationSnapshot
}

function props(
  science: ScienceClientProjection | null | undefined,
  over: {
    agentPreset?: string
    loadImage?: Props['loadImage']
    store?: ReturnType<typeof testScienceSelectionStore>
    inspectCall?: (callId: string) => void
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
  const snapshot = emptySnapshot()
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
    expect(statuses.map(el => el.textContent)).toEqual(['No charts yet.', 'No outcome published yet.'])
  })

  it('renders one gallery entry per logical chart at its latest accepted version', () => {
    const science = baseProjection({
      charts: [
        chart({ version: 1 }), chart({ version: 2 }), chart({ version: 1 }),
        chart({ chartId: 'chart-2' as never, title: 'Other', version: 1 }),
      ],
    })
    render(<ScienceDetailsView {...props(science)} />)
    expect(screen.getAllByText(/^v\d$/)).toHaveLength(2)
    expect(screen.getByText('v2')).toBeTruthy()
    expect(screen.getByText('Loss curve')).toBeTruthy()
    expect(screen.getAllByText('loss-curve')).toHaveLength(2)
    expect(screen.getByText('Other')).toBeTruthy()
  })

  it('loads a gallery thumbnail through the injected session-scoped loader', async () => {
    const loadImage = vi.fn().mockResolvedValue('data:image/png;base64,abc')
    const science = baseProjection({ charts: [chart()] })
    const view = render(<ScienceDetailsView {...props(science, { loadImage })} />)
    await waitFor(() => { expect(loadImage).toHaveBeenCalledTimes(1) })
    expect(loadImage.mock.calls[0]?.[0]).toMatchObject({ attachmentId: 'sha256:abc' })
    await waitFor(() => { expect(view.container.querySelector('img')).not.toBeNull() })
  })

  it('reports unavailable attachments distinctly when the loader rejects', async () => {
    const loadImage = vi.fn().mockRejectedValue(new Error('network'))
    const science = baseProjection({ charts: [chart()] })
    render(<ScienceDetailsView {...props(science, { loadImage })} />)
    expect(await screen.findByRole('button', { name: 'Failed to load, click to retry' })).toBeTruthy()
  })

  it('activates a gallery entry on Enter/Space and ignores every other key', () => {
    const science = baseProjection({ charts: [chart({ version: 1 })] })
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
    const science = baseProjection({ charts: [chart({ version: 1, title: 'v1 title' }), chart({ version: 2, title: 'v2 title' })] })
    render(<ScienceDetailsView {...props(science)} />)
    fireEvent.click(screen.getByText('v2 title'))

    expect(screen.getByRole('tab', { name: 'v2 title' })).toBeTruthy()
    expect(screen.getByText('loss-curve')).toBeTruthy()
    expect(screen.queryByText('No charts yet.')).toBeNull()
  })
})

describe('ScienceDetailsView: tab strip', () => {
  function twoTabs() {
    const science = baseProjection({
      charts: [chart({ chartId: 'chart-1' as never, title: 'Alpha' }), chart({ chartId: 'chart-2' as never, title: 'Beta' })],
    })
    const store = testScienceSelectionStore()
    store.actions.openTab({ chartId: 'chart-1' as never, version: 1 })
    store.actions.openTab({ chartId: 'chart-2' as never, version: 1 })
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
    expect(store.instance.getSnapshot().activeChartId).toBe('chart-1')
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
    expect(screen.getByRole('button', { name: 'Open chart Alpha, version 1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open chart Beta, version 1' })).toBeTruthy()
  })

  it('a stale tab (chart no longer present in the projection) shows its raw id and the unavailable notice', () => {
    const science = baseProjection({ charts: [chart()] })
    const store = testScienceSelectionStore()
    store.actions.openTab({ chartId: 'missing-chart' as never, version: 1 })
    render(<ScienceDetailsView {...props(science, { store })} />)
    expect(screen.getByRole('tab', { name: 'missing-chart' })).toBeTruthy()
    expect(statusText()).toBe('This artifact version is no longer available.')
  })
})

describe('ScienceDetailsView: toolbar version stepper', () => {
  function threeVersions() {
    const science = baseProjection({
      charts: [
        chart({ version: 1, title: 'v1 title', caption: 'First pass', attachment: { attachmentId: 'sha256:abc' as never, mediaType: 'image/png', bytes: 512, width: 10, height: 10 } }),
        chart({ version: 2, title: 'v2 title', attachment: { attachmentId: 'sha256:abc' as never, mediaType: 'image/png', bytes: 2048, width: 10, height: 10 } }),
        chart({ version: 3, title: 'v3 title', attachment: { attachmentId: 'sha256:abc' as never, mediaType: 'image/png', bytes: 5 * 1024 * 1024, width: 10, height: 10 } }),
      ],
    })
    const store = testScienceSelectionStore()
    store.actions.openTab({ chartId: 'chart-1' as never, version: 2 })
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
    expect(screen.getByText(/5\.0 MB/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Next version' }).hasAttribute('disabled')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Previous version' }))
    fireEvent.click(screen.getByRole('button', { name: 'Previous version' }))
    expect(screen.getAllByText('v1 title')).toHaveLength(2)
    expect(screen.getByText('First pass')).toBeTruthy()
    expect(screen.getByText(/512 B/)).toBeTruthy()
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

describe('ScienceDetailsView: content dispatch', () => {
  it.each(['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const)('renders an image for %s attachments', async (mediaType) => {
    const science = baseProjection({
      charts: [chart({ attachment: { attachmentId: 'sha256:abc' as never, mediaType, bytes: 100, width: 10, height: 10 } })],
    })
    const store = testScienceSelectionStore()
    store.actions.openTab({ chartId: 'chart-1' as never, version: 1 })
    const loadImage = vi.fn().mockResolvedValue(`data:${mediaType};base64,abc`)
    render(<ScienceDetailsView {...props(science, { store, loadImage })} />)
    await waitFor(() => { expect(document.querySelector('img')).not.toBeNull() })
  })

  it('renders the source run and dimensions in the content facts', () => {
    const science = baseProjection({ charts: [chart()] })
    const store = testScienceSelectionStore()
    store.actions.openTab({ chartId: 'chart-1' as never, version: 1 })
    render(<ScienceDetailsView {...props(science, { store })} />)
    expect(screen.getByText('from run run-1')).toBeTruthy()
    expect(screen.getByText(/10×10/)).toBeTruthy()
  })
})

describe('ScienceDetailsView: maximize (toolbar-triggered lightbox)', () => {
  it('opens when maximize is clicked, and closes back through the same store', async () => {
    const loadImage = vi.fn().mockResolvedValue('data:image/png;base64,abc')
    const science = baseProjection({ charts: [chart()] })
    const store = testScienceSelectionStore()
    store.actions.openTab({ chartId: 'chart-1' as never, version: 1 })
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
    const science = baseProjection({ charts: [chart()] })
    const store = testScienceSelectionStore()
    store.actions.openTab({ chartId: 'chart-1' as never, version: 1 })
    render(<ScienceDetailsView {...props(science, { store, loadImage })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }))
    await waitFor(() => { expect(loadImage.mock.calls.length).toBeGreaterThan(1) })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('discards a lightbox load that resolves after the lightbox already closed', async () => {
    let resolveLoad: ((url: string) => void) | undefined
    const loadImage = vi.fn((attachment: { attachmentId: string }) => {
      if (loadImage.mock.calls.length === 1) return Promise.resolve('data:image/png;base64,thumb')
      void attachment
      return new Promise<string>((resolve) => { resolveLoad = resolve })
    })
    const science = baseProjection({ charts: [chart()] })
    const store = testScienceSelectionStore()
    store.actions.openTab({ chartId: 'chart-1' as never, version: 1 })
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
  function withOneTab(attachmentOver: Partial<ScienceClientChartVersion['attachment']> = {}) {
    const science = baseProjection({
      charts: [chart({ attachment: { attachmentId: 'sha256:abc' as never, mediaType: 'image/png', bytes: 100, width: 10, height: 10, ...attachmentOver } })],
    })
    const store = testScienceSelectionStore()
    store.actions.openTab({ chartId: 'chart-1' as never, version: 1 })
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

describe('ScienceDetailsView: provenance drill-in', () => {
  function withRunAndChart() {
    const science = baseProjection({ runs: [run()], charts: [chart()] })
    const store = testScienceSelectionStore()
    store.actions.openTab({ chartId: 'chart-1' as never, version: 1 })
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

  it('reports the artifact as unavailable in the drill-in when the source run no longer resolves', () => {
    const science = baseProjection({ runs: [], charts: [chart()] })
    const store = testScienceSelectionStore()
    store.actions.openTab({ chartId: 'chart-1' as never, version: 1 })
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
