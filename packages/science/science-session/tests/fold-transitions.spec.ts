import { describe, expect, it } from 'vitest'
import { CallId, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  ScienceEnvironmentProfileId,
  ScienceRunId,
  ScienceVersionId,
} from '../src/index.ts'
import { foldScience } from '../src/fold.ts'
import { emptyScienceFoldState } from '../src/fold-state.ts'
import { applyScienceEvent } from '../src/transition.ts'
import {
  ARTIFACT_ID,
  OUTCOME_CALL_ID,
  RUN_CALL_ID,
  RUN_ID,
  artifact,
  environment,
  event,
  failedInterpreter,
  kernelExited,
  kernelStarted,
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
    const runNamesUnstartedKernel = [
      ...legalEvents().slice(0, 2),
      event('request/header', 2, 120, {}),
      toolCall(3, 130, RUN_CALL_ID, 'run_python'),
      event('science/run-started', 4, 140, {
        version: 1,
        run: runStarted({ requestHeaderSeq: 2, startedAt: 139 }),
      }),
    ]
    const runNamesExitedKernel = [
      ...legalEvents().slice(0, 2),
      event('science/kernel-state', 2, 115, { version: 1, kernel: kernelStarted() }),
      event('science/kernel-state', 3, 116, { version: 1, kernel: kernelExited({ at: 116 }) }),
      event('request/header', 4, 120, {}),
      toolCall(5, 130, RUN_CALL_ID, 'run_python'),
      event('science/run-started', 6, 140, {
        version: 1,
        run: runStarted({ requestHeaderSeq: 4, startedAt: 139 }),
      }),
    ]
    const runAgainstReboundKernel = [
      ...legalEvents().slice(0, 2),
      event('science/kernel-state', 2, 115, { version: 1, kernel: kernelStarted() }),
      event('science/environment-bound', 3, 120, {
        version: 1,
        environment: environment({ revision: 2, configuredAt: 119, validatedAt: 119 }),
      }),
      event('request/header', 4, 125, {}),
      toolCall(5, 130, RUN_CALL_ID, 'run_python'),
      event('science/run-started', 6, 140, {
        version: 1,
        run: runStarted({ requestHeaderSeq: 4, startedAt: 139, environmentRevision: 2 }),
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
      ['applied environment while a run is in progress', [
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
      ], /Science run is in progress/],
      ['environment validation after event', [
        legalEvents()[0]!,
        event('science/environment-bound', 1, 108, { version: 1, environment: environment() }),
      ], /validation time/],
      ['run before mode', [
        event('science/run-started', 0, 140, { version: 1, run: runStarted() }),
      ], /prior mode binding/],
      ['run without tool call', legalEvents().slice(0, 6).map((candidate, index) => index === 5
        ? event('science/run-started', 5, 140, {
          version: 1,
          run: runStarted({ toolCallId: CallId('missing-call') }),
        })
        : candidate), /does not identify one call after its cited request\/header/],
      ['run without environment', legalEvents().slice(0, 6).map((candidate, index) => index === 5
        ? event('science/run-started', 5, 140, {
          version: 1,
          run: runStarted({ environmentRevision: 2 }),
        })
        : candidate), /revision 2 does not exist/],
      ['run against old environment', latestInvalid, /latest applied environment/],
      ['run kernel epoch never started', runNamesUnstartedKernel, /does not name a started kernel/],
      ['run kernel epoch already exited', runNamesExitedKernel, /does not name a started kernel/],
      ['run environment provenance does not match its kernel', runAgainstReboundKernel, /environment provenance does not match its kernel/],
      ['run without R binding', legalEvents().slice(0, 6).map((candidate, index) => index === 5
        ? event('science/run-started', 5, 140, {
          version: 1,
          run: runStarted({ language: 'r' }),
        })
        : candidate), /available environment binding/],
      ['run fingerprint mismatch', legalEvents().slice(0, 6).map((candidate, index) => index === 5
        ? event('science/run-started', 5, 140, {
          version: 1,
          run: runStarted({ environmentFingerprint: 'e'.repeat(64) }),
        })
        : candidate), /available environment binding/],
      ['run before validation', legalEvents().slice(0, 6).map((candidate, index) => index === 5
        ? event('science/run-started', 5, 140, {
          version: 1,
          run: runStarted({ startedAt: 108 }),
        })
        : candidate), /start time/],
      ['run after event', legalEvents().slice(0, 6).map((candidate, index) => index === 5
        ? event('science/run-started', 5, 140, {
          version: 1,
          run: runStarted({ startedAt: 141 }),
        })
        : candidate), /start time/],
      ['concurrent run', [
        ...legalEvents().slice(0, 6),
        toolCall(6, 150, secondCall, 'run_python'),
        event('science/run-started', 7, 160, {
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
        ...legalEvents().slice(0, 7),
        event('science/run-finished', 7, 160, { version: 1, run: runTerminal() }),
      ], /already terminal/],
      ['finish after event', [
        ...legalEvents().slice(0, 6),
        event('science/run-finished', 6, 148, { version: 1, run: runTerminal() }),
      ], /finish time/],
      ['chart before mode', [
        event('science/artifact-saved', 0, 170, { version: 1, artifact: artifact() }),
      ], /prior mode binding/],
      ['chart versionId reused by a different committed version', [
        ...legalEvents().slice(0, 9),
        event('science/artifact-saved', 9, 180, {
          version: 1,
          artifact: artifact({ version: 2 }),
        }),
      ], /versionId cannot back two committed versions/],
      // Once this session's own log carries versions 1 and 4 for ARTIFACT_ID
      // (the version-4 save itself accepted as an S3 interleaving gap, see
      // fold.spec.ts), a value inside that locally-known range which
      // matches neither is still a same-session inconsistency the log alone
      // can catch, and throws.
      ['chart version regresses inside the locally-known range', [
        ...legalEvents().slice(0, 9),
        event('science/artifact-saved', 9, 190, {
          version: 1,
          artifact: artifact({ version: 4, versionId: ScienceVersionId('version-gap-ahead') }),
        }),
        event('science/artifact-saved', 10, 200, {
          version: 1,
          artifact: artifact({ version: 2, versionId: ScienceVersionId('version-gap-mismatch') }),
        }),
      ], /advance beyond the locally committed version/],
      ['outcome before mode', [
        event('science/outcome-published', 0, 180, { version: 1, outcome: outcome() }),
      ], /prior mode binding/],
      ['outcome after event', legalEvents().map((candidate, index) => index === 10
        ? event('science/outcome-published', 10, 180, {
          version: 1,
          outcome: outcome({ publishedAt: 181 }),
        })
        : candidate), /publication time/],
      ['outcome time regresses', [
        ...legalEvents(),
        toolCall(11, 185, CallId('call-outcome-2'), 'publish_outcome'),
        event('science/outcome-published', 12, 190, {
          version: 1,
          outcome: outcome({
            revision: 2,
            publishedAt: 178,
            toolCallId: CallId('call-outcome-2'),
          }),
        }),
      ], /publication time/],
      ['outcome environment missing', legalEvents().map((candidate, index) => index === 10
        ? event('science/outcome-published', 10, 180, {
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
            requestHeaderSeq: 2,
            environmentRevisions: [1],
          }),
        }),
      ], /environment revision 1 was not applied/],
      ['outcome run evidence missing', legalEvents().map((candidate, index) => index === 10
        ? event('science/outcome-published', 10, 180, {
          version: 1,
          outcome: outcome({ evidence: [{ kind: 'run', runId: ScienceRunId('missing-run') }] }),
        })
        : candidate), /not a successful prior run/],
      ['outcome run evidence not terminal', [
        ...legalEvents().slice(0, 6),
        toolCall(6, 145, OUTCOME_CALL_ID, 'publish_outcome'),
        event('science/outcome-published', 7, 150, {
          version: 1,
          outcome: outcome({
            evidence: [{ kind: 'run', runId: RUN_ID }],
            publishedAt: 149,
          }),
        }),
      ], /not a successful prior run/],
      ['outcome chart evidence missing', legalEvents().map((candidate, index) => index === 10
        ? event('science/outcome-published', 10, 180, {
          version: 1,
          outcome: outcome({ evidence: [{ kind: 'chart', chartId: ARTIFACT_ID, version: 2 }] }),
        })
        : candidate), /chart evidence/],
      ['outcome message evidence missing', legalEvents().map((candidate, index) => index === 10
        ? event('science/outcome-published', 10, 180, {
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
      ...legalEvents().slice(0, 9),
      event('assistant/message', 9, 175, {}),
      toolCall(10, 176, OUTCOME_CALL_ID, 'publish_outcome'),
      event('science/outcome-published', 11, 180, {
        version: 1,
        outcome: outcome({
          evidence: [
            { kind: 'run', runId: RUN_ID },
            { kind: 'chart', chartId: ARTIFACT_ID, version: 1 },
            { kind: 'message', seq: 9 },
          ],
          // Chart evidence contributes no environmentRevisions; only the run does.
          environmentRevisions: [1],
        }),
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
      requestHeaderSeq: 4,
      environmentRevision: 2,
      startedAt: 139,
    })
    const terminalOnSecondEnvironment = runTerminal({
      requestHeaderSeq: 4,
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
      event('science/kernel-state', 3, 125, { version: 1, kernel: kernelStarted({ environmentRevision: 2, at: 125 }) }),
      event('request/header', 4, 130, {}),
      toolCall(5, 135, RUN_CALL_ID, 'run_python'),
      event('science/run-started', 6, 140, { version: 1, run: runOnSecondEnvironment }),
      event('science/run-finished', 7, 150, { version: 1, run: terminalOnSecondEnvironment }),
      toolCall(8, 155, OUTCOME_CALL_ID, 'publish_outcome'),
      event('science/outcome-published', 9, 160, {
        version: 1,
        outcome: outcome({
          evidence: [{ kind: 'run', runId: RUN_ID }],
          publishedAt: 159,
          requestHeaderSeq: 4,
          environmentRevisions,
        }),
      }),
    ]
    expect(() => foldScience(outcomeOnSecondEnvironment([1])))
      .toThrow(/environmentRevisions must exactly match cited run and chart evidence/)
    expect(() => foldScience(outcomeOnSecondEnvironment([1, 2])))
      .toThrow(/environmentRevisions must exactly match cited run and chart evidence/)

    const chartVersionTwo = [
      ...legalEvents().slice(0, 9),
      event('science/artifact-saved', 9, 190, {
        version: 1,
        artifact: artifact({
          version: 2,
          versionId: ScienceVersionId('version-chart-2'),
        }),
      }),
    ]
    expect(foldScience(chartVersionTwo).artifacts.map(candidate => candidate.version)).toEqual([1, 2])
  })

  it('accepts a new version whose content sha256 repeats a prior version verbatim', () => {
    // The fold has no content-hash dedup of its own — deciding whether
    // unchanged content warrants a new version is the capture/curation
    // caller's decision (see the Runtime), not this package's. A fresh
    // store row must still be accepted as the next contiguous version even
    // when its content matches a prior version byte for byte.
    const events = [
      ...legalEvents().slice(0, 9),
      event('science/artifact-saved', 9, 190, {
        version: 1,
        artifact: artifact({
          version: 2,
          title: 'Curated trend',
          caption: 'Selected by the model.',
          // Identical sha256 to the version-1 fixture; fresh store row.
          versionId: ScienceVersionId('version-resave'),
        }),
      }),
    ]
    const state = foldScience(events)
    expect(state.artifacts.map(candidate => ({
      version: candidate.version,
      title: candidate.title,
      caption: candidate.caption,
      sha256: candidate.sha256,
    }))).toEqual([
      { version: 1, title: 'Trend', caption: undefined, sha256: artifact().sha256 },
      {
        version: 2,
        title: 'Curated trend',
        caption: 'Selected by the model.',
        sha256: artifact().sha256,
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

  it('rejects a repeated turn/start and a turn/end without one currently open turn', () => {
    expect(() => foldScience([
      event('turn/start', 0, 0, { turn: 1 }),
      event('turn/start', 1, 10, { turn: 1 }),
    ])).toThrow(/turn\/start cannot repeat a turn/)

    expect(() => foldScience([
      event('turn/end', 0, 0, { turn: 1, reason: { kind: 'completed' } }),
    ])).toThrow(/turn\/end requires one open turn/)

    expect(() => foldScience([
      event('turn/start', 0, 0, { turn: 1 }),
      event('turn/end', 1, 10, { turn: 1, reason: { kind: 'completed' } }),
      event('turn/end', 2, 20, { turn: 1, reason: { kind: 'completed' } }),
    ])).toThrow(/turn\/end requires one open turn/)
  })

  it('derives interruption only for an unmatched run at session/end-seed', () => {
    const openRun = legalEvents().slice(0, 6)
    openRun.push(event('session/end-seed', 6, 150, {}))
    const interrupted = foldScience(openRun)
    expect(interrupted.runs).toEqual([{
      ...runStarted(),
      status: 'interrupted',
      finishedAt: 150,
      interruptedAtSeq: 6,
    }])
    expect(interrupted.lastScienceEventSeq).toBe(6)

    const settledRun = legalEvents().slice(0, 7)
    settledRun.push(event('session/end-seed', 7, 160, {}))
    const settled = foldScience(settledRun)
    expect(settled.runs).toEqual([runTerminal()])
    // The run itself already reached terminal status, but its kernel is
    // still open (never exited) throughout this fixture chain: the
    // session/end-seed boundary still derives that kernel's own
    // interruption, so it still commits Science
    // time at its own seq rather than leaving it at run-finished's.
    expect(settled.lastScienceEventSeq).toBe(7)

    const twoRuns = [
      ...legalEvents().slice(0, 7),
      toolCall(7, 160, CallId('call-run-2'), 'run_python'),
      event('science/run-started', 8, 170, {
        version: 1,
        run: runStarted({
          runId: ScienceRunId('run-2'),
          toolCallId: CallId('call-run-2'),
          startedAt: 169,
          runDirectoryRef: 'runs/run-2/',
        }),
      }),
      event('session/end-seed', 9, 180, {}),
    ]
    const mixed = foldScience(twoRuns)
    expect(mixed.runs[0]).toEqual(runTerminal())
    expect(mixed.runs[1]).toMatchObject({ status: 'interrupted', interruptedAtSeq: 9 })

    const backwardsBoundary = [...openRun.slice(0, 6), event('session/end-seed', 6, 139, {})]
    expect(() => foldScience(backwardsBoundary)).toThrow(/moves time backwards/)
  })
})
