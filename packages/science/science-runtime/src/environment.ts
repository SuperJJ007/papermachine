/** Stable local Conda-prefix observation through the shared subprocess and sandbox services. */

import { createHash } from 'node:crypto'
import { lstat, readFile, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { ConfinedArgv, SandboxEnforcement, SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import type { SandboxProvider } from '@deepseek-ai/dsh-sandbox'
import { canonicalizeWatchPath } from '@deepseek-ai/dsh-home-paths'
import type { ScienceInterpreterBinding, ScienceLanguage, SciencePackage } from '@deepseek-ai/dsh-science-session'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { ScienceRuntimeError } from './types.ts'
import type { ConfiguredProfile } from './config.ts'
import { assertPrefixReadOnly, confineWithEnforcement, interpreterPathEnv, localeEnvironment, windowsEnvironment } from './execution.ts'
import { containsPath, createProbeScratch, planProbeScratch, removeProbeScratch } from './scratch.ts'
import type { ScienceProbeScratch, ScienceSessionScratch } from './scratch.ts'

const VERSION_MAX_BYTES = 1_024
const UTF8_PROBE_TEXT = 'dsh-科学-✓'
/**
 * Fixed capture ceiling for the package-inventory probe's raw subprocess
 * output — a defensive backstop against a runaway probe, not a
 * deployment-varying choice (`MAX_OUTPUT_BYTES` in `execution.ts` is the
 * analogous fixed bound for run output). Generous relative to
 * `MAX_PACKAGES_MAX_BYTES` in `config.ts` so a probe transcript for any
 * inventory within the configurable retention cap is never lossy at capture
 * time, even with JSON/TSV formatting overhead.
 */
const PACKAGES_PROBE_MAX_BYTES = 8 * 1024 * 1024
/** Base-R expression: TSV `Package<TAB>Version` lines, no header, no `jsonlite` dependency. */
const R_PACKAGES_EXPR = "m <- installed.packages()[, c('Package', 'Version'), drop = FALSE]; "
  + "write.table(m, file = stdout(), sep = '\\t', quote = FALSE, row.names = FALSE, col.names = FALSE)"
const UNIX_EXECUTE_BITS = 0o111
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

interface StaticInterpreterFacts {
  readonly prefix: string
  readonly executable: string
  readonly history: Uint8Array
  readonly identity: string
}

interface PreparedProbeAttempt {
  readonly scratch: ScienceProbeScratch
  readonly version: readonly string[]
  readonly utf8: readonly string[]
  readonly packages: readonly string[]
}

/** One attempt's three probes, each confined once its probe directory exists. */
interface ConfinedProbeAttempt {
  readonly version: ConfinedArgv
  readonly utf8: ConfinedArgv
  readonly packages: ConfinedArgv
}

interface PreparedObservation {
  readonly kind: 'probe'
  readonly language: ScienceLanguage
  readonly configuredPrefix: string
  readonly staticFacts: StaticInterpreterFacts
  readonly attempt: PreparedProbeAttempt
}

interface InvalidObservation {
  readonly kind: 'invalid'
  readonly value: ObservedInterpreter
}

/** Canonical direct argv; Rscript accepts `--version` only as its sole argument. */
function probeArgv(language: ScienceLanguage, executable: string, kind: 'version' | 'utf8' | 'packages'): string[] {
  if (language === 'python') {
    if (kind === 'version') return [executable, '-I', '-B', '-X', 'utf8', '--version']
    if (kind === 'utf8') {
      // `\u` escapes, not the literal characters: an ASCII-only argv survives a
      // win32 launcher that forwards argv through an ANSI code page (see the
      // R branch below for the launcher this defends against).
      return [
        executable, '-I', '-B', '-X', 'utf8', '-c',
        'import sys;sys.stdout.buffer.write("dsh-\\u79d1\\u5b66-\\u2713".encode("utf-8"))',
      ]
    }
    // `pip list` reports what the interpreter itself sees, requiring nothing outside the prefix.
    return [executable, '-I', '-B', '-X', 'utf8', '-m', 'pip', 'list', '--format=json']
  }
  if (kind === 'version') return [executable, '--version']
  if (kind === 'utf8') {
    // `\u` escapes, not the literal characters: conda-forge's win32
    // `Scripts\Rscript.exe` is a launcher that forwards its command line
    // through `CreateProcessA` (ANSI), so a non-ASCII byte outside the
    // active code page arrives at R corrupted and R reports a re-encoding
    // failure before it ever runs the expression. An ASCII-only argv with
    // `\u` escapes sidesteps the launcher entirely; `enc2utf8` still forces
    // the decoded string back to UTF-8 for output.
    return [executable, '--vanilla', '--encoding=UTF-8', '-e', 'cat(enc2utf8("dsh-\\u79d1\\u5b66-\\u2713"),sep="")']
  }
  return [executable, '--vanilla', '--encoding=UTF-8', '-e', R_PACKAGES_EXPR]
}

/** Exact child environment for an unpublished probe. */
function probeEnvironment(prefix: string, scratch: ScienceProbeScratch): NodeJS.ProcessEnv {
  return {
    HOME: scratch.home,
    TMPDIR: scratch.tmp,
    PATH: interpreterPathEnv(prefix),
    ...localeEnvironment(),
    ...windowsEnvironment(scratch.tmp),
  }
}

/** A private probe policy owned by exactly one provider observation. */
function probePolicy(scratch: ScienceProbeScratch, sessionId: SessionId): SandboxPolicy {
  return { mode: 'workspace-write', workspaceRoot: scratch.directory, sessionId }
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

/** Convert one fs bigint stat into the frozen executable identity serialization. */
function executableIdentity(info: Awaited<ReturnType<typeof stat>>): string {
  const asBigInt = info as Awaited<ReturnType<typeof stat>> & {
    readonly dev: bigint
    readonly ino: bigint
    readonly mode: bigint
    readonly size: bigint
    readonly mtimeNs: bigint
    readonly ctimeNs: bigint
  }
  return `stat-v1\0${process.platform}\0${String(asBigInt.dev)}\0${String(asBigInt.ino)}\0${String(asBigInt.mode)}\0${String(asBigInt.size)}\0${String(asBigInt.mtimeNs)}\0${String(asBigInt.ctimeNs)}`
}

/** Lower-case SHA-256 for one exact byte or string sequence. */
function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** Normalize a lossless version capture to exactly one non-empty line. */
function normalizeVersion(stdout: string, stderr: string): string | undefined {
  const selected = stdout.length > 0 ? stdout : stderr
  if (stdout.length > 0 && stderr.length > 0) return undefined
  const value = selected.replaceAll('\r\n', '\n').replace(/^[\t\n\r ]+|[\t\n\r ]+$/gu, '')
  if (value.length === 0 || value.includes('\0') || value.split('\n').length !== 1) return undefined
  return value
}

/** Parse `pip list --format=json` stdout; malformed or non-string entries fail the probe. */
function parsePythonPackages(stdout: string): readonly SciencePackage[] | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return undefined
  }
  if (!Array.isArray(parsed)) return undefined
  const packages: SciencePackage[] = []
  for (const entry of parsed as unknown[]) {
    if (typeof entry !== 'object' || entry === null) return undefined
    const { name, version } = entry as Record<string, unknown>
    if (typeof name !== 'string' || typeof version !== 'string' || name.length === 0 || version.length === 0) return undefined
    packages.push({ name, version })
  }
  return packages
}

/** Parse base-R TSV `Package<TAB>Version` lines; malformed lines fail the probe. */
function parseRPackages(stdout: string): readonly SciencePackage[] | undefined {
  const lines = stdout.replaceAll('\r\n', '\n').split('\n').filter(line => line.length > 0)
  const packages: SciencePackage[] = []
  for (const line of lines) {
    const tab = line.indexOf('\t')
    if (tab <= 0 || tab !== line.lastIndexOf('\t') || tab === line.length - 1) return undefined
    packages.push({ name: line.slice(0, tab), version: line.slice(tab + 1) })
  }
  return packages
}

/** Parse one language's package-inventory probe stdout. */
function parsePackages(language: ScienceLanguage, stdout: string): readonly SciencePackage[] | undefined {
  return language === 'python' ? parsePythonPackages(stdout) : parseRPackages(stdout)
}

/** Stable digest over the complete sorted package inventory, before any retention truncation. */
function packagesDigest(sorted: readonly SciencePackage[]): string {
  return sha256(`dsh-science-packages-v1\0${sorted.map(entry => `${entry.name}\0${entry.version}`).join('\n')}`)
}

/** Sorted, digested, and cap-truncated package inventory ready for a durable identity record. */
interface PackageInventory {
  readonly packages: readonly SciencePackage[]
  readonly packagesSha256: string
  readonly packagesTruncated: boolean
}

/**
 * Sort the observed inventory, digest the complete sorted value, then retain
 * entries up to the configured entry and byte caps.
 * @param raw - complete parsed inventory before sorting or truncation.
 * @param maxEntries - configured maximum retained entries.
 * @param maxBytes - configured maximum retained UTF-8 bytes (summed name and version).
 * @returns the retained inventory, its complete-inventory digest, and whether either cap truncated it.
 */
function packageInventory(raw: readonly SciencePackage[], maxEntries: number, maxBytes: number): PackageInventory {
  const sorted = [...raw].sort((first, second) => first.name === second.name
    ? first.version.localeCompare(second.version)
    : first.name.localeCompare(second.name))
  const packages: SciencePackage[] = []
  let bytes = 0
  let truncated = false
  for (const entry of sorted) {
    const cost = Buffer.byteLength(entry.name, 'utf8') + Buffer.byteLength(entry.version, 'utf8')
    if (packages.length >= maxEntries || bytes + cost > maxBytes) {
      truncated = true
      break
    }
    packages.push(entry)
    bytes += cost
  }
  return { packages, packagesSha256: packagesDigest(sorted), packagesTruncated: truncated }
}

/** Run one fully confined direct argv probe and return exact retained bytes/text facts. */
async function runProbe(
  services: ObservationServices,
  prefix: string,
  scratch: ScienceProbeScratch,
  confined: ConfinedArgv,
  maxBytes: number,
): Promise<{ readonly stdout: string; readonly stderr: string; readonly ok: boolean }> {
  const handle = services.subprocess.spawn({
    argv: confined.argv,
    cwd: scratch.directory,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes },
      stderr: { maxBytes },
    },
    graceMs: 3_000,
    environmentBase: 'empty',
    // confined.env carries entries the selected sandbox backend's runner
    // invocation itself requires (e.g. the win32 ACL rung's
    // ELECTRON_RUN_AS_NODE); merged last so the backend's requirement wins.
    env: { ...probeEnvironment(prefix, scratch), ...confined.env },
    signal: services.signal,
  })
  let outcome: Awaited<typeof handle.done> | undefined
  let completionError: unknown
  try {
    outcome = await handle.done
  } catch (error) {
    completionError = error
  }
  // Caller cancellation already asks the shared subprocess provider to
  // terminate; cleanup waits without the caller signal so the probe directory
  // is never removed while a managed tree still owns it.
  const quiescent = await handle.waitForExit()
  if (!quiescent) throw new ScienceRuntimeError('QUIESCENCE_UNPROVEN', 'interpreter probe did not reach whole-tree quiescence')
  if (completionError !== undefined) {
    if (completionError instanceof Error) throw completionError
    throw new Error('science-runtime: interpreter probe failed without an Error object')
  }
  if (outcome === undefined) throw new Error('science-runtime: probe settled without a subprocess outcome')
  const stdout = handle.collected.stdout?.readFrom(0)
  const stderr = handle.collected.stderr?.readFrom(0)
  if (stdout === undefined || stderr === undefined || stdout.lossy || stderr.lossy
    || stdout.utf8Validity !== 'valid' || stderr.utf8Validity !== 'valid') {
    return { stdout: '', stderr: '', ok: false }
  }
  return { stdout: stdout.text, stderr: stderr.text, ok: outcome.exitCode === 0 && outcome.signal === null }
}

