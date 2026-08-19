import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type {} from '../src/domain.ts'
import * as ScienceSessionDomain from '../src/index.ts'
import { decodeScienceDomainEvent, decodeScienceKernelState } from '../src/index.ts'
import { foldScience } from '../src/fold.ts'
import {
  applyScienceProjectionState,
  emptyScienceProjectionState,
  viewScienceProjectionState,
} from '../src/projection.ts'
import type { ScienceProjectionState } from '../src/projection-private.ts'
import { decodeScienceProjectionFold, encodeScienceProjectionFold } from '../src/projection-fold-codec.ts'
import {
  FINGERPRINT,
  event,
  kernelExited,
  kernelStarted,
  mode,
} from './fixtures.ts'

describe('Science kernel-state codec', () => {
  it('round-trips a started and an exited kernel fact', () => {
    expect(decodeScienceKernelState(kernelStarted())).toEqual(kernelStarted())
    expect(decodeScienceKernelState(kernelExited())).toEqual(kernelExited())
  })

  it('rejects an unknown end reason', () => {
    expect(() => decodeScienceKernelState(kernelExited({ reason: 'unexpected' as never }))).toThrow()
  })

  it('rejects a reason carried by a started fact', () => {
    expect(() => decodeScienceKernelState({ ...kernelStarted(), reason: 'idle' })).toThrow()
  })

  it('rejects an exited fact missing its reason', () => {
    const { reason: _reason, ...withoutReason } = kernelExited()
    expect(() => decodeScienceKernelState(withoutReason)).toThrow()
  })

  it('rejects a non-positive or fractional kernel epoch', () => {
    for (const kernelEpoch of [0, -1, 1.5]) {
      expect(() => decodeScienceKernelState(kernelStarted({ kernelEpoch }))).toThrow()
    }
  })

  it('rejects an unexpected field on the fact itself or its event wrapper', () => {
    expect(() => decodeScienceKernelState({ ...kernelStarted(), unexpected: true })).toThrow()
    expect(() => decodeScienceDomainEvent(event('science/kernel-state', 0, 100, {
      version: 1,
      kernel: kernelStarted(),
      unexpected: true,
    }))).toThrow()
  })

  it('decodes the event wrapper and rejects an ignorable or foreign-version kernel-state event', () => {
    const wrapped = event('science/kernel-state', 1, 115, { version: 1, kernel: kernelStarted() })
    expect(decodeScienceDomainEvent(wrapped)).toEqual({
      type: 'science/kernel-state',
      seq: 1,
      time: 115,
      data: { version: 1, kernel: kernelStarted() },
    })
    expect(() => decodeScienceDomainEvent({ ...wrapped, ignorable: true })).toThrow(/required, not ignorable/)
    expect(() => decodeScienceDomainEvent(event('science/kernel-state', 1, 115, {
      version: 2,
      kernel: kernelStarted(),
    }))).toThrow()
  })
})

