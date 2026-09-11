/** Host-to-browser deployment configuration for Turn output groups. */

/** Schema default shared by the Host and standalone client composition. */
export const DEFAULT_TURN_OUTPUT_COLLAPSED_COUNT = 4
/** Boot-global field populated before the client bundles mount. */
export const TURN_OUTPUT_COUNT_GLOBAL = '__DSH_CHAT_TURN_OUTPUT_COUNT__'

/**
 * Resolve the optional boot value for standalone client composition and reject malformed wire values.
 * @returns The positive deployment card limit.
 */
export function readTurnOutputCollapsedCount(): number {
  const raw = (globalThis as Record<string, unknown>)[TURN_OUTPUT_COUNT_GLOBAL]
  if (raw === undefined) return DEFAULT_TURN_OUTPUT_COLLAPSED_COUNT
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 1) {
    throw new Error('ui-chat: turnOutputCollapsedCount must be a positive integer')
  }
  return raw
}