/** Sandbox-confine one probe argv against its already-created private probe directory. */
function confineProbe(
  services: ObservationServices,
  prefix: string,
  scratch: ScienceProbeScratch,
  argv: readonly string[],
): ConfinedArgv {
  return confineWithEnforcement(services.sandbox, prefix, probePolicy(scratch, services.sessionId), argv, services.minimumEnforcement)
}

/** Confine every probe of one attempt, in fixed order, against its already-created probe directory. */
function confineProbeAttempt(
  services: ObservationServices,
  prefix: string,
  scratch: ScienceProbeScratch,
  attempt: PreparedProbeAttempt,
): ConfinedProbeAttempt {
  return {
    version: confineProbe(services, prefix, scratch, attempt.version),
    utf8: confineProbe(services, prefix, scratch, attempt.utf8),
    packages: confineProbe(services, prefix, scratch, attempt.packages),
  }
}

/** Distinguish an absent or structurally unusable configured interpreter from provider I/O failure. */
class StaticInterpreterUnavailableError extends Error {
  override name = 'StaticInterpreterUnavailableError'
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

/** Convert an ordinary missing path into an honest invalid binding, preserving other I/O failures. */
function unavailableOnMissing(error: unknown, description: string): never {
  if (missingPathError(error)) {
    throw new StaticInterpreterUnavailableError(description)
  }
  throw error
}

/** Classify only filesystem missing-path errors as static interpreter unavailability. */
function missingPathError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const code = (error as { readonly code?: unknown }).code
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP'
}