describe('strict Science kernel-state fold', () => {
  it('folds a started/exited alternation across coexisting python and r kernels', () => {
    const events: SessionEvent[] = [
      event('science/mode-bound', 0, 100, { version: 1, mode: mode() }),
      event('science/kernel-state', 1, 115, { version: 1, kernel: kernelStarted() }),
      event('science/kernel-state', 2, 120, {
        version: 1,
        kernel: kernelStarted({ kernelEpoch: 2, language: 'r', at: 120 }),
      }),
      event('science/kernel-state', 3, 200, { version: 1, kernel: kernelExited() }),
      event('science/kernel-state', 4, 210, {
        version: 1,
        kernel: kernelExited({ kernelEpoch: 2, language: 'r', at: 210 }),
      }),
      event('science/kernel-state', 5, 300, {
        version: 1,
        kernel: kernelStarted({ kernelEpoch: 3, at: 300 }),
      }),
    ]
    const state = foldScience(events)
    expect(state.kernels).toEqual([
      kernelExited(),
      kernelExited({ kernelEpoch: 2, language: 'r', at: 210 }),
      kernelStarted({ kernelEpoch: 3, at: 300 }),
    ])
    expect(state.kernelEpochWatermark).toBe(3)
  })

  it('rejects every kernel-state transition discontinuity', () => {
    const cases: Array<readonly [string, SessionEvent[], RegExp]> = [
      ['kernel state before mode', [
        event('science/kernel-state', 0, 115, { version: 1, kernel: kernelStarted() }),
      ], /prior mode binding/],
      ['epoch regression', [
        event('science/mode-bound', 0, 100, { version: 1, mode: mode() }),
        event('science/kernel-state', 1, 115, { version: 1, kernel: kernelStarted({ kernelEpoch: 2 }) }),
        event('science/kernel-state', 2, 200, { version: 1, kernel: kernelExited({ kernelEpoch: 2, at: 200 }) }),
        event('science/kernel-state', 3, 210, { version: 1, kernel: kernelStarted({ kernelEpoch: 2, at: 210 }) }),
      ], /does not exceed the session's prior kernel epoch/],
      ['double start for the same language before an exit', [
        event('science/mode-bound', 0, 100, { version: 1, mode: mode() }),
        event('science/kernel-state', 1, 115, { version: 1, kernel: kernelStarted() }),
        event('science/kernel-state', 2, 120, { version: 1, kernel: kernelStarted({ kernelEpoch: 2, at: 120 }) }),
      ], /already started/],
      ['exit with no prior started fact', [
        event('science/mode-bound', 0, 100, { version: 1, mode: mode() }),
        event('science/kernel-state', 1, 115, { version: 1, kernel: kernelExited() }),
      ], /no matching started/],
      ['exit epoch does not match the currently open kernel', [
        event('science/mode-bound', 0, 100, { version: 1, mode: mode() }),
        event('science/kernel-state', 1, 115, { version: 1, kernel: kernelStarted() }),
        event('science/kernel-state', 2, 200, { version: 1, kernel: kernelExited({ kernelEpoch: 9, at: 200 }) }),
      ], /no matching started/],
      ['double exit for the same language', [
        event('science/mode-bound', 0, 100, { version: 1, mode: mode() }),
        event('science/kernel-state', 1, 115, { version: 1, kernel: kernelStarted() }),
        event('science/kernel-state', 2, 200, { version: 1, kernel: kernelExited() }),
        event('science/kernel-state', 3, 210, { version: 1, kernel: kernelExited({ at: 210 }) }),
      ], /no matching started/],
    ]
    for (const [name, events, pattern] of cases) {
      expect(() => foldScience(events), name).toThrow(pattern)
    }
  })

  it('derives interrupted only for a kernel still started at session/end-seed', () => {
    const openKernel: SessionEvent[] = [
      event('science/mode-bound', 0, 100, { version: 1, mode: mode() }),
      event('science/kernel-state', 1, 115, { version: 1, kernel: kernelStarted() }),
    ]
    const interrupted = foldScience([...openKernel, event('session/end-seed', 2, 400, {})])
    expect(interrupted.kernels).toEqual([{
      kernelEpoch: 1,
      language: 'python',
      status: 'interrupted',
      environmentRevision: 1,
      environmentFingerprint: FINGERPRINT,
      startedAt: 115,
      finishedAt: 400,
      interruptedAtSeq: 2,
    }])
    expect(interrupted.lastScienceEventSeq).toBe(2)

    const closedKernel: SessionEvent[] = [
      ...openKernel,
      event('science/kernel-state', 2, 200, { version: 1, kernel: kernelExited() }),
    ]
    const settled = foldScience([...closedKernel, event('session/end-seed', 3, 400, {})])
    expect(settled.kernels).toEqual([kernelExited()])
    // No open kernel means end-seed leaves the fold untouched: the last Science
    // fact is still the exited kernel-state event, not the seed boundary.
    expect(settled.lastScienceEventSeq).toBe(2)

    const mixed: SessionEvent[] = [
      ...closedKernel,
      event('science/kernel-state', 3, 210, {
        version: 1,
        kernel: kernelStarted({ kernelEpoch: 2, language: 'r', at: 210 }),
      }),
      event('session/end-seed', 4, 400, {}),
    ]
    const mixedState = foldScience(mixed)
    expect(mixedState.kernels[0]).toEqual(kernelExited())
    expect(mixedState.kernels[1]).toMatchObject({
      status: 'interrupted',
      kernelEpoch: 2,
      language: 'r',
      interruptedAtSeq: 4,
    })
  })
})

describe('Science kernel-state replay equivalence', () => {
  async function harness(): Promise<Context> {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    return ctx
  }

  it('rebuilds the same kernel fold state from a cold JSON seed as the live fold for a fully closed lifecycle', async () => {
    const liveCtx = await harness()
    const live = liveCtx.sessions.create(SessionId('science-kernel-live'), { meta: { agentPreset: 'science' } })
    live.append('science/mode-bound', { version: 1, mode: mode() })
    live.append('science/kernel-state', { version: 1, kernel: kernelStarted() })
    live.append('science/kernel-state', { version: 1, kernel: kernelExited() })
    const liveState = foldScience(live.events)

    const seed = JSON.parse(JSON.stringify(live.events)) as SessionEvent[]
    const coldCtx = await harness()
    const cold = coldCtx.sessions.create(SessionId('science-kernel-cold'), { seed, meta: { agentPreset: 'science' } })
    const coldState = foldScience(cold.events)

    expect(coldState.kernels).toEqual(liveState.kernels)
    expect(coldState.kernelEpochWatermark).toBe(liveState.kernelEpochWatermark)
  })

  it('derives interrupted only when cold construction closes an unmatched seed kernel', async () => {
    const sourceCtx = await harness()
    const source = sourceCtx.sessions.create(SessionId('science-kernel-open-source'), {
      meta: { agentPreset: 'science' },
    })
    source.append('science/mode-bound', { version: 1, mode: mode() })
    source.append('science/kernel-state', { version: 1, kernel: kernelStarted() })
    expect(foldScience(source.events).kernels).toEqual([kernelStarted()])

    const seed = JSON.parse(JSON.stringify(source.events)) as SessionEvent[]
    const resumedCtx = await harness()
    const resumed = resumedCtx.sessions.create(SessionId('science-kernel-open-resumed'), {
      seed,
      meta: { agentPreset: 'science' },
    })
    const kernel = foldScience(resumed.events).kernels[0]
    expect(kernel).toMatchObject({ status: 'interrupted', kernelEpoch: 1, interruptedAtSeq: seed.length })
  })
})

describe('Science kernel-state projection persistence', () => {
  it('round-trips a closed kernel lifecycle through the projection fold codec', () => {
    const events: SessionEvent[] = [
      event('science/mode-bound', 0, 100, { version: 1, mode: mode() }),
      event('science/kernel-state', 1, 115, { version: 1, kernel: kernelStarted() }),
      event('science/kernel-state', 2, 120, {
        version: 1,
        kernel: kernelStarted({ kernelEpoch: 2, language: 'r', at: 120 }),
      }),
      event('science/kernel-state', 3, 200, { version: 1, kernel: kernelExited() }),
    ]
    const state = foldScience(events)
    const encoded = encodeScienceProjectionFold(state)
    expect(encoded.kernels).toEqual(state.kernels)
    expect(encoded.kernelEpochWatermark).toBe(2)

    const decoded = decodeScienceProjectionFold(encoded, state.nextSeq)
    expect(decoded).toEqual(state)
  })

  it('retains science/kernel-state in the incremental projection witness instead of dropping it', () => {
    const events: SessionEvent[] = [
      event('science/mode-bound', 0, 100, { version: 1, mode: mode() }),
      event('science/kernel-state', 1, 115, { version: 1, kernel: kernelStarted() }),
    ]
    const state = events.reduce<ScienceProjectionState>(applyScienceProjectionState, emptyScienceProjectionState())
    expect(state.witness.map(candidate => candidate.type)).toEqual(['science/mode-bound', 'science/kernel-state'])
    expect(decodeScienceProjectionFold(state.fold).kernels).toEqual([kernelStarted()])
    expect(viewScienceProjectionState(state)?.kernels).toEqual([{
      kernelEpoch: 1,
      language: 'python',
      state: 'started',
      environmentRevision: 1,
      environmentFingerprintPreview: FINGERPRINT.slice(0, 12),
      at: 115,
    }])
    expect(viewScienceProjectionState(state)?.metrics.kernelCount).toBe(1)
  })

  it('retains an end-seed-derived interruption in the incremental projection witness', () => {
    const events: SessionEvent[] = [
      event('science/mode-bound', 0, 100, { version: 1, mode: mode() }),
      event('science/kernel-state', 1, 115, { version: 1, kernel: kernelStarted() }),
      event('session/end-seed', 2, 400, {}),
    ]
    const state = events.reduce<ScienceProjectionState>(applyScienceProjectionState, emptyScienceProjectionState())
    expect(state.witness.map(candidate => candidate.type))
      .toEqual(['science/mode-bound', 'science/kernel-state', 'session/end-seed'])
    expect(viewScienceProjectionState(state)?.kernels).toEqual([{
      kernelEpoch: 1,
      language: 'python',
      status: 'interrupted',
      environmentRevision: 1,
      environmentFingerprintPreview: FINGERPRINT.slice(0, 12),
      startedAt: 115,
      finishedAt: 400,
      interruptedAtSeq: 2,
    }])
  })

  async function registryHarness(): Promise<Context> {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(ScienceSessionDomain)
    return ctx
  }

  it('carries kernel facts through the live sessionProjections cache and a cold JSON replay identically', async () => {
    const liveCtx = await registryHarness()
    const live = liveCtx.sessions.create(SessionId('science-kernel-projection-live'), {
      meta: { agentPreset: 'science' },
    })
    live.append('science/mode-bound', { version: 1, mode: mode() })
    live.append('science/kernel-state', { version: 1, kernel: kernelStarted() })
    live.append('science/kernel-state', { version: 1, kernel: kernelExited() })
    const liveValue = liveCtx.sessionProjections.snapshot(live).values.science
    expect(liveValue?.kernels).toEqual([{
      kernelEpoch: 1,
      language: 'python',
      state: 'exited',
      reason: 'idle',
      environmentRevision: 1,
      environmentFingerprintPreview: FINGERPRINT.slice(0, 12),
      at: 200,
    }])
    expect(liveValue?.metrics.kernelCount).toBe(1)

    const seed = JSON.parse(JSON.stringify(live.events)) as SessionEvent[]
    const coldCtx = await registryHarness()
    const cold = coldCtx.sessions.create(SessionId('science-kernel-projection-cold'), {
      seed,
      meta: { agentPreset: 'science' },
    })
    expect(coldCtx.sessionProjections.snapshot(cold).values.science).toEqual(liveValue)
  })
})
