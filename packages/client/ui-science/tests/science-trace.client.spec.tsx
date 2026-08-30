// @vitest-environment jsdom
/** Science process projection, disclosure, and navigation. */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationNode, ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { ScienceArtifactId, ScienceRunId } from '@deepseek-ai/dsh-science-session'
import type { ScienceClientProjection, ScienceClientRun } from '@deepseek-ai/dsh-science-session/types'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { en } from '../src/client/locales.ts'
import {
  formatScienceTraceDuration, scienceTraceStepTitle, scienceTraceStepStatus, ScienceTraceView, type ScienceTraceViewProps,
} from '../src/client/ScienceTraceView.tsx'
import type { ScienceTraceStepTitle } from '../src/client/science-trace-model.ts'
import { buildScienceTraceModel, scienceTracePips } from '../src/client/science-trace-model.ts'

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

type Tool = { name: string; argsRaw?: string; callId?: string }
function step(seq: number, number: number, tools: readonly Tool[], turn = 1): ConversationNode {
  return { kind: 'assistant', seq, time: seq, turn, step: number,
    blocks: tools.map((tool, index) => ({ kind: 'tool-call', name: tool.name,
      callId: tool.callId ?? `call-${String(seq)}-${String(index)}`, argsRaw: tool.argsRaw ?? '{}' })) }
}
function result(callId: string, isError: boolean): ConversationNode {
  return { kind: 'tool-result', seq: 99, time: 99, callId, isError, content: [],
    call: null, callTime: null, callView: null, resultView: null, subCalls: [] }
}
function projection(patch: Partial<ScienceClientProjection> = {}): ScienceClientProjection {
  return { ...fixture().science, environment: null, runs: [], artifacts: [], kernels: [], ...patch }
}
function build(nodes: readonly ConversationNode[], patch: Partial<ScienceClientProjection> = {},
  times: ReadonlyMap<number, { startTime: number; endTime?: number }> = new Map()) {
  return buildScienceTraceModel(nodes, projection(patch), times)
}
function mount(nodes: readonly ConversationNode[], science: ScienceClientProjection | null | undefined = projection(),
  turnTimings: ReadonlyMap<number, { startTime: number; endTime?: number }> = new Map()) {
  const inspectCall = vi.fn(), openArtifact = vi.fn(), selectDetailed = vi.fn(), openTab = vi.fn()
  const snapshot = { nodes, turnTimings } as unknown as ConversationSnapshot
  const rendered = render(<ScienceTraceView {...({
    useSession: (select: (value: ConversationSnapshot) => unknown) => select(snapshot),
    useProjection: () => science, inspectCall, actions: { openTab }, openArtifact, selectDetailed, t,
  } as unknown as ScienceTraceViewProps)} />)
  return { ...rendered, inspectCall, openArtifact, selectDetailed, openTab }
}
const scroll = vi.fn()
beforeEach(() => { Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: scroll }); scroll.mockClear() })

const tools = [
  ['run_python', '{}', 'run', { kind: 'run', language: 'python' }],
  ['run_r', '{}', 'run', { kind: 'run', language: 'r' }],
  ['read', '{"file_path":"/Users/private/input.csv"}', 'browse', { kind: 'read', name: 'input.csv' }],
  ['read_image', JSON.stringify({ file_path: 'C:\\Users\\private\\plot.png' }), 'browse', { kind: 'read-image', name: 'plot.png' }],
  ['glob', '{"pattern":"**/*.csv"}', 'browse', { kind: 'glob', pattern: '**/*.csv' }],
  ['grep', '{"pattern":"accuracy"}', 'browse', { kind: 'grep', pattern: 'accuracy' }],
  ['get_science_state', '{}', 'browse', { kind: 'state' }],
  ['annotate_artifact', '{"logical_name":"/private/plot.png","version":1,"title":"Plot"}', 'curate',
    { kind: 'annotate', name: 'plot.png', version: 1, title: 'Plot' }],
  ['publish_outcome', '{"title":"Result"}', 'publish', { kind: 'publish', title: 'Result' }],
  ['subagent_task', '{}', 'delegate', { kind: 'delegate' }],
  ['todo_write', '{}', 'other', { kind: 'tool', name: 'todo_write' }],
] as const

