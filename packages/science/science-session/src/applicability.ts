/** Session-container applicability policy for durable Science facts. */

import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { isScienceDomainEventType } from './codec.ts'
import type { ScienceFoldState } from './fold-state.ts'

/**
 * Require one candidate event to be applicable to its owning Session.
 *
 * This policy owns facts that are not present in the event stream itself,
 * notably the durable Session preset. Science transition and provenance rules
 * remain in the strict fold.
 *
 * @param header - immutable metadata for the event's owning Session.
 * @param state - strict fold state immediately before the candidate event.
 * @param event - candidate Session event being admitted.
 */
export function assertScienceSessionApplicability(
  header: Pick<SessionHeader, 'agentPreset'>,
  state: ScienceFoldState,
  event: SessionEvent,
): void {
  if (isScienceDomainEventType(event.type) && header.agentPreset !== 'science') {
    throw new Error('Science events require session.header.agentPreset to equal "science"')
  }
  if (header.agentPreset === 'science'
    && state.mode === undefined
    && (event.type === 'step/start'
      || event.type === 'request/header'
      || event.type === 'tool/call')) {
    throw new Error('Science mode must be bound before the first step/start, request/header, or tool/call')
  }
}
