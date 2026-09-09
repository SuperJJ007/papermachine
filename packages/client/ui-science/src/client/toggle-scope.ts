/** Read this deployment's Files-toggle placement from the Host-injected boot global. */

import { DEFAULT_TOGGLE_SCOPE, isToggleScope, TOGGLE_SCOPE_GLOBAL, type ToggleScope } from '../toggle-scope.ts'

/**
 * Resolve the placement the Host injected ahead of every plugin bundle
 * (`bootToggleScopeInjection`, the Host half). Falls back to the schema
 * default for a boot page that predates the injection (a stale cached
 * shell) or carries a malformed value — the same posture as every other
 * wire boundary this package validates.
 * @returns the validated placement.
 */
export function readToggleScope(): ToggleScope {
  const raw = (globalThis as Record<string, unknown>)[TOGGLE_SCOPE_GLOBAL]
  return isToggleScope(raw) ? raw : DEFAULT_TOGGLE_SCOPE
}
