/** Stable local Conda-prefix observation through the shared subprocess and sandbox services. */

import { createHash } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SandboxEnforcement, SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import type { SandboxProvider } from '@deepseek-ai/dsh-sandbox'
import { canonicalizeWatchPath } from '@deepseek-ai/dsh-home-paths'
import type { ScienceInterpreterBinding, ScienceLanguage } from '@deepseek-ai/dsh-science-session'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type { ConfiguredProfile } from './config.ts'
import { assertPrefixReadOnly } from './execution.ts'
import type { ScienceSessionScratch } from './scratch.ts'
const POSIX_LAYOUT = { python: ['bin', 'python'], r: ['bin', 'Rscript'] } as const
const WINDOWS_LAYOUT = { python: ['python.exe'], r: ['Scripts', 'Rscript.exe'] } as const
const EXECUTABLE_LAYOUTS: Record<NodeJS.Platform, typeof POSIX_LAYOUT | typeof WINDOWS_LAYOUT> = {
  aix: POSIX_LAYOUT, android: POSIX_LAYOUT, darwin: POSIX_LAYOUT, freebsd: POSIX_LAYOUT, haiku: POSIX_LAYOUT,
  linux: POSIX_LAYOUT, netbsd: POSIX_LAYOUT, openbsd: POSIX_LAYOUT, sunos: POSIX_LAYOUT, win32: WINDOWS_LAYOUT, cygwin: POSIX_LAYOUT,
}

/** Stable facts required to start a selected interpreter. */
export interface ObservedInterpreter {
  /** Durable binding result. */
  readonly binding: ScienceInterpreterBinding
  /** Canonical prefix used in fixed PATH and boundary comparisons. */
  readonly prefix: string
  /** Canonical executable used in direct argv. */
  readonly executable: string
  /**
   * Sandbox enforcement level this language's probe confinement actually
   * reported. Absent when static interpreter checks failed before any
   * confinement was attempted (`staticFailure`) — no observation, honestly no value.
   */
  readonly enforcement?: SandboxEnforcement
}

/** Stable observations for every configured language in one profile. */
export interface ObservedProfile {
  /** Configured durable profile id. */
  readonly profile: ConfiguredProfile
  /** Python observation when declared. */
  readonly python?: ObservedInterpreter
  /** R observation when declared. */
  readonly r?: ObservedInterpreter
}

/** Input services and static values for a stable observation. */
export interface ObservationServices {
  readonly subprocess: SubprocessRuntime
  readonly sandbox: SandboxProvider
  readonly sessionScratch: ScienceSessionScratch
  readonly sessionId: SessionId
  readonly signal: AbortSignal
  /**
   * Create or verify the planned Session tree once every required probe
   * attempt is planned (paths and argv only, nothing confined yet).
   */
  readonly prepareSessionScratch?: () => Promise<void>
  /** Configured maximum retained package-inventory entries. */
  readonly packagesMaxEntries: number
  /** Configured maximum retained package-inventory UTF-8 bytes. */
  readonly packagesMaxBytes: number
  /** Lowest sandbox enforcement level Science is configured to accept for a probe confinement. */
  readonly minimumEnforcement: SandboxEnforcement
}

/**
 * Reject an allowlisted prefix that a future fixed run policy could write.
 * @param profile - Selected local profile before any scratch creation.
 * @param session - Exact live Session that would own the policy.
 * @param scratchRoot - Derived but not yet created Science Session root.
 */
export async function assertProfileRunConfinement(
  profile: ConfiguredProfile,
  session: Session,
  scratchRoot: string,
): Promise<void> {
  const policy: SandboxPolicy = { mode: 'workspace-write', workspaceRoot: scratchRoot, sessionId: session.id }
  for (const prefix of [profile.pythonPrefix, profile.rPrefix]) {
    if (prefix !== undefined) assertPrefixReadOnly(await canonicalizeWatchPath(prefix), policy)
  }
}

