/** Package-owned pre-commit invariants for durable Science session facts. */

import type { Context } from '@deepseek-ai/cordis'
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

/** Apply one candidate through applicability and the strict fold. */
function applyChecked(
  session: Session,
  state: ScienceFoldState,
  event: SessionEvent,
  fail: InvariantFailure,
): void {
  try {
    assertScienceSessionApplicability(session.header, state, event)
    applyScienceEvent(state, event)
  } catch (error) {
    /* v8 ignore next -- domain validation throws Error instances */
    const message = error instanceof Error ? error.message : String(error)
    fail(`session event ${String(event.seq)} violates the durable Science stream: ${message}`)
  }
}

/** Install an independent incremental fold over every attached session. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const states = new WeakMap<Session, ScienceFoldState>()
  const staged = new WeakMap<SessionEvent, { readonly session: Session; readonly state: ScienceFoldState }>()

  const seed = (session: Session): ScienceFoldState => {
    const state = emptyScienceFoldState()
    for (const event of session.events) applyChecked(session, state, event, fail)
    states.set(session, state)
    return state
  }
  /* v8 ignore next -- session/event always follows list() or session/created seeding */
  const stateFor = (session: Session): ScienceFoldState => states.get(session) ?? seed(session)

  for (const session of ctx.sessions.list()) seed(session)
  ctx.on('session/created', (session) => { seed(session) }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    const state = cloneScienceFoldState(stateFor(session))
    applyChecked(session, state, event, fail)
    staged.set(event, { session, state })
  }, { global: true })
  ctx.on('session/event', (session, event) => {
    const candidate = staged.get(event)
    /* v8 ignore next 2 -- internal/dispatch stages the exact callback arguments */
    if (candidate === undefined || candidate.session !== session) {
      return fail('session/event reached publication without matching Science-fold validation')
    }
    staged.delete(event)
    states.set(session, candidate.state)
  }, { global: true })
}, { inject: ['sessions'] })

/** Register the Science-stream invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
