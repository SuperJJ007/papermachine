import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { replayScience, toClientScienceProjection } from '../src/index.ts'
import { scienceProjectionSchema } from '../src/projection.ts'
import {
  event,
  kernelExited,
  kernelStarted,
  legalEvents,
} from './fixtures.ts'

describe('Science projection wire schema', () => {
  const clientReplay = (events: readonly SessionEvent[]) =>
    toClientScienceProjection(replayScience(events))

  it('accepts decoded members and derived metrics without re-running strict provenance', () => {
    const events = legalEvents()
    const modeState = clientReplay(events.slice(0, 1))!
    const environmentState = clientReplay(events.slice(0, 2))!
    const runningState = clientReplay(events.slice(0, 6))!
    const state = clientReplay(events)!
    const interruptedState = clientReplay([
      ...events.slice(0, 6),
      event('session/end-seed', 6, 150, {}),
    ])!

    const currentEnvironment = state.environment!
    const currentPython = currentEnvironment.python!
    const { languageVersion: _languageVersion, fingerprintPreview: _fingerprintPreview, ...minimalPython } = currentPython
    const { python: _python, ...environmentWithoutPython } = currentEnvironment
    const currentRun = state.runs[0]!
    if (currentRun.status !== 'success') throw new Error('fixture run is not successful')
    const currentChart = state.artifacts[0]!
    const { name: _attachmentName, ...attachmentWithoutName } = currentChart.attachment
    const rRunningState = {
      ...runningState,
      environment: {
        ...environmentWithoutPython,
        r: { ...currentPython, language: 'r' },
      },
      runs: [{ ...runningState.runs[0], language: 'r' }],
    }
    const secondChart = {
      ...state.artifacts[0]!,
      version: 2,
      createdAt: 179,
    }
    // legalEvents() already seeds the epoch-1 python kernel's `started` half
    // (open): exit it, then start a fresh epoch 2 so this scenario models a
    // realistic restart rather than a rejected duplicate open epoch.
    const kernelEvents: SessionEvent[] = [
      ...events,
      event('science/kernel-state', 11, 190, { version: 1, kernel: kernelExited({ at: 190 }) }),
      event('science/kernel-state', 12, 195, { version: 1, kernel: kernelStarted({ kernelEpoch: 2, at: 195 }) }),
    ]
    const kernelState = clientReplay(kernelEvents)!
    const interruptedKernelState = clientReplay([
      ...kernelEvents,
      event('session/end-seed', 13, 400, {}),
    ])!
    const structurallyIndependentMembers = [
      {
        ...state,
        environment: null,
      },
      {
        ...state,
        environment: { ...currentEnvironment, python: minimalPython },
      },
      {
        ...state,
        environment: {
          ...currentEnvironment,
          status: 'invalid',
          python: { language: 'python', capability: 'unavailable' },
        },
      },
      {
        ...state,
        runs: [currentRun, { ...currentRun, status: 'failed', failureCode: 'RUN_FAILED', outputDegraded: true }],
        metrics: { ...state.metrics, runCount: 2, successfulRunCount: 1 },
      },
      {
        ...state,
        artifacts: [{
          ...currentChart,
          caption: 'Visible caption',
          attachment: attachmentWithoutName,
        }],
      },
      {
        ...state,
        artifacts: [state.artifacts[0], secondChart],
        metrics: { ...state.metrics, artifactVersionCount: 2 },
      },
      {
        ...state,
        artifacts: [{
          ...currentChart,
          attachment: { attachmentId: currentChart.attachment.attachmentId, mediaType: 'text/csv', bytes: 32, name: 'summary.csv' },
        }],
      },
      {
        ...state,
        artifacts: [{
          ...currentChart,
          attachment: { attachmentId: currentChart.attachment.attachmentId, mediaType: 'application/vnd.vega-lite+json', bytes: 64, name: 'summary.vl.json' },
        }],
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
      {
        ...state,
        outcome: {
          ...state.outcome,
          evidence: [{ kind: 'run', runId: currentRun.runId }],
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
      kernelState,
      interruptedKernelState,
      ...structurallyIndependentMembers,
    ].entries()) {
      expect(scienceProjectionSchema.safeParse(value).success, `valid projection ${String(index)}`)
        .toBe(true)
    }
  })

  it('rejects malformed members and incorrect derived metrics', () => {
    const events = legalEvents()
    const runningState = clientReplay(events.slice(0, 6))!
    const state = clientReplay(events)!
    const interruptedState = clientReplay([
      ...events.slice(0, 6),
      event('session/end-seed', 6, 150, {}),
    ])!
    const currentEnvironment = state.environment!
    const currentPython = currentEnvironment.python!
    const { languageVersion: _languageVersion, fingerprintPreview: _fingerprintPreview, ...minimalPython } = currentPython
    const { python: _python, ...environmentWithoutPython } = currentEnvironment
    const currentRun = state.runs[0]!
    const currentChart = state.artifacts[0]!
    const interruptedRun = interruptedState.runs[0]!
    // legalEvents() already seeds the epoch-1 python kernel's `started` half
    // (open): exit it, then start a fresh epoch 2, whose still-open record
    // is kernels[1] (kernels[0] is epoch 1, now exited).
    const kernelState = clientReplay([
      ...events,
      event('science/kernel-state', 11, 190, { version: 1, kernel: kernelExited({ at: 190 }) }),
      event('science/kernel-state', 12, 195, { version: 1, kernel: kernelStarted({ kernelEpoch: 2, at: 195 }) }),
    ])!
    const currentKernel = kernelState.kernels[1]!
    if (currentKernel.state === 'interrupted') throw new Error('fixture kernel is not a started/exited fact')
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
      { ...state, environment: 1 },
      { ...state, environment: { ...currentEnvironment, python: null } },
      { ...state, environment: { ...currentEnvironment, python: [] } },
      { ...state, environment: { ...currentEnvironment, python: { ...minimalPython, unexpected: true } } },
      { ...state, environment: { ...currentEnvironment, python: { ...minimalPython, language: 'ruby' } } },
      { ...state, environment: { ...currentEnvironment, python: { ...minimalPython, capability: 'lost' } } },
      { ...state, environment: { ...currentEnvironment, python: { ...minimalPython, languageVersion: 1 } } },
      { ...state, environment: { ...currentEnvironment, python: { ...minimalPython, languageVersion: '/private/python' } } },
      { ...state, environment: { ...currentEnvironment, python: { ...minimalPython, fingerprintPreview: 1 } } },
      { ...state, environment: { ...currentEnvironment, python: { ...minimalPython, fingerprintPreview: 'short' } } },
      { ...state, environment: { ...currentEnvironment, python: { ...currentPython, packages: 'not-an-array' } } },
      { ...state, environment: { ...currentEnvironment, python: { ...currentPython, packages: [null] } } },
      { ...state, environment: { ...currentEnvironment, python: { ...currentPython, packages: [{ name: 1, version: '1' }] } } },
      { ...state, environment: { ...currentEnvironment, python: { ...currentPython, packages: [{ name: 'pip', version: 1 }] } } },
      { ...state, environment: { ...currentEnvironment, python: { ...currentPython, packages: [{ name: '', version: '1' }] } } },
      { ...state, environment: { ...currentEnvironment, python: { ...currentPython, packages: [{ name: 'pip', version: '' }] } } },
      { ...state, environment: { ...currentEnvironment, python: { ...currentPython, packages: [{ name: 'pip', version: '1', extra: true }] } } },
      { ...state, environment: { ...currentEnvironment, python: { ...currentPython, packagesTruncated: 'not-a-boolean' } } },
      { ...state, environment: { ...currentEnvironment, python: { ...currentPython, packagesSha256Preview: 1 } } },
      { ...state, environment: { ...currentEnvironment, python: { ...currentPython, packagesSha256Preview: 'short' } } },
      { ...state, environment: { ...environmentWithoutPython } },
      { ...state, environment: { ...currentEnvironment, revision: 0 } },
      { ...state, environment: { ...currentEnvironment, profileId: '' } },
      { ...state, environment: { ...currentEnvironment, configuredAt: -1 } },
      { ...state, environment: { ...currentEnvironment, validatedAt: -1 } },
      { ...state, environment: { ...currentEnvironment, status: 'other' } },
      { ...state, environment: { ...currentEnvironment, status: 'applied', python: { language: 'python', capability: 'unavailable' } } },
      { ...state, runs: {} },
      { ...state, runs: [null] },
      { ...state, runs: [{}] },
      { ...state, runs: [{ ...runningState.runs[0], unexpected: true }] },
      { ...state, runs: [{ ...state.runs[0], status: 'unknown' }] },
      // A kernel run has no per-run exit code or signal: neither field
      // exists on the wire schema any more, so either one is an unrecognized key.
      { ...state, runs: [{ ...currentRun, exitCode: 0 }] },
      { ...state, runs: [{ ...currentRun, signal: 'TERM' }] },
      { ...state, runs: [{ ...currentRun, failureCode: 1 }] },
      { ...state, runs: [{ ...currentRun, status: 'failed', failureCode: 'RUN_FAILED', outputDegraded: false }] },
      { ...state, runs: [{ status: 'interrupted' }] },
      { ...state, runs: [{ ...interruptedRun, finishedAt: '150' }] },
      { ...state, runs: [{ ...interruptedRun, finishedAt: Number.NaN }] },
      { ...state, runs: [{ ...interruptedRun, finishedAt: 138 }] },
      { ...state, runs: [{ ...interruptedRun, interruptedAtSeq: '3' }] },
      { ...state, runs: [{ ...interruptedRun, interruptedAtSeq: Number.NaN }] },
      { ...state, runs: [{ ...interruptedRun, interruptedAtSeq: -1 }] },
      { ...state, artifacts: {} },
      { ...state, artifacts: [null] },
      { ...state, artifacts: [{ ...currentChart, caption: 1 }] },
      { ...state, artifacts: [{ ...currentChart, attachment: null }] },
      { ...state, artifacts: [{ ...state.artifacts[0], attachment: { mediaType: 'text/plain' } }] },
      { ...kernelState, kernels: {} },
      { ...kernelState, kernels: [null] },
      { ...kernelState, kernels: [{}] },
      { ...kernelState, kernels: [{ ...currentKernel, unexpected: true }] },
      { ...kernelState, kernels: [{ ...currentKernel, kernelEpoch: 0 }] },
      { ...kernelState, kernels: [{ ...currentKernel, language: 'ruby' }] },
      { ...kernelState, kernels: [{ ...currentKernel, environmentFingerprintPreview: 'short' }] },
      { ...kernelState, kernels: [{ ...currentKernel, state: 'unknown' }] },
      { ...kernelState, kernels: [{ ...currentKernel, reason: 'idle' }] },
      { ...kernelState, kernels: [{ ...currentKernel, state: 'exited' }] },
      { ...kernelState, kernels: [{ ...currentKernel, state: 'exited', reason: 'unexpected' }] },
      { ...kernelState, kernels: [{ ...currentKernel, startedAt: 100 }] },
      { ...kernelState, kernels: [{ ...currentKernel, state: 'exited', reason: 'idle' }] },
      {
        ...kernelState,
        kernels: [{ ...currentKernel, state: 'exited', reason: 'idle', startedAt: currentKernel.at + 1 }],
      },
      {
        ...kernelState,
        kernels: [{
          kernelEpoch: currentKernel.kernelEpoch,
          language: currentKernel.language,
          state: 'interrupted',
          environmentRevision: currentKernel.environmentRevision,
          environmentFingerprintPreview: currentKernel.environmentFingerprintPreview,
          startedAt: 100,
          finishedAt: 50,
          interruptedAtSeq: 1,
        }],
      },
      { ...kernelState, metrics: { ...kernelState.metrics, kernelCount: 0 } },
      { ...state, outcome: { ...state.outcome, evidence: [] } },
      { ...state, outcome: 1 },
      { ...state, outcome: { ...state.outcome, evidence: [null] } },
      { ...state, outcome: { ...state.outcome, evidence: [{ kind: 'run', runId: 1 }] } },
      { ...state, outcome: { ...state.outcome, evidence: [{ kind: 'run', runId: currentRun.runId, unexpected: true }] } },
      { ...state, lastScienceEventSeq: 1.5 },
      { ...state, lastScienceEventSeq: -1 },
      { ...state, metrics: null },
      { ...state, metrics: { runCount: 1 } },
      { ...state, metrics: { ...state.metrics, unexpected: 1 } },
      { ...state, metrics: { ...state.metrics, runCount: 99 } },
      // legalEvents() itself seeds one open kernel, so `state`'s own true
      // kernelCount is 1; 0 is the wrong count here.
      { ...state, metrics: { ...state.metrics, kernelCount: 0 } },
      { ...state, runs: [unstableInterruptedRun] },
    ]
    for (const [index, value] of invalidValues.entries()) {
      expect(scienceProjectionSchema.safeParse(value).success, `invalid projection ${String(index)}`)
        .toBe(false)
    }
  })
})
