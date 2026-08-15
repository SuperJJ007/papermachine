import { describe, expect, it } from 'vitest'
import { replayScience } from '../src/index.ts'
import { scienceProjectionSchema } from '../src/projection.ts'
import { legalEvents, RUN_ID, CHART_ID } from './fixtures.ts'

describe('Science projection replay', () => {
  it('projects all six event types and derives stable metrics', () => {
    const state = replayScience(legalEvents())
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

  it('returns null before Science mode is bound', () => {
    expect(replayScience([])).toBeNull()
  })
})