/** Check static prefix and executable facts before any child starts. */
async function staticInterpreter(
  language: ScienceLanguage,
  configuredPrefix: string,
): Promise<StaticInterpreterFacts> {
  let prefix: string
  try {
    prefix = await realpath(configuredPrefix)
  } catch (error) {
    unavailableOnMissing(error, 'configured Conda prefix is absent or cannot be resolved')
  }
  let history: Uint8Array
  try {
    history = await readHistoryFile(prefix)
  } catch (error) {
    if (error instanceof HistoryNotRegularFileError) throw new StaticInterpreterUnavailableError(error.message)
    unavailableOnMissing(error, 'conda-meta/history is absent')
  }
  let executable: string
  try {
    executable = await realpath(executableCandidate(language, prefix))
  } catch (error) {
    unavailableOnMissing(error, `configured ${language} interpreter is absent`)
  }
  if (!containsPath(prefix, executable)) throw new StaticInterpreterUnavailableError('interpreter escapes configured prefix')
  let executableInfo: Awaited<ReturnType<typeof lstat>>
  try {
    executableInfo = await lstat(executable)
  } catch (error) {
    unavailableOnMissing(error, `configured ${language} interpreter is absent`)
  }
  if (!executableInfo.isFile() || executableInfo.isSymbolicLink()
    || (process.platform !== 'win32' && (executableInfo.mode & UNIX_EXECUTE_BITS) === 0)) {
    throw new StaticInterpreterUnavailableError('interpreter is not a regular executable')
  }
  let identity: string
  try {
    identity = executableIdentity(await stat(executable, { bigint: true }))
  } catch (error) {
    unavailableOnMissing(error, 'configured interpreter changed during static observation')
  }
  return { prefix, executable, history, identity }
}

