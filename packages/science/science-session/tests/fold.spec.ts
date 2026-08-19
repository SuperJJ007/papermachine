import { describe, expect, it } from 'vitest'
import { CallId } from '@deepseek-ai/dsh-llm'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  decodeScienceArtifact,
  decodeScienceEnvironment,
  decodeScienceDomainEvent,
  decodeScienceOutcome,
  decodeScienceRunStarted,
  decodeScienceRunTerminal,
  ScienceArtifactId,
  ScienceRunId,
} from '../src/index.ts'
import { isScienceDomainEventType } from '../src/codec.ts'
import { foldScience } from '../src/fold.ts'
import {
  ARTIFACT_CALL_ID,
  ARTIFACT_ID,
  OUTCOME_CALL_ID,
  RUN_CALL_ID,
  RUN_ID,
  artifact,
  autoArtifact,
  environment,
  environmentWithoutPython,
  event,
  failedInterpreter,
  interpreter,
  legalEvents,
  mode,
  outcome,
  runStarted,
  runTerminal,
  toolCall,
} from './fixtures.ts'

describe('strict Science fold', () => {
  it('folds one legal chain containing all six Science event types', () => {
    const state = foldScience(legalEvents())

    expect(state.mode).toEqual(mode())
    expect(state.modeBoundSeq).toBe(0)
    expect(state.environments).toEqual([environment()])
    expect(state.runs).toEqual([runTerminal()])
    expect(state.artifacts).toEqual([artifact()])
    expect(state.outcomes).toEqual([outcome()])
    expect(state.nextSeq).toBe(11)
    expect(state.lastScienceEventSeq).toBe(10)
    expect(state.lastScienceTime).toBe(180)
    expect(state.requestHeaders).toEqual([{ seq: 3, time: 120 }])
    expect(state.toolCalls).toEqual([
      { seq: 4, time: 130, callId: RUN_CALL_ID, turn: 1, step: 1, name: 'run_python' },
      { seq: 7, time: 160, callId: ARTIFACT_CALL_ID, turn: 1, step: 1, name: 'annotate_artifact' },
      { seq: 9, time: 175, callId: OUTCOME_CALL_ID, turn: 1, step: 1, name: 'publish_outcome' },
    ])
    expect(state.settledToolCallSeqs).toEqual([])
    expect(state.messageFacts).toEqual([])
    expect(state.consumedToolCallSeqs).toEqual([4, 7, 9])
  })

  it('folds an auto-captured text artifact that carries its source run\'s own toolCallId, consuming no fresh tool call', () => {
    const events: SessionEvent[] = [
      ...legalEvents().slice(0, 7),
      event('science/artifact-saved', 7, 165, { version: 1, artifact: autoArtifact({ createdAt: 165 }) }),
    ]
    const state = foldScience(events)

    expect(state.artifacts).toEqual([autoArtifact({ createdAt: 165 })])
    expect(state.consumedToolCallSeqs).toEqual([4])
    expect(decodeScienceArtifact(autoArtifact({ createdAt: 165 }))).toEqual(autoArtifact({ createdAt: 165 }))
  })

  it('uses strict payload schemas for every Science event', () => {
    const scienceEvents = legalEvents().filter(candidate => candidate.type.startsWith('science/'))
    for (const candidate of scienceEvents) {
      const data = candidate.data as unknown as Record<string, unknown>
      expect(
        () => decodeScienceDomainEvent({
          ...candidate,
          data: { ...data, unexpected: true },
        } as SessionEvent),
        candidate.type,
      ).toThrow()
    }

    expect(() => decodeScienceDomainEvent(event('science/mode-bound', 0, 100, {
      version: 1,
      mode: { ...mode(), unexpected: true },
    }))).toThrow()
    expect(() => decodeScienceDomainEvent({
      ...legalEvents()[0]!,
      ignorable: true,
    })).toThrow(/required, not ignorable/)
    expect(() => decodeScienceDomainEvent(event('science/mode-bound', 0, 100, {
      version: 2,
      mode: mode(),
    }))).toThrow()

    expect(() => decodeScienceDomainEvent(event('science/future-required', 0, 100, {})))
      .toThrow(/unsupported required Science event type/)
    expect(decodeScienceDomainEvent({
      ...event('science/future-ignorable', 0, 100, {}),
      ignorable: true,
    })).toBeUndefined()
    expect(decodeScienceDomainEvent(event('turn/start', 0, 100, {}))).toBeUndefined()
  })

  it('enforces every environment and run cross-field schema rule', () => {
    const invalidEnvironments: unknown[] = [
      environment({ python: { ...interpreter(), reason: 'unexpected' } as unknown as never }),
      environment({
        status: 'invalid',
        failureReason: 'invalid binding',
        python: {
          language: 'python',
          configuredPrefix: '/opt/science',
          capability: 'invalid',
        } as unknown as never,
      }),
      environmentWithoutPython(),
      environment({ python: interpreter({ language: 'r' }) }),
      environmentWithoutPython({ r: interpreter() }),
      environment({ configuredAt: 110, validatedAt: 109 }),
      environment({
        python: failedInterpreter('invalid'),
      }),
      environment({ failureReason: 'unexpected' }),
      environment({
        status: 'invalid',
        python: failedInterpreter('invalid'),
      }),
      environment({
        status: 'drifted',
        python: failedInterpreter('drifted'),
      }),
    ]
    for (const candidate of invalidEnvironments) {
      expect(() => decodeScienceEnvironment(candidate)).toThrow()
    }

    expect(decodeScienceEnvironment(environment({
      status: 'invalid',
      failureReason: 'interpreter missing',
      python: failedInterpreter('unavailable', {
        configuredPrefix: 'C:\\science',
        reason: 'interpreter missing',
      }),
    }))).toMatchObject({
      status: 'invalid',
      python: { capability: 'unavailable', configuredPrefix: 'C:\\science' },
    })
    expect(decodeScienceEnvironment(environment({
      status: 'drifted',
      failureReason: 'identity changed',
      python: failedInterpreter('drifted', {
        canonicalPrefix: '\\\\science-host\\envs\\profile',
        reason: 'identity changed',
      }),
    }))).toMatchObject({ status: 'drifted', python: { capability: 'drifted' } })

    const invalidStarts: unknown[] = [
      runStarted({ runDirectoryRef: 'runs/not-the-run/' }),
    ]
    for (const candidate of invalidStarts) {
      expect(() => decodeScienceRunStarted(candidate)).toThrow()
    }

    const invalidTerminals: unknown[] = [
      runTerminal({ runDirectoryRef: 'runs/not-the-run/' }),
      runTerminal({ finishedAt: 138 }),
      runTerminal({ exitCode: 1 }),
      runTerminal({ signal: 'TERM' }),
      runTerminal({ failureCode: 'FAILED' }),
      runTerminal({ failureMessage: 'unexpected' }),
      runTerminal({ status: 'failed', exitCode: 1 }),
    ]
    for (const candidate of invalidTerminals) {
      expect(() => decodeScienceRunTerminal(candidate)).toThrow()
    }
    expect(() => decodeScienceRunTerminal(runTerminal({
      status: 'failed',
      exitCode: 1,
      failureCode: 'RUN_FAILED',
      failureMessage: 'expected failure',
    }))).not.toThrow()
  })

  it('enforces outcome normalization and exposes stable vocabulary helpers', () => {
    expect(decodeScienceArtifact(artifact())).toEqual(artifact())
    expect(() => decodeScienceOutcome(outcome({
      evidence: [
        { kind: 'run', runId: RUN_ID },
        { kind: 'chart', chartId: ARTIFACT_ID, version: 1 },
        { kind: 'message', seq: 2 },
      ],
    }))).not.toThrow()
    expect(() => decodeScienceOutcome(outcome({
      evidence: [{ kind: 'message', seq: 2 }],
      environmentRevisions: [],
    }))).not.toThrow()

    const invalidOutcomes: unknown[] = [
      outcome({ evidence: [
        { kind: 'run', runId: RUN_ID },
        { kind: 'run', runId: RUN_ID },
      ] }),
      outcome({ environmentRevisions: [1, 1] }),
      outcome({ environmentRevisions: [2, 1] }),
      outcome({ summaryMarkdown: '界'.repeat(12_000) }),
    ]
    for (const candidate of invalidOutcomes) {
      expect(() => decodeScienceOutcome(candidate)).toThrow()
    }

    expect([
      'science/mode-bound',
      'science/environment-bound',
      'science/run-started',
      'science/run-finished',
      'science/artifact-saved',
      'science/outcome-published',
    ].every(isScienceDomainEventType)).toBe(true)
    expect(isScienceDomainEventType('science/future-event')).toBe(false)
  })

  it('supersedes a version in place when a later save repeats its request turn', () => {
    const events = legalEvents().slice(0, 9)
    events.push(
      toolCall(9, 180, CallId('second-annotate-call'), 'annotate_artifact'),
      event('science/artifact-saved', 10, 190, {
        version: 1,
        artifact: artifact({
          toolCallId: CallId('second-annotate-call'),
          title: 'Trend, redrawn',
          attachment: {
            attachmentId: AttachmentId('attachment-2'),
            mediaType: 'image/png',
            bytes: 256,
            width: 16,
            height: 9,
            name: 'trend.png',
          },
          createdAt: 185,
        }),
      }),
    )

    const state = foldScience(events)

    // One result the reader asked for, holding the content that turn ended on.
    expect(state.artifacts).toHaveLength(1)
    expect(state.artifacts.at(0)).toMatchObject({ version: 1, title: 'Trend, redrawn' })
    expect(state.artifacts.at(0)?.attachment.attachmentId).toBe('attachment-2')
    // The retained fact follows the superseding event, so evidence cited
    // against this version is dated by the save that produced what it holds.
    expect(state.artifactFacts).toEqual([{ artifactId: ARTIFACT_ID, version: 1, seq: 10, time: 190 }])
  })

  it('rejects a supersede that renames the artifact or walks its content backwards in time', () => {
    // Auto-captured saves need no curation call, so both candidates below
    // reach the supersede rules on the same turn the capture came from.
    const base = legalEvents().slice(0, 7)
    base.push(event('science/artifact-saved', 7, 170, { version: 1, artifact: autoArtifact({ createdAt: 168 }) }))

    const renamed = base.slice()
    renamed.push(event('science/artifact-saved', 8, 175, {
      version: 1,
      artifact: autoArtifact({ artifactId: ScienceArtifactId('a-different-artifact'), createdAt: 169 }),
    }))
    expect(() => foldScience(renamed)).toThrow(/must retain artifactId and advance contiguously/)

    // A stale save must not overwrite a version with content committed before it.
    const backdated = base.slice()
    backdated.push(event('science/artifact-saved', 8, 175, {
      version: 1,
      artifact: autoArtifact({ createdAt: 160 }),
    }))
    expect(() => foldScience(backdated)).toThrow(/must retain artifactId and advance contiguously/)
  })

  it('supersedes across turns only for an unchanged attachment, never for new content', () => {
    const curated = legalEvents().slice(0, 9)
    curated.push(
      event('request/header', 9, 178, {
        header: { config: { provider: 'test', model: 'test-model' } },
        reason: 'initial',
      }),
      toolCall(10, 180, CallId('later-annotate-call'), 'annotate_artifact', { turn: 2, step: 1 }),
      event('science/artifact-saved', 11, 190, {
        version: 1,
        artifact: artifact({
          toolCallId: CallId('later-annotate-call'),
          requestHeaderSeq: 9,
          title: 'Titled a turn later',
          createdAt: 185,
        }),
      }),
    )

    // Metadata-only curation carries the same attachment, so titling a result
    // in a later turn retitles it rather than cloning it.
    const state = foldScience(curated)
    expect(state.artifacts).toHaveLength(1)
    expect(state.artifacts.at(0)).toMatchObject({ version: 1, title: 'Titled a turn later' })

    // New content in a new turn is a new result, and must not reuse the
    // version number a reader already saw.
    const rewritten = curated.slice()
    rewritten[11] = event('science/artifact-saved', 11, 190, {
      version: 1,
      artifact: artifact({
        toolCallId: CallId('later-annotate-call'),
        requestHeaderSeq: 9,
        attachment: {
          attachmentId: AttachmentId('attachment-3'),
          mediaType: 'image/png',
          bytes: 256,
          width: 16,
          height: 9,
          name: 'trend.png',
        },
        createdAt: 185,
      }),
    })
    expect(() => foldScience(rewritten)).toThrow(/superseded only by its own request turn or by an unchanged attachment/)
  })

  it('rejects discontinuous revisions, duplicate identities, and backward Science time', () => {
    const badEnvironment = legalEvents()
    badEnvironment[1] = event('science/environment-bound', 1, 110, {
      version: 1,
      environment: environment({ revision: 2 }),
    })
    expect(() => foldScience(badEnvironment)).toThrow(/environment revision must be 1/)

    const badChart = legalEvents()
    badChart[8] = event('science/artifact-saved', 8, 170, {
      version: 1,
      artifact: artifact({ version: 2 }),
    })
    expect(() => foldScience(badChart)).toThrow(/first logical artifact version must be 1/)

    const badOutcome = legalEvents()
    badOutcome[10] = event('science/outcome-published', 10, 180, {
      version: 1,
      outcome: outcome({ revision: 2 }),
    })
    expect(() => foldScience(badOutcome)).toThrow(/outcome revision must be 1/)

    const duplicateRun = legalEvents().slice(0, 7)
    duplicateRun.push(event('tool/call', 7, 160, {
      turn: 1,
      step: 2,
      callId: CallId('call-run-again'),
      name: 'run_python',
      arguments: '{}',
    }))
    duplicateRun.push(event('science/run-started', 8, 170, {
      version: 1,
      run: runStarted({ toolCallId: CallId('call-run-again'), startedAt: 169 }),
    }))
    expect(() => foldScience(duplicateRun)).toThrow(/duplicate Science runId/)

    const backward = legalEvents()
    backward[1] = event('science/environment-bound', 1, 99, {
      version: 1,
      environment: environment({ configuredAt: 90, validatedAt: 98 }),
    })
    expect(() => foldScience(backward)).toThrow(/moves time backwards/)
  })

  it('rejects missing or forward references and terminal whole-value rewrites', () => {
    const missingHeader = legalEvents()
    missingHeader[5] = event('science/run-started', 5, 140, {
      version: 1,
      run: runStarted({ requestHeaderSeq: 99 }),
    })
    expect(() => foldScience(missingHeader)).toThrow(/not the latest post-mode request\/header/)

    const missingRun = legalEvents()
    missingRun[8] = event('science/artifact-saved', 8, 170, {
      version: 1,
      artifact: artifact({ runId: ScienceRunId('missing-run') }),
    })
    expect(() => foldScience(missingRun)).toThrow(/reference a run that reached a terminal status/)

    const futureEvidence = legalEvents()
    futureEvidence[10] = event('science/outcome-published', 10, 180, {
      version: 1,
      outcome: outcome({ evidence: [{ kind: 'message', seq: 99 }] }),
    })
    expect(() => foldScience(futureEvidence)).toThrow(/message evidence seq 99 is missing/)

    const rewrittenTerminal = legalEvents()
    rewrittenTerminal[6] = event('science/run-finished', 6, 150, {
      version: 1,
      run: runTerminal({ codeSha256: 'e'.repeat(64) }),
    })
    expect(() => foldScience(rewrittenTerminal)).toThrow(/rewrites start-owned fields/)

    const terminal = runTerminal()
    const { stdoutBytes: _stdoutBytes, ...partialTerminal } = terminal
    expect(() => decodeScienceDomainEvent(event('science/run-finished', 5, 150, {
      version: 1,
      run: partialTerminal,
    }))).toThrow()
  })

})
