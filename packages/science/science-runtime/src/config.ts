/** Strict local Conda-profile configuration for the Science Runtime. */

import { isAbsolute } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { ScienceEnvironmentProfileId } from '@deepseek-ai/dsh-science-session'
import type { ScienceEnvironmentProfileId as ScienceEnvironmentProfileIdType } from '@deepseek-ai/dsh-science-session'
import type { RasterCapturePolicy } from './capture.ts'

/** Default raster-capture policy: a `.png` is auto-captured only when the run declares it via `raster_artifacts`. */
export const DEFAULT_RASTER_CAPTURE: RasterCapturePolicy = 'declared'

/** Fixed default timeout for one bind or run operation. */
export const DEFAULT_TIMEOUT_MS = 120_000
/** Lowest accepted configured operation timeout. */
export const MIN_TIMEOUT_MS = 1
/** Highest accepted configured operation timeout. */
export const MAX_TIMEOUT_MS = 600_000

/** Default maximum retained package-inventory entries per observed interpreter. */
export const DEFAULT_PACKAGES_MAX_ENTRIES = 2_000
/** Lowest accepted configured package-inventory entry bound. */
export const MIN_PACKAGES_MAX_ENTRIES = 1
/** Highest accepted configured package-inventory entry bound. */
export const MAX_PACKAGES_MAX_ENTRIES = 20_000

/** Default maximum retained package-inventory UTF-8 bytes (summed name and version) per observed interpreter. */
export const DEFAULT_PACKAGES_MAX_BYTES = 65_536
/** Lowest accepted configured package-inventory byte bound. */
export const MIN_PACKAGES_MAX_BYTES = 1_024
/** Highest accepted configured package-inventory byte bound. */
export const MAX_PACKAGES_MAX_BYTES = 1_048_576

/** Default maximum encoded bytes for one auto-captured run-written file, matching the attachment store's default image byte cap. */
export const DEFAULT_CAPTURE_MAX_FILE_BYTES = 5 * 1024 * 1024
/** Lowest accepted configured auto-capture per-file byte bound. */
export const MIN_CAPTURE_MAX_FILE_BYTES = 1 * 1024 * 1024
/** Highest accepted configured auto-capture per-file byte bound. */
export const MAX_CAPTURE_MAX_FILE_BYTES = 50 * 1024 * 1024

/** Default maximum eligible files auto-captured from one run. */
export const DEFAULT_CAPTURE_MAX_FILES_PER_RUN = 50
/** Lowest accepted configured auto-capture per-run file-count bound. */
export const MIN_CAPTURE_MAX_FILES_PER_RUN = 1
/** Highest accepted configured auto-capture per-run file-count bound. */
export const MAX_CAPTURE_MAX_FILES_PER_RUN = 1_000

/** Default maximum artifact versions retained per session before auto-capture stops appending further versions. */
export const DEFAULT_CAPTURE_MAX_ARTIFACT_VERSIONS_PER_SESSION = 500
/** Lowest accepted configured auto-capture per-session artifact-version bound. */
export const MIN_CAPTURE_MAX_ARTIFACT_VERSIONS_PER_SESSION = 1
/** Highest accepted configured auto-capture per-session artifact-version bound. */
export const MAX_CAPTURE_MAX_ARTIFACT_VERSIONS_PER_SESSION = 10_000

/** Default maximum artifact inputs materialized for one run. */
export const DEFAULT_INPUT_MAX_FILES_PER_RUN = 20
/** Lowest accepted configured artifact-input count bound. */
export const MIN_INPUT_MAX_FILES_PER_RUN = 1
/** Highest accepted configured artifact-input count bound. */
export const MAX_INPUT_MAX_FILES_PER_RUN = 1_000

/** Default maximum aggregate bytes materialized as artifact inputs for one run. */
export const DEFAULT_INPUT_MAX_BYTES_PER_RUN = 50 * 1024 * 1024
/** Lowest accepted configured artifact-input aggregate-byte bound. */
export const MIN_INPUT_MAX_BYTES_PER_RUN = 1
/** Highest accepted configured artifact-input aggregate-byte bound. */
export const MAX_INPUT_MAX_BYTES_PER_RUN = 1024 * 1024 * 1024

