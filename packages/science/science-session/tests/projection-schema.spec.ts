import { describe, expect, it } from 'vitest'
import { CallId } from '@deepseek-ai/dsh-llm'
import { replayScience } from '../src/index.ts'
import { scienceProjectionSchema } from '../src/projection.ts'
import {
  event,
  legalEvents,
} from './fixtures.ts'

describe('Science projection wire schema', () => {
  it('accepts decoded members and derived metrics without re-running strict provenance', () => {
    const events = legalEvents()
    const modeState = replayScience(events.slice(0, 1))!
    const environmentState = replayScience(events.slice(0, 2))!
    const runningState = replayScience(events.slice(0, 5))!
    const state = replayScience(events)!
    const interruptedState = replayScience([
      ...events.slice(0, 5),
      event('session/end-seed', 5, 150, {}),
    ])!

    const currentEnvironment = state.environment!
    const currentPython = currentEnvironment.python!
    const { python: _python, ...environmentWithoutPython } = currentEnvironment
    const rRunningState = {
      ...runningState,
      environment: {
        ...environmentWithoutPython,
        r: { ...currentPython, language: 'r' },
      },
      runs: [{ ...runningState.runs[0], language: 'r' }],
    }
    const secondChart = {
      ...state.charts[0]!,
      version: 2,
      toolCallId: CallId('call-chart-2'),
      createdAt: 179,
    }
    const structurallyIndependentMembers = [
      {
        ...state,
        environment: null,
      },
      {
        ...state,
        charts: [state.charts[0], secondChart],
        metrics: { ...state.metrics, chartVersionCount: 2 },
      },
      {
        ...state,
        runs: [state.runs[0], state.runs[0]],
        metrics: {
          ...state.metrics,
          runCount: 2,
          successfulRunCount: 2,
        },
      },
      {
        ...state,
        outcome: {
          ...state.outcome,
          evidence: [{ kind: 'message', seq: 999 }],
          environmentRevisions: [],
        },
      },
    ]

    for (const [index, value] of [
      null,
      modeState,
      environmentState,
      runningState,
      rRunningState,
      interruptedState,
      state,
      ...structurallyIndependentMembers,
    ].entries()) {
      expect(scienceProjectionSchema.safeParse(value).success, `valid projection ${String(index)}`)
        .toBe(true)
    }
  })

  it('rejects malformed members and incorrect derived metrics', () => {
    const events = legalEvents()
    const runningState = replayScience(events.slice(0, 5))!
    const state = replayScience(events)!
    const interruptedState = replayScience([
      ...events.slice(0, 5),
      event('session/end-seed', 5, 150, {}),
    ])!
    const interruptedRun = interruptedState.runs[0]!
    const { metrics: _metrics, ...withoutMetrics } = state
    let statusReads = 0
    const unstableInterruptedRun = { ...interruptedRun }
    Object.defineProperty(unstableInterruptedRun, 'status', {
      enumerable: true,
      get: () => {
        statusReads += 1
        return statusReads <= 3 ? 'interrupted' : 'running'
      },
    })

    const invalidValues: unknown[] = [
      undefined,
      1,
      [],
      {},
      withoutMetrics,
      { ...state, unexpected: true },
      { ...state, mode: { ...state.mode, modeId: 'other' } },
      { ...state, environment: { ...state.environment, status: 'invalid' } },
      { ...state, runs: {} },
      { ...state, runs: [null] },
      { ...state, runs: [{}] },
      { ...state, runs: [{ ...runningState.runs[0], unexpected: true }] },
      { ...state, runs: [{ ...state.runs[0], status: 'unknown' }] },
      { ...state, runs: [{ status: 'interrupted' }] },
      { ...state, runs: [{ ...interruptedRun, finishedAt: '150' }] },
      { ...state, runs: [{ ...interruptedRun, finishedAt: Number.NaN }] },
      { ...state, runs: [{ ...interruptedRun, finishedAt: 138 }] },
      { ...state, runs: [{ ...interruptedRun, interruptedAtSeq: '3' }] },
      { ...state, runs: [{ ...interruptedRun, interruptedAtSeq: Number.NaN }] },
      { ...state, runs: [{ ...interruptedRun, interruptedAtSeq: -1 }] },
      { ...state, charts: {} },
      { ...state, charts: [{ ...state.charts[0], attachment: { mediaType: 'text/plain' } }] },
      { ...state, outcome: { ...state.outcome, evidence: [] } },
      { ...state, lastScienceEventSeq: 1.5 },
      { ...state, lastScienceEventSeq: -1 },
      { ...state, metrics: null },
      { ...state, metrics: { runCount: 1 } },
      { ...state, metrics: { ...state.metrics, unexpected: 1 } },
      { ...state, metrics: { ...state.metrics, runCount: 99 } },
      { ...state, runs: [unstableInterruptedRun] },
    ]
    for (const [index, value] of invalidValues.entries()) {
      expect(scienceProjectionSchema.safeParse(value).success, `invalid projection ${String(index)}`)
        .toBe(false)
    }
  })
})
