// @vitest-environment jsdom
/**
 * The provenance drill-in: the breadcrumb (root segment jumps back to
 * content), the sub-tab strip (aria-selected, switching), and each of the
 * four sub-tabs both available and distinctly unavailable — including the
 * run-outside-loaded-window "pending history" states, where the durable
 * digest and byte counts still render — the running-log state, byte
 * truncation, the environment-superseded state for a revision the projection
 * no longer retains (including no binding at all), and the jump-to-transcript
 * action. Resolution (chart/run existing) is the caller's job; this
 * component always renders for an already-resolved pair.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { conversationContextKey } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConversationSnapshot, ToolCallBlock, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { ScienceClientArtifactVersion, ScienceClientEnvironmentBinding, ScienceClientRun } from '@deepseek-ai/dsh-science-session/types'
import type { ScienceProvenanceSubTab } from '../src/client/selection-store.ts'
import { ScienceArtifactProvenance, type ScienceArtifactProvenanceProps } from '../src/client/ScienceArtifactProvenance.tsx'
import { en } from '../src/client/locales.ts'

type Props = ScienceArtifactProvenanceProps
const CALL_ID = 'call-run-1'
const t: Props['t'] = makeTranslate(en)

afterEach(cleanup)

function chart(over: Partial<ScienceClientArtifactVersion> = {}): ScienceClientArtifactVersion {
  return {
    artifactId: 'chart-1' as never, logicalName: 'loss-curve', version: 2, title: 'Loss curve', origin: 'model',
    attachment: { attachmentId: 'sha256:abc' as never, mediaType: 'image/png', bytes: 10, width: 1, height: 1 },
    runId: 'run-1' as never, toolCallId: 'call-chart-1' as never, requestHeaderSeq: 8,
    environmentRevision: 1, environmentFingerprintPreview: 'f'.repeat(12), createdAt: 3_000,
    ...over,
  }
}

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

function environment(over: Partial<ScienceClientEnvironmentBinding> = {}): ScienceClientEnvironmentBinding {
  return {
    revision: 1, profileId: 'science' as never, configuredAt: 0, validatedAt: 0, status: 'applied',
    python: { language: 'python', capability: 'available' },
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

function props(over: {
  chart?: ScienceClientArtifactVersion
  run?: ScienceClientRun
  environment?: ScienceClientEnvironmentBinding | null | undefined
  block?: ToolCallBlock | undefined
  subTab?: ScienceProvenanceSubTab
  onSubTabChange?: (subTab: ScienceProvenanceSubTab) => void
  onBack?: () => void
  inspectCall?: (callId: string) => void
} = {}): Props {
  return {
    chart: over.chart ?? chart(),
    run: over.run ?? run(),
    environment: 'environment' in over ? over.environment : environment(),
    snapshot: snapshotWith(over.block),
    subTab: over.subTab ?? 'code',
    onSubTabChange: over.onSubTabChange ?? vi.fn(),
    onBack: over.onBack ?? vi.fn(),
    inspectCall: over.inspectCall ?? vi.fn(),
    t,
  }
}

describe('ScienceArtifactProvenance: breadcrumb', () => {
  it('shows the chart title and "Provenance", and the root segment jumps back to content', () => {
    const onBack = vi.fn()
    render(<ScienceArtifactProvenance {...props({ onBack })} />)
    const breadcrumb = screen.getByRole('navigation', { name: 'Provenance' })
    expect(within(breadcrumb).getByText('Loss curve')).toBeTruthy()
    expect(within(breadcrumb).getByText('Provenance')).toBeTruthy()
    within(breadcrumb).getByRole('button', { name: 'Loss curve' }).click()
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})

describe('ScienceArtifactProvenance: sub-tab strip', () => {
  it('renders all four sub-tabs and marks the active one selected', () => {
    render(<ScienceArtifactProvenance {...props({ subTab: 'log' })} />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map(tab => tab.textContent)).toEqual(['Code', 'Execution log', 'Messages', 'Environment'])
    expect(screen.getByRole('tab', { name: 'Execution log' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'Code' }).getAttribute('aria-selected')).toBe('false')
  })

  it('clicking a sub-tab reports the id through onSubTabChange', () => {
    const onSubTabChange = vi.fn()
    render(<ScienceArtifactProvenance {...props({ onSubTabChange })} />)
    screen.getByRole('tab', { name: 'Environment' }).click()
    expect(onSubTabChange).toHaveBeenCalledWith('environment')
  })

  it('renders exactly one sub-tab section body at a time', () => {
    const view = render(<ScienceArtifactProvenance {...props({ subTab: 'code' })} />)
    expect(view.container.querySelectorAll('section')).toHaveLength(1)
  })
})

describe('ScienceArtifactProvenance: code', () => {
  it('renders the code and its durable digest anchor when the call head is loaded', () => {
    const block = settledInWindow('{"code":"print(1)"}', 'ok')
    const view = render(<ScienceArtifactProvenance {...props({ subTab: 'code', block })} />)
    expect(view.container.textContent).toContain(`SHA-256 ${'c'.repeat(64)}`)
    expect(view.container.textContent).toContain('print(1)')
    expect(view.queryByRole('status')).toBeNull()
  })

  it('renders pending-history when the call is outside the loaded window, with the digest still visible', () => {
    const view = render(<ScienceArtifactProvenance {...props({ subTab: 'code', block: undefined })} />)
    expect(view.getByRole('status').textContent).toBe('The code is outside the loaded conversation history. Load more history to see it.')
    expect(view.container.textContent).toContain(`SHA-256 ${'c'.repeat(64)}`)
  })

  it('renders pending-history when the settled result stayed in-window but the call head did not', () => {
    const block = settledCallOutOfWindow('output')
    const view = render(<ScienceArtifactProvenance {...props({ subTab: 'code', block })} />)
    expect(view.getByRole('status')).toBeTruthy()
  })

  it('renders the code from a still-running call\'s own argsRaw', () => {
    const block: ToolCallBlock = {
      callId: CALL_ID, name: 'run_python', argsRaw: '{"code":"print(2)"}',
      turn: 1, step: 1, time: 3_000, callView: null, subCalls: [],
    }
    const view = render(<ScienceArtifactProvenance {...props({ subTab: 'code', run: run({ status: 'running' }), block })} />)
    expect(view.container.textContent).toContain('print(2)')
  })

  it('reports code as absent when the argsRaw is not valid JSON or carries no code field', () => {
    const block = settledInWindow('not-json', 'output')
    const view = render(<ScienceArtifactProvenance {...props({ subTab: 'code', block })} />)
    expect(view.getByRole('status')).toBeTruthy()
  })
})

describe('ScienceArtifactProvenance: execution log', () => {
  it('renders the log text plus the projection\'s durable byte counts', () => {
    const block = settledInWindow('{"code":"x"}', 'hello stdout')
    const view = render(<ScienceArtifactProvenance {...props({ subTab: 'log', block })} />)
    expect(view.container.textContent).toContain('stdout 12 bytes, stderr 3 bytes')
    expect(view.container.textContent).toContain('hello stdout')
    expect(view.queryByRole('status')).toBeNull()
  })

  it('renders a non-text result content block as formatted JSON', () => {
    const block: ToolResultNode = {
      kind: 'tool-result', seq: 4, time: 4_000, callId: CALL_ID,
      call: { name: 'run_python', argsRaw: '{"code":"x"}' }, callTime: 3_500,
      content: [{ type: 'reasoning', text: 'note' }],
      isError: false, callView: null, resultView: null, subCalls: [],
    }
    const view = render(<ScienceArtifactProvenance {...props({ subTab: 'log', block })} />)
    expect(view.container.textContent).toContain('"type": "reasoning"')
  })

  it('flags truncation alongside the byte counts', () => {
    const block = settledInWindow('{"code":"x"}', 'hello')
    const view = render(<ScienceArtifactProvenance {...props({ subTab: 'log', run: run({ stdoutTruncated: true }), block })} />)
    expect(view.container.textContent).toContain('(truncated)')
  })

  it('reports the run as still in progress for a running run, with no byte counts (none exist yet)', () => {
    const view = render(<ScienceArtifactProvenance {...props({
      subTab: 'log',
      run: run({ status: 'running', finishedAt: undefined, stdoutBytes: undefined, stderrBytes: undefined, stdoutTruncated: undefined, stderrTruncated: undefined } as never),
      block: undefined,
    })} />)
    expect(view.getByRole('status').textContent).toBe('The run is still in progress.')
    expect(view.container.textContent).not.toContain('bytes')
  })

  it('renders pending-history for the log when the run is outside the loaded window, with durable byte counts still visible', () => {
    const view = render(<ScienceArtifactProvenance {...props({ subTab: 'log', block: undefined })} />)
    expect(view.getByRole('status').textContent)
      .toBe('The execution log is outside the loaded conversation history. Load more history to see it.')
    expect(view.container.textContent).toContain('stdout 12 bytes, stderr 3 bytes')
  })
})

describe('ScienceArtifactProvenance: messages', () => {
  it('renders the request/turn facts and jumps to the transcript on demand', () => {
    const inspectCall = vi.fn()
    const view = render(<ScienceArtifactProvenance {...props({ subTab: 'messages', inspectCall })} />)
    expect(view.container.textContent).toContain('Request 7')
    view.getByRole('button', { name: 'Jump to transcript' }).click()
    expect(inspectCall).toHaveBeenCalledWith(CALL_ID)
  })
})

describe('ScienceArtifactProvenance: environment', () => {
  it('renders the environment JSON block when the run\'s revision is the current binding', () => {
    const view = render(<ScienceArtifactProvenance {...props({ subTab: 'environment' })} />)
    expect(view.container.textContent).toContain('"profileId"')
    expect(view.queryByRole('status')).toBeNull()
  })

  it('reports the environment as superseded when the projection retains only a later revision', () => {
    const view = render(<ScienceArtifactProvenance {...props({
      subTab: 'environment', environment: environment({ revision: 2 }),
    })} />)
    expect(view.getByRole('status').textContent)
      .toBe('Revision 1 (fingerprint ffffffffffff) is no longer the current environment binding; only the latest revision is retained.')
  })

  it('reports the environment as superseded when no environment binding exists at all', () => {
    const view = render(<ScienceArtifactProvenance {...props({ subTab: 'environment', environment: null })} />)
    expect(view.getByRole('status')).toBeTruthy()
  })
})