/** Default persistent-kernel idle deadline, matching Claude Science parity (30 minutes). */
export const DEFAULT_KERNEL_IDLE_TIMEOUT_MS = 1_800_000
/** Lowest accepted configured kernel idle deadline (1 minute). */
export const MIN_KERNEL_IDLE_TIMEOUT_MS = 60_000
/** Highest accepted configured kernel idle deadline (24 hours). */
export const MAX_KERNEL_IDLE_TIMEOUT_MS = 86_400_000

/** Default persistent-kernel spawn-to-READY deadline. */
export const DEFAULT_KERNEL_START_TIMEOUT_MS = 30_000
/** Lowest accepted configured kernel spawn-to-READY deadline. */
export const MIN_KERNEL_START_TIMEOUT_MS = 1_000
/** Highest accepted configured kernel spawn-to-READY deadline. */
export const MAX_KERNEL_START_TIMEOUT_MS = 600_000

/** Default deadline for one post-run chart extraction exchange. */
export const DEFAULT_CHART_EXTRACT_TIMEOUT_MS = 5_000
/** Lowest accepted chart extraction deadline. */
export const MIN_CHART_EXTRACT_TIMEOUT_MS = 1
/** Highest accepted chart extraction deadline. */
export const MAX_CHART_EXTRACT_TIMEOUT_MS = 600_000

/** Default number of recent runs whose live figures remain strongly referenced per kernel. */
export const DEFAULT_CHART_LIVE_RUNS_RETAINED = 4
/** Lowest accepted live-figure run retention count. */
export const MIN_CHART_LIVE_RUNS_RETAINED = 1
/** Highest accepted live-figure run retention count. */
export const MAX_CHART_LIVE_RUNS_RETAINED = 100

/** Default maximum session logs read to build one project's store ↔ session reconciliation event set. */
export const DEFAULT_RECONCILE_MAX_SESSIONS = 500
/** Lowest accepted configured reconciliation session-scan bound. */
export const MIN_RECONCILE_MAX_SESSIONS = 1
/** Highest accepted configured reconciliation session-scan bound. */
export const MAX_RECONCILE_MAX_SESSIONS = 100_000

/** One allowlisted existing Conda prefix. */
export interface ScienceEnvironmentProfileConfig {
  /** Existing prefix containing `bin/python` or `python.exe`. */
  readonly pythonPrefix?: string
  /** Existing prefix containing `bin/Rscript` or `Scripts/Rscript.exe`. */
  readonly rPrefix?: string
}

