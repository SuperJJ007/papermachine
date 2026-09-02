// @vitest-environment jsdom
/** Science process projection, disclosure, and navigation. */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
import type { ScienceVersionSummaryMap } from '../src/client/version-summaries.ts'

/**
 * Current library facts derived from a fixture's own `origin`/`createdAt`
 * fields, matching D9's `sessions.scienceVersions` response shape — the
 * turn/human-edit attribution these tests exercise now reads `contentOrigin`
 * and `createdAt` from here rather than the removed `origin`/`runId`/
 * `toolCallId`/`parent` fields directly on the artifact.
 */
function summariesFor(artifacts: readonly Record<string, unknown>[]): ScienceVersionSummaryMap {
  const map = new Map()
  for (const artifact of artifacts) {
    const versionId = artifact.versionId as string
    map.set(versionId, {
      versionId, artifactId: artifact.artifactId, logicalName: artifact.logicalName, ordinal: artifact.version,
      title: artifact.title, contentOrigin: artifact.origin === 'human-edit' ? 'human-edit' : 'run-auto',
      createdAt: artifact.createdAt, mediaType: 'image/png', byteCount: 0,
    })
  }
  return map
}

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
        versionId: 'version-1a' as never, sha256: 'a'.repeat(64), seenAt: 9_000,
        attachment: { kind: 'image', attachmentId: 'a1', mediaType: 'image/png' },
        environmentRevision: 1, environmentFingerprintPreview: 'abc', createdAt: 9_000,
        origin: 'model', runId: ScienceRunId('run-8'), toolCallId: 'attempt-8', requestHeaderSeq: 8 },
      { artifactId: ScienceArtifactId('chart-1'), logicalName: 'chart.png', version: 1, title: 'Curated chart',
        versionId: 'version-1b' as never, sha256: 'a'.repeat(64), seenAt: 9_500,
        attachment: { kind: 'image', attachmentId: 'a1', mediaType: 'image/png' },
        environmentRevision: 1, environmentFingerprintPreview: 'abc', createdAt: 9_500,
        origin: 'model', runId: ScienceRunId('run-8'), toolCallId: 'attempt-8', requestHeaderSeq: 8 },
      { artifactId: ScienceArtifactId('chart-1'), logicalName: 'chart.png', version: 2, title: 'Chart',
        versionId: 'version-2' as never, sha256: 'b'.repeat(64), seenAt: 19_000,
        parent: { artifactId: ScienceArtifactId('chart-1'), version: 1 },
        attachment: { kind: 'image', attachmentId: 'a2', mediaType: 'image/png' },
        environmentRevision: 1, environmentFingerprintPreview: 'abc', createdAt: 19_000,
        origin: 'model', runId: ScienceRunId('run-10'), toolCallId: 'repair-2', requestHeaderSeq: 10 },
      { artifactId: ScienceArtifactId('chart-1'), logicalName: 'chart.png', version: 3, title: 'Chart',
        versionId: 'version-3' as never, sha256: 'c'.repeat(64), seenAt: 19_500,
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
  const science = projection(patch)
  return buildScienceTraceModel(nodes, science, times, summariesFor(science.artifacts as unknown as Record<string, unknown>[]))
}
function mount(nodes: readonly ConversationNode[], science: ScienceClientProjection | null | undefined = projection(),
  turnTimings: ReadonlyMap<number, { startTime: number; endTime?: number }> = new Map()) {
  const inspectCall = vi.fn(), openArtifact = vi.fn(), selectDetailed = vi.fn(), openTab = vi.fn()
  const summaries = science == null ? new Map() : summariesFor(science.artifacts as unknown as Record<string, unknown>[])
  const loadVersions = vi.fn(async () => ({ ok: true, value: { versions: [...summaries.values()] } }))
  const snapshot = { nodes, turnTimings } as unknown as ConversationSnapshot
  const rendered = render(<ScienceTraceView {...({
    useSession: (select: (value: ConversationSnapshot) => unknown) => select(snapshot),
    useProjection: () => science, inspectCall, actions: { openTab }, openArtifact, selectDetailed, loadVersions, t,
  } as unknown as ScienceTraceViewProps)} />)
  return { ...rendered, inspectCall, openArtifact, selectDetailed, openTab, loadVersions }
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
  ['annotate_artifact', '{"logical_name":"plot.png","title":"Plot"}', 'curate',
    { kind: 'annotate', name: 'plot.png', title: 'Plot' }],
  ['annotate_artifact', '{"logical_name":"plot.png","version":"1","title":"Plot"}', 'curate',
    { kind: 'annotate', name: 'plot.png', title: 'Plot' }],
  ['publish_outcome', '{"title":"Result"}', 'publish', { kind: 'publish', title: 'Result' }],
  ['subagent_task', '{}', 'delegate', { kind: 'delegate' }],
  ['todo_write', '{}', 'other', { kind: 'tool', name: 'todo_write' }],
] as const

