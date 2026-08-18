// @vitest-environment jsdom
/**
 * The provenance view: preset gate, no selection, artifact unavailable
 * (chart or its source run missing from the projection), each of the four
 * parts (code, execution log, conversation, environment) both available and
 * distinctly unavailable — including the run-outside-loaded-window "pending
 * history" states, where the durable digest and byte counts still render —
 * the running-log state, byte truncation, the environment-superseded state
 * for a revision the projection no longer retains, and the jump-to-transcript
 * action.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { conversationContextKey } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ConversationSnapshot, SessionId, SessionListState, ToolCallBlock, ToolResultNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ScienceClientProjection, ScienceClientRun } from '@deepseek-ai/dsh-science-session/types'
import { ScienceProvenanceView, type ScienceProvenanceViewProps } from '../src/client/ScienceProvenanceView.tsx'
import { en } from '../src/client/locales.ts'
import { testScienceSelectionStore } from './selection-store-test-helpers.client.ts'

type Props = ScienceProvenanceViewProps

const SESSION = 'session-1' as SessionId
const CALL_ID = 'call-run-1'
const t: Props['t'] = makeTranslate(en)

afterEach(cleanup)

function run(over: Partial<ScienceClientRun> = {}): ScienceClientRun {
  return {
    runId: 'run-1' as never,
    language: 'python',
    toolCallId: CALL_ID as never,
    requestHeaderSeq: 7,
    environmentRevision: 1,
    environmentFingerprintPreview: 'f'.repeat(12),
    startedAt: 1_000,
    codeSha256: 'c'.repeat(64),
    status: 'success',
    finishedAt: 2_000,
    stdoutBytes: 12,
    stderrBytes: 3,
    stdoutTruncated: false,
    stderrTruncated: false,
    ...over,
  } as ScienceClientRun
}

function baseProjection(over: Partial<ScienceClientProjection> = {}): ScienceClientProjection {
  return {
    mode: { modeId: 'science', presetId: 'science', modeRevision: 'r' },
    environment: {
      revision: 1, profileId: 'science' as never, configuredAt: 0, validatedAt: 0, status: 'applied',
      python: { language: 'python', capability: 'available' },
    },
    runs: [run()],
    charts: [{
      chartId: 'chart-1' as never, logicalName: 'loss-curve', version: 2, title: 'Loss curve',
      attachment: { attachmentId: 'sha256:abc' as never, mediaType: 'image/png', bytes: 10, width: 1, height: 1 },
      runId: 'run-1' as never, toolCallId: 'call-chart-1' as never, requestHeaderSeq: 8,
      environmentRevision: 1, environmentFingerprintPreview: 'f'.repeat(12), createdAt: 3_000,
    }],
    outcome: null,
    metrics: { runCount: 1, successfulRunCount: 1, chartCount: 1, chartVersionCount: 1, outcomeRevision: 0 },
    lastScienceEventSeq: 9,
    ...over,
  }
}

/** A settled node whose call head is loaded (call present). */
function settledInWindow(argsRaw: string, resultText: string): ToolResultNode {
  return {
    kind: 'tool-result', seq: 4, time: 4_000, callId: CALL_ID,
    call: { name: 'run_python', argsRaw },
    callTime: 3_500,
    content: [{ type: 'text', text: resultText }],
    isError: false, callView: null, resultView: null, subCalls: [],
  }
}

/** A settled node whose call head fell outside the loaded window (call null), result still present. */
function settledCallOutOfWindow(resultText: string): ToolResultNode {
  return {
    kind: 'tool-result', seq: 4, time: 4_000, callId: CALL_ID,
    call: null,
    callTime: null,
    content: [{ type: 'text', text: resultText }],
    isError: false, callView: null, resultView: null, subCalls: [],
  }
}

function snapshotWith(block: ToolCallBlock | undefined): ConversationSnapshot {
  const key = conversationContextKey('tool-call', CALL_ID)
  const node = block === undefined ? undefined : { key, kind: 'tool-call' as const, id: CALL_ID, target: 'chat' as const, anchorSeq: 0, location: { kind: 'session' as const }, visibility: 'visible' as const, data: { root: block } }
  return {
    chat: {
      nodes: {
        get: (k: string) => (k === key ? node : undefined),
        values: () => (node === undefined ? [] : [node]),
      },
    },
  } as unknown as ConversationSnapshot
}