/** Build an honest static invalid record without creating a probe directory. */
function staticFailure(language: ScienceLanguage, configuredPrefix: string, error: StaticInterpreterUnavailableError): ObservedInterpreter {
  const reason = error.message.slice(0, 1_024)
  return {
    prefix: configuredPrefix,
    executable: executableCandidate(language, configuredPrefix),
    binding: { language, configuredPrefix, capability: 'invalid', reason },
  }
}

/**
 * Plan one exact attempt's probe directory and direct argv (version, UTF-8,
 * and package-inventory probes) without creating the directory or confining
 * any argv. Confinement needs the probe directory to exist — a real win32
 * ACL sandbox `realpathSync.native`s the confined `workspaceRoot` — so it
 * happens later, in {@link observePrepared} right after
 * {@link createProbeScratch} materializes this planned directory.
 */
function prepareProbeAttempt(
  services: ObservationServices,
  language: ScienceLanguage,
  staticFacts: StaticInterpreterFacts,
): PreparedProbeAttempt {
  services.signal.throwIfAborted()
  const scratch = planProbeScratch(services.sessionScratch)
  if (language === 'r' && scratch.tmp.includes(' ')) {
    throw new ScienceRuntimeError('CONFINEMENT_UNAVAILABLE', 'R probe TMPDIR cannot contain an ASCII space')
  }
  return {
    scratch,
    version: probeArgv(language, staticFacts.executable, 'version'),
    utf8: probeArgv(language, staticFacts.executable, 'utf8'),
    packages: probeArgv(language, staticFacts.executable, 'packages'),
  }
}