/**
 * Return the platform-specific executable candidate for a configured
 * language prefix — the same fixed layout (`bin/python`/`bin/Rscript` on
 * POSIX, `python.exe`/`Scripts\Rscript.exe` on win32) every static and probe
 * check in this module uses. Exported so a real-driver test can locate a
 * real bound interpreter the way the product itself does.
 * @param language - selects the layout entry.
 * @param prefix - configured or canonicalized Conda prefix.
 * @returns the candidate executable path; existence is not checked here.
 */
export function executableCandidate(language: ScienceLanguage, prefix: string): string {
  return join(prefix, ...EXECUTABLE_LAYOUTS[process.platform][language])
}

/** Lower-case SHA-256 for one exact byte or string sequence. */
function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** `conda-meta/history` exists but is not a usable regular, non-symlink file. */
class HistoryNotRegularFileError extends Error {
  override name = 'HistoryNotRegularFileError'
}

/**
 * Read `<prefix>/conda-meta/history`'s exact bytes: the single computation
 * {@link staticInterpreter} and the exported {@link prefixHistoryDigest} both
 * build on, so the two agree on what "the history" is by construction
 * rather than by a comment asserting they compute the same thing.
 * @param prefix - already-canonicalized Conda prefix.
 * @returns the exact bytes at `conda-meta/history`.
 * @throws the raw `lstat`/`readFile` error (e.g. a missing path) unclassified.
 * @throws {@link HistoryNotRegularFileError} when the path exists but is a directory, a symlink, or otherwise not a regular file.
 */
async function readHistoryFile(prefix: string): Promise<Uint8Array> {
  const historyPath = join(prefix, 'conda-meta', 'history')
  const historyInfo = await lstat(historyPath)
  if (!historyInfo.isFile() || historyInfo.isSymbolicLink()) {
    throw new HistoryNotRegularFileError('conda-meta/history must be a regular file')
  }
  return readFile(historyPath)
}

/**
 * Digest of a durably-bound prefix's Conda transaction history, read fresh
 * and compared against a binding's recorded `condaHistorySha256` to detect
 * whether the shared prefix changed since that binding was observed —
 * `startRun`'s cheap, non-probing per-run drift check. Built on the exact
 * same {@link readHistoryFile} read `staticInterpreter` performs, so a
 * matching digest here means `staticInterpreter` would read identical bytes
 * too, not merely bytes this function judges equivalent by some looser rule.
 * @param canonicalPrefix - a durable binding's already-canonicalized (`realpath`'d) Conda prefix.
 * @returns the lower-case SHA-256 digest of `conda-meta/history`'s exact
 *   bytes, or `undefined` when the file is missing, is not a regular
 *   non-symlink file, or any other read failure occurs. Callers MUST treat
 *   `undefined` as drift — the binding can no longer be confirmed
 *   consistent with the prefix on disk — never as "no drift".
 */
export async function prefixHistoryDigest(canonicalPrefix: string): Promise<string | undefined> {
  try {
    return sha256(await readHistoryFile(canonicalPrefix))
  } catch {
    return undefined
  }
}

/**
 * Unavailable during P1; P2 owns this implementation.
 * @param _services - Input reserved for P2.
 * @param _profile - Input reserved for P2.
 * @throws Always rejects execution while the migration is pending.
 */
export async function observeProfile(_services: ObservationServices, _profile: ConfiguredProfile): Promise<ObservedProfile> {
  // FIXME(replant): P2: host-local subprocess verification.
  throw new Error('Science migration pending — P2: host-local subprocess verification')
}

/**
 * Compare two available bindings by their durable observation fingerprint.
 * @param first - First optional durable binding.
 * @param second - Second optional durable binding.
 * @returns Whether both absent bindings or both available fingerprints match.
 */
export function sameObservation(first: ScienceInterpreterBinding | undefined, second: ScienceInterpreterBinding | undefined): boolean {
  if (first === undefined || second === undefined) return first === second
  return first.capability === 'available'
    && second.capability === 'available'
    && first.bindingFingerprint === second.bindingFingerprint
}
