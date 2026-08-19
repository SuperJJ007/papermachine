import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { replayScience, toClientScienceProjection } from '../src/index.ts'
import { scienceProjectionSchema } from '../src/projection.ts'
import {
  ARTIFACT_CALL_ID,
  ARTIFACT_ID,
  FINGERPRINT,
  PACKAGES_SHA,
  RUN_CALL_ID,
  RUN_ID,
  event,
  kernelExited,
  legalEvents,
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
    const { exitCode: _exitCode, ...withoutExitCode } = terminal
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
        withoutExitCode,
        { ...terminal, signal: 'TERM', failureCode: 'RUN_FAILED' },
        { ...terminal, signal: '/private/TERM' },
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
    expect(client.runs[0]).not.toHaveProperty('exitCode')
    expect(client.runs[1]).toMatchObject({ signal: 'TERM', failureCode: 'RUN_FAILED' })
    expect(client.runs[2]).not.toHaveProperty('signal')
    expect(client.artifacts[0]).toMatchObject({ caption: 'A safe caption.' })

    const { python: _python, ...environmentWithoutPython } = environment
    expect(toClientScienceProjection({
      ...host,
      environment: { ...environmentWithoutPython, r: unavailableR },
    })?.environment).not.toHaveProperty('python')
  })
})