/** Runtime configuration supplied by one Cordis row. */
export interface Config {
  /** Explicit Harness home; omitted follows the shared resolver. */
  readonly dshHome?: string
  /**
   * Absolute path to the deployment's micromamba executable. Required for
   * `ScienceRuntime.installPackages`; omitted means this deployment cannot
   * install packages, and `installPackages` rejects with
   * `INSTALLER_NOT_CONFIGURED` rather than silently degrading to an
   * in-kernel `pip install`/`install.packages()`. Never used for anything
   * else — binding and running an environment need no installer. Must be
   * configured together with {@link Config.installChannels}: setting one
   * without the other fails config resolution.
   */
  readonly micromambaPath?: string
  /**
   * Ordered, non-empty list of `https://` conda channel URLs `installPackages`
   * tries in turn, each as one complete, independent `micromamba install`
   * attempt (never merged into one `--channel` list, which would let a
   * single solve pull packages from different mirrors into one inconsistent
   * install) — the same whole-attempt-fallback shape
   * `apps/desktop/src/environment-declaration.ts`'s `EnvironmentSource.channels`
   * uses for provisioning, so a deployment that provisioned through a
   * mirror can also install through it. Only a `'failed'` attempt tries the
   * next URL; `'cancelled'`/`'timed-out'` stop immediately, since every
   * attempt shares the same operation deadline and cancellation signal.
   * Validated identically to the desktop's own channel URLs: `https://`
   * only, every later character drawn from a fixed allowlist (letters,
   * digits, and `._~/-`) that admits no whitespace, control character, or
   * shell metacharacter, since the value reaches `micromamba` argv
   * unescaped. Must be configured together with {@link Config.micromambaPath}.
   */
  readonly installChannels?: string[]
  /**
   * Map of profile identifiers to existing language prefixes. An empty map
   * is a valid explicit unconfigured state — for example a deployment that
   * defers every profile to the restart-scoped `science-runtime` settings
   * namespace.
   */
  readonly profiles: Readonly<Record<string, ScienceEnvironmentProfileConfig>>
  /** One caller-independent bound for bind and run operations. */
  readonly timeoutMs?: number
  /**
   * Maximum package-inventory entries retained per observed interpreter.
   * An inventory exceeding this cap is truncated and flagged; the digest
   * still covers the complete pre-truncation inventory.
   */
  readonly packagesMaxEntries?: number
  /**
   * Maximum package-inventory UTF-8 bytes (summed name and version) retained
   * per observed interpreter. An inventory exceeding this cap is truncated
   * and flagged; the digest still covers the complete pre-truncation
   * inventory.
   */
  readonly packagesMaxBytes?: number
  /**
   * Whether auto-capture admits a `.png` unconditionally (`'always'`) or
   * only when the writing run declared it via `raster_artifacts`
   * (`'declared'`, the default). A model self-inspection render outside
   * SCIENCE_ARTIFACT_DIR never becomes an artifact.
   */
  readonly rasterCapture?: RasterCapturePolicy
  /** Maximum encoded bytes admitted for one auto-captured run-written file; a larger file is skipped and counted, never a run failure. */
  readonly captureMaxFileBytes?: number
  /** Maximum eligible files auto-captured from one run; further eligible files are truncated and flagged, never a run failure. */
  readonly captureMaxFilesPerRun?: number
  /**
   * Maximum artifact versions a session accumulates through auto-capture
   * before it stops appending further versions, truncated and flagged.
   */
  readonly captureMaxArtifactVersionsPerSession?: number
  /** Maximum artifact-version inputs materialized for one run. */
  readonly inputMaxFilesPerRun?: number
  /** Maximum aggregate attachment bytes materialized as inputs for one run. */
  readonly inputMaxBytesPerRun?: number
  /**
   * Idle deadline after a persistent kernel's last `DONE` before the
   * Runtime ends it with reason `idle`; disarmed while a run is in flight.
   */
  readonly kernelIdleTimeoutMs?: number
  /**
   * Deadline from a persistent kernel's spawn to its `READY` handshake;
   * a slower handshake rejects the acquiring run with `KERNEL_START_FAILED`.
   */
  readonly kernelStartTimeoutMs?: number
  /** Deadline for post-run live-figure extraction; a timeout retires the kernel. */
  readonly chartExtractTimeoutMs?: number
  /** Recent runs whose registered live figures remain strongly referenced in each kernel. */
  readonly chartLiveRunsRetained?: number
  /**
   * Maximum session logs read, per project, when building the event set for
   * one store ↔ session reconciliation pass. A project with more matching
   * sessions than this reports its walk truncated rather than reading them
   * all in one call — bounded so a large multi-session project's first
   * Science operation is never blocked scanning every session it has ever had.
   */
  readonly reconcileMaxSessions?: number
}

/** Parsed profile with its durable identifier preserved. */
export interface ConfiguredProfile {
  /** Durable profile identifier. */
  readonly id: ScienceEnvironmentProfileIdType
  /** Original absolute configured Python prefix. */
  readonly pythonPrefix?: string
  /** Original absolute configured R prefix. */
  readonly rPrefix?: string
}

const PROFILE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u

/** Fixed maximum accepted `installChannels` entries — a safety backstop on the whole-attempt retry loop, not a deployment tunable. */
export const MAX_INSTALL_CHANNELS = 16

/**
 * A conda channel URL that reaches `micromamba` argv unescaped: `https://`
 * only, and every character after the scheme drawn from a fixed allowlist
 * (letters, digits, and `._~/-`) that admits no whitespace, control
 * character, or shell metacharacter (`;&|$()<>\`'"\\`) — this is a parser
 * boundary the value crosses on the way to a child process argv, so it is
 * validated by allowlist rather than by excluding known-bad characters.
 * Identical to `apps/desktop/src/environment-declaration.ts`'s own
 * `CHANNEL_URL`, duplicated here rather than imported since this package
 * never depends on `apps/desktop`.
 */
const CHANNEL_URL = /^https:\/\/[A-Za-z0-9](?:[A-Za-z0-9._~/-]*[A-Za-z0-9])?$/u