describe('Science process model', () => {
  it('uses projection trace coordinates when the loaded conversation is only a cold tail', () => {
    const early = { ...run('early', 1), turn: 1, step: 1 }
    const current = { ...run('current', 2), turn: 2, step: 1 }
    const science = projection({ runs: [early, current] } as Partial<ScienceClientProjection>) as ScienceClientProjection & {
      trace: {
        turns: readonly Record<string, unknown>[]
        calls: readonly Record<string, unknown>[]
      }
    }
    science.trace = {
      turns: [
        { turn: 1, startSeq: 1, startTime: 1_000, endSeq: 9, endTime: 9_000 },
        { turn: 2, startSeq: 10, startTime: 10_000, endSeq: 19, endTime: 19_000 },
      ],
      calls: [
        { seq: 3, time: 3_000, callId: 'early', turn: 1, step: 1, name: 'run_python' },
        { seq: 12, time: 12_000, callId: 'current', turn: 2, step: 1, name: 'run_python' },
      ],
    }

    const model = buildScienceTraceModel(
      [step(12, 1, [{ name: 'run_python', callId: 'current' }], 2)],
      science,
      new Map([[2, { startTime: 10_000, endTime: 19_000 }]]),
      new Map(),
    )

    expect(model.groups.map(group => ({ turn: group.turn, steps: group.stepCount, runs: group.runs.length }))).toEqual([
      { turn: 1, steps: 1, runs: 1 },
      { turn: 2, steps: 1, runs: 1 },
    ])
    expect(model.unassigned).toEqual({ runs: [], artifacts: [] })
  })

  it.each(tools)('classifies %s from structured arguments', (name, argsRaw, kind, title) => {
    expect(build([step(1, 1, [{ name, argsRaw }])]).groups[0]?.steps[0]).toMatchObject({ kind, title })
  })
  it.each([
    ['read', '{'], ['read', 'null'], ['read', '[]'], ['read', '1'], ['read', '{}'], ['read', '{"file_path":1}'],
    ['glob', '{}'], ['grep', '{"pattern":false}'], ['annotate_artifact', '{}'],
    ['annotate_artifact', '{"logical_name":"x","version":1}'],
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
  it('orders calls by seq, shares parallel step numbers, and excludes answer-only steps from totals', () => {
    const model = build([step(20, 2, [{ name: 'run_python' }]), step(10, 1, [{ name: 'run_r' }, { name: 'run_python' }]), step(30, 3, [])])
    expect(model.groups[0]?.steps.map(row => [row.step, row.members[0]?.callId])).toEqual([
      [1, 'call-10-0'], [1, 'call-10-1'], [2, 'call-20-0'],
    ])
    expect(model.groups[0]?.stepCount).toBe(2)
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
    expect(group.stepCount).toBe(4)
    expect(group.steps[0]?.members[0]?.callId).toBe('call-1-0')
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
  it('places artifact deltas by creation time at the turn level and keeps direct edits on the user side', () => {
    const { nodes, science, turnTimes } = fixture()
    const model = buildScienceTraceModel(nodes, science, turnTimes, summariesFor(science.artifacts as unknown as Record<string, unknown>[]))
    // Per-call attribution is gone with the removed producing-call link: no
    // step ever carries artifact chips of its own, only the turn-level group.
    expect(model.groups.flatMap(group => group.steps.flatMap(row => row.artifacts))).toEqual([])
    expect(model.groups[0]?.artifacts.map(item => item.action)).toEqual(['created', 'curated'])
    expect(model.groups[1]?.artifacts[0]).toMatchObject({ action: 'advanced', parentVersion: 1 })
    expect(model.groups[1]?.failedCount).toBe(1)
    expect(model.groups.flatMap(group => group.artifacts).map(item => item.version)).not.toContain(3)
    expect(model.humanEdits).toMatchObject([{ actor: 'user', turn: 2, anchor: 'artifact:chart-1@3' }])
    expect(model.dialogues.find(item => item.seq === 21)?.turn).toBe(2)
    expect(model.environment?.languages).toEqual(['Python'])
  })
  it('keeps an unseen run outside request groups; an artifact outside every turn window still lands on lastTurn', () => {
    const human = fixture().science.artifacts[3]!
    // Neither artifact's createdAt (9_000, 19_500) falls inside turn 2's
    // declared window ([30_000, +Inf)); both fall back to the same lastTurn
    // this run of nodes infers (2, from the lone assistant node) —
    // `artifactTurn` never leaves an artifact unassigned the way a run
    // without a matching call can stay unassigned.
    const orphan = fixture().science.artifacts[0]!
    const nodes = [
      { kind: 'user', seq: 1, time: 0, source: null, content: [{ type: 'image', attachment: {} as never }] },
      { kind: 'steering', seq: 2, time: 1, messageId: 'm' as never, source: null, content: [] },
      { kind: 'steering', seq: 3, time: 2, messageId: 'm2' as never, source: null, content: [{ type: 'text', text: 'First' }] },
      step(4, 1, [], 2),
    ] as ConversationNode[]
    const model = build(nodes, { artifacts: [orphan, human], runs: [run('unseen', 1)] }, new Map([[2, { startTime: 30_000 }]]))
    expect(model.groups).toMatchObject([{ turn: 2, artifacts: [{ version: 1, action: 'created' }] }])
    expect(model).toMatchObject({ unassigned: { runs: [run('unseen', 1)], artifacts: [] } })
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
  it('places an artifact by its own createdAt window regardless of which calls the turn loaded', () => {
    // The removed `runId`/`toolCallId` fields meant a version's producing
    // call had to be loaded before it appeared at all; createdAt-window
    // placement has no such precondition — the artifact shows up in the
    // very first render, before any call/run history streams in.
    const artifact = fixture().science.artifacts[0]!
    const turnTimes = new Map([[1, { startTime: 0, endTime: 10_000 }], [2, { startTime: 10_001, endTime: 20_000 }]])
    const noNodes = build([], { artifacts: [artifact] }, turnTimes)
    expect(noNodes.groups).toMatchObject([{ turn: 1, artifacts: [{ logicalName: 'chart.png', version: 1 }] }])
    expect(noNodes).toMatchObject({ unassigned: { artifacts: [] } })
    const laterArtifact = { ...artifact, versionId: 'version-later' as never, createdAt: 15_000 }
    const later = build([], { artifacts: [laterArtifact] }, turnTimes)
    expect(later.groups).toMatchObject([{ turn: 2, artifacts: [{ version: 1 }] }])
  })
  it('expands terminal epochs and places sorted markers before their containing or next turn', () => {
    const base = { kernelEpoch: 1, language: 'python' as const, environmentRevision: 1, environmentFingerprintPreview: 'abc' }
    const model = build([step(1, 1, [], 1), step(2, 1, [], 2), step(3, 1, [], 3)], { kernels: [
      { ...base, state: 'exited', at: 30, startedAt: 5, reason: 'idle' },
      { ...base, language: 'r', state: 'interrupted', startedAt: 12, finishedAt: 25, interruptedAtSeq: 10 },
      { ...base, kernelEpoch: 2, state: 'started', at: 35 },
    ] }, new Map([[1, { startTime: 10, endTime: 15 }], [2, { startTime: 20, endTime: 25 }]]))
    expect(model.kernelMarkers.map(marker => [marker.event, marker.at, marker.beforeTurn])).toEqual([
      ['started', 5, 1], ['started', 12, 1], ['interrupted', 25, 2], ['exited', 30, 4], ['started', 35, 4],
    ])
    expect(model.kernelMarkers.map(marker => marker.anchor)).toEqual([
      'kernel:python:1:started', 'kernel:r:1:started', 'kernel:r:1:interrupted', 'kernel:python:1:exited', 'kernel:python:2:started',
    ])
  })
  it.each([[10, 1], [15, 1], [16, 2], [20, 2], [35, 2]])('places a marker at %s before turn %s, including an open turn', (at, beforeTurn) => {
    const model = build([step(1, 1, [], 1), step(2, 1, [], 2)], { kernels: [{
      kernelEpoch: 1, language: 'python', state: 'started', at, environmentRevision: 1, environmentFingerprintPreview: 'abc',
    }] }, new Map([[1, { startTime: 10, endTime: 15 }], [2, { startTime: 20 }]]))
    expect(model.kernelMarkers[0]?.beforeTurn).toBe(beforeTurn)
  })
})

describe('Science process presentation', () => {
  it('keeps an unowned run in unassigned history; opens exact artifact versions from its own turn chip', async () => {
    // No turn-timing window is declared, so `artifactTurn` falls back to
    // `lastTurn` (50, inferred from the one loaded assistant node) — the
    // artifact joins that turn's own group rather than staying unassigned
    // the way `produce` (a run whose callId never appears in the loaded
    // nodes) does.
    const artifact = fixture().science.artifacts[0]!
    const { openArtifact } = mount([step(50, 1, [{ name: 'run_python', callId: 'current' }], 50)],
      projection({ runs: [run('produce', 8), run('current', 9)], artifacts: [artifact] }))
    await waitFor(() => { expect(screen.getByRole('button', { name: 'chart.png v1' })).toBeTruthy() })
    const history = screen.getByRole('region', { name: 'Unassigned history' })
    expect(history.textContent).toContain('1 runs and 0 artifact versions')
    expect(within(history).queryByRole('button', { name: 'chart.png v1' })).toBeNull()
    const chip = screen.getByRole('button', { name: 'chart.png v1' })
    expect(chip.closest('[data-actor]')?.getAttribute('data-actor')).toBe('agent')
    fireEvent.click(chip)
    expect(openArtifact).toHaveBeenCalledWith({ artifactId: artifact.artifactId, version: 1 })
  })

  it('shows retained runs when no conversation nodes are loaded', () => {
    mount([], projection({ runs: [run('produce', 8)] }))
    expect(screen.getByRole('region', { name: 'Unassigned history' }).textContent).toContain('1 runs and 0 artifact versions')
    expect(screen.queryByText('Intent groups will appear after a Science research conversation starts.')).toBeNull()
  })

  it('bounds source code and arbitrary arguments, with separate truncation notices', () => {
    mount([step(1, 1, [{ name: 'run_python', argsRaw: JSON.stringify({ code: 'x'.repeat(100_001), context: 'y'.repeat(100_001) }) }])])
    fireEvent.click(screen.getByRole('button', { name: /Expand steps/u }))
    expect(screen.getByText(/^x+$/u).textContent).toHaveLength(180)
    fireEvent.click(within(screen.getByRole('list')).getByRole('button', { name: 'Python run' }))
    expect(screen.getByRole('button', { name: 'Copy displayed code' })).toBeTruthy()
    for (const name of ['Code', 'Input arguments']) {
      const region = screen.getByRole('region', { name })
      expect(region.querySelector('pre')?.textContent).toHaveLength(100_000)
      expect(region.textContent).toContain('Showing first 100000 of ')
    }
  })

  it('shows recorded code, parameters, output and run facts locally, and keeps copy controls independent', () => {
    const callId = 'calculation'
    const output = { ...result(callId, false), content: [{ type: 'text' as const,
      text: '--- stdout ---\nrows=120\n--- stderr ---\n(empty)' }] }
    const finished = { ...run(callId, 1), stdoutBytes: 9, stderrBytes: 0, stdoutTruncated: true,
      failureCode: 'EXECUTION_ERROR' } as ScienceClientRun
    const { inspectCall, selectDetailed } = mount([
      step(1, 1, [{ name: 'run_python', callId, argsRaw: JSON.stringify({ code: '\nprint("rows=120")', timeout: 30 }) }]), output,
    ], projection({ runs: [finished] }))
    fireEvent.click(screen.getByRole('button', { name: /Expand steps/u }))
    expect(screen.queryByRole('region', { name: 'Standard output' })).toBeNull()
    expect(screen.getByText('print("rows=120")')).toBeTruthy()
    const title = within(screen.getByRole('list')).getByRole('button', { name: 'Python run' })
    fireEvent.click(title)
    expect(title.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('region', { name: 'Code' }).textContent).toContain('print("rows=120")')
    expect(screen.getByRole('region', { name: 'Input arguments' }).textContent).toContain('"timeout": 30')
    expect(screen.getByRole('region', { name: 'Standard output' }).textContent).toContain('rows=120')
    expect(screen.getByRole('region', { name: 'Error output' }).textContent).toContain('(empty)')
    fireEvent.click(screen.getByText('Full tool result'))
    expect(screen.getByRole('region', { name: 'Tool result' }).textContent).toContain('--- stdout ---')
    expect(screen.getByText(/Stdout 9 bytes.*Output truncated/u)).toBeTruthy()
    expect(screen.getByText(/Kernel #1.*Environment revision 1.*EXECUTION_ERROR/u)).toBeTruthy()
    const details = screen.getByRole('region', { name: 'Python run' })
    for (const target of [details, details.querySelector('h4')!, details.querySelector('p')!, details.querySelector('b')!,
      details.parentElement!, screen.getByRole('region', { name: 'Standard output' }).querySelector('pre')!]) {
      fireEvent.click(target)
      expect(screen.getByRole('list')).toBeTruthy()
    }
    expect(title.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(title)
    expect(screen.queryByRole('region', { name: 'Code' })).toBeNull()
    expect(inspectCall).not.toHaveBeenCalled()
    expect(selectDetailed).not.toHaveBeenCalled()
  })
  it.each([
    ['run_r', '{"code":"x <- 1"}', 'R run'],
    ['run_python', '{"code":""}', 'Python run'],
    ['run_python', '{"code":1}', 'Python run'],
    ['read', '{', 'read'],
    ['read', 'null', 'read'],
    ['read', '[]', 'read'],
  ])('keeps incomplete and empty %s inputs inspectable: %s', (name, argsRaw, label) => {
    mount([step(1, 1, [{ name, argsRaw }])])
    fireEvent.click(screen.getByRole('button', { name: /Expand steps/u }))
    fireEvent.click(within(screen.getByRole('list')).getByRole('button', { name: label }))
    expect(screen.getByText('Result not yet recorded')).toBeTruthy()
    const code = screen.queryByRole('region', { name: 'Code' })
    if (argsRaw.includes('"code":"')) {
      expect(code).toBeTruthy()
      expect(screen.queryByRole('region', { name: 'Input arguments' })).toBeNull()
    } else {
      expect(code).toBeNull()
      expect(screen.getByRole('region', { name: 'Input arguments' }).querySelector('pre')?.textContent?.replace(/\s/gu, '')).toBe(argsRaw)
    }
  })
  it('retains unstructured output and describes non-text results without embedding raw image bytes', () => {
    const output = { ...result('read-image', false), content: [
      { type: 'text' as const, text: 'x'.repeat(100_001) },
      { type: 'image' as const, attachment: { attachmentId: 'PRIVATE_IMAGE_REF' as never, mediaType: 'image/png' as const, bytes: 1, width: 1, height: 1 } },
    ] }
    mount([step(1, 1, [{ name: 'read_image', callId: 'read-image', argsRaw: '{"file_path":"image.png"}' }]), output])
    fireEvent.click(screen.getByRole('button', { name: /Expand steps/u }))
    fireEvent.click(within(screen.getByRole('list')).getByRole('button', { name: 'View image image.png' }))
    expect(screen.getByRole('region', { name: 'Tool result' }).querySelector('pre')?.textContent).toHaveLength(100_000)
    expect(screen.getByText('Showing first 100000 of 100001 characters.')).toBeTruthy()
    expect(screen.getByText('1 non-text result blocks (image)')).toBeTruthy()
    expect(screen.queryByText(/PRIVATE_IMAGE_REF/u)).toBeNull()
  })
  it('shows an empty recorded output distinctly from a result that has not arrived', () => {
    mount([step(1, 1, [{ name: 'run_python', callId: 'empty', argsRaw: '{"code":"pass"}' }]), result('empty', false)])
    fireEvent.click(screen.getByRole('button', { name: /Expand steps/u }))
    fireEvent.click(within(screen.getByRole('list')).getByRole('button', { name: 'Python run' }))
    expect(screen.getByRole('region', { name: 'Tool result' }).textContent).toContain('(empty)')
    expect(screen.queryByText('Result not yet recorded')).toBeNull()
  })

  it('toggles the whole card while preserving independent controls and text selection', async () => {
    const { nodes, science, turnTimes } = fixture()
    const { container } = mount(nodes, science, turnTimes)
    const card = container.querySelector('article[data-actor="agent"]')!
    await waitFor(() => { expect(within(card as HTMLElement).getByRole('button', { name: 'chart.png v1' })).toBeTruthy() })
    fireEvent.click(screen.getByText('Build the chart'))
    expect(within(card as HTMLElement).getByRole('list')).toBeTruthy()
    fireEvent.click(card)
    expect(within(card as HTMLElement).queryByRole('list')).toBeNull()
    fireEvent.click(within(card as HTMLElement).getByRole('button', { name: 'chart.png v1' }))
    expect(within(card as HTMLElement).queryByRole('list')).toBeNull()
    const selection = vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => 'selected text' } as Selection)
    fireEvent.click(card)
    expect(within(card as HTMLElement).queryByRole('list')).toBeNull()
    selection.mockReturnValue(null)
    fireEvent.click(card)
    expect(within(card as HTMLElement).getByRole('list')).toBeTruthy()
    selection.mockRestore()
  })

  it.each([[999, '999 ms'], [1000, '1.0 s'], [59999, '60.0 s'], [60000, '1m 0s'],
    [137100, '2m 17s'], [361000, '6m 1s']])('formats %s milliseconds as %s', (ms, expected) => {
    expect(formatScienceTraceDuration(ms, t)).toBe(expected)
  })
  it('localizes titles, durations and every run terminal status', () => {
    const titles: readonly [ScienceTraceStepTitle, string][] = [
      [{ kind: 'run', language: 'python' }, 'Python run'], [{ kind: 'run', language: 'r' }, 'R run'],
      [{ kind: 'run', language: 'julia' }, 'julia run'], [{ kind: 'read', name: 'a' }, 'Read file a'],
      [{ kind: 'read-image', name: 'a' }, 'View image a'], [{ kind: 'glob', pattern: '*.csv' }, 'Find files *.csv'],
      [{ kind: 'grep', pattern: 'x' }, 'Search contents x'], [{ kind: 'state' }, 'Read session state'],
      [{ kind: 'annotate', name: 'a', version: 1, title: 'Plot' }, 'Annotate a v1 “Plot”'],
      [{ kind: 'annotate', name: 'a', title: 'Plot' }, 'Annotate a “Plot”'],
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
  it('starts collapsed, navigates from pips, toggles disclosure, and opens precise artifacts without Detailed', async () => {
    const { nodes, science, turnTimes } = fixture()
    const { container, inspectCall, selectDetailed, openArtifact, openTab } = mount(nodes, science, turnTimes)
    expect(screen.queryByRole('list', { name: 'Turn steps' })).toBeNull()
    expect(container.querySelectorAll('[data-line-budget="4"]')).toHaveLength(2)
    expect(screen.getAllByRole('group', { name: 'Step strip' }).flatMap(strip => within(strip).getAllByRole('button'))).toHaveLength(12)
    await waitFor(() => { expect(screen.getByText('Turns 2 · Steps 2 · Runs 10 · Artifacts 1 · 20.0 s')).toBeTruthy() })
    expect(container.querySelector('b')?.textContent).toBe('1 failed')
    expect(screen.queryByText('The chart is ready.')).toBeNull()
    expect(container.textContent).not.toMatch(/Intermediate narration|Research environment|Semantic trace|Swimlane|\/Users\//u)
    fireEvent.click(screen.getByRole('button', { name: 'chart.png v2' }))
    expect(openTab).toHaveBeenLastCalledWith({ artifactId: ScienceArtifactId('chart-1'), version: 2 })
    expect(openArtifact).toHaveBeenLastCalledWith({ artifactId: ScienceArtifactId('chart-1'), version: 2 })
    const strip = screen.getAllByRole('group', { name: 'Step strip' })[1]!
    fireEvent.click(within(strip).getAllByRole('button')[1]!)
    const list = screen.getByRole('list', { name: 'Turn steps' })
    expect(list.textContent).not.toContain('●')
    expect(within(list).getByText('Success · 500 ms')).toBeTruthy()
    expect(within(list).getAllByRole('listitem')[1]?.getAttribute('data-highlight')).toBe('true')
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
    // Per-step artifact chips are gone with the removed producing-call link
    // (the turn-level chip, clicked above, already covers opening an exact
    // version); the expanded step's own chip row renders empty now.
    expect(within(list).queryByRole('button', { name: 'chart.png v2' })).toBeNull()
    fireEvent.click(within(list).getAllByRole('button', { name: 'Python run' })[0]!)
    expect(selectDetailed).not.toHaveBeenCalled()
    expect(inspectCall).not.toHaveBeenCalled()
    expect(within(list).getByRole('region', { name: 'Python run' })).toBeTruthy()
    const toggle = screen.getByRole('button', { name: /Collapse steps.*1 failed/u })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(toggle)
    expect(screen.queryByRole('list', { name: 'Turn steps' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Expand steps.*1 failed/u }))
    expect(screen.getByRole('button', { name: /Collapse steps.*1 failed/u }).getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Open artifact' }))
    expect(openTab).toHaveBeenLastCalledWith({ artifactId: ScienceArtifactId('chart-1'), version: 3 })
  })
  it('expands every member of a merged row locally and preserves individual pip labels', () => {
    const { inspectCall, selectDetailed } = mount([step(1, 1, [
      { name: 'read', argsRaw: '{"file_path":"a"}' }, { name: 'read', argsRaw: '{"file_path":"b"}' },
    ])])
    fireEvent.click(screen.getByRole('button', { name: 'Read file b' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reviewed 2 sources' }))
    expect(inspectCall).not.toHaveBeenCalled()
    expect(screen.getByRole('region', { name: 'Read file a' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Read file b' })).toBeTruthy()
    expect(screen.getAllByText('Result not yet recorded')).toHaveLength(2)
    expect(selectDetailed).not.toHaveBeenCalled()
    expect(screen.getByText('No artifacts')).toBeTruthy()
    expect(screen.getByText('Request unavailable for this turn')).toBeTruthy()
  })
  it('shows four final artifact chips for fourteen versions, with none repeated per-step', async () => {
    // Per-step artifact chips are gone with the removed producing-call
    // link: the expanded steps list carries no `file-` chips of its own now,
    // only the one turn-level chip row this group's `artifacts` renders.
    const original = fixture().science.artifacts[0]!
    const artifacts = Array.from({ length: 14 }, (_, index) => ({ ...original,
      artifactId: ScienceArtifactId(`file-${String(index % 4)}`), logicalName: `file-${String(index % 4)}.png`,
      versionId: `version-${String(index)}` as never,
      version: Math.floor(index / 4) + 1, toolCallId: 'create', origin: 'model' as const,
    })) as unknown as ScienceClientProjection['artifacts']
    const { container } = mount([step(1, 1, [{ name: 'run_python', callId: 'create' }])],
      projection({ artifacts: [...artifacts, artifacts[0]!], runs: [run('create', 8)],
        outcome: { title: 'Done' } as ScienceClientProjection['outcome'] }))
    await waitFor(() => { expect(screen.getByRole('button', { name: 'file-0.png v4' })).toBeTruthy() })
    expect(container.querySelectorAll('button[data-anchor^="artifact:"]')).toHaveLength(4)
    expect(screen.getByText(/Artifacts 4.*outcome published/u)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Expand steps/u }))
    expect(within(screen.getByRole('list')).queryAllByRole('button', { name: /file-/u })).toHaveLength(0)
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
  it('keeps a human-only turn and omits empty agent turns', async () => {
    const human = fixture().science.artifacts[3]!
    const { container } = mount([step(1, 1, [], 1), step(2, 1, [], 2)], projection({ artifacts: [human] }),
      new Map([[1, { startTime: 30_000 }], [2, { startTime: 40_000 }]]))
    await waitFor(() => { expect(container.querySelectorAll('[data-kind="human-edit"]')).toHaveLength(1) })
    expect(container.querySelectorAll('[data-actor="agent"]')).toHaveLength(0)
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
    expect(buildScienceTraceModel([], science, new Map(), new Map()).environment?.languages).toEqual(['R'])
    mount([], science)
    expect(screen.getByText('R kernel #2 started · environment science')).toBeTruthy()
    expect(screen.getByText('R kernel #2 interrupted · variables cleared')).toBeTruthy()
  })
})
