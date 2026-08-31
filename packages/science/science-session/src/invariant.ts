/** Package-owned pre-commit invariants for durable Science session facts. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { assertScienceSessionApplicability } from './applicability.ts'
import { cloneScienceFoldState, emptyScienceFoldState } from './fold-state.ts'
import type { ScienceFoldState } from './fold-state.ts'
import { applyScienceEvent } from './transition.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-science-session'

/** Cordis companion plugin name. */
export const name = 'science-session-invariant'

/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** The strict fold state and resolved agent preset immediately before the next candidate event. */
interface ScienceInvariantCursor {
  readonly state: ScienceFoldState
  readonly preset: string | undefined
}

/** Apply one candidate through applicability and the strict fold. */
function applyChecked(
  preset: string | undefined,
  state: ScienceFoldState,
  event: SessionEvent,
  fail: InvariantFailure,
): void {
  try {
    assertScienceSessionApplicability(preset, state, event)
    applyScienceEvent(state, event)
  } catch (error) {
    /* v8 ignore next -- domain validation throws Error instances */
    const message = error instanceof Error ? error.message : String(error)
    fail(`session event ${String(event.seq)} violates the durable Science stream: ${message}`)
  }
}

/**
 * The resolved preset immediately after one candidate event, matching
 * `@deepseek-ai/dsh-agent-presets`' `resolveSessionPreset` newest-selection-
 * wins rule — carried forward through this cursor rather than rescanning
 * `session.events` on every dispatched event: `agent-preset/selected` is the
 * only event type that moves it, and it takes effect starting with the event
 * immediately after it.
 */
function nextPreset(preset: string | undefined, event: SessionEvent): string | undefined {
  return event.type === 'agent-preset/selected' ? event.data.agentPreset : preset
}

/** Install an independent incremental fold over every attached session. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const cursors = new WeakMap<Session, ScienceInvariantCursor>()
  const staged = new WeakMap<SessionEvent, { readonly session: Session } & ScienceInvariantCursor>()

  const seed = (session: Session): ScienceInvariantCursor => {
    const state = emptyScienceFoldState()
    let preset = session.header.agentPreset
    for (const event of session.events) {
      applyChecked(preset, state, event, fail)
      preset = nextPreset(preset, event)
    }
    const cursor = { state, preset }
    cursors.set(session, cursor)
    return cursor
  }
  /* v8 ignore next -- session/event always follows list() or session/created seeding */
  const cursorFor = (session: Session): ScienceInvariantCursor => cursors.get(session) ?? seed(session)

  // Each invariant owns its replay and publication state; this common Cordis event subscription does not share a domain fold.
  /* jscpd:ignore-start */
  for (const session of ctx.sessions.list()) seed(session)
  ctx.on('session/created', (session) => { seed(session) }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    /* jscpd:ignore-end */
    const cursor = cursorFor(session)
    const state = cloneScienceFoldState(cursor.state)
    applyChecked(cursor.preset, state, event, fail)
    staged.set(event, { session, state, preset: nextPreset(cursor.preset, event) })
  }, { global: true })
  ctx.on('session/event', (session, event) => {
    const candidate = staged.get(event)
    /* v8 ignore next 2 -- internal/dispatch stages the exact callback arguments */
    if (candidate === undefined || candidate.session !== session) {
      return fail('session/event reached publication without matching Science-fold validation')
    }
    staged.delete(event)
    cursors.set(session, { state: candidate.state, preset: candidate.preset })
  }, { global: true })
}, { inject: ['sessions'] })

/** Register the Science-stream invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
