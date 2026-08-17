/**
 * The sole `ctx.sessionAttachments` extractor this package registers for
 * `science/chart-saved`: returns exactly `chart.attachment` after the
 * existing strict decoder accepts the event, fails loud on malformed data,
 * and unregisters on HMR disposal.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionAttachmentIndex, { SessionAttachmentIndexError } from '@deepseek-ai/dsh-session-attachment-index'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as ScienceSessionDomain from '../src/index.ts'
import { appendFixtureEvents, chart, event } from './fixtures.ts'

describe('science/chart-saved attachment extractor', () => {
  it('registers an extractor that returns exactly chart.attachment for a valid event', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionAttachmentIndex)
    await ctx.plugin(ScienceSessionDomain)
    const session = ctx.sessions.create(SessionId('science-chart-extractor'), { meta: { agentPreset: 'science' } })
    appendFixtureEvents(session)

    const chartEvent = session.events.find(candidate => candidate.type === 'science/chart-saved')
    expect(chartEvent).toBeDefined()
    const refs = ctx.sessionAttachments.extract(chartEvent!)
    expect(refs).toEqual([chart().attachment])
  })

  it('propagates the strict decoder\'s rejection of a malformed chart payload rather than degrading to empty', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionAttachmentIndex)
    await ctx.plugin(ScienceSessionDomain)
    const malformed = event('science/chart-saved', 1, 1, { version: 1, chart: 'not-an-object' })
    expect(() => ctx.sessionAttachments.extract(malformed)).toThrow()
  })

  it('leaves science/chart-saved extractor-required (fails loud) when the registry has no science-session registration', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionAttachmentIndex)
    const chartEvent = event('science/chart-saved', 1, 1, { version: 1, chart: chart() })
    expect(() => ctx.sessionAttachments.extract(chartEvent)).toThrow(SessionAttachmentIndexError)
  })

  it('removes the registration when the owning fiber disposes (HMR safety)', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionAttachmentIndex)
    const fiber = await ctx.plugin(ScienceSessionDomain)
    const chartEvent = event('science/chart-saved', 1, 1, { version: 1, chart: chart() })
    expect(ctx.sessionAttachments.extract(chartEvent)).toEqual([chart().attachment])
    await fiber.dispose()
    expect(() => ctx.sessionAttachments.extract(chartEvent)).toThrow(SessionAttachmentIndexError)
  })
})