describe('Science process model', () => {
  it.each(tools)('classifies %s from structured arguments', (name, argsRaw, kind, title) => {
    expect(build([step(1, 1, [{ name, argsRaw }])]).groups[0]?.steps[0]).toMatchObject({ kind, title })
  })
  it.each([
    ['read', '{'], ['read', 'null'], ['read', '[]'], ['read', '1'], ['read', '{}'], ['read', '{"file_path":1}'],
    ['glob', '{}'], ['grep', '{"pattern":false}'], ['annotate_artifact', '{}'],
    ['annotate_artifact', '{"logical_name":"x","version":"1","title":"x"}'],
    ['annotate_artifact', '{"logical_name":"x","version":1,"title":false}'], ['publish_outcome', '{}'],
    ['publish_outcome', '{"title":2}'],
  ])('keeps the tool name for malformed %s arguments %s', (name, argsRaw) => {
    expect(build([step(1, 1, [{ name, argsRaw }])]).groups[0]?.steps[0]?.title).toEqual({ kind: 'tool', name })
  })
  it('strips absolute paths and bounds structured titles at forty characters', () => {
    for (const name of ['glob', 'grep']) {
      const model = build([step(1, 1, [{ name, argsRaw: JSON.stringify({ pattern: '/Users/private/*.csv' }) }])])
      expect(model.groups[0]?.steps[0]?.title).toEqual({ kind: name, pattern: '*.csv' })
    }
    for (const title of ['x'.repeat(40), 'x'.repeat(41)]) {
      const expected = title.length === 40 ? title : `${'x'.repeat(40)}…`
      for (const name of ['annotate_artifact', 'publish_outcome']) {
        const model = build([step(1, 1, [{ name, argsRaw: JSON.stringify({ title, logical_name: 'plot.png', version: 1 }) }])])
        expect(model.groups[0]?.steps[0]?.title).toMatchObject({ title: expected })
      }
    }
  })
  it('orders calls by seq, shares parallel step numbers, and counts answer-only steps', () => {
    const model = build([step(20, 2, [{ name: 'run_python' }]), step(10, 1, [{ name: 'run_r' }, { name: 'run_python' }]), step(30, 3, [])])
    expect(model.groups[0]?.steps.map(row => [row.step, row.members[0]?.callId])).toEqual([
      [1, 'call-10-0'], [1, 'call-10-1'], [2, 'call-20-0'],
    ])
    expect(model.groups[0]?.stepCount).toBe(3)
  })
  it('merges only consecutive successful browse calls within a turn, preserving each pip destination', () => {
    const model = build([
      step(1, 1, [{ name: 'read', argsRaw: '{"file_path":"a"}' }, { name: 'read', argsRaw: '{"file_path":"b"}' }]),
      step(2, 2, [{ name: 'get_science_state' }]),
      step(3, 3, [{ name: 'run_python' }, { name: 'annotate_artifact' }, { name: 'publish_outcome' }, { name: 'subagent' }]),
      step(4, 4, [{ name: 'read', callId: 'failure' }, { name: 'get_science_state' }]), result('failure', true),
      step(5, 1, [{ name: 'get_science_state' }], 2),
    ])
    const group = model.groups[0]!
    expect(group.steps.map(row => row.title.kind)).toEqual(['browse-many', 'run', 'tool', 'tool', 'delegate', 'tool', 'state'])
    expect(group.steps[0]).toMatchObject({ step: 1, title: { kind: 'browse-many', count: 3 } })
    expect(scienceTracePips(group).map(pip => pip.rowIndex)).toEqual([0, 0, 0, 1, 2, 3, 4, 5, 6])
    expect(scienceTracePips(group)[1]?.title).toEqual({ kind: 'read', name: 'b' })
    expect(model.groups[1]?.steps).toHaveLength(1)
  })
  it.each(['running', 'success', 'failed', 'timed-out', 'cancelled'] as const)('uses authoritative run %s over the result error flag', (status) => {
    const model = build([step(1, 1, [{ name: 'run_python', callId: 'r' }]), result('r', true)], { runs: [run('r', 1, status)] })
    expect(model.groups[0]?.steps[0]).toMatchObject({ runStatus: status, failed: status !== 'running' && status !== 'success',
      durationMs: status === 'running' ? undefined : 500 })
  })
  it('uses run language and interruption facts, and treats missing results as unknown', () => {
    const interrupted = { ...run('r', 1), language: 'r', status: 'interrupted', finishedAt: 900, interruptedAtSeq: 5 } as ScienceClientRun
    const model = build([step(1, 1, [{ name: 'run_python', callId: 'r' }, { name: 'todo_write' }]), result('r', false)], { runs: [interrupted] })
    expect(model.groups[0]?.steps[0]).toMatchObject({ title: { language: 'r' }, failed: true, durationMs: 0, runStatus: 'interrupted' })
    expect(model.groups[0]?.steps[1]?.failed).toBe(false)
  })
  it('attaches artifact deltas to calls and keeps direct edits on the user side', () => {
    const { nodes, science, turnTimes } = fixture()
    const model = buildScienceTraceModel(nodes, science, turnTimes)
    expect(model.groups[0]?.steps[7]?.artifacts.map(item => item.action)).toEqual(['created', 'curated'])
    expect(model.groups[1]?.steps[1]?.artifacts[0]).toMatchObject({ action: 'advanced', parentVersion: 1 })
    expect(model.groups[1]?.failedCount).toBe(1)
    expect(model.groups.flatMap(group => group.steps.flatMap(row => row.artifacts)).map(item => item.version)).not.toContain(3)
    expect(model.humanEdits).toMatchObject([{ actor: 'user', turn: 2, anchor: 'artifact:chart-1@3' }])
    expect(model.dialogues.find(item => item.seq === 21)?.turn).toBe(2)
    expect(model.environment?.languages).toEqual(['Python'])
  })
  it('retains orphan artifacts, assigns out-of-turn edits to the last turn, and tolerates empty dialogue', () => {
    const human = fixture().science.artifacts[3]!
    const orphan = fixture().science.artifacts[0]!
    const nodes = [
      { kind: 'user', seq: 1, time: 0, source: null, content: [{ type: 'image', attachment: {} as never }] },
      { kind: 'steering', seq: 2, time: 1, messageId: 'm' as never, source: null, content: [] },
      { kind: 'steering', seq: 3, time: 2, messageId: 'm2' as never, source: null, content: [{ type: 'text', text: 'First' }] },
      step(4, 1, [], 2),
    ] as ConversationNode[]
    const model = build(nodes, { artifacts: [orphan, human], runs: [run('unseen', 1)] }, new Map([[2, { startTime: 30_000 }]]))
    expect(model.groups[0]).toMatchObject({ turn: 2, stepCount: 1, durationMs: 500, steps: [] })
    expect(model.humanEdits[0]?.turn).toBe(2)
    expect(model.dialogues[0]?.turn).toBe(1)
    const ongoing = build([step(1, 1, [], 2)], { artifacts: [human] }, new Map([[1, { startTime: 0 }]]))
    expect(ongoing.humanEdits[0]?.turn).toBe(1)
  })
  it('uses turn wall time and otherwise sums completed run durations', () => {
    const nodes = [step(1, 1, [{ name: 'run_python', callId: 'r' }])]
    expect(build(nodes, { runs: [run('r', 1)] }, new Map([[1, { startTime: 0, endTime: 12_000 }]])).groups[0]?.durationMs).toBe(12_000)
    expect(build(nodes, { runs: [run('r', 1)] }).groups[0]?.durationMs).toBe(500)
    expect(build(nodes, { runs: [run('r', 1, 'running')] }).groups[0]?.durationMs).toBeUndefined()
  })
  it('expands terminal epochs, sorts markers and positions them before the first later turn', () => {
    const base = { kernelEpoch: 1, language: 'python' as const, environmentRevision: 1, environmentFingerprintPreview: 'abc' }
    const model = build([step(1, 1, [], 1), step(2, 1, [], 2), step(3, 1, [], 3)], { kernels: [
      { ...base, state: 'exited', at: 30, startedAt: 5, reason: 'idle' },
      { ...base, language: 'r', state: 'interrupted', startedAt: 12, finishedAt: 25, interruptedAtSeq: 10 },
      { ...base, kernelEpoch: 2, state: 'started', at: 35 },
    ] }, new Map([[1, { startTime: 10 }], [2, { startTime: 20 }]]))
    expect(model.kernelMarkers.map(marker => [marker.event, marker.at, marker.beforeTurn])).toEqual([
      ['started', 5, 1], ['started', 12, 2], ['interrupted', 25, 4], ['exited', 30, 4], ['started', 35, 4],
    ])
  })
})

