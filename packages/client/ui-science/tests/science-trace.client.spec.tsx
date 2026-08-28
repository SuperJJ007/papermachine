// @vitest-environment jsdom
/** Semantic Science trace grouping and actor-owned presentation. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConversationNode, ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { ScienceArtifactId, ScienceRunId } from '@deepseek-ai/dsh-science-session'
import type { ScienceClientProjection, ScienceClientRun } from '@deepseek-ai/dsh-science-session/types'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { en } from '../src/client/locales.ts'
import {
  formatScienceTraceDuration, scienceTraceGroupTitle, ScienceTraceView, type ScienceTraceViewProps,
} from '../src/client/ScienceTraceView.tsx'
import type { ScienceTraceGroup } from '../src/client/science-trace-model.ts'
import { buildScienceTraceModel } from '../src/client/science-trace-model.ts'

const translate = (key: keyof typeof en, params?: Record<string, unknown>): string => {
  let text: string = en[key]
  for (const [name, value] of Object.entries(params ?? {})) text = text.replace(`{${name}}`, String(value))
  return text
}
const t = translate as TranslateNS<'science'>
afterEach(cleanup)

function assistant(turn: number, seq: number, calls: readonly string[], text = ''): ConversationNode {
  return {
    kind: 'assistant', turn, step: 1, seq, time: turn * 10_000 + 5_000,
    blocks: [
      ...calls.map(callId => ({
        kind: 'tool-call' as const, callId,
        name: callId.startsWith('subagent') ? 'subagent' : callId.startsWith('misc') ? 'read' : 'run_python',
        argsRaw: '{}',
      })),
      ...(text === '' ? [] : [{ kind: 'text' as const, text }]),
    ],
  }
}

function run(
  callId: string,
  index: number,
  status: 'running' | 'success' | 'failed' | 'timed-out' | 'cancelled' = 'success',
): ScienceClientRun {
  const base = {
    runId: ScienceRunId(`run-${String(index)}`), language: 'python' as const, toolCallId: callId as never,
    requestHeaderSeq: index, environmentRevision: 1, environmentFingerprintPreview: 'abc',
    startedAt: index * 1_000, codeSha256: 'a'.repeat(64), kernelEpoch: 1,
  }
  return status === 'running' ? { ...base, status } : {
    ...base, status, finishedAt: index * 1_000 + 500, stdoutBytes: 0, stderrBytes: 0,
    stdoutTruncated: false, stderrTruncated: false,
  }
}

function fixture() {
  const calls = Array.from({ length: 8 }, (_, index) => `attempt-${String(index + 1)}`)
  const nodes: ConversationNode[] = [
    { kind: 'user', seq: 1, time: 1_000, source: { kind: 'user' }, content: [{ type: 'text', text: 'Build the chart' }] },
    assistant(1, 9, [], 'Intermediate narration that must not become a conclusion card.'),
    assistant(1, 10, calls, 'The chart is ready.'),
    { kind: 'user', seq: 11, time: 11_000, source: { kind: 'science-edit' },
      content: [{ type: 'text', text: 'Change the selected axis' }] },
    assistant(2, 20, ['repair-1', 'repair-2', 'misc-read', 'subagent-child'], 'I corrected the failed attempt.'),
    { kind: 'steering', seq: 21, time: 21_000, messageId: 'm1' as never, source: { kind: 'user' },
      content: [{ type: 'text', text: 'Keep the labels concise' }] },
  ]
  const science = {
    mode: { preset: 'science' }, environment: {
      revision: 1, profileId: 'science', configuredAt: 1, validatedAt: 2, status: 'ready',
      python: { language: 'python', capability: 'supported' },
    }, kernels: [{ kernelEpoch: 1, language: 'python', state: 'started', environmentRevision: 1,
      environmentFingerprintPreview: 'abc', at: 1 }], outcome: null, lastScienceEventSeq: 50,
    runs: [...calls.map((callId, index) => run(callId, index + 1)), run('repair-1', 9, 'failed'), run('repair-2', 10)],
    artifacts: [
      { artifactId: ScienceArtifactId('chart-1'), logicalName: 'chart.png', version: 1, title: 'Chart',
        attachment: { kind: 'image', attachmentId: 'a1', mediaType: 'image/png' },
        environmentRevision: 1, environmentFingerprintPreview: 'abc', createdAt: 9_000,
        origin: 'model', runId: ScienceRunId('run-8'), toolCallId: 'attempt-8', requestHeaderSeq: 8 },
      { artifactId: ScienceArtifactId('chart-1'), logicalName: 'chart.png', version: 1, title: 'Curated chart',
        attachment: { kind: 'image', attachmentId: 'a1', mediaType: 'image/png' },
        environmentRevision: 1, environmentFingerprintPreview: 'abc', createdAt: 9_500,
        origin: 'model', runId: ScienceRunId('run-8'), toolCallId: 'attempt-8', requestHeaderSeq: 8 },
      { artifactId: ScienceArtifactId('chart-1'), logicalName: 'chart.png', version: 2, title: 'Chart',
        parent: { artifactId: ScienceArtifactId('chart-1'), version: 1 },
        attachment: { kind: 'image', attachmentId: 'a2', mediaType: 'image/png' },
        environmentRevision: 1, environmentFingerprintPreview: 'abc', createdAt: 19_000,
        origin: 'model', runId: ScienceRunId('run-10'), toolCallId: 'repair-2', requestHeaderSeq: 10 },
      { artifactId: ScienceArtifactId('chart-1'), logicalName: 'chart.png', version: 3, title: 'Chart',
        parent: { artifactId: ScienceArtifactId('chart-1'), version: 2 },
        attachment: { kind: 'image', attachmentId: 'a3', mediaType: 'image/png' },
        environmentRevision: 1, environmentFingerprintPreview: 'abc', createdAt: 19_500, origin: 'human-edit' },
    ],
    metrics: { runCount: 10, successfulRunCount: 9, artifactCount: 1, artifactVersionCount: 3, kernelCount: 0,
      outcomeRevision: 0 },
  } as unknown as ScienceClientProjection
  const turnTimes = new Map([
    [1, { startTime: 0, endTime: 10_000 }],
    [2, { startTime: 10_001, endTime: 20_000 }],
  ])
  return { nodes, science, turnTimes }
}

describe('Science semantic trace', () => {
  it('formats every structured title and duration without reading model prose', () => {
    const base = { turn: 1, runs: [], artifacts: [], failedCount: 0, miscToolCount: 0,
      delegatedCallIds: [], anchor: 'turn:1' } as const
    const title = (value: ScienceTraceGroup['title']) => scienceTraceGroupTitle({ ...base, title: value }, t)
    expect(title({ kind: 'selected-edit', name: 'plot.json' })).toBe('Edit plot.json from your selection')
    expect(title({ kind: 'edit', name: 'plot.json', version: 2 })).toBe('Edit plot.json (from v2)')
    expect(title({ kind: 'generate', name: 'plot.json', count: 1 })).toBe('Generate plot.json')
    expect(title({ kind: 'generate', name: 'plot.json', count: 2 })).toBe('Generate plot.json and 2 items')
    expect(title({ kind: 'curate', name: 'plot.json', artifactTitle: 'Result' })).toBe('Curate plot.json (title: Result)')
    expect(title({ kind: 'run', language: 'python' })).toBe('Run python code')
    expect(title({ kind: 'browse' })).toBe('Review sources')
    expect(formatScienceTraceDuration(undefined, t)).toBe('running')
    expect(formatScienceTraceDuration(500, t)).toBe('500 ms')
    expect(formatScienceTraceDuration(1_500, t)).toBe('1.5 s')
  })

  it('groups eight attempts, keeps steering in the current turn, exposes failure, and attributes human edits to the user', () => {
    const { nodes, science, turnTimes } = fixture()
    const model = buildScienceTraceModel(nodes, science, turnTimes)
    expect(model.turns).toEqual([1, 2])
    expect(model.groups).toHaveLength(2)
    expect(model.groups[0]?.runs).toHaveLength(8)
    expect(model.dialogues.some(item => item.text === 'The chart is ready.')).toBe(false)
    expect(model.groups[0]?.title).toEqual({ kind: 'generate', name: 'chart.png', count: 2 })
    expect(model.groups[0]?.artifacts.map(item => item.action)).toEqual(['created', 'curated'])
    expect(model.groups[1]?.failedCount).toBe(1)
    expect(model.groups[1]).toMatchObject({ miscToolCount: 1, delegatedCallIds: ['subagent-child'] })
    expect(model.groups[1]?.title).toEqual({ kind: 'selected-edit', name: 'chart.png' })
    expect(model.humanEdits).toMatchObject([{ actor: 'user', turn: 2, anchor: 'artifact:chart-1@3' }])
    expect(model.dialogues.find(item => item.seq === 21)?.turn).toBe(2)
  })

  it('classifies run-only, browse-only, agent-edit, running, and history-fallback groups', () => {
    const nodes = [
      { kind: 'user', seq: 1, time: 1, source: null, content: [{ type: 'text', text: '' }] },
      { kind: 'user', seq: 2, time: 2, source: { kind: 1 },
        content: [{ type: 'image', attachment: {} as never }, { type: 'text', text: 'Check environment' }] },
      assistant(1, 3, ['run-only']),
      { kind: 'user', seq: 4, time: 4, source: null, content: [{ type: 'text', text: 'Inspect files' }] },
      assistant(2, 5, ['misc-files']),
      { kind: 'steering', seq: 6, time: 6, messageId: 'empty' as never, source: null, content: [] },
      { kind: 'user', seq: 7, time: 7, source: { kind: 'user' }, content: [{ type: 'text', text: 'Revise chart' }] },
      assistant(3, 8, ['edit-run']),
      { kind: 'context', seq: 9, time: 9, source: null, content: [], provenance: {} as never, form: null },
      { kind: 'user', seq: 10, time: 10, source: { kind: 'user' }, content: [{ type: 'text', text: 'Delegate' }] },
      assistant(4, 11, ['subagent-only']),
      { kind: 'user', seq: 12, time: 12, source: { kind: 'user' }, content: [{ type: 'text', text: 'Continue' }] },
      assistant(5, 13, []),
    ] as ConversationNode[]
    const science = {
      mode: {}, environment: { revision: 1, profileId: 'science', configuredAt: 1, validatedAt: 1,
        status: 'ready', r: { language: 'r', capability: 'supported' } },
      kernels: [], outcome: null, lastScienceEventSeq: 9,
      runs: [run('run-only', 1, 'running'), run('edit-run', 2), run('outside-run', 3)],
      artifacts: [
        { artifactId: ScienceArtifactId('plot'), logicalName: 'plot.json', version: 2, title: 'Plot',
          parent: { artifactId: ScienceArtifactId('plot'), version: 1 }, attachment: {} as never,
          environmentRevision: 1, environmentFingerprintPreview: 'abc', createdAt: 8,
          origin: 'model', runId: ScienceRunId('run-2'), toolCallId: 'edit-run', requestHeaderSeq: 2 },
        { artifactId: ScienceArtifactId('orphan'), logicalName: 'orphan.csv', version: 1, title: 'Orphan',
          attachment: {} as never, environmentRevision: 1, environmentFingerprintPreview: 'abc', createdAt: 8,
          origin: 'model', runId: ScienceRunId('run-3'), toolCallId: 'outside', requestHeaderSeq: 3 },
        { artifactId: ScienceArtifactId('plot'), logicalName: 'plot.json', version: 3, title: 'Plot',
          parent: { artifactId: ScienceArtifactId('plot'), version: 2 }, attachment: {} as never,
          environmentRevision: 1, environmentFingerprintPreview: 'abc', createdAt: 99,
          origin: 'human-edit' },
        { artifactId: ScienceArtifactId('plot'), logicalName: 'plot.json', version: 4, title: 'Plot',
          parent: { artifactId: ScienceArtifactId('plot'), version: 3 }, attachment: {} as never,
          environmentRevision: 1, environmentFingerprintPreview: 'abc', createdAt: 50,
          origin: 'human-edit' },
      ],
      metrics: {},
    } as unknown as ScienceClientProjection
    const model = buildScienceTraceModel(nodes, science, new Map([[5, { startTime: 90 }]]))
    expect(model.environment?.languages).toEqual(['R'])
    expect(model.groups.map(group => group.title)).toEqual([
      { kind: 'run', language: 'python' },
      { kind: 'browse' },
      { kind: 'edit', name: 'plot.json', version: 1 },
      { kind: 'browse' },
      { kind: 'generate', name: 'orphan.csv', count: 1 },
    ])
    expect(model.groups[0]?.durationMs).toBeUndefined()
    expect(model.humanEdits.map(item => item.turn)).toEqual([5, 5])
  })

  it('classifies a later same-version save as curation', () => {
    const nodes = [
      { kind: 'user', seq: 1, time: 1, source: { kind: 'user' }, content: [{ type: 'text', text: 'Create' }] },
      assistant(1, 2, ['create']),
      { kind: 'user', seq: 3, time: 3, source: { kind: 'user' }, content: [{ type: 'text', text: 'Curate' }] },
      assistant(2, 4, ['curate']),
    ] as ConversationNode[]
    const artifact = {
      artifactId: ScienceArtifactId('plot'), logicalName: 'plot.json', version: 1, title: 'Plot',
      attachment: {} as never, environmentRevision: 1, environmentFingerprintPreview: 'abc', createdAt: 2,
      origin: 'model' as const, runId: ScienceRunId('run-1'), requestHeaderSeq: 1,
    }
    const science = {
      mode: {}, environment: null, kernels: [], outcome: null, lastScienceEventSeq: 4, runs: [],
      artifacts: [{ ...artifact, toolCallId: 'create' }, { ...artifact, title: 'Curated', toolCallId: 'curate' }], metrics: {},
    } as unknown as ScienceClientProjection
    expect(buildScienceTraceModel(nodes, science, new Map()).groups.map(group => group.title)).toEqual([
      { kind: 'generate', name: 'plot.json', count: 1 },
      { kind: 'curate', name: 'plot.json', artifactTitle: 'Curated' },
    ])
  })

  it('renders three-line fact cards and routes run and artifact anchors without repeating answers', () => {
    const { nodes, science, turnTimes } = fixture()
    const inspectCall = vi.fn()
    const openArtifact = vi.fn()
    const selectDetailed = vi.fn()
    const openTab = vi.fn()
    const snapshot = { nodes, turnTimings: turnTimes } as unknown as ConversationSnapshot
    render(<ScienceTraceView {...({
      useSession: (select: (value: ConversationSnapshot) => unknown) => select(snapshot),
      useProjection: () => science,
      inspectCall, actions: { openTab }, openArtifact, selectDetailed, t,
    } as unknown as ScienceTraceViewProps)} />)

    expect(document.querySelectorAll('[data-line-budget="3"]')).toHaveLength(2)
    expect(screen.queryByText(/Intermediate narration/)).toBeNull()
    expect(screen.queryByText('The chart is ready.')).toBeNull()
    const failed = screen.getByRole('button', { name: /python ×2.*1 failed/u })
    fireEvent.click(failed)
    expect(selectDetailed).toHaveBeenCalledTimes(1)
    expect(inspectCall).toHaveBeenCalledWith('repair-1')
    const chip = screen.getByRole('button', { name: /chart.png v2/ })
    expect(chip.getAttribute('data-anchor')).toBe('artifact:chart-1@2')
    fireEvent.click(chip)
    expect(openTab).toHaveBeenCalledWith({ artifactId: ScienceArtifactId('chart-1'), version: 2 })
    expect(openArtifact).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Open artifact' }))
    expect(openTab).toHaveBeenCalledWith({ artifactId: ScienceArtifactId('chart-1'), version: 3 })
  })

  it('shows the no-runs and no-artifacts fallbacks, and skips the group card for a human-edit-only turn', () => {
    const nodes = [
      { kind: 'user', seq: 1, time: 1, source: { kind: 'user' }, content: [{ type: 'text', text: 'First' }] },
      assistant(1, 2, ['run-a']),
      { kind: 'user', seq: 3, time: 3, source: { kind: 'user' }, content: [{ type: 'text', text: 'Second' }] },
      assistant(2, 4, ['subagent-a']),
      { kind: 'user', seq: 5, time: 5, source: { kind: 'user' }, content: [{ type: 'text', text: 'Third' }] },
    ] as ConversationNode[]
    const science = {
      mode: {}, environment: null, kernels: [], outcome: null, lastScienceEventSeq: 5,
      runs: [run('run-a', 1)],
      artifacts: [
        { artifactId: ScienceArtifactId('note'), logicalName: 'note.md', version: 2, title: 'Note',
          parent: { artifactId: ScienceArtifactId('note'), version: 1 }, attachment: {} as never,
          environmentRevision: 1, environmentFingerprintPreview: 'abc', createdAt: 25, origin: 'human-edit' },
      ],
      metrics: {},
    } as unknown as ScienceClientProjection
    const turnTimes = new Map([
      [1, { startTime: 0, endTime: 10 }], [2, { startTime: 11, endTime: 20 }], [3, { startTime: 21, endTime: 30 }],
    ])
    const snapshot = { nodes, turnTimings: turnTimes } as unknown as ConversationSnapshot
    render(<ScienceTraceView {...({
      useSession: (select: (value: ConversationSnapshot) => unknown) => select(snapshot),
      useProjection: () => science,
      inspectCall: vi.fn(), actions: { openTab: vi.fn() }, openArtifact: vi.fn(), selectDetailed: vi.fn(), t,
    } as unknown as ScienceTraceViewProps)} />)

    // Turn 3 published only a human edit: no card renders for it, but its
    // human-edit node still does (reusing the already-covered node render).
    expect(document.querySelectorAll('[data-line-budget="3"]')).toHaveLength(2)
    expect(screen.getByText(/directly edited note\.md/u)).toBeTruthy()
    // Turn 1 ran code but produced no artifact.
    expect(screen.getAllByText('No produced files').length).toBeGreaterThan(0)
    // Turn 2 delegated to a subagent with no run of its own: the facts button
    // is disabled and falls back to the no-runs label.
    const noRuns = screen.getByRole('button', { name: 'No code runs' })
    expect(noRuns.hasAttribute('disabled')).toBe(true)
  })

  it('falls back to a request-unavailable label when no dialogue precedes the group\'s turn', () => {
    const nodes = [assistant(1, 1, ['run-a'])] as ConversationNode[]
    const science = {
      mode: {}, environment: null, kernels: [], outcome: null, lastScienceEventSeq: 1,
      runs: [run('run-a', 1)], artifacts: [], metrics: {},
    } as unknown as ScienceClientProjection
    const snapshot = { nodes, turnTimings: new Map() } as unknown as ConversationSnapshot
    render(<ScienceTraceView {...({
      useSession: (select: (value: ConversationSnapshot) => unknown) => select(snapshot),
      useProjection: () => science,
      inspectCall: vi.fn(), actions: { openTab: vi.fn() }, openArtifact: vi.fn(), selectDetailed: vi.fn(), t,
    } as unknown as ScienceTraceViewProps)} />)

    expect(screen.getByText('Request unavailable for this turn')).toBeTruthy()
  })

  it('renders the empty projection state', () => {
    const snapshot = { nodes: [], turnTimings: new Map() } as unknown as ConversationSnapshot
    render(<ScienceTraceView {...({
      useSession: (select: (value: ConversationSnapshot) => unknown) => select(snapshot),
      useProjection: () => null, t,
    } as unknown as ScienceTraceViewProps)} />)
    expect(screen.getByText(/Intent groups will appear/)).toBeTruthy()
  })

  it('never renders a direct assistant conclusion in the trace', () => {
    const nodes = [
      { kind: 'user', seq: 1, time: 1, source: { kind: 'user' }, content: [{ type: 'text', text: 'Answer directly' }] },
      assistant(1, 2, [], 'Direct conclusion'),
    ] as ConversationNode[]
    const snapshot = { nodes, turnTimings: new Map() } as unknown as ConversationSnapshot
    render(<ScienceTraceView {...({
      useSession: (select: (value: ConversationSnapshot) => unknown) => select(snapshot),
      useProjection: () => ({ ...fixture().science, runs: [], artifacts: [] }), t,
    } as unknown as ScienceTraceViewProps)} />)
    expect(screen.queryByText('Direct conclusion')).toBeNull()
    expect(document.querySelector('[data-kind="dialogue"]')).toBeNull()
  })
})
