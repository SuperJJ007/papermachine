import { describe, expect, it } from 'vitest'
import { assertScienceSessionApplicability } from '../src/applicability.ts'
import { emptyScienceFoldState } from '../src/fold-state.ts'
import { applyScienceEvent } from '../src/transition.ts'
import { event, mode } from './fixtures.ts'

describe('Science Session applicability policy', () => {
  it('owns the durable preset boundary without duplicating transitions', () => {
    const state = emptyScienceFoldState()
    const modeEvent = event('science/mode-bound', 0, 100, { version: 1, mode: mode() })

    expect(() => { assertScienceSessionApplicability(undefined, state, modeEvent) })
      .toThrow(/resolved agent preset/)
    expect(() => { assertScienceSessionApplicability('science', state, modeEvent) })
      .not.toThrow()

    applyScienceEvent(state, modeEvent)
    expect(() => { assertScienceSessionApplicability('science', state, modeEvent) })
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
    expect(() => { assertScienceSessionApplicability('science', state, candidate) })
      .toThrow(/mode must be bound/)
    expect(() => { assertScienceSessionApplicability(undefined, state, candidate) }).not.toThrow()
  })

  it('rejects a science/mode-bound event whose own recorded presetId is malformed', () => {
    const state = emptyScienceFoldState()
    const malformedModeEvent = event('science/mode-bound', 0, 100, { version: 1, mode: { ...mode(), presetId: 42 } })

    expect(() => { assertScienceSessionApplicability('science', state, malformedModeEvent) })
      .toThrow(/resolved agent preset/)
  })

  it('rejects a science/mode-bound event whose own recorded presetId mismatches the resolved preset', () => {
    const state = emptyScienceFoldState()
    const mismatchedModeEvent = event('science/mode-bound', 0, 100, { version: 1, mode: { ...mode(), presetId: 'other' } })

    expect(() => { assertScienceSessionApplicability('science', state, mismatchedModeEvent) })
      .toThrow(/resolved agent preset/)
  })

  it('requires mode binding before a non-mode-bound Science domain event', () => {
    const state = emptyScienceFoldState()
    const runStartedEvent = event('science/run-started', 0, 100, {})

    expect(() => { assertScienceSessionApplicability('science', state, runStartedEvent) })
      .toThrow(/resolved agent preset/)
  })

  it('rejects a post-mode-bound Science event once the resolved preset has changed', () => {
    const state = emptyScienceFoldState()
    const modeEvent = event('science/mode-bound', 0, 100, { version: 1, mode: mode() })
    applyScienceEvent(state, modeEvent)

    const laterEvent = event('science/run-started', 1, 200, {})
    expect(() => { assertScienceSessionApplicability('other', state, laterEvent) })
      .toThrow(/still equal the preset that bound Science mode/)
  })
})
