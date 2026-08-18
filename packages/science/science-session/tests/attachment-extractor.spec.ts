/**
 * The sole `ctx.sessionAttachments` extractor this package registers for
 * `science/artifact-saved`: returns exactly `artifact.attachment` after the
 * existing strict decoder accepts the event, fails loud on malformed data,
 * and unregisters on HMR disposal.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionAttachmentIndex, { SessionAttachmentIndexError } from '@deepseek-ai/dsh-session-attachment-index'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as ScienceSessionDomain from '../src/index.ts'
import { appendFixtureEvents, artifact, event } from './fixtures.ts'

describe('science/artifact-saved attachment extractor', () => {
  it('registers an extractor that returns exactly artifact.attachment for a valid event', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionAttachmentIndex)
    await ctx.plugin(ScienceSessionDomain)
    const session = ctx.sessions.create(SessionId('science-chart-extractor'), { meta: { agentPreset: 'science' } })
    appendFixtureEvents(session)

    const artifactEvent = session.events.find(candidate => candidate.type === 'science/artifact-saved')
    expect(artifactEvent).toBeDefined()
    const refs = ctx.sessionAttachments.extract(artifactEvent!)
    expect(refs).toEqual([artifact().attachment])
  })

  it('propagates the strict decoder\'s rejection of a malformed artifact payload rather than degrading to empty', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionAttachmentIndex)
    await ctx.plugin(ScienceSessionDomain)
    const malformed = event('science/artifact-saved', 1, 1, { version: 1, artifact: 'not-an-object' })
    expect(() => ctx.sessionAttachments.extract(malformed)).toThrow()
  })

  it('leaves science/artifact-saved extractor-required (fails loud) when the registry has no science-session registration', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionAttachmentIndex)
    const artifactEvent = event('science/artifact-saved', 1, 1, { version: 1, artifact: artifact() })
    expect(() => ctx.sessionAttachments.extract(artifactEvent)).toThrow(SessionAttachmentIndexError)
  })

  it('removes the registration when the owning fiber disposes (HMR safety)', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionAttachmentIndex)
    const fiber = await ctx.plugin(ScienceSessionDomain)
    const artifactEvent = event('science/artifact-saved', 1, 1, { version: 1, artifact: artifact() })
    expect(ctx.sessionAttachments.extract(artifactEvent)).toEqual([artifact().attachment])
    await fiber.dispose()
    expect(() => ctx.sessionAttachments.extract(artifactEvent)).toThrow(SessionAttachmentIndexError)
  })
})
