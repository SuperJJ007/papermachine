/** Strict local Conda-profile configuration for the Science Runtime. */

import { isAbsolute } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { ScienceEnvironmentProfileId } from '@deepseek-ai/dsh-science-session'
import type { ScienceEnvironmentProfileId as ScienceEnvironmentProfileIdType } from '@deepseek-ai/dsh-science-session'

/** Fixed default timeout for one bind or run operation. */
export const DEFAULT_TIMEOUT_MS = 120_000
/** Lowest accepted configured operation timeout. */
export const MIN_TIMEOUT_MS = 1
/** Highest accepted configured operation timeout. */
export const MAX_TIMEOUT_MS = 600_000

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
  /** Non-empty map of profile identifiers to existing language prefixes. */
  readonly profiles: Readonly<Record<string, ScienceEnvironmentProfileConfig>>
  /** One caller-independent bound for bind and run operations. */
  readonly timeoutMs?: number
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
})

/** Parsed immutable runtime configuration. */
export interface ResolvedConfig {
  /** Explicit Harness home, when configured. */
  readonly dshHome: string | undefined
  /** Non-empty allowlisted profiles. */
  readonly profiles: ReadonlyMap<string, ConfiguredProfile>
  /** Explicitly resolved operation deadline. */
  readonly timeoutMs: number
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
 * @param profiles - Parsed Loader profile map.
 * @returns Immutable profiles keyed by their durable id string.
 */
export function parseProfiles(
  profiles: Readonly<Record<string, ScienceEnvironmentProfileConfig>>,
): ReadonlyMap<string, ConfiguredProfile> {
  assertKnownKeys(profiles, Object.keys(profiles), 'profiles')
  const entries = Object.entries(profiles)
  if (entries.length === 0) throw new Error('science-runtime: profiles must be non-empty')
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
  assertKnownKeys(config, ['dshHome', 'profiles', 'timeoutMs'], 'config')
  if (config.dshHome !== undefined && typeof config.dshHome !== 'string') {
    throw new Error('science-runtime: dshHome must be a string when configured')
  }
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`science-runtime: timeoutMs must be a safe integer from ${String(MIN_TIMEOUT_MS)} through ${String(MAX_TIMEOUT_MS)}`)
  }
  return {
    dshHome: config.dshHome,
    profiles: parseProfiles(config.profiles),
    timeoutMs,
  }
}
