import { describe, expect, it } from 'vitest'
import { CallId, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  ScienceArtifactId,
  ScienceEnvironmentProfileId,
  ScienceRunId,
} from '../src/index.ts'
import { foldScience } from '../src/fold.ts'
import { emptyScienceFoldState } from '../src/fold-state.ts'
import { applyScienceEvent } from '../src/transition.ts'
import type { ScienceArtifactVersion } from '../src/index.ts'
import {
  ARTIFACT_CALL_ID,
  ARTIFACT_ID,
  OUTCOME_CALL_ID,
  RUN_CALL_ID,
  RUN_ID,
  artifact,
  autoArtifact,
  environment,
  event,
  failedInterpreter,
  legalEvents,
  mode,
  outcome,
  runStarted,
  runTerminal,
  toolCall,
} from './fixtures.ts'

describe('strict Science fold transitions', () => {
  it('rejects every strict transition discontinuity without mutating the contract', () => {
    const secondCall = CallId('call-second')
    const secondRunId = ScienceRunId('run-2')
    const invalidEnvironment = environment({
      revision: 2,
      profileId: ScienceEnvironmentProfileId('profile-2'),
      configuredAt: 111,
      validatedAt: 119,
      status: 'invalid',
      python: failedInterpreter('invalid'),
      failureReason: 'invalid binding',
    })
    const latestInvalid = [
      ...legalEvents().slice(0, 2),
      event('science/environment-bound', 2, 120, { version: 1, environment: invalidEnvironment }),
      event('request/header', 3, 130, {}),
      toolCall(4, 140, RUN_CALL_ID, 'run_python'),
      event('science/run-started', 5, 150, {
        version: 1,
        run: runStarted({ requestHeaderSeq: 3, startedAt: 149 }),
      }),
    ]
    const secondChart = (overrides: Partial<ScienceArtifactVersion>): SessionEvent[] => [
      ...legalEvents().slice(0, 8),
      toolCall(8, 180, secondCall, 'annotate_artifact'),
      event('science/artifact-saved', 9, 190, {
        version: 1,
        artifact: artifact({
          toolCallId: secondCall,
          createdAt: 189,
          ...overrides,
        }),
      }),
    ]

    const cases: Array<readonly [string, SessionEvent[], RegExp]> = [
      ['duplicate mode', [
        legalEvents()[0]!,
        event('science/mode-bound', 1, 110, { version: 1, mode: mode() }),
      ], /bound only once/],
      ['mode after step start', [
        event('step/start', 0, 90, { turn: 1, step: 1 }),
        event('science/mode-bound', 1, 100, { version: 1, mode: mode() }),
      ], /cannot follow pre-mode step\/start/],
      ['environment before mode', [
        event('science/environment-bound', 0, 110, { version: 1, environment: environment() }),
      ], /prior mode binding/],
      ['applied environment after a run', [
        ...legalEvents().slice(0, 6),
        event('science/environment-bound', 6, 160, {
          version: 1,
          environment: environment({
            revision: 2,
            profileId: ScienceEnvironmentProfileId('profile-2'),
            configuredAt: 151,
            validatedAt: 159,
          }),
        }),
      ], /cannot be replaced/],
      ['environment validation after event', [
        legalEvents()[0]!,
        event('science/environment-bound', 1, 108, { version: 1, environment: environment() }),
      ], /validation time/],
      ['run before mode', [
        event('science/run-started', 0, 140, { version: 1, run: runStarted() }),
      ], /prior mode binding/],
      ['run without tool call', legalEvents().slice(0, 5).map((candidate, index) => index === 4
        ? event('science/run-started', 4, 140, {
          version: 1,
          run: runStarted({ toolCallId: CallId('missing-call') }),
        })
        : candidate), /does not identify one call after its cited request\/header/],
      ['run without environment', legalEvents().slice(0, 5).map((candidate, index) => index === 4
        ? event('science/run-started', 4, 140, {
          version: 1,
          run: runStarted({ environmentRevision: 2 }),
        })
        : candidate), /revision 2 does not exist/],
      ['run against old environment', latestInvalid, /latest applied environment/],
      ['run without R binding', legalEvents().slice(0, 5).map((candidate, index) => index === 4
        ? event('science/run-started', 4, 140, {
          version: 1,
          run: runStarted({ language: 'r' }),
        })
        : candidate), /available environment binding/],
      ['run fingerprint mismatch', legalEvents().slice(0, 5).map((candidate, index) => index === 4
        ? event('science/run-started', 4, 140, {
          version: 1,
          run: runStarted({ environmentFingerprint: 'e'.repeat(64) }),
        })
        : candidate), /available environment binding/],
      ['run before validation', legalEvents().slice(0, 5).map((candidate, index) => index === 4
        ? event('science/run-started', 4, 140, {
          version: 1,
          run: runStarted({ startedAt: 108 }),
        })
        : candidate), /start time/],
      ['run after event', legalEvents().slice(0, 5).map((candidate, index) => index === 4
        ? event('science/run-started', 4, 140, {
          version: 1,
          run: runStarted({ startedAt: 141 }),
        })
        : candidate), /start time/],
      ['concurrent run', [
        ...legalEvents().slice(0, 5),
        toolCall(5, 150, secondCall, 'run_python'),
        event('science/run-started', 6, 160, {
          version: 1,
          run: runStarted({
            runId: secondRunId,
            toolCallId: secondCall,
            startedAt: 159,
            runDirectoryRef: 'runs/run-2/',
          }),
        }),
      ], /only one Science run/],
      ['finish without start', [
        event('science/run-finished', 0, 150, { version: 1, run: runTerminal() }),
      ], /no matching start/],
      ['finish after terminal', [
        ...legalEvents().slice(0, 6),
        event('science/run-finished', 6, 160, { version: 1, run: runTerminal() }),
      ], /already terminal/],
      ['finish after event', [
        ...legalEvents().slice(0, 5),
        event('science/run-finished', 5, 148, { version: 1, run: runTerminal() }),
      ], /finish time/],
      ['chart before mode', [
        event('science/artifact-saved', 0, 170, { version: 1, artifact: artifact() }),
      ], /prior mode binding/],
      ['chart from running run', [
        ...legalEvents().slice(0, 5),
        toolCall(5, 150, ARTIFACT_CALL_ID, 'annotate_artifact'),
        event('science/artifact-saved', 6, 160, {
          version: 1,
          artifact: artifact({ createdAt: 159 }),
        }),
      ], /reference a run that reached a terminal status/],
      ['auto artifact toolCallId does not match its source run', [
        ...legalEvents().slice(0, 6),
        event('science/artifact-saved', 6, 165, {
          version: 1,
          artifact: autoArtifact({ toolCallId: CallId('mismatched-call'), createdAt: 165 }),
        }),
      ], /must carry its source run's own toolCallId/],
      ['auto artifact requestHeaderSeq does not match its source run', [
        ...legalEvents().slice(0, 6),
        event('request/header', 6, 165, {
          header: { config: { provider: 'test', model: 'test-model' } },
          reason: 'second',
        }),
        event('science/artifact-saved', 7, 170, {
          version: 1,
          artifact: autoArtifact({ requestHeaderSeq: 6, createdAt: 170 }),
        }),
      ], /must carry its source run's own toolCallId/],
      ['chart without tool call', legalEvents().slice(0, 8).map((candidate, index) => index === 7
        ? event('science/artifact-saved', 7, 170, {
          version: 1,
          artifact: artifact({ toolCallId: CallId('missing-call') }),
        })
        : candidate), /does not identify one call after its cited request\/header/],
      ['chart environment revision mismatch', legalEvents().slice(0, 8).map((candidate, index) => index === 7
        ? event('science/artifact-saved', 7, 170, {
          version: 1,
          artifact: artifact({ environmentRevision: 2 }),
        })
        : candidate), /environment provenance/],
      ['chart fingerprint mismatch', legalEvents().slice(0, 8).map((candidate, index) => index === 7
        ? event('science/artifact-saved', 7, 170, {
          version: 1,
          artifact: artifact({ environmentFingerprint: 'e'.repeat(64) }),
        })
        : candidate), /environment provenance/],
      ['chart before run finish', legalEvents().slice(0, 8).map((candidate, index) => index === 7
        ? event('science/artifact-saved', 7, 170, { version: 1, artifact: artifact({ createdAt: 148 }) })
        : candidate), /creation time/],
      ['chart after event', legalEvents().slice(0, 8).map((candidate, index) => index === 7
        ? event('science/artifact-saved', 7, 170, { version: 1, artifact: artifact({ createdAt: 171 }) })
        : candidate), /creation time/],
      ['artifactId reused for another logical artifact', secondChart({ logicalName: 'other' }), /two logical artifacts/],
      ['chart version changes identity', secondChart({ artifactId: ScienceArtifactId('chart-2'), version: 2 }), /advance contiguously/],
      ['chart version skips', secondChart({ version: 3 }), /advance contiguously/],
      ['chart version moves creation time backwards', [
        ...legalEvents().slice(0, 8),
        toolCall(8, 168, secondCall, 'annotate_artifact'),
        event('science/artifact-saved', 9, 190, {
          version: 1,
          artifact: artifact({
            version: 2,
            toolCallId: secondCall,
            createdAt: 168,
          }),
        }),
      ], /advance contiguously/],
      ['outcome before mode', [
        event('science/outcome-published', 0, 180, { version: 1, outcome: outcome() }),
      ], /prior mode binding/],
      ['outcome after event', legalEvents().map((candidate, index) => index === 9
        ? event('science/outcome-published', 9, 180, {
          version: 1,
          outcome: outcome({ publishedAt: 181 }),
        })
        : candidate), /publication time/],
      ['outcome time regresses', [
        ...legalEvents(),
        toolCall(10, 185, CallId('call-outcome-2'), 'publish_outcome'),
        event('science/outcome-published', 11, 190, {
          version: 1,
          outcome: outcome({
            revision: 2,
            publishedAt: 178,
            toolCallId: CallId('call-outcome-2'),
          }),
        }),
      ], /publication time/],
      ['outcome environment missing', legalEvents().map((candidate, index) => index === 9
        ? event('science/outcome-published', 9, 180, {
          version: 1,
          outcome: outcome({ environmentRevisions: [2] }),
        })
        : candidate), /revision 2 does not exist/],
      ['outcome environment not applied', [
        legalEvents()[0]!,
        event('science/environment-bound', 1, 110, {
          version: 1,
          environment: environment({
            status: 'invalid',
            python: failedInterpreter('invalid'),
            failureReason: 'invalid binding',
          }),
        }),
        event('request/header', 2, 120, {}),
        event('assistant/message', 3, 130, {}),
        toolCall(4, 135, OUTCOME_CALL_ID, 'publish_outcome'),
        event('science/outcome-published', 5, 140, {
          version: 1,
          outcome: outcome({
            evidence: [{ kind: 'message', seq: 3 }],
            publishedAt: 139,
          }),
        }),
      ], /environment revision 1 was not applied/],
      ['outcome run evidence missing', legalEvents().map((candidate, index) => index === 9
        ? event('science/outcome-published', 9, 180, {
          version: 1,
          outcome: outcome({ evidence: [{ kind: 'run', runId: ScienceRunId('missing-run') }] }),
        })
        : candidate), /not a successful prior run/],
      ['outcome run evidence not terminal', [
        ...legalEvents().slice(0, 5),
        toolCall(5, 145, OUTCOME_CALL_ID, 'publish_outcome'),
        event('science/outcome-published', 6, 150, {
          version: 1,
          outcome: outcome({
            evidence: [{ kind: 'run', runId: RUN_ID }],
            publishedAt: 149,
          }),
        }),
      ], /not a successful prior run/],
      ['outcome chart evidence missing', legalEvents().map((candidate, index) => index === 9
        ? event('science/outcome-published', 9, 180, {
          version: 1,
          outcome: outcome({ evidence: [{ kind: 'chart', chartId: ARTIFACT_ID, version: 2 }] }),
        })
        : candidate), /chart evidence/],
      ['outcome message evidence missing', legalEvents().map((candidate, index) => index === 9
        ? event('science/outcome-published', 9, 180, {
          version: 1,
          outcome: outcome({ evidence: [{ kind: 'message', seq: 99 }] }),
        })
        : candidate), /message evidence/],
    ]

    for (const [name, events, pattern] of cases) {
      expect(() => foldScience(events), name).toThrow(pattern)
    }
  })

  it('indexes supporting events and accepts each evidence kind', () => {
    const supportingState = emptyScienceFoldState()
    const supportingEvents = [
      event('user/message', 0, 1, {}),
      event('assistant/message', 1, 2, {}),
      event('tool/result', 2, 3, {
        message: createToolResultMessage({
          callId: RUN_CALL_ID,
          content: [{ type: 'text', text: 'done' }],
          isError: false,
        }),
      }),
      event('request/header', 3, 4, {}),
      toolCall(4, 5, RUN_CALL_ID, 'run_python'),
      event('turn/start', 5, 6, {}),
    ]
    for (const supportingEvent of supportingEvents) applyScienceEvent(supportingState, supportingEvent)
    expect(supportingState.messageFacts).toEqual([
      { seq: 0, time: 1 },
      { seq: 1, time: 2 },
      { seq: 2, time: 3 },
    ])
    expect(supportingState.requestHeaders).toEqual([{ seq: 3, time: 4 }])
    expect(supportingState.toolCalls).toEqual([{
      seq: 4,
      time: 5,
      callId: RUN_CALL_ID,
      turn: 1,
      step: 1,
      name: 'run_python',
    }])
    expect(supportingState.settledToolCallSeqs).toEqual([])
    expect(supportingState.consumedToolCallSeqs).toEqual([])

    const postModeStep = emptyScienceFoldState()
    applyScienceEvent(postModeStep, legalEvents()[0]!)
    applyScienceEvent(postModeStep, event('step/start', 1, 101, { turn: 1, step: 1 }))
    expect(postModeStep.preModeStepStarted).toBe(false)

    const withMessageEvidence = [
      ...legalEvents().slice(0, 8),
      event('assistant/message', 8, 175, {}),
      toolCall(9, 176, OUTCOME_CALL_ID, 'publish_outcome'),
      event('science/outcome-published', 10, 180, {
        version: 1,
        outcome: outcome({ evidence: [
          { kind: 'run', runId: RUN_ID },
          { kind: 'chart', chartId: ARTIFACT_ID, version: 1 },
          { kind: 'message', seq: 8 },
        ] }),
      }),
    ]
    expect(() => foldScience(withMessageEvidence)).not.toThrow()

    const secondEnvironment = environment({
      revision: 2,
      profileId: ScienceEnvironmentProfileId('profile-2'),
      configuredAt: 111,
      validatedAt: 119,
    })
    const runOnSecondEnvironment = runStarted({
      requestHeaderSeq: 3,
      environmentRevision: 2,
      startedAt: 139,
    })
    const terminalOnSecondEnvironment = runTerminal({
      requestHeaderSeq: 3,
      environmentRevision: 2,
      startedAt: 139,
    })
    const outcomeOnSecondEnvironment = (environmentRevisions: readonly number[]): SessionEvent[] => [
      legalEvents()[0]!,
      legalEvents()[1]!,
      event('science/environment-bound', 2, 120, {
        version: 1,
        environment: secondEnvironment,
      }),
      event('request/header', 3, 130, {}),
      toolCall(4, 135, RUN_CALL_ID, 'run_python'),
      event('science/run-started', 5, 140, { version: 1, run: runOnSecondEnvironment }),
      event('science/run-finished', 6, 150, { version: 1, run: terminalOnSecondEnvironment }),
      toolCall(7, 155, OUTCOME_CALL_ID, 'publish_outcome'),
      event('science/outcome-published', 8, 160, {
        version: 1,
        outcome: outcome({
          evidence: [{ kind: 'run', runId: RUN_ID }],
          publishedAt: 159,
          requestHeaderSeq: 3,
          environmentRevisions,
        }),
      }),
    ]
    expect(() => foldScience(outcomeOnSecondEnvironment([1])))
      .toThrow(/environmentRevisions must exactly match cited run and chart evidence/)
    expect(() => foldScience(outcomeOnSecondEnvironment([1, 2])))
      .toThrow(/environmentRevisions must exactly match cited run and chart evidence/)

    const chartVersionTwo = [
      ...legalEvents().slice(0, 8),
      toolCall(8, 180, CallId('call-chart-2'), 'annotate_artifact'),
      event('science/artifact-saved', 9, 190, {
        version: 1,
        artifact: artifact({
          version: 2,
          toolCallId: CallId('call-chart-2'),
          createdAt: 189,
        }),
      }),
    ]
    expect(foldScience(chartVersionTwo).artifacts.map(candidate => candidate.version)).toEqual([1, 2])
  })

  it('creates a new version for a curation-only re-save with an identical attachment', () => {
    // The fold has no content-hash dedup of its own — deciding whether an
    // unchanged attachment warrants a new version is the capture/curation
    // caller's decision (see the Runtime), not this package's. A re-save
    // that only changes title, caption, and origin must still be accepted
    // as the next contiguous version.
    const events = [
      ...legalEvents().slice(0, 8),
      toolCall(8, 180, CallId('call-chart-2'), 'annotate_artifact'),
      event('science/artifact-saved', 9, 190, {
        version: 1,
        artifact: artifact({
          version: 2,
          toolCallId: CallId('call-chart-2'),
          createdAt: 189,
          title: 'Curated trend',
          caption: 'Selected by the model.',
          origin: 'model',
          // Identical attachment reference to the version-1 fixture.
        }),
      }),
    ]
    const state = foldScience(events)
    expect(state.artifacts.map(candidate => ({
      version: candidate.version,
      title: candidate.title,
      caption: candidate.caption,
      origin: candidate.origin,
      attachment: candidate.attachment,
    }))).toEqual([
      { version: 1, title: 'Trend', caption: undefined, origin: 'model', attachment: artifact().attachment },
      {
        version: 2,
        title: 'Curated trend',
        caption: 'Selected by the model.',
        origin: 'model',
        attachment: artifact().attachment,
      },
    ])
  })

  it('rejects invalid event positions and timestamps', () => {
    const cases: SessionEvent[] = [
      event('turn/start', 1, 0, {}),
      event('turn/start', 0.5, 0, {}),
      event('turn/start', 0, -1, {}),
      event('turn/start', 0, 0.5, {}),
    ]
    for (const candidate of cases) {
      expect(() => { applyScienceEvent(emptyScienceFoldState(), candidate) }).toThrow()
    }
  })

  it('derives interruption only for an unmatched run at session/end-seed', () => {
    const openRun = legalEvents().slice(0, 5)
    openRun.push(event('session/end-seed', 5, 150, {}))
    const interrupted = foldScience(openRun)
    expect(interrupted.runs).toEqual([{
      ...runStarted(),
      status: 'interrupted',
      finishedAt: 150,
      interruptedAtSeq: 5,
    }])
    expect(interrupted.lastScienceEventSeq).toBe(5)

    const settledRun = legalEvents().slice(0, 6)
    settledRun.push(event('session/end-seed', 6, 160, {}))
    const settled = foldScience(settledRun)
    expect(settled.runs).toEqual([runTerminal()])
    expect(settled.lastScienceEventSeq).toBe(5)

    const twoRuns = [
      ...legalEvents().slice(0, 6),
      toolCall(6, 160, CallId('call-run-2'), 'run_python'),
      event('science/run-started', 7, 170, {
        version: 1,
        run: runStarted({
          runId: ScienceRunId('run-2'),
          toolCallId: CallId('call-run-2'),
          startedAt: 169,
          runDirectoryRef: 'runs/run-2/',
        }),
      }),
      event('session/end-seed', 8, 180, {}),
    ]
    const mixed = foldScience(twoRuns)
    expect(mixed.runs[0]).toEqual(runTerminal())
    expect(mixed.runs[1]).toMatchObject({ status: 'interrupted', interruptedAtSeq: 8 })

    const backwardsBoundary = [...openRun.slice(0, 5), event('session/end-seed', 5, 139, {})]
    expect(() => foldScience(backwardsBoundary)).toThrow(/moves time backwards/)
  })
})
