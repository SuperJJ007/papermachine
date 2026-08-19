/** Session-container applicability policy for durable Science facts. */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { isScienceDomainEventType } from './codec.ts'
import type { ScienceFoldState } from './fold-state.ts'

/**
 * Require one candidate event to be applicable to its owning Session.
 *
 * This policy owns facts that are not present in the event stream itself,
 * notably the session's resolved agent preset. The caller resolves it
 * through `@deepseek-ai/dsh-agent-presets`' `resolveSessionPreset` (creation
 * header, overridden by the last `agent-preset/selected` event) rather than
 * the frozen creation header alone, matching every other host-layer reader
 * of a session's preset — a session recomposed to `science` while blank
 * keeps its original creation-time header forever, but every event after the
 * switch is a Science-preset event. Science transition and provenance rules
 * remain in the strict fold.
 *
 * @param preset - the session's resolved agent preset immediately before the candidate event.
 * @param state - strict fold state immediately before the candidate event.
 * @param event - candidate Session event being admitted.
 */
export function assertScienceSessionApplicability(
  preset: string | undefined,
  state: ScienceFoldState,
  event: SessionEvent,
): void {
  if (isScienceDomainEventType(event.type) && preset !== 'science') {
    throw new Error('Science events require the session\'s resolved agent preset to equal "science"')
  }
  if (preset === 'science'
    && state.mode === undefined
    && (event.type === 'step/start'
      || event.type === 'request/header'
      || event.type === 'tool/call')) {
    throw new Error('Science mode must be bound before the first step/start, request/header, or tool/call')
  }
}
