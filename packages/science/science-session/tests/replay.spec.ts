import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as ScienceSessionDomain from '../src/index.ts'
import { replayScience, toClientScienceProjection } from '../src/index.ts'
import { SCIENCE_PROJECTION_STATE_VERSION } from '../src/ids.ts'
import {
  applyScienceProjectionState,
  emptyScienceProjectionState,
  scienceProjectionStateSchema,
} from '../src/projection.ts'
import {
  OUTCOME_CALL_ID,
  RUN_ID,
  appendFixtureEvents,
  legalEvents,
  mode,
  outcome,
} from './fixtures.ts'

interface ScienceCheckpointState {
  readonly observedSeq: number
  readonly witness: readonly { readonly seq: number }[]
}

async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(ScienceSessionDomain)
  return ctx
}

function appendPreModeMessageOutcome(session: Session): void {
  const message = session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'pre-mode evidence' }],
      source: { kind: 'model', provider: 'test', model: 'test-model' },
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [] })
  session.append('science/mode-bound', { version: 1, mode: mode() })
  const request = session.append('request/header', {
    header: { config: { provider: 'test', model: 'test-model' } },
    reason: 'initial',
  })
  const call = session.append('tool/call', {
    turn: 1,
    step: 1,
    callId: OUTCOME_CALL_ID,
    name: 'publish_outcome',
    arguments: '{}',
  })
  session.append('science/outcome-published', {
    version: 1,
    outcome: outcome({
      evidence: [{ kind: 'message', seq: message.seq }],
      requestHeaderSeq: request.seq,
      environmentRevisions: [],
      publishedAt: call.time,
    }),
  })
}