function props(
  science: ScienceClientProjection | null | undefined,
  over: {
    agentPreset?: string
    selected?: { chartId: string; version: number } | null
    block?: ToolCallBlock | undefined
    inspectCall?: (callId: string) => void
    store?: ReturnType<typeof testScienceSelectionStore>
  } = {},
): Props {
  const state = {
    ids: [SESSION],
    byId: { [SESSION]: { id: SESSION, displayTitle: SESSION, running: false, blank: false, updatedAt: 0, agentPreset: over.agentPreset ?? 'science' } },
    current: SESSION, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  } satisfies SessionListState
  const store = over.store ?? testScienceSelectionStore()
  if (over.selected !== undefined) store.actions.select(over.selected as never)
  const snapshot = snapshotWith(over.block)
  return {
    sessionId: SESSION,
    useSessions: <T,>(select: (s: SessionListState) => T) => select(state),
    useSession: <T,>(select: (s: ConversationSnapshot) => T) => select(snapshot),
    useProjection: vi.fn(() => science),
    useStore: store.useStore,
    inspectCall: over.inspectCall ?? vi.fn(),
    t,
  } as unknown as Props
}

describe('ScienceProvenanceView: preset gate', () => {
  it('renders nothing for a non-Science session even with a selection', () => {
    const view = render(<ScienceProvenanceView {...props(baseProjection(), { agentPreset: 'standard', selected: { chartId: 'chart-1', version: 2 } })} />)
    expect(view.container.innerHTML).toBe('')
  })
})

describe('ScienceProvenanceView: no selection', () => {
  it('reports no selection distinctly', () => {
    render(<ScienceProvenanceView {...props(baseProjection(), { selected: null })} />)
    expect(screen.getByRole('status').textContent).toBe('Select an artifact in the Details column to see its provenance.')
  })
})

describe('ScienceProvenanceView: artifact unavailable', () => {
  it('reports the artifact as unavailable when the chart no longer resolves', () => {
    render(<ScienceProvenanceView {...props(baseProjection(), { selected: { chartId: 'missing', version: 1 } })} />)
    expect(screen.getByRole('status').textContent).toBe('This artifact version is no longer available.')
  })

  it('reports the artifact as unavailable when the source run no longer resolves', () => {
    const science = baseProjection({ runs: [] })
    render(<ScienceProvenanceView {...props(science, { selected: { chartId: 'chart-1', version: 2 } })} />)
    expect(screen.getByRole('status').textContent).toBe('This artifact version is no longer available.')
  })
})

function sectionOf(container: HTMLElement, heading: string): HTMLElement {
  const el = within(container).getByText(heading).closest('section')
  if (el === null) throw new Error(`no <section> ancestor for heading "${heading}"`)
  return el
}

describe('ScienceProvenanceView: code', () => {
  it('renders the code and its durable digest anchor when the call head is loaded', () => {
    const block = settledInWindow('{"code":"print(1)"}', 'ok')
    const view = render(<ScienceProvenanceView {...props(baseProjection(), { selected: { chartId: 'chart-1', version: 2 }, block })} />)
    const section = sectionOf(view.container, 'Code')
    expect(within(section).queryByRole('status')).toBeNull()
    expect(section.textContent).toContain(`SHA-256 ${'c'.repeat(64)}`)
    expect(section.textContent).toContain('print(1)')
  })

  it('renders pending-history for code when the call is outside the loaded window, with the digest still visible', () => {
    const view = render(<ScienceProvenanceView {...props(baseProjection(), { selected: { chartId: 'chart-1', version: 2 }, block: undefined })} />)
    const section = sectionOf(view.container, 'Code')
    expect(within(section).getByRole('status').textContent)
      .toBe('The code is outside the loaded conversation history. Load more history to see it.')
    expect(section.textContent).toContain(`SHA-256 ${'c'.repeat(64)}`)
  })

  it('renders pending-history for code when the settled result stayed in-window but the call head did not', () => {
    const block = settledCallOutOfWindow('output')
    const view = render(<ScienceProvenanceView {...props(baseProjection(), { selected: { chartId: 'chart-1', version: 2 }, block })} />)
    const section = sectionOf(view.container, 'Code')
    expect(within(section).getByRole('status')).toBeTruthy()
  })

  it('renders the code from a still-running call\'s own argsRaw', () => {
    const block: ToolCallBlock = {
      callId: CALL_ID, name: 'run_python', argsRaw: '{"code":"print(2)"}',
      turn: 1, step: 1, time: 3_000, callView: null, subCalls: [],
    }
    const view = render(<ScienceProvenanceView {...props(baseProjection({ runs: [run({ status: 'running' })] }), { selected: { chartId: 'chart-1', version: 2 }, block })} />)
    const section = sectionOf(view.container, 'Code')
    expect(section.textContent).toContain('print(2)')
  })

  it('reports code as absent when the argsRaw is not valid JSON or carries no code field', () => {
    const block = settledInWindow('not-json', 'output')
    const view = render(<ScienceProvenanceView {...props(baseProjection(), { selected: { chartId: 'chart-1', version: 2 }, block })} />)
    expect(within(sectionOf(view.container, 'Code')).getByRole('status')).toBeTruthy()
  })
})

