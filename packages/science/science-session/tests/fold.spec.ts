import { describe, expect, it } from 'vitest'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  decodeScienceArtifact,
  decodeScienceEnvironment,
  decodeScienceDomainEvent,
  decodeScienceOutcome,
  decodeScienceRunStarted,
  decodeScienceRunTerminal,
  ScienceArtifactId,
  ScienceProjectId,
  ScienceRunId,
  ScienceVersionId,
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
    // The annotate_artifact call (seq 7) is folded (`state.toolCalls`) but no
    // longer consumed: `science/artifact-saved` no longer authorizes through
    // a tool call at all — that authorization moved to the project artifact
    // store's `annotateVersion` call site.
    expect(state.consumedToolCallSeqs).toEqual([4, 9])
  })

  it('folds an auto-captured text artifact, consuming no fresh tool call', () => {
    const events: SessionEvent[] = [
      ...legalEvents().slice(0, 7),
      event('science/artifact-saved', 7, 165, { version: 1, artifact: autoArtifact({ seenAt: 165 }) }),
    ]
    const state = foldScience(events)

    expect(state.artifacts).toEqual([autoArtifact({ seenAt: 165 })])
    expect(state.consumedToolCallSeqs).toEqual([4])
    expect(decodeScienceArtifact(autoArtifact({ seenAt: 165 }))).toEqual(autoArtifact({ seenAt: 165 }))
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
      // A kernel run has no per-run exit code or signal; the strict
      // schema refuses both as unrecognized keys regardless of status.
      { ...runTerminal(), exitCode: 1 },
      { ...runTerminal(), signal: 'TERM' },
      runTerminal({ failureCode: 'FAILED' }),
      runTerminal({ failureMessage: 'unexpected' }),
      runTerminal({ status: 'failed' }),
    ]
    for (const candidate of invalidTerminals) {
      expect(() => decodeScienceRunTerminal(candidate)).toThrow()
    }
    expect(() => decodeScienceRunTerminal(runTerminal({
      status: 'failed',
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

  it('decodes and folds a pre-slimming v1-shaped artifact event, ignoring every retired provenance field', () => {
    // Decision (i) in the artifact-source-authority Agent Note: the codec
    // accepts a v1-shaped event — every field this build no longer writes,
    // and `createdAt` in place of `seenAt` — and silently drops what it
    // does not declare, rather than bumping SESSION_FORMAT_VERSION.
    const { seenAt: _seenAt, ...withoutSeenAt } = artifact()
    const legacyShaped = {
      ...withoutSeenAt,
      producerSessionId: 'science-fixture-session',
      runId: RUN_ID,
      toolCallId: ARTIFACT_CALL_ID,
      requestHeaderSeq: 3,
      environmentRevision: 1,
      environmentFingerprint: 'b'.repeat(64),
      parent: { artifactId: ARTIFACT_ID, version: 1 },
      origin: 'model',
      byteCount: 128,
      mediaType: 'image/png',
      createdAt: artifact().seenAt,
    }
    expect(decodeScienceArtifact(legacyShaped)).toEqual(artifact())

    // Neither the current field nor its legacy fallback: nothing to resolve seenAt from.
    const { seenAt: _seenAt2, ...withoutEitherTimestamp } = artifact()
    expect(() => decodeScienceArtifact(withoutEitherTimestamp)).toThrow(/requires seenAt/)

    const events = legalEvents()
    events[8] = event('science/artifact-saved', 8, 170, { version: 1, artifact: legacyShaped })
    expect(foldScience(events).artifacts).toEqual([artifact()])
  })

  it('rejects the pre-store embedded-attachment value with a clear error', () => {
    const embedded = {
      ...artifact(),
      attachment: { attachmentId: 'attachment-1', mediaType: 'image/png', bytes: 128, width: 16, height: 9 },
    }
    expect(() => decodeScienceArtifact(embedded)).toThrow(/embeds a session attachment.*rejected outright/)
    const events = legalEvents()
    events[8] = event('science/artifact-saved', 8, 170, { version: 1, artifact: embedded })
    expect(() => foldScience(events)).toThrow(/embeds a session attachment.*rejected outright/)
  })

  it('replaces a version in place when a later re-record retains its store content reference', () => {
    const events = legalEvents().slice(0, 9)
    events.push(
      event('science/artifact-saved', 9, 190, {
        version: 1,
        artifact: artifact({ title: 'Trend, redrawn', seenAt: 185 }),
      }),
    )

    const state = foldScience(events)

    // One result the reader asked for, holding the content that turn ended on.
    expect(state.artifacts).toHaveLength(1)
    expect(state.artifacts.at(0)).toMatchObject({ version: 1, title: 'Trend, redrawn' })
    expect(state.artifacts.at(0)?.versionId).toBe('version-1')
    // The retained fact follows the superseding event, so evidence cited
    // against this version is dated by the save that produced what it holds.
    expect(state.artifactFacts).toEqual([{
      artifactId: ARTIFACT_ID, version: 1, seq: 9, time: 190, turn: 1, step: 1,
    }])
  })

  it('keeps a re-record\'s trace anchor at the producing call once that call has settled', () => {
    // run_python (turn 1) produces version 1 and settles before an
    // annotate_artifact call opens in a later turn and re-records only its
    // title. The re-record must not move the version's owner coordinates to
    // the still-open annotate_artifact call: the chip stays "Python run".
    const events = [
      ...legalEvents().slice(0, 7), // mode, environment, kernel, header, run_python call, run-started, run-finished
      event('science/artifact-saved', 7, 165, { version: 1, artifact: artifact({ seenAt: 165 }) }),
      event('step/end', 8, 166, { turn: 1, step: 1 }), // settles the run_python call (seq 4)
      toolCall(9, 170, ARTIFACT_CALL_ID, 'annotate_artifact', { turn: 2, step: 1 }),
      event('science/artifact-saved', 10, 175, {
        version: 1,
        artifact: artifact({ title: 'Curated trend', seenAt: 175 }),
      }),
    ]

    const state = foldScience(events)

    expect(state.artifacts).toHaveLength(1)
    expect(state.artifacts.at(0)).toMatchObject({ version: 1, title: 'Curated trend' })
    expect(state.artifactFacts).toEqual([{
      artifactId: ARTIFACT_ID, version: 1, seq: 10, time: 175, turn: 1, step: 1,
    }])
  })

  it('opens the next version for changed content, and accepts a same-content re-record at its own version', () => {
    const first = autoArtifact({ seenAt: 160 })
    const resave = autoArtifact({ seenAt: 170 })
    // A re-record naming the same versionId/sha256 as the already-committed
    // version is a metadata-only snapshot: the fold has no `origin` field
    // to gate who may re-record it any more — that distinction lives only
    // in the project artifact store now.
    expect(foldScience([
      ...legalEvents().slice(0, 7),
      event('science/artifact-saved', 7, 160, { version: 1, artifact: first }),
      event('science/artifact-saved', 8, 170, { version: 1, artifact: resave }),
    ]).artifacts).toEqual([resave])

    const next = autoArtifact({
      version: 2,
      versionId: ScienceVersionId('version-next'),
      sha256: '1'.repeat(64),
      seenAt: 170,
    })
    const state = foldScience([
      ...legalEvents().slice(0, 7),
      event('science/artifact-saved', 7, 160, { version: 1, artifact: first }),
      event('science/artifact-saved', 8, 170, { version: 1, artifact: next }),
    ])
    expect(state.artifacts).toEqual([first, next])
  })

  it('rejects a version that reuses another committed version\'s store versionId or another session project', () => {
    const first = autoArtifact({ seenAt: 160 })
    const reusedVersionId = autoArtifact({
      version: 2,
      sha256: '1'.repeat(64),
      seenAt: 170,
    })
    expect(() => foldScience([
      ...legalEvents().slice(0, 7),
      event('science/artifact-saved', 7, 160, { version: 1, artifact: first }),
      event('science/artifact-saved', 8, 170, { version: 1, artifact: reusedVersionId }),
    ])).toThrow(/versionId cannot back two committed versions/)

    const foreignProject = autoArtifact({
      artifactId: ScienceArtifactId('artifact-foreign'),
      logicalName: 'foreign.csv',
      projectId: ScienceProjectId('project-2'),
      versionId: ScienceVersionId('version-foreign'),
      seenAt: 170,
    })
    expect(() => foldScience([
      ...legalEvents().slice(0, 7),
      event('science/artifact-saved', 7, 160, { version: 1, artifact: first }),
      event('science/artifact-saved', 8, 170, { version: 1, artifact: foreignProject }),
    ])).toThrow(/must name one owning projectId/)
  })

  it('rejects a later re-record that changes the target version\'s store content reference', () => {
    const events = legalEvents().slice(0, 9)
    events.push(
      event('science/artifact-saved', 9, 190, {
        version: 1,
        artifact: artifact({ sha256: '2'.repeat(64), seenAt: 185 }),
      }),
    )

    expect(() => foldScience(events)).toThrow(/must retain its store content reference/)
  })

  it('allows a later re-record only when it retains the target version\'s store content reference', () => {
    const curated = legalEvents().slice(0, 9)
    curated.push(
      event('science/artifact-saved', 9, 190, {
        version: 1,
        artifact: artifact({ title: 'Titled a turn later', seenAt: 185 }),
      }),
    )

    // Metadata-only re-recording carries the same store reference, so
    // titling a result later retitles it rather than cloning it.
    const state = foldScience(curated)
    expect(state.artifacts).toHaveLength(1)
    expect(state.artifacts.at(0)).toMatchObject({ version: 1, title: 'Titled a turn later' })

    // A later re-record still names the original version, but a changed
    // store reference cannot replace content bytes through this path.
    const rewritten = curated.slice()
    rewritten[9] = event('science/artifact-saved', 9, 190, {
      version: 1,
      artifact: artifact({ versionId: ScienceVersionId('version-3'), seenAt: 185 }),
    })
    expect(() => foldScience(rewritten)).toThrow(/must retain its store content reference/)
  })

  it('rejects discontinuous revisions, duplicate identities, and backward Science time', () => {
    const badEnvironment = legalEvents()
    badEnvironment[1] = event('science/environment-bound', 1, 110, {
      version: 1,
      environment: environment({ revision: 2 }),
    })
    expect(() => foldScience(badEnvironment)).toThrow(/environment revision must be 1/)

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

  it('accepts a first-sighted artifact version above 1 as a cross-session continuation (S3)', () => {
    // This session's own log has never recorded ARTIFACT_ID before this
    // event: it may be opening a brand-new artifact, or continuing one a
    // different session in the same project already versioned. The fold
    // cannot tell those apart without the project store, so it accepts the
    // reference (the live Runtime validated the true prior ordinal against
    // the store before this event ever committed).
    const continued = legalEvents().slice(0, 9)
    continued[8] = event('science/artifact-saved', 8, 170, {
      version: 1,
      artifact: artifact({ version: 4 }),
    })
    const state = foldScience(continued)
    expect(state.artifacts.at(-1)).toMatchObject({ artifactId: ARTIFACT_ID, version: 4 })
  })

  it('accepts a later artifact-saved version beyond this session\'s own local maximum, still rejecting an in-range mismatch (S3 interleaving)', () => {
    const continued = legalEvents().slice(0, 9)
    continued[8] = event('science/artifact-saved', 8, 170, {
      version: 1,
      artifact: artifact({ version: 4 }),
    })

    // A save beyond this session's own local maximum (4) for that
    // artifactId is trusted even though it is not exactly the next
    // contiguous version: a concurrent session's own interleaved append may
    // have landed in between in store-serialized order before this event
    // ever committed, exactly like the store-validated first-sighted case
    // above trusts any positive ordinal.
    const gapAhead = continued.slice()
    gapAhead.push(
      event('science/artifact-saved', 9, 190, {
        version: 1,
        artifact: artifact({ version: 7, versionId: ScienceVersionId('version-continue-ahead') }),
      }),
    )
    const advanced = foldScience(gapAhead)
    expect(advanced.artifacts.at(-1)).toMatchObject({ artifactId: ARTIFACT_ID, version: 7 })

    // A value at or below that local maximum which does not exactly match a
    // locally recorded version is a same-session inconsistency the log
    // alone can catch (a regression, or a gap inside the locally-seen
    // range), and still throws.
    const belowRange = continued.slice()
    belowRange.push(
      event('science/artifact-saved', 9, 190, {
        version: 1,
        artifact: artifact({ version: 2 }),
      }),
    )
    expect(() => foldScience(belowRange)).toThrow(/advance beyond the locally committed version/)
  })

  it('accepts a run input version beyond this session\'s own local maximum, still rejecting an in-range mismatch (S3 interleaving)', () => {
    const continued = legalEvents().slice(0, 9)
    continued[8] = event('science/artifact-saved', 8, 170, {
      version: 1,
      artifact: artifact({ version: 4 }),
    })

    const runCall = CallId('call-run-continue')
    const run = runStarted({
      runId: ScienceRunId('run-continue'),
      toolCallId: runCall,
      startedAt: 189,
      runDirectoryRef: 'runs/run-continue/',
      inputs: [{ artifactId: ARTIFACT_ID, version: 6, path: 'ahead.png' }],
    })
    const aheadOfLocalMax = [
      ...continued,
      toolCall(9, 185, runCall, 'run_python'),
      event('science/run-started', 10, 190, { version: 1, run }),
    ]
    // A run input naming a version strictly ahead of this session's own
    // locally-recorded maximum (4) is trusted for the same reason a save
    // beyond that maximum is: the live Runtime already validated the
    // reference against the project store before this event committed.
    expect(() => foldScience(aheadOfLocalMax)).not.toThrow()

    const inRangeMismatch = [
      ...continued,
      toolCall(9, 185, runCall, 'run_python'),
      event('science/run-started', 10, 190, {
        version: 1,
        run: { ...run, inputs: [{ artifactId: ARTIFACT_ID, version: 2, path: 'between.png' }] },
      }),
    ]
    // A value at or below that local maximum which does not exactly match a
    // locally recorded version is still fully verifiable from the log
    // alone, and throws.
    expect(() => foldScience(inRangeMismatch)).toThrow(/run input .* does not identify a committed artifact version/)
  })

  it('rejects missing or forward references and terminal whole-value rewrites', () => {
    const missingHeader = legalEvents()
    missingHeader[5] = event('science/run-started', 5, 140, {
      version: 1,
      run: runStarted({ requestHeaderSeq: 99 }),
    })
    expect(() => foldScience(missingHeader)).toThrow(/not the latest post-mode request\/header/)

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

  it('accepts a run input naming a version this session already committed', () => {
    const branchId = ScienceArtifactId('artifact-branch')
    const branch = artifact({
      artifactId: branchId,
      logicalName: 'branch.png',
      versionId: ScienceVersionId('version-branch'),
      sha256: '3'.repeat(64),
      seenAt: 179,
    })
    const secondRunCall = CallId('call-run-with-input')
    const secondRun = runStarted({
      runId: ScienceRunId('run-with-input'),
      toolCallId: secondRunCall,
      startedAt: 189,
      runDirectoryRef: 'runs/run-with-input/',
      inputs: [{ artifactId: branchId, version: 1, path: 'source/branch.png' }],
    })
    const events = [
      ...legalEvents().slice(0, 9),
      event('science/artifact-saved', 9, 180, { version: 1, artifact: branch }),
      toolCall(10, 185, secondRunCall, 'run_python', { turn: 2, step: 1 }),
      event('science/run-started', 11, 190, { version: 1, run: secondRun }),
    ]

    const state = foldScience(events)
    expect(state.artifacts.at(-1)).toMatchObject({ artifactId: branchId })
    expect(state.runs.at(-1)).toMatchObject({ runId: secondRun.runId, inputs: secondRun.inputs })
  })

  it('accepts sibling versions opened from one baseline, in the order their events commit', () => {
    const versionTwo = artifact({
      version: 2,
      versionId: ScienceVersionId('version-two'),
      sha256: '4'.repeat(64),
      seenAt: 179,
    })
    const versionThree = artifact({
      version: 3,
      versionId: ScienceVersionId('version-three'),
      sha256: '5'.repeat(64),
      seenAt: 189,
    })
    const siblings = [
      ...legalEvents().slice(0, 9),
      event('science/artifact-saved', 9, 180, { version: 1, artifact: versionTwo }),
      event('science/artifact-saved', 10, 190, { version: 1, artifact: versionThree }),
    ]

    expect(foldScience(siblings).artifacts.slice(1)).toMatchObject([
      { version: 2 },
      { version: 3 },
    ])
  })

  it('requires canonical distinct input paths and terminal repetition of start-owned inputs', () => {
    const { inputs: _startedInputs, ...legacyStarted } = runStarted()
    const { inputs: _terminalInputs, ...legacyTerminal } = runTerminal()
    const legacyEvents = legalEvents()
    legacyEvents[5] = event('science/run-started', 5, 140, { version: 1, run: legacyStarted })
    legacyEvents[6] = event('science/run-finished', 6, 150, { version: 1, run: legacyTerminal })
    expect(foldScience(legacyEvents).runs).toEqual([legacyTerminal])
    expect(() => decodeScienceRunStarted(runStarted({
      inputs: [{ artifactId: ARTIFACT_ID, version: 1, path: '../escape.png' }],
    }))).toThrow(/run input path/)
    expect(() => decodeScienceRunStarted(runStarted({
      inputs: [{ artifactId: ARTIFACT_ID, version: 1, path: '/absolute.png' }],
    }))).toThrow(/run input path/)
    expect(() => decodeScienceRunStarted(runStarted({
      inputs: [{ artifactId: ARTIFACT_ID, version: 1, path: 'nul\0path.png' }],
    }))).toThrow(/run input path/)
    expect(() => decodeScienceRunStarted(runStarted({
      inputs: [
        { artifactId: ARTIFACT_ID, version: 1, path: 'same.png' },
        { artifactId: ARTIFACT_ID, version: 1, path: 'same.png' },
      ],
    }))).toThrow(/input paths must be unique/)

    const rewrittenTerminal = legalEvents()
    rewrittenTerminal[6] = event('science/run-finished', 6, 150, {
      version: 1,
      run: runTerminal({ inputs: [{ artifactId: ARTIFACT_ID, version: 1, path: 'late.png' }] }),
    })
    expect(() => foldScience(rewrittenTerminal)).toThrow(/rewrites start-owned fields/)
  })

})
