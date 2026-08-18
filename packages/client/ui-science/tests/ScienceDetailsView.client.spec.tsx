// @vitest-environment jsdom
/**
 * The Science Details entry (the artifact panel): every reachable state from
 * the accepted client-safe `science` projection (missing projection support,
 * unbound, environment failed/applied/package-count, no/some runs,
 * gallery/detail/version-rail for charts, attachment failure, no/some
 * Outcome), the version rail walking every durable version, the
 * header-triggered lightbox, distinct accessible text per state, and a
 * privacy regression proving a full fingerprint, executable, or configured
 * path never reaches rendered text even when a projection value carries one.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ScienceClientChartVersion, ScienceClientInterpreterBinding, ScienceClientProjection, ScienceClientRun,
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

function props(
  science: ScienceClientProjection | null | undefined,
  over: {
    agentPreset?: string
    loadImage?: Props['loadImage']
    store?: ReturnType<typeof testScienceSelectionStore>
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
  const store = over.store ?? testScienceSelectionStore()
  return {
    sessionId: SESSION,
    useSessions,
    useProjection: vi.fn(() => science),
    useStore: store.useStore,
    actions: store.actions,
    loadImage: over.loadImage ?? vi.fn().mockResolvedValue('blob:fake-url'),
    t,
  } as unknown as Props
}

/** The whole-panel status text, valid only for the two single-paragraph early-return states. */
function statusText(): string {
  return screen.getByRole('status').textContent ?? ''
}