describe('ScienceProvenanceView: execution log', () => {
  it('renders the log text plus the projection\'s durable byte counts', () => {
    const block = settledInWindow('{"code":"x"}', 'hello stdout')
    const view = render(<ScienceProvenanceView {...props(baseProjection(), { selected: { chartId: 'chart-1', version: 2 }, block })} />)
    const section = sectionOf(view.container, 'Execution log')
    expect(within(section).queryByRole('status')).toBeNull()
    expect(section.textContent).toContain('stdout 12 bytes, stderr 3 bytes')
    expect(section.textContent).toContain('hello stdout')
  })

  it('renders a non-text result content block as formatted JSON', () => {
    const block: ToolResultNode = {
      kind: 'tool-result', seq: 4, time: 4_000, callId: CALL_ID,
      call: { name: 'run_python', argsRaw: '{"code":"x"}' }, callTime: 3_500,
      content: [{ type: 'reasoning', text: 'note' }],
      isError: false, callView: null, resultView: null, subCalls: [],
    }
    const view = render(<ScienceProvenanceView {...props(baseProjection(), { selected: { chartId: 'chart-1', version: 2 }, block })} />)
    expect(sectionOf(view.container, 'Execution log').textContent).toContain('"type": "reasoning"')
  })

  it('flags truncation alongside the byte counts', () => {
    const science = baseProjection({ runs: [run({ stdoutTruncated: true })] })
    const block = settledInWindow('{"code":"x"}', 'hello')
    const view = render(<ScienceProvenanceView {...props(science, { selected: { chartId: 'chart-1', version: 2 }, block })} />)
    expect(sectionOf(view.container, 'Execution log').textContent).toContain('(truncated)')
  })

  it('reports the run as still in progress for a running run, with no byte counts (none exist yet)', () => {
    const science = baseProjection({ runs: [run({ status: 'running', finishedAt: undefined, stdoutBytes: undefined, stderrBytes: undefined, stdoutTruncated: undefined, stderrTruncated: undefined } as never)] })
    const view = render(<ScienceProvenanceView {...props(science, { selected: { chartId: 'chart-1', version: 2 }, block: undefined })} />)
    const section = sectionOf(view.container, 'Execution log')
    expect(within(section).getByRole('status').textContent).toBe('The run is still in progress.')
    expect(section.textContent).not.toContain('bytes')
  })

  it('renders pending-history for the log when the run is outside the loaded window, with durable byte counts still visible', () => {
    const view = render(<ScienceProvenanceView {...props(baseProjection(), { selected: { chartId: 'chart-1', version: 2 }, block: undefined })} />)
    const section = sectionOf(view.container, 'Execution log')
    expect(within(section).getByRole('status').textContent)
      .toBe('The execution log is outside the loaded conversation history. Load more history to see it.')
    expect(section.textContent).toContain('stdout 12 bytes, stderr 3 bytes')
  })
})

describe('ScienceProvenanceView: conversation', () => {
  it('renders the request/turn facts and jumps to the transcript on demand', () => {
    const inspectCall = vi.fn()
    const view = render(<ScienceProvenanceView {...props(baseProjection(), { selected: { chartId: 'chart-1', version: 2 }, inspectCall })} />)
    const section = sectionOf(view.container, 'Conversation')
    expect(section.textContent).toContain('Request 7')
    within(section).getByRole('button', { name: 'Jump to transcript' }).click()
    expect(inspectCall).toHaveBeenCalledWith(CALL_ID)
  })
})

describe('ScienceProvenanceView: environment', () => {
  it('renders the environment JSON block when the run\'s revision is the current binding', () => {
    const view = render(<ScienceProvenanceView {...props(baseProjection(), { selected: { chartId: 'chart-1', version: 2 } })} />)
    const section = sectionOf(view.container, 'Environment')
    expect(within(section).queryByRole('status')).toBeNull()
    expect(section.textContent).toContain('"profileId"')
  })

  it('reports the environment as superseded when the projection retains only a later revision', () => {
    const science = baseProjection({
      environment: {
        revision: 2, profileId: 'science' as never, configuredAt: 0, validatedAt: 0, status: 'applied',
      },
    })
    const view = render(<ScienceProvenanceView {...props(science, { selected: { chartId: 'chart-1', version: 2 } })} />)
    const section = sectionOf(view.container, 'Environment')
    expect(within(section).getByRole('status').textContent)
      .toBe('Revision 1 (fingerprint ffffffffffff) is no longer the current environment binding; only the latest revision is retained.')
  })

  it('reports the environment as superseded when no environment binding exists at all', () => {
    const science = baseProjection({ environment: null })
    const view = render(<ScienceProvenanceView {...props(science, { selected: { chartId: 'chart-1', version: 2 } })} />)
    expect(within(sectionOf(view.container, 'Environment')).getByRole('status')).toBeTruthy()
  })
})
