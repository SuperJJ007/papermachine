import { describe, expect, it } from 'vitest'
import { replayScience, toClientScienceProjection } from '../src/index.ts'
import { scienceProjectionSchema } from '../src/projection.ts'
import { legalEvents, RUN_ID, CHART_ID, FINGERPRINT } from './fixtures.ts'

describe('Science projection replay', () => {
  it('projects all six event types and derives stable metrics', () => {
    const state = toClientScienceProjection(replayScience(legalEvents()))
    expect(state).toMatchObject({
      mode: { modeId: 'science', presetId: 'science', modeRevision: 'r3' },
      environment: { revision: 1, status: 'applied' },
      runs: [{ runId: RUN_ID, status: 'success' }],
      charts: [{ chartId: CHART_ID, version: 1 }],
      outcome: { revision: 1 },
      metrics: {
        runCount: 1,
        successfulRunCount: 1,
        chartCount: 1,
        chartVersionCount: 1,
        outcomeRevision: 1,
      },
      lastScienceEventSeq: 9,
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
    expect(clientJson).not.toContain('toolCallId')
    expect(clientJson).not.toContain('requestHeaderSeq')
  })

  it('returns null before Science mode is bound', () => {
    expect(toClientScienceProjection(replayScience([]))).toBeNull()
  })

  it('sanitizes optional interpreter, run, and chart fields without inventing absent values', () => {
    const host = replayScience(legalEvents())!
    const environment = host.environment!
    const python = environment.python!
    const terminal = host.runs[0]!
    if (terminal.status !== 'success') throw new Error('fixture run is not successful')
    const { exitCode: _exitCode, ...withoutExitCode } = terminal
    const chart = host.charts[0]!
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
      charts: [{ ...chart, caption: 'A safe caption.' }],
    })!

    expect(client.environment).toMatchObject({
      python: { capability: 'available', fingerprintPreview: FINGERPRINT.slice(0, 12) },
      r: { capability: 'unavailable' },
    })
    expect(client.environment?.python).not.toHaveProperty('languageVersion')
    expect(client.environment?.r).not.toHaveProperty('languageVersion')
    expect(client.environment?.r).not.toHaveProperty('fingerprintPreview')
    expect(client.runs[0]).not.toHaveProperty('exitCode')
    expect(client.runs[1]).toMatchObject({ signal: 'TERM', failureCode: 'RUN_FAILED' })
    expect(client.runs[2]).not.toHaveProperty('signal')
    expect(client.charts[0]).toMatchObject({ caption: 'A safe caption.' })

    const { python: _python, ...environmentWithoutPython } = environment
    expect(toClientScienceProjection({
      ...host,
      environment: { ...environmentWithoutPython, r: unavailableR },
    })?.environment).not.toHaveProperty('python')
  })
})