/**
 * Validate one ordered list of `https://` conda channel URLs. The caller
 * (`resolveConfig`) already treats an omitted or empty `installChannels` as
 * the unconfigured state before calling this, so this only re-validates the
 * array's own element type against untyped `cordis.yml`/JS input — a
 * non-empty precondition, not re-checked here.
 * @param channels - the configured `installChannels` value, already known non-empty.
 * @returns the validated, order-preserved channel list.
 */
function parseInstallChannels(channels: unknown): readonly string[] {
  if (!Array.isArray(channels)) {
    throw new Error('science-runtime: installChannels must be an array of strings when configured')
  }
  if (channels.length > MAX_INSTALL_CHANNELS) {
    throw new Error(`science-runtime: installChannels accepts at most ${String(MAX_INSTALL_CHANNELS)} entries`)
  }
  for (const url of channels) {
    if (typeof url !== 'string' || !CHANNEL_URL.test(url)) {
      throw new Error(`science-runtime: installChannels entry ${JSON.stringify(url)} is not a valid https channel URL`)
    }
  }
  return channels as readonly string[]
}

/** Loader schema. {@link resolveConfig} validates closed-object rules. */
export const configSchema: z<Config> = z.object({
  dshHome: z.string(),
  micromambaPath: z.string(),
  installChannels: z.array(z.string()).required(false),
  profiles: z.dict(z.object({
    pythonPrefix: z.string(),
    rPrefix: z.string(),
  })).required(),
  timeoutMs: z.number().step(1).min(MIN_TIMEOUT_MS).max(MAX_TIMEOUT_MS).default(DEFAULT_TIMEOUT_MS),
  packagesMaxEntries: z.number().step(1)
    .min(MIN_PACKAGES_MAX_ENTRIES).max(MAX_PACKAGES_MAX_ENTRIES)
    .default(DEFAULT_PACKAGES_MAX_ENTRIES),
  packagesMaxBytes: z.number().step(1)
    .min(MIN_PACKAGES_MAX_BYTES).max(MAX_PACKAGES_MAX_BYTES)
    .default(DEFAULT_PACKAGES_MAX_BYTES),
  rasterCapture: z.union(['declared', 'always'] as const).default(DEFAULT_RASTER_CAPTURE),
  captureMaxFileBytes: z.number().step(1)
    .min(MIN_CAPTURE_MAX_FILE_BYTES).max(MAX_CAPTURE_MAX_FILE_BYTES)
    .default(DEFAULT_CAPTURE_MAX_FILE_BYTES),
  captureMaxFilesPerRun: z.number().step(1)
    .min(MIN_CAPTURE_MAX_FILES_PER_RUN).max(MAX_CAPTURE_MAX_FILES_PER_RUN)
    .default(DEFAULT_CAPTURE_MAX_FILES_PER_RUN),
  captureMaxArtifactVersionsPerSession: z.number().step(1)
    .min(MIN_CAPTURE_MAX_ARTIFACT_VERSIONS_PER_SESSION).max(MAX_CAPTURE_MAX_ARTIFACT_VERSIONS_PER_SESSION)
    .default(DEFAULT_CAPTURE_MAX_ARTIFACT_VERSIONS_PER_SESSION),
  inputMaxFilesPerRun: z.number().step(1)
    .min(MIN_INPUT_MAX_FILES_PER_RUN).max(MAX_INPUT_MAX_FILES_PER_RUN)
    .default(DEFAULT_INPUT_MAX_FILES_PER_RUN),
  inputMaxBytesPerRun: z.number().step(1)
    .min(MIN_INPUT_MAX_BYTES_PER_RUN).max(MAX_INPUT_MAX_BYTES_PER_RUN)
    .default(DEFAULT_INPUT_MAX_BYTES_PER_RUN),
  kernelIdleTimeoutMs: z.number().step(1)
    .min(MIN_KERNEL_IDLE_TIMEOUT_MS).max(MAX_KERNEL_IDLE_TIMEOUT_MS)
    .default(DEFAULT_KERNEL_IDLE_TIMEOUT_MS),
  kernelStartTimeoutMs: z.number().step(1)
    .min(MIN_KERNEL_START_TIMEOUT_MS).max(MAX_KERNEL_START_TIMEOUT_MS)
    .default(DEFAULT_KERNEL_START_TIMEOUT_MS),
  chartExtractTimeoutMs: z.number().step(1)
    .min(MIN_CHART_EXTRACT_TIMEOUT_MS).max(MAX_CHART_EXTRACT_TIMEOUT_MS)
    .default(DEFAULT_CHART_EXTRACT_TIMEOUT_MS),
  chartLiveRunsRetained: z.number().step(1)
    .min(MIN_CHART_LIVE_RUNS_RETAINED).max(MAX_CHART_LIVE_RUNS_RETAINED)
    .default(DEFAULT_CHART_LIVE_RUNS_RETAINED),
  reconcileMaxSessions: z.number().step(1)
    .min(MIN_RECONCILE_MAX_SESSIONS).max(MAX_RECONCILE_MAX_SESSIONS)
    .default(DEFAULT_RECONCILE_MAX_SESSIONS),
})