/** Resolve static facts and plan the first exact attempt without creating scratch or confining anything. */
async function prepareObservation(
  services: ObservationServices,
  language: ScienceLanguage,
  configuredPrefix: string,
): Promise<PreparedObservation | InvalidObservation> {
  let staticFacts: StaticInterpreterFacts
  try {
    staticFacts = await staticInterpreter(language, configuredPrefix)
  } catch (error) {
    if (error instanceof StaticInterpreterUnavailableError) {
      return { kind: 'invalid', value: staticFailure(language, configuredPrefix, error) }
    }
    throw error
  }
  return {
    kind: 'probe',
    language,
    configuredPrefix,
    staticFacts,
    attempt: prepareProbeAttempt(services, language, staticFacts),
  }
}

/**
 * Execute one planned attempt's probes and calculate one stable binding
 * digest. Each attempt's probe directory is created first
 * ({@link createProbeScratch}), then its three probes are confined against
 * that now-existing directory ({@link confineProbeAttempt}), then run — the
 * order a real win32 ACL sandbox requires.
 */
async function observePrepared(
  services: ObservationServices,
  prepared: PreparedObservation,
): Promise<ObservedInterpreter> {
  const { language, configuredPrefix } = prepared
  let staticFacts = prepared.staticFacts
  let preparedAttempt = prepared.attempt
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const scratch = await createProbeScratch(services.sessionScratch, preparedAttempt.scratch)
    let observationFailure: unknown
    try {
      const confined = confineProbeAttempt(services, staticFacts.prefix, scratch, preparedAttempt)
      const version = await runProbe(services, staticFacts.prefix, scratch, confined.version, VERSION_MAX_BYTES)
      const utf8 = await runProbe(services, staticFacts.prefix, scratch, confined.utf8, VERSION_MAX_BYTES)
      const packages = await runProbe(services, staticFacts.prefix, scratch, confined.packages, PACKAGES_PROBE_MAX_BYTES)
      const normalized = version.ok ? normalizeVersion(version.stdout, version.stderr) : undefined
      const after = await staticInterpreter(language, configuredPrefix)
      const stable = after.prefix === staticFacts.prefix
        && after.executable === staticFacts.executable
        && after.identity === staticFacts.identity
        && Buffer.compare(after.history, staticFacts.history) === 0
      if (!stable) {
        if (attempt === 0) {
          staticFacts = after
          preparedAttempt = prepareProbeAttempt(services, language, staticFacts)
          continue
        }
        return {
          prefix: after.prefix,
          executable: after.executable,
          binding: { language, configuredPrefix, canonicalPrefix: after.prefix, capability: 'invalid', reason: 'environment changed during observation' },
          enforcement: confined.version.enforcement,
        }
      }
      if (normalized === undefined || !utf8.ok || utf8.stdout !== UTF8_PROBE_TEXT || utf8.stderr.length !== 0) {
        return {
          prefix: staticFacts.prefix,
          executable: staticFacts.executable,
          binding: { language, configuredPrefix, canonicalPrefix: staticFacts.prefix, executable: staticFacts.executable, capability: 'invalid', reason: 'interpreter probes did not produce the required lossless output' },
          enforcement: confined.version.enforcement,
        }
      }
      const rawPackages = packages.ok ? parsePackages(language, packages.stdout) : undefined
      if (rawPackages === undefined) {
        return {
          prefix: staticFacts.prefix,
          executable: staticFacts.executable,
          binding: { language, configuredPrefix, canonicalPrefix: staticFacts.prefix, executable: staticFacts.executable, capability: 'invalid', reason: 'package inventory probe did not produce parseable output' },
          enforcement: confined.version.enforcement,
        }
      }
      const historySha = sha256(staticFacts.history)
      const fingerprint = sha256(`dsh-science-binding-v1\0${language}\0${staticFacts.prefix}\0${staticFacts.executable}\0${staticFacts.identity}\0${normalized}\0${historySha}`)
      return {
        prefix: staticFacts.prefix,
        executable: staticFacts.executable,
        binding: {
          language,
          configuredPrefix,
          canonicalPrefix: staticFacts.prefix,
          executable: staticFacts.executable,
          executableIdentity: staticFacts.identity,
          languageVersion: normalized,
          condaHistorySha256: historySha,
          bindingFingerprint: fingerprint,
          ...packageInventory(rawPackages, services.packagesMaxEntries, services.packagesMaxBytes),
          capability: 'available',
        },
        enforcement: confined.version.enforcement,
      }
    } catch (error) {
      observationFailure = error
      throw error
    } finally {
      try {
        await removeProbeScratch(services.sessionScratch, scratch)
      } catch (cleanupError) {
        if (observationFailure !== undefined) {
          throw new AggregateError(
            [observationFailure, cleanupError],
            'science-runtime: interpreter observation and probe cleanup both failed',
          )
        }
        throw cleanupError
      }
    }
  }
  /* v8 ignore next -- the bounded loop either returns, continues once, or throws. */
  throw new Error('science-runtime: stable observation exhausted unexpectedly')
}

