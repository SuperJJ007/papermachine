/** Pure decision of whether the applied environment still matches the shipped discipline declaration. */

import type { AppliedEnvironment } from './provisioning.ts'
import type { EnvironmentDeclaration } from './environment-declaration.ts'

/**
 * `unselected` — no environment has ever been applied; onboarding is a first run.
 * `current` — the applied revision matches the shipped declaration for the same discipline id.
 * `stale` — a discipline is applied, but the shipped declaration for that id now names a
 * different revision; the discipline must be re-provisioned before the workspace opens.
 * `unknown-discipline` — the applied discipline id is no longer among the shipped declarations.
 */
export type DisciplineStatus =
  | { readonly kind: 'unselected' }
  | { readonly kind: 'current' }
  | { readonly kind: 'stale'; readonly declaration: EnvironmentDeclaration }
  | { readonly kind: 'unknown-discipline' }

/**
 * Compare the applied environment pointer against the currently shipped
 * declarations. A discipline is chosen once but its environment is not fixed
 * forever: when the shipped declaration for the applied discipline advances
 * to a new revision, this reports `stale` so the caller can route back to
 * provisioning instead of opening the workspace against an outdated
 * environment. F1's revision-scoped prefix path means re-provisioning a new
 * revision never touches the prefix this function found stale until the new
 * revision is itself applied.
 * @param applied - the current `applied.json` pointer, or `undefined` before any environment is applied.
 * @param declarations - every discipline declaration the running build ships.
 * @returns the discipline status driving whether the workspace or onboarding opens.
 */
export function resolveDisciplineStatus(
  applied: AppliedEnvironment | undefined,
  declarations: readonly EnvironmentDeclaration[],
): DisciplineStatus {
  if (applied === undefined) return { kind: 'unselected' }
  const declaration = declarations.find(item => item.id === applied.id)
  if (declaration === undefined) return { kind: 'unknown-discipline' }
  if (declaration.revision !== applied.revision) return { kind: 'stale', declaration }
  return { kind: 'current' }
}