/** Parsed immutable runtime configuration. */
export interface ResolvedConfig {
  /** Explicit Harness home, when configured. */
  readonly dshHome: string | undefined
  /** Absolute micromamba executable path, when configured; `undefined` means this deployment cannot install packages. */
  readonly micromambaPath: string | undefined
  /** Ordered, validated install-channel URLs; defined iff {@link ResolvedConfig.micromambaPath} is. */
  readonly installChannels: readonly string[] | undefined
  /** Allowlisted profiles; an empty map is a valid explicit unconfigured state. */
  readonly profiles: ReadonlyMap<string, ConfiguredProfile>
  /** Explicitly resolved operation deadline. */
  readonly timeoutMs: number
  /** Explicitly resolved package-inventory entry bound. */
  readonly packagesMaxEntries: number
  /** Explicitly resolved package-inventory byte bound. */
  readonly packagesMaxBytes: number
  /** Explicitly resolved raster-capture policy. */
  readonly rasterCapture: RasterCapturePolicy
  /** Explicitly resolved auto-capture per-file byte bound. */
  readonly captureMaxFileBytes: number
  /** Explicitly resolved auto-capture per-run file-count bound. */
  readonly captureMaxFilesPerRun: number
  /** Explicitly resolved auto-capture per-session artifact-version bound. */
  readonly captureMaxArtifactVersionsPerSession: number
  /** Explicitly resolved artifact-input count bound. */
  readonly inputMaxFilesPerRun: number
  /** Explicitly resolved artifact-input aggregate-byte bound. */
  readonly inputMaxBytesPerRun: number
  /** Explicitly resolved persistent-kernel idle deadline. */
  readonly kernelIdleTimeoutMs: number
  /** Explicitly resolved persistent-kernel spawn-to-READY deadline. */
  readonly kernelStartTimeoutMs: number
  /** Explicitly resolved chart extraction deadline. */
  readonly chartExtractTimeoutMs: number
  /** Explicitly resolved strong-reference retention count. */
  readonly chartLiveRunsRetained: number
  /** Explicitly resolved reconciliation session-scan bound. */
  readonly reconcileMaxSessions: number
}

/** Require that a configuration record has no undeclared fields. */
function assertKnownKeys(value: unknown, allowed: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`science-runtime: ${label} must be a plain record`)
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`science-runtime: ${label} has unknown field ${JSON.stringify(key)}`)
  }
}

/**
 * Require that a value is a valid raster-capture policy. Takes `unknown`
 * rather than the already-narrow `RasterCapturePolicy` field type so the
 * comparison below validates a cordis.yml-sourced runtime value that may not
 * match its static type, instead of a provably exhaustive literal check.
 */
function assertRasterCapture(value: unknown): asserts value is RasterCapturePolicy {
  if (value !== 'declared' && value !== 'always') {
    throw new Error('science-runtime: rasterCapture must be "declared" or "always"')
  }
}

/**
 * Validate runtime-owned profile rules that are not expressible in the Loader schema.
 * An empty map is a valid explicit unconfigured state, not a validation failure —
 * every declared entry still uses the safe-id grammar, requires at least one
 * absolute prefix, and rejects unknown fields.
 * @param profiles - Parsed Loader profile map.
 * @returns Immutable profiles keyed by their durable id string.
 */