/** Throw deterministic observation failures only after every sibling settles. */
function assertObservationsSettled(settled: readonly PromiseSettledResult<unknown>[]): void {
  const errors: unknown[] = []
  for (const result of settled) {
    if (result.status === 'rejected') errors.push(result.reason)
  }
  if (errors.length === 0) return
  const [initiatingFailure, ...remaining] = errors
  const initiatingError = initiatingFailure instanceof Error
    ? initiatingFailure
    : new Error('science-runtime: interpreter observation failed without an Error object')
  if (errors.length === 1) throw initiatingError
  throw new AggregateError(
    [initiatingError, ...remaining],
    'science-runtime: interpreter observations failed after all probe cleanup settled',
  )
}

/**
 * Observe every configured interpreter without calling Conda or modifying a prefix.
 * @param services - Shared services and exact Session-owned probe scratch.
 * @param profile - Strict profile whose declared interpreters are observed.
 * @returns Settled stable observations after every attempted probe cleanup has settled.
 */
export async function observeProfile(services: ObservationServices, profile: ConfiguredProfile): Promise<ObservedProfile> {
  if (services.subprocess.executionWorld !== 'host-local') {
    throw new ScienceRuntimeError('CONFINEMENT_UNAVAILABLE', 'Science private Host scratch requires a host-local subprocess provider')
  }
  const preparations: Promise<PreparedObservation | InvalidObservation>[] = []
  if (profile.pythonPrefix !== undefined) preparations.push(prepareObservation(services, 'python', profile.pythonPrefix))
  if (profile.rPrefix !== undefined) preparations.push(prepareObservation(services, 'r', profile.rPrefix))
  const prepared = await Promise.allSettled(preparations)
  assertObservationsSettled(prepared)
  const observations = await Promise.all(preparations)
  if (observations.some(observation => observation.kind === 'probe')) {
    await services.prepareSessionScratch?.()
  }
  const executions = observations.map(async (observation) => {
    return observation.kind === 'invalid' ? observation.value : observePrepared(services, observation)
  })
  const settled = await Promise.allSettled(executions)
  assertObservationsSettled(settled)
  const values = await Promise.all(executions)
  const python = values.find(value => value.binding.language === 'python')
  const r = values.find(value => value.binding.language === 'r')
  return {
    profile,
    ...(python === undefined ? {} : { python }),
    ...(r === undefined ? {} : { r }),
  }
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