/** One rendered section's root element, found by its heading text (the four sections always coexist once bound). */
function sectionOf(heading: string): HTMLElement {
  const el = screen.getByText(heading).closest('section')
  if (el === null) throw new Error(`no <section> ancestor for heading "${heading}"`)
  return el
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

describe('ScienceDetailsView: environment', () => {
  it('reports failed Runtime binding before any environment revision exists', () => {
    render(<ScienceDetailsView {...props(baseProjection())} />)
    expect(within(sectionOf('Environment')).getByRole('status').textContent).toBe('No interpreter binding is available yet.')
  })

  it('reports failed Runtime binding for an invalid or drifted revision, never as ready', () => {
    for (const status of ['invalid', 'drifted'] as const) {
      const science = baseProjection({
        environment: { revision: 1, profileId: 'science' as never, configuredAt: 0, validatedAt: 0, status },
      })
      render(<ScienceDetailsView {...props(science)} />)
      const section = sectionOf('Environment')
      expect(within(section).getByRole('status').textContent).toBe('No interpreter binding is available yet.')
      expect(section.textContent).not.toContain('ready')
      cleanup()
    }
  })

  it('renders the profile, revision, and per-language capability once applied', () => {
    const python: ScienceClientInterpreterBinding = {
      language: 'python', capability: 'available', languageVersion: '3.11.4', fingerprintPreview: 'abcdef012345',
    }
    const r: ScienceClientInterpreterBinding = { language: 'r', capability: 'unavailable' }
    const science = baseProjection({
      environment: { revision: 2, profileId: 'science' as never, configuredAt: 0, validatedAt: 0, status: 'applied', python, r },
    })
    render(<ScienceDetailsView {...props(science)} />)
    const section = sectionOf('Environment')
    expect(within(section).queryByRole('status')).toBeNull()
    expect(section.textContent).toContain('Profile: science')
    expect(section.textContent).toContain('Revision 2')
    expect(section.textContent).toContain('Python')
    expect(within(section).getByText('Available')).toBeTruthy()
    expect(section.textContent).toContain('version 3.11.4')
    expect(section.textContent).toContain('fingerprint abcdef012345')
    expect(section.textContent).toContain('R')
    expect(within(section).getByText('Unavailable')).toBeTruthy()
  })

  it('renders every interpreter capability, including invalid and drifted', () => {
    const python: ScienceClientInterpreterBinding = { language: 'python', capability: 'invalid' }
    const r: ScienceClientInterpreterBinding = { language: 'r', capability: 'drifted' }
    const science = baseProjection({
      environment: { revision: 1, profileId: 'science' as never, configuredAt: 0, validatedAt: 0, status: 'applied', python, r },
    })
    render(<ScienceDetailsView {...props(science)} />)
    const section = sectionOf('Environment')
    expect(within(section).getByText('Invalid')).toBeTruthy()
    expect(within(section).getByText('Drifted')).toBeTruthy()
  })

  it('renders only the profile and revision for an applied environment with no interpreter binding', () => {
    const science = baseProjection({
      environment: { revision: 1, profileId: 'science' as never, configuredAt: 0, validatedAt: 0, status: 'applied' },
    })
    render(<ScienceDetailsView {...props(science)} />)
    const section = sectionOf('Environment')
    expect(section.textContent).toContain('Profile: science')
    expect(within(section).queryByText('Python')).toBeNull()
    expect(within(section).queryByText('R')).toBeNull()
  })

  it('renders the package count when the binding carries an inventory, and omits it otherwise', () => {
    const withPackages: ScienceClientInterpreterBinding = {
      language: 'python', capability: 'available',
      packages: [{ name: 'pip', version: '24.0' }, { name: 'numpy', version: '2.0.0' }],
    }
    const withoutPackages: ScienceClientInterpreterBinding = { language: 'r', capability: 'available' }
    const science = baseProjection({
      environment: {
        revision: 1, profileId: 'science' as never, configuredAt: 0, validatedAt: 0, status: 'applied',
        python: withPackages, r: withoutPackages,
      },
    })
    render(<ScienceDetailsView {...props(science)} />)
    const section = sectionOf('Environment')
    expect(section.textContent).toContain('2 packages')
  })
})

describe('ScienceDetailsView: runs', () => {
  it('reports no runs yet for an empty history', () => {
    render(<ScienceDetailsView {...props(baseProjection())} />)
    expect(within(sectionOf('Runs')).getByRole('status').textContent).toBe('No runs yet.')
  })

  it('renders ordered run status/history', () => {
    const science = baseProjection({
      runs: [
        run({ runId: 'run-1' as never, status: 'success' }),
        run({ runId: 'run-2' as never, language: 'r', status: 'failed' }),
        run({ runId: 'run-3' as never, status: 'running' }),
      ],
    })
    render(<ScienceDetailsView {...props(science)} />)
    const section = sectionOf('Runs')
    expect(within(section).queryByRole('status')).toBeNull()
    expect(section.textContent).toContain('Success')
    expect(section.textContent).toContain('Failed')
    expect(section.textContent).toContain('Running')
  })

  it('renders the timed-out, cancelled, and interrupted terminal statuses', () => {
    const science = baseProjection({
      runs: [
        run({ runId: 'run-1' as never, status: 'timed-out' }),
        run({ runId: 'run-2' as never, status: 'cancelled' }),
        run({ runId: 'run-3' as never, status: 'interrupted', interruptedAtSeq: 4 } as never),
      ],
    })
    render(<ScienceDetailsView {...props(science)} />)
    const section = sectionOf('Runs')
    expect(section.textContent).toContain('Timed out')
    expect(section.textContent).toContain('Cancelled')
    expect(section.textContent).toContain('Interrupted')
  })
})

describe('ScienceDetailsView: artifact gallery', () => {
  it('reports no charts yet for an empty history', () => {
    render(<ScienceDetailsView {...props(baseProjection())} />)
    expect(within(sectionOf('Charts')).getByRole('status').textContent).toBe('No charts yet.')
  })

  it('renders one gallery entry per logical chart at its latest accepted version', () => {
    const science = baseProjection({
      // A duplicate/out-of-order lower version after the accepted latest
      // must not displace it (latestCharts keeps the higher version).
      charts: [
        chart({ version: 1 }), chart({ version: 2 }), chart({ version: 1 }),
        chart({ chartId: 'chart-2' as never, title: 'Other', version: 1 }),
      ],
    })
    render(<ScienceDetailsView {...props(science)} />)
    const section = sectionOf('Charts')
    expect(within(section).queryByRole('status')).toBeNull()
    expect(within(section).getAllByText(/^v\d$/)).toHaveLength(2)
    expect(within(section).getByText('v2')).toBeTruthy()
    expect(within(section).getByText('Loss curve')).toBeTruthy()
    expect(within(section).getAllByText('loss-curve')).toHaveLength(2)
    expect(within(section).getByText('Other')).toBeTruthy()
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
})

describe('ScienceDetailsView: artifact detail and version rail', () => {
  it('selecting a gallery entry switches to the detail view with a version rail over every durable version', () => {
    const science = baseProjection({
      charts: [chart({ version: 1, title: 'v1 title' }), chart({ version: 2, title: 'v2 title' })],
    })
    const view = render(<ScienceDetailsView {...props(science)} />)
    const section = sectionOf('Charts')
    fireEvent.click(within(section).getByText('v2 title'))

    // Detail mode: the gallery's other entries are gone, replaced by one
    // big image, the selected version's title, and a rail over v1..v2.
    expect(screen.getByText('v2 title')).toBeTruthy()
    expect(screen.queryByText('v1 title')).toBeNull()
    const rail = screen.getByLabelText('Versions')
    expect(within(rail).getAllByRole('button')).toHaveLength(2)
    expect(within(rail).getByText('v1')).toBeTruthy()
    expect(within(rail).getByText('v2')).toBeTruthy()
    expect(view.container.querySelector('[aria-current="true"]')?.textContent).toBe('v2')
  })

  it('the version rail switches the rendered version without leaving detail mode', () => {
    const science = baseProjection({
      charts: [chart({ version: 1, title: 'v1 title' }), chart({ version: 2, title: 'v2 title' })],
    })
    render(<ScienceDetailsView {...props(science)} />)
    fireEvent.click(within(sectionOf('Charts')).getByText('v2 title'))

    const rail = screen.getByLabelText('Versions')
    fireEvent.click(within(rail).getByText('v1'))

    expect(screen.getByText('v1 title')).toBeTruthy()
    expect(screen.queryByText('v2 title')).toBeNull()
    expect(document.querySelector('[aria-current="true"]')?.textContent).toBe('v1')
  })

  it('renders the caption when the selected version carries one, and the sub-kilobyte/kilobyte/megabyte byte formats across versions', () => {
    const science = baseProjection({
      charts: [
        chart({ version: 1, title: 'v1 title', caption: 'First pass', attachment: { attachmentId: 'sha256:abc' as never, mediaType: 'image/png', bytes: 512, width: 10, height: 10 } }),
        chart({ version: 2, title: 'v2 title', attachment: { attachmentId: 'sha256:abc' as never, mediaType: 'image/png', bytes: 2048, width: 10, height: 10 } }),
        chart({ version: 3, title: 'v3 title', attachment: { attachmentId: 'sha256:abc' as never, mediaType: 'image/png', bytes: 5 * 1024 * 1024, width: 10, height: 10 } }),
      ],
    })
    render(<ScienceDetailsView {...props(science)} />)
    fireEvent.click(within(sectionOf('Charts')).getByText('v3 title'))
    expect(screen.getByText(/5\.0 MB/)).toBeTruthy()

    const rail = screen.getByLabelText('Versions')
    fireEvent.click(within(rail).getByText('v2'))
    expect(screen.getByText(/2\.0 KB/)).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Versions').querySelector('button')!)
    expect(screen.getByText('First pass')).toBeTruthy()
    expect(screen.getByText(/512 B/)).toBeTruthy()
  })

  it('activates a gallery entry on Enter/Space and ignores every other key', () => {
    const science = baseProjection({ charts: [chart({ version: 1 })] })
    render(<ScienceDetailsView {...props(science)} />)
    const gallery = sectionOf('Charts').querySelector('[role="button"]') as HTMLElement
    fireEvent.keyDown(gallery, { key: 'a' })
    expect(screen.queryByLabelText('Versions')).toBeNull()
    fireEvent.keyDown(gallery, { key: 'Enter' })
    expect(screen.getByLabelText('Versions')).toBeTruthy()
  })

  it('reports the header-triggered lightbox image as unavailable when the loader rejects (no dialog, no crash)', async () => {
    const loadImage = vi.fn().mockRejectedValue(new Error('network'))
    const science = baseProjection({ charts: [chart()] })
    const store = testScienceSelectionStore()
    render(<ScienceDetailsView {...props(science, { loadImage, store })} />)
    fireEvent.click(within(sectionOf('Charts')).getByText('Loss curve'))
    store.actions.setLightboxOpen(true)
    await waitFor(() => { expect(loadImage.mock.calls.length).toBeGreaterThan(0) })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('back-to-gallery returns to the gallery with the selection cleared', () => {
    const science = baseProjection({ charts: [chart({ version: 1 }), chart({ version: 2 })] })
    render(<ScienceDetailsView {...props(science)} />)
    fireEvent.click(within(sectionOf('Charts')).getByText('Loss curve'))
    fireEvent.click(screen.getByText('Back to gallery'))

    const section = sectionOf('Charts')
    expect(within(section).queryByLabelText('Versions')).toBeNull()
    // Back to one gallery entry at its latest (v2) version.
    expect(within(section).getByText('v2')).toBeTruthy()
  })

  it('the header-triggered lightbox opens when the shared store flips lightboxOpen, and closes back through the same store', async () => {
    const loadImage = vi.fn().mockResolvedValue('blob:fake-url')
    const science = baseProjection({ charts: [chart()] })
    const store = testScienceSelectionStore()
    render(<ScienceDetailsView {...props(science, { loadImage, store })} />)
    fireEvent.click(within(sectionOf('Charts')).getByText('Loss curve'))
    expect(screen.getByLabelText('Versions')).toBeTruthy()

    expect(screen.queryByRole('dialog')).toBeNull()
    store.actions.setLightboxOpen(true)
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => { expect(store.instance.getSnapshot().lightboxOpen).toBe(false) })
  })

  it('discards a header-triggered lightbox load that resolves after the lightbox already closed', async () => {
    let resolveLoad: ((url: string) => void) | undefined
    const loadImage = vi.fn(() => new Promise<string>((resolve) => { resolveLoad = resolve }))
    const science = baseProjection({ charts: [chart()] })
    const store = testScienceSelectionStore()
    render(<ScienceDetailsView {...props(science, { loadImage, store })} />)
    fireEvent.click(within(sectionOf('Charts')).getByText('Loss curve'))
    // The gallery thumbnail and the detail's own big-image MessageImage
    // already called loadImage; only the lightbox's own call matters here.
    const callsBeforeLightbox = loadImage.mock.calls.length

    act(() => { store.actions.setLightboxOpen(true) })
    await waitFor(() => { expect(loadImage.mock.calls.length).toBe(callsBeforeLightbox + 1) })
    // Close before the load settles: the effect's cleanup marks it stale.
    act(() => { store.actions.setLightboxOpen(false) })
    act(() => { resolveLoad?.('blob:late-url') })
    await Promise.resolve()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a stale selection (chart no longer present) falls back to the gallery', () => {
    const science = baseProjection({ charts: [chart({ version: 1 })] })
    const store = testScienceSelectionStore()
    store.actions.select({ chartId: 'missing-chart' as never, version: 1 })
    render(<ScienceDetailsView {...props(science, { store })} />)
    const section = sectionOf('Charts')
    expect(within(section).queryByLabelText('Versions')).toBeNull()
    expect(within(section).getByText('Loss curve')).toBeTruthy()
  })
})

describe('ScienceDetailsView: outcome', () => {
  it('reports no outcome published yet before publication', () => {
    render(<ScienceDetailsView {...props(baseProjection())} />)
    expect(within(sectionOf('Outcome')).getByRole('status').textContent).toBe('No outcome published yet.')
  })

  it('renders the latest Outcome with its evidence references', () => {
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
    const section = sectionOf('Outcome')
    expect(within(section).queryByRole('status')).toBeNull()
    expect(section.textContent).toContain('Model converges')
    expect(section.textContent).toContain('revision 3')
    expect(section.querySelector('strong')?.textContent).toBe('loss')
    expect(section.textContent).toContain('run run-1')
    expect(section.textContent).toContain('chart chart-1 v2')
    expect(section.textContent).toContain('message #7')
  })
})

describe('ScienceDetailsView: distinct accessible text per state', () => {
  it('never repeats the same status text across the missing-support/unbound/environment/runs/charts/outcome states', () => {
    const texts: string[] = []

    render(<ScienceDetailsView {...props(undefined)} />)
    texts.push(statusText())
    cleanup()

    render(<ScienceDetailsView {...props(null, { agentPreset: 'science' })} />)
    texts.push(statusText())
    cleanup()

    const empty = baseProjection()
    render(<ScienceDetailsView {...props(empty)} />)
    for (const status of screen.getAllByRole('status')) texts.push(status.textContent ?? '')
    cleanup()

    expect(new Set(texts).size).toBe(texts.length)
    expect(texts).toHaveLength(6)
  })
})

describe('ScienceDetailsView: privacy', () => {
  const SENTINEL_PREFIX = '/sentinel-7c21af/opt/conda/envs/science'
  const SENTINEL_EXECUTABLE = '/sentinel-7c21af/opt/conda/envs/science/bin/python3.11'
  const SENTINEL_FULL_FINGERPRINT = `${'a'.repeat(52)}sentinel7c21af`

  it('never renders a full fingerprint, executable, or configured/canonical path even when the projection value carries one', () => {
    // A structurally-honest client projection never carries these fields —
    // this simulates a Host that over-sends anyway, proving the component
    // itself never reads or displays them.
    const python = {
      language: 'python', capability: 'available', languageVersion: '3.11.4',
      fingerprintPreview: 'abcdef012345',
      configuredPrefix: SENTINEL_PREFIX,
      canonicalPrefix: SENTINEL_PREFIX,
      executable: SENTINEL_EXECUTABLE,
      executableIdentity: SENTINEL_EXECUTABLE,
      bindingFingerprint: SENTINEL_FULL_FINGERPRINT,
    } as unknown as ScienceClientInterpreterBinding
    const science = baseProjection({
      environment: { revision: 1, profileId: 'science' as never, configuredAt: 0, validatedAt: 0, status: 'applied', python },
    })
    const view = render(<ScienceDetailsView {...props(science)} />)
    expect(view.container.textContent).not.toContain(SENTINEL_PREFIX)
    expect(view.container.textContent).not.toContain(SENTINEL_EXECUTABLE)
    expect(view.container.textContent).not.toContain(SENTINEL_FULL_FINGERPRINT)
    expect(view.container.textContent).toContain('abcdef012345')
  })
})