export function parseProfiles(
  profiles: Readonly<Record<string, ScienceEnvironmentProfileConfig>>,
): ReadonlyMap<string, ConfiguredProfile> {
  assertKnownKeys(profiles, Object.keys(profiles), 'profiles')
  const entries = Object.entries(profiles)
  const parsed = new Map<string, ConfiguredProfile>()
  for (const [rawId, profile] of entries) {
    assertKnownKeys(profile, ['pythonPrefix', 'rPrefix'], `profile ${JSON.stringify(rawId)}`)
    const configured = profile as ScienceEnvironmentProfileConfig
    if (!PROFILE_ID.test(rawId)) {
      throw new Error(`science-runtime: profile id ${JSON.stringify(rawId)} is invalid`)
    }
    if (configured.pythonPrefix === undefined && configured.rPrefix === undefined) {
      throw new Error(`science-runtime: profile ${JSON.stringify(rawId)} requires pythonPrefix or rPrefix`)
    }
    for (const [field, prefix] of Object.entries({ pythonPrefix: configured.pythonPrefix, rPrefix: configured.rPrefix })) {
      if (prefix !== undefined && (typeof prefix !== 'string' || !isAbsolute(prefix))) {
        throw new Error(`science-runtime: ${field} for profile ${JSON.stringify(rawId)} must be absolute`)
      }
    }
    parsed.set(rawId, {
      id: ScienceEnvironmentProfileId(rawId),
      ...(configured.pythonPrefix === undefined ? {} : { pythonPrefix: configured.pythonPrefix }),
      ...(configured.rPrefix === undefined ? {} : { rPrefix: configured.rPrefix }),
    })
  }
  return parsed
}

