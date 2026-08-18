import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { ScienceRunId } from '../src/index.ts'
import { foldScience } from '../src/fold.ts'
import {
  ARTIFACT_CALL_ID,
  OUTCOME_CALL_ID,
  RUN_CALL_ID,
  RUN_ID,
  artifact,
  environment,
  environmentWithoutPython,
  event,
  interpreter,
  legalEvents,
  mode,
  outcome,
  runStarted,
  runTerminal,
  toolCall,
  toolResult,
} from './fixtures.ts'

describe('strict Science provenance', () => {
  it('requires every supporting authorization reference to follow mode binding', () => {
    const runAfterMode = runStarted({ requestHeaderSeq: 3 })
    const terminalAfterMode = runTerminal({ requestHeaderSeq: 3 })
    const validRunPrefix = [
      event('science/mode-bound', 1, 100, { version: 1, mode: mode() }),
      event('science/environment-bound', 2, 110, { version: 1, environment: environment() }),
      event('request/header', 3, 120, {}),
      toolCall(4, 130, RUN_CALL_ID, 'run_python'),
      event('science/run-started', 5, 140, { version: 1, run: runAfterMode }),
      event('science/run-finished', 6, 150, { version: 1, run: terminalAfterMode }),
    ]
    const cases: Array<readonly [string, SessionEvent[], RegExp]> = [
      ['run request header', [
        event('request/header', 0, 90, {}),
        event('science/mode-bound', 1, 100, { version: 1, mode: mode() }),
        event('science/environment-bound', 2, 110, { version: 1, environment: environment() }),
        toolCall(3, 130, RUN_CALL_ID, 'run_python'),
        event('science/run-started', 4, 140, {
          version: 1,
          run: runStarted({ requestHeaderSeq: 0 }),
        }),
      ], /cannot follow pre-mode/],
      ['run tool call', [
        toolCall(0, 90, RUN_CALL_ID, 'run_python'),
        event('science/mode-bound', 1, 100, { version: 1, mode: mode() }),
        event('science/environment-bound', 2, 110, { version: 1, environment: environment() }),
        event('request/header', 3, 120, {}),
        event('science/run-started', 4, 140, {
          version: 1,
          run: runStarted({ requestHeaderSeq: 3 }),
        }),
      ], /cannot follow pre-mode/],
      ['chart request header', [
        event('request/header', 0, 90, {}),
        ...validRunPrefix,
        toolCall(7, 160, ARTIFACT_CALL_ID, 'save_chart'),
        event('science/artifact-saved', 8, 170, {
          version: 1,
          artifact: artifact({ requestHeaderSeq: 0 }),
        }),
      ], /cannot follow pre-mode/],
      ['chart tool call', [
        toolCall(0, 90, ARTIFACT_CALL_ID, 'save_chart'),
        ...validRunPrefix,
        event('science/artifact-saved', 7, 170, {
          version: 1,
          artifact: artifact({ requestHeaderSeq: 3 }),
        }),
      ], /cannot follow pre-mode/],
      ['outcome request header', [
        event('request/header', 0, 90, {}),
        event('science/mode-bound', 1, 100, { version: 1, mode: mode() }),
        event('science/environment-bound', 2, 110, { version: 1, environment: environment() }),
        event('assistant/message', 3, 120, {}),
        event('science/outcome-published', 4, 130, {
          version: 1,
          outcome: outcome({
            evidence: [{ kind: 'message', seq: 3 }],
            publishedAt: 129,
            requestHeaderSeq: 0,
          }),
        }),
      ], /cannot follow pre-mode/],
    ]

    for (const [name, events, pattern] of cases) {
      expect(() => foldScience(events), name).toThrow(pattern)
    }
  })

  it('requires the latest request header and a later matching tool call', () => {
    const staleHeader = [
      ...legalEvents().slice(0, 3),
      event('request/header', 3, 125, {}),
      toolCall(4, 130, RUN_CALL_ID, 'run_python'),
      event('science/run-started', 5, 140, {
        version: 1,
        run: runStarted({ requestHeaderSeq: 2 }),
      }),
    ]
    expect(() => foldScience(staleHeader)).toThrow(/not the latest post-mode request\/header/)

    const callBeforeHeader = [
      ...legalEvents().slice(0, 2),
      toolCall(2, 115, RUN_CALL_ID, 'run_python'),
      event('request/header', 3, 120, {}),
      event('science/run-started', 4, 140, {
        version: 1,
        run: runStarted({ requestHeaderSeq: 3 }),
      }),
    ]
    expect(() => foldScience(callBeforeHeader)).toThrow(/does not identify one call after its cited request\/header/)
  })

  it('consumes each authorizing tool call once and rejects already settled calls', () => {
    const secondRun = runStarted({
      runId: ScienceRunId('run-2'),
      startedAt: 159,
      runDirectoryRef: 'runs/run-2/',
    })
    const reuseCases: Array<readonly [string, SessionEvent[]]> = [
      ['second run', [
        ...legalEvents().slice(0, 6),
        event('science/run-started', 6, 160, { version: 1, run: secondRun }),
      ]],
      ['chart', [
        ...legalEvents().slice(0, 8),
        event('science/artifact-saved', 8, 180, {
          version: 1,
          artifact: artifact({ version: 2, createdAt: 179 }),
        }),
      ]],
      ['outcome', [
        ...legalEvents(),
        event('science/outcome-published', 10, 190, {
          version: 1,
          outcome: outcome({ revision: 2, publishedAt: 189 }),
        }),
      ]],
    ]
    for (const [name, events] of reuseCases) {
      expect(() => foldScience(events), name).toThrow(/already consumed by a Science fact/)
    }

    const settledCases: Array<readonly [string, SessionEvent[]]> = [
      ['run', [
        ...legalEvents().slice(0, 4),
        toolResult(4, 135, RUN_CALL_ID),
        event('science/run-started', 5, 140, { version: 1, run: runStarted() }),
      ]],
      ['chart', [
        ...legalEvents().slice(0, 7),
        toolResult(7, 165, ARTIFACT_CALL_ID),
        event('science/artifact-saved', 8, 170, { version: 1, artifact: artifact() }),
      ]],
      ['outcome', [
        ...legalEvents().slice(0, 9),
        toolResult(9, 177, OUTCOME_CALL_ID),
        event('science/outcome-published', 10, 180, { version: 1, outcome: outcome() }),
      ]],
    ]
    for (const [name, events] of settledCases) {
      expect(() => foldScience(events), name).toThrow(/already settled before its Science fact/)
    }

    expect(() => foldScience([
      ...legalEvents().slice(0, 8),
      event('science/outcome-published', 8, 180, { version: 1, outcome: outcome() }),
    ])).toThrow(/does not identify one call after its cited request\/header/)
  })

  it('rejects a Science fact after its authorizing tool call step has ended', () => {
    const cases: Array<readonly [string, SessionEvent[]]> = [
      ['run', [
        ...legalEvents().slice(0, 4),
        event('step/end', 4, 135, { turn: 1, step: 1 }),
        event('science/run-started', 5, 140, { version: 1, run: runStarted() }),
      ]],
      ['chart', [
        ...legalEvents().slice(0, 7),
        event('step/end', 7, 165, { turn: 1, step: 1 }),
        event('science/artifact-saved', 8, 170, { version: 1, artifact: artifact() }),
      ]],
      ['outcome', [
        ...legalEvents().slice(0, 9),
        event('step/end', 9, 177, { turn: 1, step: 1 }),
        event('science/outcome-published', 10, 180, { version: 1, outcome: outcome() }),
      ]],
    ]

    for (const [name, events] of cases) {
      expect(() => foldScience(events), name).toThrow()
    }

    expect(foldScience([
      ...legalEvents().slice(0, 4),
      event('step/end', 4, 135, { turn: 2, step: 1 }),
      event('science/run-started', 5, 140, { version: 1, run: runStarted() }),
    ]).runs).toEqual([runStarted()])
  })

  it('requires the operation-specific tool name and accepts the R runner name', () => {
    const wrongNames: Array<readonly [string, SessionEvent[], RegExp]> = [
      ['run', legalEvents().slice(0, 5).map((candidate, index) => index === 3
        ? toolCall(3, 130, RUN_CALL_ID, 'bash')
        : candidate), /expected run_python/],
      ['chart', legalEvents().slice(0, 8).map((candidate, index) => index === 6
        ? toolCall(6, 160, ARTIFACT_CALL_ID, 'bash')
        : candidate), /expected save_chart/],
      ['outcome', legalEvents().map((candidate, index) => index === 8
        ? toolCall(8, 175, OUTCOME_CALL_ID, 'bash')
        : candidate), /expected publish_outcome/],
    ]
    for (const [name, events, pattern] of wrongNames) {
      expect(() => foldScience(events), name).toThrow(pattern)
    }

    const rRun = runStarted({ language: 'r' })
    const rEvents = [
      legalEvents()[0]!,
      event('science/environment-bound', 1, 110, {
        version: 1,
        environment: environmentWithoutPython({
          r: interpreter({ language: 'r' }),
        }),
      }),
      legalEvents()[2]!,
      toolCall(3, 130, RUN_CALL_ID, 'run_r'),
      event('science/run-started', 4, 140, { version: 1, run: rRun }),
    ]
    expect(foldScience(rEvents).runs).toEqual([rRun])
  })

  it('requires payload times to follow every authorizing and cited event', () => {
    const runCases: Array<readonly [string, SessionEvent[]]> = [
      ['request header', legalEvents().slice(0, 5).map((candidate, index) => index === 4
        ? event('science/run-started', 4, 140, {
          version: 1,
          run: runStarted({ startedAt: 119 }),
        })
        : candidate)],
      ['tool call', legalEvents().slice(0, 5).map((candidate, index) => index === 4
        ? event('science/run-started', 4, 140, {
          version: 1,
          run: runStarted({ startedAt: 129 }),
        })
        : candidate)],
    ]
    for (const [name, events] of runCases) {
      expect(() => foldScience(events), name).toThrow(/supporting-fact event interval/)
    }

    expect(() => foldScience([
      ...legalEvents().slice(0, 5),
      event('science/run-finished', 5, 150, {
        version: 1,
        run: runTerminal({ finishedAt: 139 }),
      }),
    ])).toThrow(/durable start-to-finish event interval/)

    const chartTimeCases: Array<readonly [string, SessionEvent[]]> = [
      ['request header', [
        ...legalEvents().slice(0, 6),
        event('request/header', 6, 165, {}),
        toolCall(7, 160, ARTIFACT_CALL_ID, 'save_chart'),
        event('science/artifact-saved', 8, 170, {
          version: 1,
          artifact: artifact({ requestHeaderSeq: 6, createdAt: 164 }),
        }),
      ]],
      ['tool call', legalEvents().slice(0, 8).map((candidate, index) => index === 7
        ? event('science/artifact-saved', 7, 170, {
          version: 1,
          artifact: artifact({ createdAt: 159 }),
        })
        : candidate)],
      ['source terminal event', [
        ...legalEvents().slice(0, 5),
        event('science/run-finished', 5, 165, { version: 1, run: runTerminal() }),
        toolCall(6, 150, ARTIFACT_CALL_ID, 'save_chart'),
        event('science/artifact-saved', 7, 170, {
          version: 1,
          artifact: artifact({ createdAt: 164 }),
        }),
      ]],
    ]
    for (const [name, events] of chartTimeCases) {
      expect(() => foldScience(events), name).toThrow(/supporting-fact event interval/)
    }

    const outcomeTimeCases: Array<readonly [string, SessionEvent[], RegExp]> = [
      ['request header', [
        ...legalEvents().slice(0, 8),
        event('request/header', 8, 178, {}),
        toolCall(9, 175, OUTCOME_CALL_ID, 'publish_outcome'),
        event('science/outcome-published', 10, 180, {
          version: 1,
          outcome: outcome({ requestHeaderSeq: 8, publishedAt: 177 }),
        }),
      ], /authorizing facts/],
      ['tool call', [
        ...legalEvents().slice(0, 9),
        event('science/outcome-published', 9, 180, {
          version: 1,
          outcome: outcome({ publishedAt: 174 }),
        }),
      ], /authorizing facts/],
      ['run evidence', [
        ...legalEvents().slice(0, 6),
        toolCall(6, 145, OUTCOME_CALL_ID, 'publish_outcome'),
        event('science/outcome-published', 7, 160, {
          version: 1,
          outcome: outcome({
            evidence: [{ kind: 'run', runId: RUN_ID }],
            publishedAt: 149,
          }),
        }),
      ], /precedes cited run evidence/],
      ['chart evidence', [
        ...legalEvents().slice(0, 8),
        toolCall(8, 165, OUTCOME_CALL_ID, 'publish_outcome'),
        event('science/outcome-published', 9, 180, {
          version: 1,
          outcome: outcome({ publishedAt: 169 }),
        }),
      ], /precedes cited chart evidence/],
      ['message evidence', [
        legalEvents()[0]!,
        event('request/header', 1, 110, {}),
        event('assistant/message', 2, 130, {}),
        toolCall(3, 120, OUTCOME_CALL_ID, 'publish_outcome'),
        event('science/outcome-published', 4, 140, {
          version: 1,
          outcome: outcome({
            evidence: [{ kind: 'message', seq: 2 }],
            publishedAt: 129,
            requestHeaderSeq: 1,
            environmentRevisions: [],
          }),
        }),
      ], /precedes cited message evidence/],
    ]
    for (const [name, events, pattern] of outcomeTimeCases) {
      expect(() => foldScience(events), name).toThrow(pattern)
    }
  })

  it('accepts a message-only outcome without environment provenance', () => {
    const events = [
      legalEvents()[0]!,
      event('request/header', 1, 110, {}),
      event('assistant/message', 2, 120, {}),
      toolCall(3, 125, OUTCOME_CALL_ID, 'publish_outcome'),
      event('science/outcome-published', 4, 130, {
        version: 1,
        outcome: outcome({
          evidence: [{ kind: 'message', seq: 2 }],
          publishedAt: 129,
          requestHeaderSeq: 1,
          environmentRevisions: [],
        }),
      }),
    ]

    expect(foldScience(events).outcomes).toEqual([
      outcome({
        evidence: [{ kind: 'message', seq: 2 }],
        publishedAt: 129,
        requestHeaderSeq: 1,
        environmentRevisions: [],
      }),
    ])
  })
})
