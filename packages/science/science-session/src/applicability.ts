/** Session-container applicability policy for durable Science facts. */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { isScienceDomainEventType } from './codec.ts'
import type { ScienceFoldState } from './fold-state.ts'
import { SCIENCE_PRESET_ID } from './ids.ts'

/**
 * Read the candidate's own recorded `presetId` without the strict decode
 * `transition.ts` performs later in the fold — mirroring how this package's
 * invariant companion already reads `event.data.agentPreset` off a raw
 * `agent-preset/selected` event before any domain decode. This function
 * only needs the one field to check self-consistency against the live-
 * resolved preset; a malformed or missing value simply fails that check
 * (transition.ts reports the precise decode failure once this event
 * commits to the fold).
 * @param event - candidate event, already known to be `science/mode-bound`.
 * @returns the recorded `presetId`, or `undefined` when absent/malformed.
 */
function recordedModeBoundPresetId(event: SessionEvent): string | undefined {
  const mode = (event.data as { readonly mode?: { readonly presetId?: unknown } }).mode
  return typeof mode?.presetId === 'string' ? mode.presetId : undefined
}

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
 * A session's Science events must keep naming the one preset that bound
 * Science mode: `science/mode-bound` itself must record the currently
 * resolved preset (today always `SCIENCE_PRESET_ID`, the only preset this
 * policy recognizes as eligible — see its own JSDoc), and every later
 * Science event must find the resolved preset unchanged since that bind.
 * Replay never re-decides eligibility from live preset metadata; it only
 * checks this self-consistency, matching the Host-side pre-commit /
 * replay-only-checks-what-committed split used elsewhere in this domain
 * (e.g. store-reference validation for artifact events).
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
  if (isScienceDomainEventType(event.type)) {
    if (state.mode === undefined) {
      const boundPresetId = event.type === 'science/mode-bound' ? recordedModeBoundPresetId(event) : undefined
      if (preset !== SCIENCE_PRESET_ID || boundPresetId !== preset) {
        throw new Error(`Science events require the session's resolved agent preset to equal ${JSON.stringify(SCIENCE_PRESET_ID)}`)
      }
    } else if (preset !== state.mode.presetId) {
      throw new Error('Science events require the session\'s resolved agent preset to still equal the preset that bound Science mode')
    }
  }
  if (preset === SCIENCE_PRESET_ID
    && state.mode === undefined
    && (event.type === 'step/start'
      || event.type === 'request/header'
      || event.type === 'tool/call')) {
    throw new Error('Science mode must be bound before the first step/start, request/header, or tool/call')
  }
}
