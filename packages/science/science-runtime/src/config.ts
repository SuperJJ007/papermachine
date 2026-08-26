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
   * (`'declared'`, the default) — an editable Vega-Lite spec stays the
   * captured deliverable until export, and a model self-inspection render
   * outside SCIENCE_ARTIFACT_DIR never becomes an artifact at all.
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

/** Loader schema. {@link resolveConfig} validates closed-object rules. */
export const configSchema: z<Config> = z.object({
  dshHome: z.string(),
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
})

/** Parsed immutable runtime configuration. */
export interface ResolvedConfig {
  /** Explicit Harness home, when configured. */
  readonly dshHome: string | undefined
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
      'dshHome', 'profiles', 'timeoutMs',
      'packagesMaxEntries', 'packagesMaxBytes',
      'rasterCapture',
      'captureMaxFileBytes', 'captureMaxFilesPerRun', 'captureMaxArtifactVersionsPerSession',
      'inputMaxFilesPerRun', 'inputMaxBytesPerRun',
      'kernelIdleTimeoutMs', 'kernelStartTimeoutMs',
    ],
    'config',
  )
  if (config.dshHome !== undefined && typeof config.dshHome !== 'string') {
    throw new Error('science-runtime: dshHome must be a string when configured')
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
  const rasterCapture = config.rasterCapture ?? DEFAULT_RASTER_CAPTURE
  if (rasterCapture !== 'declared' && rasterCapture !== 'always') {
    throw new Error('science-runtime: rasterCapture must be "declared" or "always"')
  }
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
  return {
    dshHome: config.dshHome,
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
  }
}