describe('Science cold replay', () => {
  it('preserves pre-mode message evidence across live and cold replay', async () => {
    const liveCtx = await harness()
    const liveSession = liveCtx.sessions.create(SessionId('science-pre-mode-message-live'), {
      meta: { agentPreset: 'science' },
    })
    appendPreModeMessageOutcome(liveSession)
    const live = liveCtx.sessionProjections.snapshot(liveSession).values.science
    expect(live).toEqual(toClientScienceProjection(replayScience(liveSession.events)))

    const coldCtx = await harness()
    const coldSession = coldCtx.sessions.create(SessionId('science-pre-mode-message-cold'), {
      seed: JSON.parse(JSON.stringify(liveSession.events)) as SessionEvent[],
      meta: { agentPreset: 'science' },
    })
    expect(coldCtx.sessionProjections.snapshot(coldSession).values.science).toEqual(live)
    expect(live?.outcome?.evidence).toEqual([{ kind: 'message', seq: 0 }])
  })

  it('rebuilds the same value from a cold JSON seed as the live projection', async () => {
    const liveCtx = await harness()
    const liveSession = liveCtx.sessions.create(SessionId('science-live'), {
      meta: { agentPreset: 'science' },
    })
    appendFixtureEvents(liveSession)
    const live = liveCtx.sessionProjections.snapshot(liveSession).values.science
    expect(live).toEqual(toClientScienceProjection(replayScience(liveSession.events)))
    const seed = JSON.parse(JSON.stringify(liveSession.events)) as SessionEvent[]

    const coldCtx = await harness()
    const coldSession = coldCtx.sessions.create(SessionId('science-cold'), {
      seed,
      meta: { agentPreset: 'science' },
    })
    const cold = coldCtx.sessionProjections.snapshot(coldSession).values.science
    expect(cold).toEqual(live)
    expect(cold).toEqual(toClientScienceProjection(replayScience(coldSession.events)))
  })

  it('round-trips a projection checkpoint and preserves the cold value', async () => {
    const ctx = await harness()
    const session = ctx.sessions.create(SessionId('science-checkpoint'), {
      meta: { agentPreset: 'science' },
    })
    appendFixtureEvents(session)
    const live = ctx.sessionProjections.snapshot(session).values.science
    const checkpoint = JSON.parse(JSON.stringify(
      ctx.sessionProjections.checkpoint(session),
    )) as ReturnType<typeof ctx.sessionProjections.checkpoint>

    expect(ctx.sessionProjections.viewCheckpoint(checkpoint).science).toEqual(live)

    const science = checkpoint.science!
    const state = science.val as ScienceCheckpointState
    const tampered = {
      ...checkpoint,
      science: {
        ...science,
        val: {
          ...state,
          witness: state.witness.filter(candidate => candidate.seq !== 8),
        },
      },
    }
    expect(ctx.sessionProjections.viewCheckpoint(tampered)).not.toHaveProperty('science')
    expect(ctx.sessionProjections.restoreFloor(tampered)).toBe(0)
    expect(() => ctx.sessionProjections.restore(tampered, [], science.seq + 1))
      .toThrow(/re-read from seq 0/)
    const refolded = ctx.sessionProjections.restore(tampered, session.events, 0)
    expect(refolded.snapshot.values.science).toEqual(live)
    expect(ctx.sessionProjections.snapshot(session).values.science).toEqual(live)
  })

  it('rejects an older Science value spliced under a newer checkpoint watermark', async () => {
    const ctx = await harness()
    const events = legalEvents()
    const modeOnly = applyScienceProjectionState(
      emptyScienceProjectionState(),
      events[0]!,
    )
    expect(modeOnly.observedSeq).toBe(0)
    expect(scienceProjectionStateSchema.safeParse(modeOnly).success).toBe(true)

    const spliced = {
      science: {
        ver: SCIENCE_PROJECTION_STATE_VERSION,
        seq: events.at(-1)!.seq,
        val: modeOnly,
      },
    }
    expect(ctx.sessionProjections.viewCheckpoint(spliced)).not.toHaveProperty('science')
    expect(ctx.sessionProjections.restoreFloor(spliced)).toBe(0)
    expect(() => ctx.sessionProjections.restore(spliced, [], events.length))
      .toThrow(/re-read from seq 0/)

    const restored = ctx.sessionProjections.restore(spliced, events, 0)
    expect(restored.snapshot.values.science).toEqual(toClientScienceProjection(replayScience(events)))
    expect((restored.checkpoint.science?.val as ScienceCheckpointState).observedSeq)
      .toBe(events.at(-1)!.seq)
  })

  it('discards a version-mismatched checkpoint and refolds the complete log', async () => {
    const ctx = await harness()
    const session = ctx.sessions.create(SessionId('science-checkpoint-version'), {
      meta: { agentPreset: 'science' },
    })
    appendFixtureEvents(session)
    const live = ctx.sessionProjections.snapshot(session).values.science
    const checkpoint = ctx.sessionProjections.checkpoint(session)
    const science = checkpoint.science!
    const mismatched = {
      ...checkpoint,
      science: { ...science, ver: science.ver + 1 },
    }

    expect(ctx.sessionProjections.viewCheckpoint(mismatched)).not.toHaveProperty('science')
    expect(ctx.sessionProjections.restoreFloor(mismatched)).toBe(0)
    const restored = ctx.sessionProjections.restore(mismatched, session.events, 0)
    expect(restored.snapshot.values.science).toEqual(live)
    expect(restored.checkpoint.science?.ver).toBe(SCIENCE_PROJECTION_STATE_VERSION)

    const empty = ctx.sessionProjections.restore(mismatched, [], 0)
    expect(empty.snapshot.values.science).toBeNull()
  })

  it('derives interrupted only when cold construction closes an unmatched seed run', async () => {
    const sourceCtx = await harness()
    const source = sourceCtx.sessions.create(SessionId('science-open-source'), {
      meta: { agentPreset: 'science' },
    })
    appendFixtureEvents(source, legalEvents().slice(0, 5))
    expect(sourceCtx.sessionProjections.snapshot(source).values.science?.runs[0]?.status).toBe('running')

    const seed = JSON.parse(JSON.stringify(source.events)) as SessionEvent[]
    const resumedCtx = await harness()
    const resumed = resumedCtx.sessions.create(SessionId('science-open-resumed'), {
      seed,
      meta: { agentPreset: 'science' },
    })
    const run = resumedCtx.sessionProjections.snapshot(resumed).values.science?.runs[0]
    expect(run).toMatchObject({
      runId: RUN_ID,
      status: 'interrupted',
      interruptedAtSeq: seed.length,
    })
    expect(resumedCtx.sessionProjections.snapshot(resumed).values.science)
      .toEqual(toClientScienceProjection(replayScience(resumed.events)))
  })
})
