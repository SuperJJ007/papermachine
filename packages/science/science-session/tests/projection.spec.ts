import { describe, expect, it } from 'vitest'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { replayScience, ScienceArtifactId, ScienceRunId, toClientScienceProjection } from '../src/index.ts'
import { scienceProjectionSchema } from '../src/projection.ts'
import {
  ARTIFACT_CALL_ID,
  ARTIFACT_ID,
  FINGERPRINT,
  PACKAGES_SHA,
  RUN_CALL_ID,
  RUN_ID,
  artifact,
  event,
  kernelExited,
  legalEvents,
  runStarted,
  runTerminal,
  toolCall,
} from './fixtures.ts'

describe('Science projection replay', () => {
  it('projects all six event types and derives stable metrics', () => {
    const state = toClientScienceProjection(replayScience(legalEvents()))
    expect(state).toMatchObject({
      mode: { modeId: 'science', presetId: 'science', modeRevision: 'r3' },
      environment: {
        revision: 1,
        status: 'applied',
        python: { packages: [{ name: 'pip', version: '24.0' }], packagesTruncated: false, packagesSha256Preview: PACKAGES_SHA.slice(0, 12) },
      },
      runs: [{ runId: RUN_ID, status: 'success', toolCallId: RUN_CALL_ID, requestHeaderSeq: 3 }],
      artifacts: [{ artifactId: ARTIFACT_ID, version: 1, toolCallId: ARTIFACT_CALL_ID, requestHeaderSeq: 3 }],
      outcome: { revision: 1 },
      metrics: {
        runCount: 1,
        successfulRunCount: 1,
        artifactCount: 1,
        artifactVersionCount: 1,
        outcomeRevision: 1,
      },
      lastScienceEventSeq: 10,
    })
    expect(scienceProjectionSchema.safeParse(state).success).toBe(true)
  })

  it('keeps Host paths, full fingerprints, and mutation provenance out of the client projection', () => {
    const host = replayScience(legalEvents())
    const client = toClientScienceProjection(host)
    const hostJson = JSON.stringify(host)
    const clientJson = JSON.stringify(client)

    expect(hostJson).toContain('/opt/science')
    expect(hostJson).toContain(FINGERPRINT)
    expect(clientJson).toContain(FINGERPRINT.slice(0, 12))
    expect(clientJson).not.toContain(FINGERPRINT)
    expect(clientJson).not.toContain('/opt/science')
    expect(clientJson).not.toContain('configuredPrefix')
    expect(clientJson).not.toContain('canonicalPrefix')
    expect(clientJson).not.toContain('executable')
    expect(clientJson).toContain('toolCallId')
    expect(clientJson).toContain('requestHeaderSeq')
  })

  it('returns null before Science mode is bound', () => {
    expect(toClientScienceProjection(replayScience([]))).toBeNull()
  })

  it('projects exact artifact parents and run inputs to clients', () => {
    const branchCall = CallId('projection-branch-call')
    const branchId = ScienceArtifactId('projection-branch')
    const parent = { artifactId: ARTIFACT_ID, version: 1 }
    const runCall = CallId('projection-input-run')
    const inputs = [{ artifactId: branchId, version: 1, path: 'reference/branch.png' }]
    const events: SessionEvent[] = [
      ...legalEvents().slice(0, 9),
      toolCall(9, 175, branchCall, 'annotate_artifact'),
      event('science/artifact-saved', 10, 180, {
        version: 1,
        artifact: artifact({
          artifactId: branchId,
          logicalName: 'projection-branch.png',
          parent,
          toolCallId: branchCall,
          createdAt: 179,
        }),
      }),
      toolCall(11, 185, runCall, 'run_python', { turn: 2, step: 1 }),
      event('science/run-started', 12, 190, {
        version: 1,
        run: runStarted({
          runId: ScienceRunId('projection-input-run'),
          toolCallId: runCall,
          startedAt: 189,
          runDirectoryRef: 'runs/projection-input-run/',
          inputs,
        }),
      }),
    ]

    const client = toClientScienceProjection(replayScience(events))!
    expect(client.artifacts.at(-1)).toMatchObject({ artifactId: branchId, parent })
    expect(client.runs.at(-1)).toMatchObject({ inputs })
    expect(scienceProjectionSchema.safeParse(client).success).toBe(true)
  })

  it('retains a legacy run whose durable events predate artifact inputs', () => {
    const events = legalEvents()
    const { inputs: _startedInputs, ...started } = runStarted()
    const { inputs: _terminalInputs, ...finished } = runTerminal()
    events[5] = event('science/run-started', 5, 140, { version: 1, run: started })
    events[6] = event('science/run-finished', 6, 150, { version: 1, run: finished })

    const client = toClientScienceProjection(replayScience(events))!
    expect(client.runs).toHaveLength(1)
    expect(client.runs[0]).not.toHaveProperty('inputs')
    expect(scienceProjectionSchema.safeParse(client).success).toBe(true)
  })

  it('exposes kernel history and kernelCount, redacting the full environment fingerprint to a preview', () => {
    // legalEvents() already seeds the epoch-1 python kernel's `started` half
    // (at time 115); this test appends only the `exited` half.
    const events: SessionEvent[] = [
      ...legalEvents(),
      event('science/kernel-state', 11, 200, { version: 1, kernel: kernelExited({ at: 200 }) }),
    ]
    const host = replayScience(events)!
    const client = toClientScienceProjection(host)!

    expect(host.kernels).toEqual([kernelExited({ at: 200 })])
    expect(host.metrics.kernelCount).toBe(1)
    expect(client.metrics.kernelCount).toBe(1)
    expect(client.kernels).toEqual([{
      kernelEpoch: 1,
      language: 'python',
      state: 'exited',
      reason: 'idle',
      startedAt: 115,
      environmentRevision: 1,
      environmentFingerprintPreview: FINGERPRINT.slice(0, 12),
      at: 200,
    }])
    expect(client.kernels[0]).not.toHaveProperty('environmentFingerprint')

    const clientJson = JSON.stringify(client)
    expect(clientJson).toContain(FINGERPRINT.slice(0, 12))
    expect(clientJson).not.toContain(FINGERPRINT)
    expect(scienceProjectionSchema.safeParse(client).success).toBe(true)
  })

  it('sanitizes optional interpreter, run, and artifact fields without inventing absent values', () => {
    const host = replayScience(legalEvents())!
    const environment = host.environment!
    const python = environment.python!
    const terminal = host.runs[0]!
    if (terminal.status !== 'success') throw new Error('fixture run is not successful')
    const artifact = host.artifacts[0]!
    const unavailableR = {
      language: 'r' as const,
      configuredPrefix: 'C:\\private-science',
      capability: 'unavailable' as const,
      reason: 'not installed',
    }

    const client = toClientScienceProjection({
      ...host,
      environment: {
        ...environment,
        python: { ...python, languageVersion: '/private/python' },
        r: unavailableR,
      },
      runs: [
        terminal,
        { ...terminal, status: 'failed', failureCode: 'RUN_FAILED' },
        { ...terminal, status: 'failed', failureCode: 'RUN_FAILED', outputDegraded: true },
      ],
      artifacts: [{ ...artifact, caption: 'A safe caption.' }],
    })!

    expect(client.environment).toMatchObject({
      python: { capability: 'available', fingerprintPreview: FINGERPRINT.slice(0, 12) },
      r: { capability: 'unavailable' },
    })
    expect(client.environment?.python).not.toHaveProperty('languageVersion')
    expect(client.environment?.r).not.toHaveProperty('languageVersion')
    expect(client.environment?.r).not.toHaveProperty('fingerprintPreview')
    expect(client.environment?.r).not.toHaveProperty('packages')
    expect(client.runs[0]).not.toHaveProperty('failureCode')
    expect(client.runs[0]).not.toHaveProperty('outputDegraded')
    expect(client.runs[1]).toMatchObject({ failureCode: 'RUN_FAILED' })
    expect(client.runs[1]).not.toHaveProperty('outputDegraded')
    expect(client.runs[2]).toMatchObject({ failureCode: 'RUN_FAILED', outputDegraded: true })
    expect(client.artifacts[0]).toMatchObject({ caption: 'A safe caption.' })

    const { python: _python, ...environmentWithoutPython } = environment
    expect(toClientScienceProjection({
      ...host,
      environment: { ...environmentWithoutPython, r: unavailableR },
    })?.environment).not.toHaveProperty('python')
  })
})