/**
 * Resolve config defaults and reject fields that the permissive Loader schema
 * intentionally preserves for other package styles.
 * @param config - Loader-normalized or programmatic provider configuration.
 * @returns One immutable local Runtime configuration.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  assertKnownKeys(
    config,
    [
      'dshHome', 'micromambaPath', 'installChannels', 'profiles', 'timeoutMs',
      'packagesMaxEntries', 'packagesMaxBytes',
      'rasterCapture',
      'captureMaxFileBytes', 'captureMaxFilesPerRun', 'captureMaxArtifactVersionsPerSession',
      'inputMaxFilesPerRun', 'inputMaxBytesPerRun',
      'kernelIdleTimeoutMs', 'kernelStartTimeoutMs',
      'chartExtractTimeoutMs', 'chartLiveRunsRetained',
      'reconcileMaxSessions',
    ],
    'config',
  )
  if (config.dshHome !== undefined && typeof config.dshHome !== 'string') {
    throw new Error('science-runtime: dshHome must be a string when configured')
  }
  if (config.micromambaPath !== undefined && (typeof config.micromambaPath !== 'string' || !isAbsolute(config.micromambaPath))) {
    throw new Error('science-runtime: micromambaPath must be an absolute path when configured')
  }
  // schemastery normalizes an omitted `z.array(...).required(false)` field to
  // `[]`, not `undefined` (matching `dsh-terminal-bash`'s own `shellArgs`
  // precedent), so an empty array reaching here is the unconfigured state,
  // not a user-declared empty channel list. A caller that passes an explicit
  // `[]` reads the same way, which is why `parseInstallChannels` never sees
  // an empty list and does not re-check for one.
  const installChannels = config.installChannels === undefined || config.installChannels.length === 0
    ? undefined
    : parseInstallChannels(config.installChannels)
  if ((config.micromambaPath === undefined) !== (installChannels === undefined)) {
    throw new Error('science-runtime: micromambaPath and installChannels must be configured together, or neither')
  }
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`science-runtime: timeoutMs must be a safe integer from ${String(MIN_TIMEOUT_MS)} through ${String(MAX_TIMEOUT_MS)}`)
  }
  const packagesMaxEntries = config.packagesMaxEntries ?? DEFAULT_PACKAGES_MAX_ENTRIES
  if (!Number.isSafeInteger(packagesMaxEntries)
    || packagesMaxEntries < MIN_PACKAGES_MAX_ENTRIES
    || packagesMaxEntries > MAX_PACKAGES_MAX_ENTRIES) {
    throw new Error(`science-runtime: packagesMaxEntries must be a safe integer from ${String(MIN_PACKAGES_MAX_ENTRIES)} through ${String(MAX_PACKAGES_MAX_ENTRIES)}`)
  }
  const packagesMaxBytes = config.packagesMaxBytes ?? DEFAULT_PACKAGES_MAX_BYTES
  if (!Number.isSafeInteger(packagesMaxBytes)
    || packagesMaxBytes < MIN_PACKAGES_MAX_BYTES
    || packagesMaxBytes > MAX_PACKAGES_MAX_BYTES) {
    throw new Error(`science-runtime: packagesMaxBytes must be a safe integer from ${String(MIN_PACKAGES_MAX_BYTES)} through ${String(MAX_PACKAGES_MAX_BYTES)}`)
  }
  const rasterCapture: unknown = config.rasterCapture ?? DEFAULT_RASTER_CAPTURE
  assertRasterCapture(rasterCapture)
  const captureMaxFileBytes = config.captureMaxFileBytes ?? DEFAULT_CAPTURE_MAX_FILE_BYTES
  if (!Number.isSafeInteger(captureMaxFileBytes)
    || captureMaxFileBytes < MIN_CAPTURE_MAX_FILE_BYTES
    || captureMaxFileBytes > MAX_CAPTURE_MAX_FILE_BYTES) {
    throw new Error(`science-runtime: captureMaxFileBytes must be a safe integer from ${String(MIN_CAPTURE_MAX_FILE_BYTES)} through ${String(MAX_CAPTURE_MAX_FILE_BYTES)}`)
  }
  const captureMaxFilesPerRun = config.captureMaxFilesPerRun ?? DEFAULT_CAPTURE_MAX_FILES_PER_RUN
  if (!Number.isSafeInteger(captureMaxFilesPerRun)
    || captureMaxFilesPerRun < MIN_CAPTURE_MAX_FILES_PER_RUN
    || captureMaxFilesPerRun > MAX_CAPTURE_MAX_FILES_PER_RUN) {
    throw new Error(`science-runtime: captureMaxFilesPerRun must be a safe integer from ${String(MIN_CAPTURE_MAX_FILES_PER_RUN)} through ${String(MAX_CAPTURE_MAX_FILES_PER_RUN)}`)
  }
  const captureMaxArtifactVersionsPerSession = config.captureMaxArtifactVersionsPerSession
    ?? DEFAULT_CAPTURE_MAX_ARTIFACT_VERSIONS_PER_SESSION
  if (!Number.isSafeInteger(captureMaxArtifactVersionsPerSession)
    || captureMaxArtifactVersionsPerSession < MIN_CAPTURE_MAX_ARTIFACT_VERSIONS_PER_SESSION
    || captureMaxArtifactVersionsPerSession > MAX_CAPTURE_MAX_ARTIFACT_VERSIONS_PER_SESSION) {
    throw new Error(`science-runtime: captureMaxArtifactVersionsPerSession must be a safe integer from ${String(MIN_CAPTURE_MAX_ARTIFACT_VERSIONS_PER_SESSION)} through ${String(MAX_CAPTURE_MAX_ARTIFACT_VERSIONS_PER_SESSION)}`)
  }
  const inputMaxFilesPerRun = config.inputMaxFilesPerRun ?? DEFAULT_INPUT_MAX_FILES_PER_RUN
  if (!Number.isSafeInteger(inputMaxFilesPerRun)
    || inputMaxFilesPerRun < MIN_INPUT_MAX_FILES_PER_RUN
    || inputMaxFilesPerRun > MAX_INPUT_MAX_FILES_PER_RUN) {
    throw new Error(`science-runtime: inputMaxFilesPerRun must be a safe integer from ${String(MIN_INPUT_MAX_FILES_PER_RUN)} through ${String(MAX_INPUT_MAX_FILES_PER_RUN)}`)
  }
  const inputMaxBytesPerRun = config.inputMaxBytesPerRun ?? DEFAULT_INPUT_MAX_BYTES_PER_RUN
  if (!Number.isSafeInteger(inputMaxBytesPerRun)
    || inputMaxBytesPerRun < MIN_INPUT_MAX_BYTES_PER_RUN
    || inputMaxBytesPerRun > MAX_INPUT_MAX_BYTES_PER_RUN) {
    throw new Error(`science-runtime: inputMaxBytesPerRun must be a safe integer from ${String(MIN_INPUT_MAX_BYTES_PER_RUN)} through ${String(MAX_INPUT_MAX_BYTES_PER_RUN)}`)
  }
  const kernelIdleTimeoutMs = config.kernelIdleTimeoutMs ?? DEFAULT_KERNEL_IDLE_TIMEOUT_MS
  if (!Number.isSafeInteger(kernelIdleTimeoutMs)
    || kernelIdleTimeoutMs < MIN_KERNEL_IDLE_TIMEOUT_MS
    || kernelIdleTimeoutMs > MAX_KERNEL_IDLE_TIMEOUT_MS) {
    throw new Error(`science-runtime: kernelIdleTimeoutMs must be a safe integer from ${String(MIN_KERNEL_IDLE_TIMEOUT_MS)} through ${String(MAX_KERNEL_IDLE_TIMEOUT_MS)}`)
  }
  const kernelStartTimeoutMs = config.kernelStartTimeoutMs ?? DEFAULT_KERNEL_START_TIMEOUT_MS
  if (!Number.isSafeInteger(kernelStartTimeoutMs)
    || kernelStartTimeoutMs < MIN_KERNEL_START_TIMEOUT_MS
    || kernelStartTimeoutMs > MAX_KERNEL_START_TIMEOUT_MS) {
    throw new Error(`science-runtime: kernelStartTimeoutMs must be a safe integer from ${String(MIN_KERNEL_START_TIMEOUT_MS)} through ${String(MAX_KERNEL_START_TIMEOUT_MS)}`)
  }
  const chartExtractTimeoutMs = config.chartExtractTimeoutMs ?? DEFAULT_CHART_EXTRACT_TIMEOUT_MS
  if (!Number.isSafeInteger(chartExtractTimeoutMs)
    || chartExtractTimeoutMs < MIN_CHART_EXTRACT_TIMEOUT_MS
    || chartExtractTimeoutMs > MAX_CHART_EXTRACT_TIMEOUT_MS) {
    throw new Error(`science-runtime: chartExtractTimeoutMs must be a safe integer from ${String(MIN_CHART_EXTRACT_TIMEOUT_MS)} through ${String(MAX_CHART_EXTRACT_TIMEOUT_MS)}`)
  }
  const chartLiveRunsRetained = config.chartLiveRunsRetained ?? DEFAULT_CHART_LIVE_RUNS_RETAINED
  if (!Number.isSafeInteger(chartLiveRunsRetained)
    || chartLiveRunsRetained < MIN_CHART_LIVE_RUNS_RETAINED
    || chartLiveRunsRetained > MAX_CHART_LIVE_RUNS_RETAINED) {
    throw new Error(`science-runtime: chartLiveRunsRetained must be a safe integer from ${String(MIN_CHART_LIVE_RUNS_RETAINED)} through ${String(MAX_CHART_LIVE_RUNS_RETAINED)}`)
  }
  const reconcileMaxSessions = config.reconcileMaxSessions ?? DEFAULT_RECONCILE_MAX_SESSIONS
  if (!Number.isSafeInteger(reconcileMaxSessions)
    || reconcileMaxSessions < MIN_RECONCILE_MAX_SESSIONS
    || reconcileMaxSessions > MAX_RECONCILE_MAX_SESSIONS) {
    throw new Error(`science-runtime: reconcileMaxSessions must be a safe integer from ${String(MIN_RECONCILE_MAX_SESSIONS)} through ${String(MAX_RECONCILE_MAX_SESSIONS)}`)
  }
  return {
    dshHome: config.dshHome,
    micromambaPath: config.micromambaPath,
    installChannels,
    profiles: parseProfiles(config.profiles),
    timeoutMs,
    packagesMaxEntries,
    packagesMaxBytes,
    rasterCapture,
    captureMaxFileBytes,
    captureMaxFilesPerRun,
    captureMaxArtifactVersionsPerSession,
    inputMaxFilesPerRun,
    inputMaxBytesPerRun,
    kernelIdleTimeoutMs,
    kernelStartTimeoutMs,
    chartExtractTimeoutMs,
    chartLiveRunsRetained,
    reconcileMaxSessions,
  }
}
