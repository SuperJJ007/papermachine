import { describe, expect, it } from 'vitest'
import { assertScienceSessionApplicability } from '../src/applicability.ts'
import { emptyScienceFoldState } from '../src/fold-state.ts'
import { applyScienceEvent } from '../src/transition.ts'
import { event, mode } from './fixtures.ts'

describe('Science Session applicability policy', () => {
  it('owns the durable preset boundary without duplicating transitions', () => {
    const state = emptyScienceFoldState()
    const modeEvent = event('science/mode-bound', 0, 100, { version: 1, mode: mode() })

    expect(() => { assertScienceSessionApplicability({}, state, modeEvent) })
      .toThrow(/agentPreset/)
    expect(() => { assertScienceSessionApplicability({ agentPreset: 'science' }, state, modeEvent) })
      .not.toThrow()

    applyScienceEvent(state, modeEvent)
    expect(() => { assertScienceSessionApplicability({ agentPreset: 'science' }, state, modeEvent) })
      .not.toThrow()
    expect(() => { applyScienceEvent(state, { ...modeEvent, seq: 1 }) })
      .toThrow(/bound only once/)
  })

  it.each([
    event('step/start', 0, 100, { turn: 1, step: 1 }),
    event('request/header', 0, 100, {}),
    event('tool/call', 0, 100, {}),
  ])('requires mode before Science-preset host activity: $type', (candidate) => {
    const state = emptyScienceFoldState()
    expect(() => { assertScienceSessionApplicability({ agentPreset: 'science' }, state, candidate) })
      .toThrow(/mode must be bound/)
    expect(() => { assertScienceSessionApplicability({}, state, candidate) }).not.toThrow()
  })
})
