import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as ScienceSessionDomain from '../src/index.ts'
import type { ScienceClientProjection } from '../src/index.ts'
import type { ScienceProjectionState } from '../src/projection-private.ts'
import { mode } from './fixtures.ts'

const scienceValue = (ctx: Context, session: Session): ScienceClientProjection | null | undefined =>
  ctx.sessionProjections.snapshot(session).values.science

describe('Science projection registry', () => {
  it('distinguishes an absent key from a registered null value and unregisters on HMR disposal', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    const session = ctx.sessions.create()

    expect(ctx.sessionProjections.snapshot(session).values).not.toHaveProperty('science')
    const first = await ctx.plugin(ScienceSessionDomain)
    expect(scienceValue(ctx, session)).toBeNull()

    await first.dispose()
    expect(ctx.sessionProjections.snapshot(session).values).not.toHaveProperty('science')

    const second = await ctx.plugin(ScienceSessionDomain)
    expect(scienceValue(ctx, session)).toBeNull()
    await second.dispose()
  })

  it('waits for an optional projection registry and registers when it appears', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const scienceFiber = await ctx.plugin(ScienceSessionDomain)
    await ctx.plugin(SessionProjectionRegistry)
    const session = ctx.sessions.create()
    expect(scienceValue(ctx, session)).toBeNull()
    await scienceFiber.dispose()
    expect(ctx.sessionProjections.snapshot(session).values).not.toHaveProperty('science')
  })

  it('advances its checkpoint watermark but notifies only for a public Science change', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(ScienceSessionDomain)
    const session = ctx.sessions.create(SessionId('science-projection-watermark'), {
      meta: { agentPreset: 'science' },
    })
    const seen: Array<{ readonly seq: number; readonly value: unknown }> = []
    ctx.sessionProjections.onChanged((_session, key, value, seq) => {
      if (key === 'science') seen.push({ seq, value })
    })

    session.append('turn/start', { turn: 1 })
    const modeBound = session.append('science/mode-bound', { version: 1, mode: mode() })
    session.append('request/header', {
      header: { config: { provider: 'test', model: 'test-model' } },
      reason: 'initial',
    })
    session.append('turn/start', { turn: 2 })

    expect(seen).toHaveLength(1)
    expect(seen[0]?.seq).toBe(modeBound.seq)
    expect(seen[0]?.value).toMatchObject({
      mode: mode(),
      lastScienceEventSeq: modeBound.seq,
    })
    const checkpoint = ctx.sessionProjections.checkpoint(session).science!
    expect((checkpoint.val as ScienceProjectionState).observedSeq).toBe(session.seq - 1)
    expect(checkpoint.seq).toBe(session.seq - 1)
    expect(scienceValue(ctx, session)?.lastScienceEventSeq).toBe(modeBound.seq)
  })
})
