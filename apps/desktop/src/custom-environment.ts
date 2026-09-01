/** A user-authored package set, expressed as an {@link EnvironmentDeclaration} the shipped provisioner can run unchanged. */

import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from './atomic-write.ts'
import { parseEnvironmentDeclaration, type DesktopPlatform, type EnvironmentDeclaration, type EnvironmentSource } from './environment-declaration.ts'

/** The single id every custom package set is published under; one custom environment exists at a time. */
export const CUSTOM_ENVIRONMENT_ID = 'custom'

/**
 * The `YYYY.MM` half of a custom revision. A format anchor, not a date: the
 * revision's meaning is the digest that follows it, and deriving these two
 * fields from the current clock would give one unchanged package set a new
 * revision each month, which `resolveDisciplineStatus` would read as `stale`
 * and re-provision for no reason.
 */
const REVISION_PREFIX = '2026.09'

/** Advertised sizes for a custom set, which cannot be known before the solver runs. */
const ESTIMATED_DOWNLOAD_BYTES = 520_000_000
const REQUIRED_FREE_BYTES = 6_000_000_000
const TIMEOUT_MS = 3_600_000

/**
 * Health checks that prove only that each interpreter starts. A custom set
 * is whatever the user asked for, so probing named libraries — the way the
 * shipped declaration does — would fail an environment that is exactly what
 * was requested. Starting both interpreters is the part the binding written
 * after provisioning actually depends on.
 */
const HEALTH_CHECKS = [
  { language: 'python', executable: 'python', args: ['-c', 'pass'] },
  { language: 'r', executable: 'Rscript', args: ['-e', 'invisible(NULL)'] },
] as const

function customPath(root: string): string {
  return join(root, 'custom.json')
}

/**
 * Derive the revision digest for a package set. Order-insensitive (the
 * same packages listed in a different order are the same environment) and
 * stable across launches, so re-entering onboarding with an unchanged list
 * resolves to `current` instead of re-downloading.
 *
 * Deliberately excludes sources: a source names where packages are
 * downloaded from, not which packages the resulting environment has, so
 * trying a different mirror (or the ordered fallback moving on to one) for
 * the same package list must not mint a new revision and force a
 * redundant re-provision of an environment that would come out identical.
 * @param packages - the requested package tokens.
 * @returns a decimal digest, the third field of the revision.
 */
function digest(packages: readonly string[]): string {
  const canonical = JSON.stringify([...packages].sort())
  return String(Number.parseInt(createHash('sha256').update(canonical).digest('hex').slice(0, 10), 16))
}

/**
 * Build the declaration for a user-authored package set. Routed through
 * {@link parseEnvironmentDeclaration} rather than constructed directly, so
 * a package token the user typed faces exactly the validation a shipped
 * declaration faces before it can reach the solver's argv.
 * @param packages - the requested package tokens, in the order the user listed them.
 * @param platforms - the platforms this build provisions for.
 * @param sources - the same ordered sources the shipped declaration carries;
 *   a custom package set does not choose its own sources.
 * @returns the declaration to persist and provision.
 * @throws when the set is empty or a token is not a valid package spec.
 */
export function buildCustomDeclaration(
  packages: readonly string[],
  platforms: readonly DesktopPlatform[],
  sources: readonly EnvironmentSource[],
): EnvironmentDeclaration {
  return parseEnvironmentDeclaration({
    schemaVersion: 1,
    id: CUSTOM_ENVIRONMENT_ID,
    revision: `${REVISION_PREFIX}.${digest(packages)}`,
    name: '自定义环境 · Custom environment',
    supportedPlatforms: platforms,
    sources,
    packages,
    estimatedDownloadBytes: ESTIMATED_DOWNLOAD_BYTES,
    requiredFreeBytes: REQUIRED_FREE_BYTES,
    timeoutMs: TIMEOUT_MS,
    healthChecks: HEALTH_CHECKS,
  })
}

/**
 * Persist the custom declaration beside the provisioner's own state, so the
 * next launch can resolve the applied environment's id against a declaration
 * again — without this file, `resolveDisciplineStatus` reports
 * `unknown-discipline` for a working custom environment and routes back to
 * onboarding on every launch.
 * @param root - the provisioner root (`<dshHome>/desktop-environments`).
 * @param declaration - the declaration to persist.
 */
export async function writeCustomDeclaration(root: string, declaration: EnvironmentDeclaration): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 })
  await writeFileAtomic(customPath(root), `${JSON.stringify(declaration)}\n`, { mode: 0o600 })
}

/**
 * Read the persisted custom declaration, if the user has ever authored one.
 * A file that exists but does not parse is a hard failure rather than an
 * absent custom environment: it would otherwise silently drop the
 * declaration backing an applied environment, sending a working install
 * back through onboarding with no stated reason.
 * @param root - the provisioner root (`<dshHome>/desktop-environments`).
 * @returns the persisted declaration, or `undefined` when none was ever written.
 * @throws when the file exists but is unreadable or invalid.
 */
export async function readCustomDeclaration(root: string): Promise<EnvironmentDeclaration | undefined> {
  let raw: string
  try {
    raw = await readFile(customPath(root), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  return parseEnvironmentDeclaration(JSON.parse(raw))
}
