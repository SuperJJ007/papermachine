/**
 * Files-toggle placement: shared by the Host {@link Config} (see `index.ts`)
 * and the browser boot-global reader (`client/toggle-scope.ts`), so both
 * halves of this dual package agree on the declared placements and the wire
 * name carrying the resolved one across the Host/browser boundary.
 */

/** Every placement the Science Files toggle can render at. */
export const TOGGLE_SCOPES = ['session', 'global'] as const

/**
 * Where the Files toggle renders for this deployment. `session` gates it to
 * a Science Session's own header — the generic Web presentation fence,
 * unchanged from before this field existed. `global` renders it app-wide,
 * unconditionally, from before any workspace is selected and before any
 * Session exists — the desktop composition's placement, since the desktop
 * overlay forces Science as the product default.
 */
export type ToggleScope = typeof TOGGLE_SCOPES[number]

/** Schema default: the generic Web fence. */
export const DEFAULT_TOGGLE_SCOPE: ToggleScope = 'session'

/**
 * `globalThis` property the Host injects ahead of every plugin bundle
 * (`bootToggleScopeInjection`, `boot-toggle-scope.ts`) so the browser half
 * can read the resolved placement synchronously at its own `apply()`.
 */
export const TOGGLE_SCOPE_GLOBAL = '__DSH_SCIENCE_TOGGLE_SCOPE__'

/**
 * Narrow one value crossing the boot-global wire boundary to a declared
 * placement.
 * @param value - value read off {@link TOGGLE_SCOPE_GLOBAL}.
 * @returns whether the value is a declared placement.
 */
export function isToggleScope(value: unknown): value is ToggleScope {
  return (TOGGLE_SCOPES as readonly unknown[]).includes(value)
}