describe('Science process presentation', () => {
  it('localizes titles, durations and every run terminal status', () => {
    const titles: readonly [ScienceTraceStepTitle, string][] = [
      [{ kind: 'run', language: 'python' }, 'Python run'], [{ kind: 'run', language: 'r' }, 'R run'],
      [{ kind: 'run', language: 'julia' }, 'julia run'], [{ kind: 'read', name: 'a' }, 'Read file a'],
      [{ kind: 'read-image', name: 'a' }, 'View image a'], [{ kind: 'glob', pattern: '*.csv' }, 'Find files *.csv'],
      [{ kind: 'grep', pattern: 'x' }, 'Search contents x'], [{ kind: 'state' }, 'Read session state'],
      [{ kind: 'annotate', name: 'a', version: 1, title: 'Plot' }, 'Annotate a v1 “Plot”'],
      [{ kind: 'publish', title: 'Result' }, 'Publish outcome “Result”'], [{ kind: 'delegate' }, 'Delegate task'],
      [{ kind: 'tool', name: 'custom' }, 'custom'], [{ kind: 'browse-many', count: 3 }, 'Reviewed 3 sources'],
    ]
    for (const [title, text] of titles) expect(scienceTraceStepTitle(title, t)).toBe(text)
    expect(formatScienceTraceDuration(undefined, t)).toBe('running')
    expect(formatScienceTraceDuration(500, t)).toBe('500 ms')
    expect(formatScienceTraceDuration(1500, t)).toBe('1.5 s')
    const base = build([step(1, 1, [{ name: 'run_python' }])]).groups[0]!.steps[0]!
    const statuses = [['running', ''], ['success', 'Success · 500 ms'], ['failed', 'Failed'],
      ['timed-out', 'Timed out'], ['cancelled', 'Cancelled'], ['interrupted', 'Interrupted']] as const
    for (const [runStatus, label] of statuses) {
      expect(scienceTraceStepStatus({ ...base, runStatus, durationMs: 500 }, t)).toBe(label)
    }
    expect(scienceTraceStepStatus({ ...base, failed: true }, t)).toBe('Failed')
    expect(scienceTraceStepStatus({ ...base, kind: 'other', failed: false }, t)).toBe('')
  })
  it('starts collapsed, navigates from pips, toggles disclosure, and opens precise artifacts and calls', () => {
    const { nodes, science, turnTimes } = fixture()
    const { container, inspectCall, selectDetailed, openArtifact, openTab } = mount(nodes, science, turnTimes)
    expect(screen.queryByRole('list', { name: 'Turn steps' })).toBeNull()
    expect(container.querySelectorAll('[data-line-budget="3"]')).toHaveLength(2)
    expect(screen.getAllByRole('group', { name: 'Step strip' }).flatMap(strip => within(strip).getAllByRole('button'))).toHaveLength(12)
    expect(screen.getByText('2 turns · 2 steps · 10 runs · 1 artifacts · 20.0 s')).toBeTruthy()
    expect(container.querySelector('b')?.textContent).toBe('1')
    expect(screen.queryByText('The chart is ready.')).toBeNull()
    expect(container.textContent).not.toMatch(/Intermediate narration|Research environment|Semantic trace|Swimlane|\/Users\//u)
    fireEvent.click(screen.getByRole('button', { name: 'chart.png v2' }))
    expect(openTab).toHaveBeenLastCalledWith({ artifactId: ScienceArtifactId('chart-1'), version: 2 })
    expect(openArtifact).toHaveBeenLastCalledWith({ artifactId: ScienceArtifactId('chart-1'), version: 2 })
    const strip = screen.getAllByRole('group', { name: 'Step strip' })[1]!
    fireEvent.click(within(strip).getAllByRole('button')[1]!)
    const list = screen.getByRole('list', { name: 'Turn steps' })
    expect(within(list).getAllByRole('listitem')[1]?.getAttribute('data-highlight')).toBe('true')
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
    fireEvent.click(within(list).getByRole('button', { name: 'chart.png v2' }))
    expect(openTab).toHaveBeenLastCalledWith({ artifactId: ScienceArtifactId('chart-1'), version: 2 })
    fireEvent.click(within(list).getAllByRole('button', { name: 'Python run' })[0]!)
    expect(selectDetailed).toHaveBeenCalledTimes(1)
    expect(inspectCall).toHaveBeenCalledExactlyOnceWith('repair-1')
    const toggle = screen.getByRole('button', { name: /Collapse steps.*1 failed/u })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(toggle)
    expect(screen.queryByRole('list', { name: 'Turn steps' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Expand steps.*1 failed/u }))
    expect(screen.getByRole('button', { name: /Collapse steps.*1 failed/u }).getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Open artifact' }))
    expect(openTab).toHaveBeenLastCalledWith({ artifactId: ScienceArtifactId('chart-1'), version: 3 })
  })
  it('opens the first member of a merged row and preserves individual pip labels', () => {
    const { inspectCall, selectDetailed } = mount([step(1, 1, [
      { name: 'read', argsRaw: '{"file_path":"a"}' }, { name: 'read', argsRaw: '{"file_path":"b"}' },
    ])])
    fireEvent.click(screen.getByRole('button', { name: 'Read file b' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reviewed 2 sources' }))
    expect(inspectCall).toHaveBeenCalledExactlyOnceWith('call-1-0')
    expect(selectDetailed).toHaveBeenCalledTimes(1)
    expect(screen.getByText('No produced files')).toBeTruthy()
    expect(screen.getByText('Request unavailable for this turn')).toBeTruthy()
  })
  it('shows four final artifact chips for fourteen versions and exposes earlier versions inline', () => {
    const original = fixture().science.artifacts[0]!
    const artifacts = Array.from({ length: 14 }, (_, index) => ({ ...original,
      artifactId: ScienceArtifactId(`file-${String(index % 4)}`), logicalName: `file-${String(index % 4)}.png`,
      version: Math.floor(index / 4) + 1, toolCallId: 'create', origin: 'model' as const,
    })) as unknown as ScienceClientProjection['artifacts']
    const { container } = mount([step(1, 1, [{ name: 'run_python', callId: 'create' }])],
      projection({ artifacts: [...artifacts, artifacts[0]!], outcome: { title: 'Done' } as ScienceClientProjection['outcome'] }))
    expect(container.querySelectorAll('button[data-anchor^="artifact:"]')).toHaveLength(4)
    expect(screen.getByRole('button', { name: 'file-0.png v4' })).toBeTruthy()
    expect(screen.getByText(/4 artifacts.*outcome published/u)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Expand steps/u }))
    expect(within(screen.getByRole('list')).getAllByRole('button', { name: /file-/u })).toHaveLength(15)
  })
  it('caps the strip at 120 calls while keeping all expanded rows', () => {
    mount([step(1, 1, Array.from({ length: 123 }, () => ({ name: 'todo_write' })))])
    expect(within(screen.getByRole('group')).getAllByRole('button')).toHaveLength(120)
    expect(screen.getByLabelText('123 calls in total').textContent).toBe('…')
    fireEvent.click(screen.getByRole('button', { name: /Expand steps/u }))
    expect(screen.getAllByRole('listitem')).toHaveLength(123)
    expect(screen.getAllByLabelText('Step 1')[1]?.getAttribute('data-repeated')).toBe('true')
  })
  it.each([null, undefined, projection()])('shows an empty session without copying an assistant answer', (science) => {
    // Pass undefined explicitly to the projection hook rather than the fixture helper default.
    if (science === undefined) {
      const snapshot = { nodes: [], turnTimings: new Map() } as unknown as ConversationSnapshot
      render(<ScienceTraceView {...({ useSession: (select: (s: ConversationSnapshot) => unknown) => select(snapshot),
        useProjection: () => undefined, t } as unknown as ScienceTraceViewProps)} />)
    } else mount([assistant(1, 1, [], 'Direct conclusion')], science)
    expect(screen.getByText(/Intent groups will appear/u)).toBeTruthy()
    expect(screen.queryByText('Direct conclusion')).toBeNull()
  })
  it('keeps a human-only turn and omits empty agent turns', () => {
    const human = fixture().science.artifacts[3]!
    const { container } = mount([step(1, 1, [], 1), step(2, 1, [], 2)], projection({ artifacts: [human] }),
      new Map([[1, { startTime: 30_000 }], [2, { startTime: 40_000 }]]))
    expect(container.querySelectorAll('[data-actor="agent"]')).toHaveLength(0)
    expect(container.querySelectorAll('[data-kind="human-edit"]')).toHaveLength(1)
    expect(screen.queryByText('Turn 1')).toBeNull()
  })
  it.each(['idle', 'session-end', 'environment-rebound', 'run-escalation', 'protocol', 'crash', 'service-disposed', undefined] as const)(
    'renders kernel exit reason %s', (reason) => {
      mount([step(1, 1, [{ name: 'get_science_state' }])], projection({ kernels: [{ kernelEpoch: 1, language: 'python',
        state: 'exited', at: 30, startedAt: 5, ...(reason === undefined ? {} : { reason }),
        environmentRevision: 1, environmentFingerprintPreview: 'abc' }] }), new Map([[1, { startTime: 10, endTime: 20 }]]))
      expect(screen.getByText('Python kernel #1 started')).toBeTruthy()
      expect(screen.getByText(`Python kernel #1 exited (${en[`trace.kernel.reason.${reason ?? 'unknown'}`]}) · variables cleared`)).toBeTruthy()
    },
  )
  it('renders started and interrupted kernels with environment display names', () => {
    const environment = { ...fixture().science.environment!, python: undefined, r: { language: 'r' } } as unknown as ScienceClientProjection['environment']
    const science = projection({ environment, kernels: [{ kernelEpoch: 2, language: 'r', state: 'interrupted',
      startedAt: 0, finishedAt: 10, interruptedAtSeq: 5, environmentRevision: 1, environmentFingerprintPreview: 'abc' }] })
    expect(buildScienceTraceModel([], science, new Map()).environment?.languages).toEqual(['R'])
    mount([], science)
    expect(screen.getByText('R kernel #2 started · environment science')).toBeTruthy()
    expect(screen.getByText('R kernel #2 interrupted · variables cleared')).toBeTruthy()
  })
})
