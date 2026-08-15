/** Required plugin configuration for the Science Consumer. */

import z from '@deepseek-ai/schemastery'
import { ScienceEnvironmentProfileId } from '@deepseek-ai/dsh-science-session'
import type { ScienceEnvironmentProfileId as ScienceEnvironmentProfileIdType } from '@deepseek-ai/dsh-science-session'

/** Longest accepted `profileId`/`modeRevision` value. */
export const MAX_ID_LENGTH = 128

/** The same safe-ID grammar the durable Science Session domain requires. */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** Required deployment identity and model-facing history bound. */
export interface Config {
  /** Runtime allowlist profile this Consumer binds on first use. */
  readonly profileId: string
  /** Deployment-owned Science mode contract revision. */
  readonly modeRevision: string
  /** Maximum recent runs and chart versions returned by `get_science_state`, per collection. */
  readonly stateHistoryLimit: number
}

/** Loader schema. {@link resolveConfig} validates the safe-ID grammar and bounded-trimmed rule. */
export const Config: z<Config> = z.object({
  profileId: z.string().required(),
  modeRevision: z.string().required(),
  stateHistoryLimit: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
})

/** Parsed immutable configuration. */
export interface ResolvedConfig {
  /** Branded, grammar-validated Runtime allowlist profile identity. */
  readonly profileId: ScienceEnvironmentProfileIdType
  /** Trimmed, non-empty, bounded mode-contract revision. */
  readonly modeRevision: string
  /** Positive safe-integer bound applied independently to run and chart-version history. */
  readonly stateHistoryLimit: number
}

/**
 * Validate the Loader-parsed config against the safe-ID grammar and the
 * trimmed-bounded text rule, and brand `profileId`.
 * @param config - Loader-normalized or programmatic provider configuration.
 * @returns one immutable resolved configuration.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  if (!SAFE_ID.test(config.profileId) || config.profileId.length > MAX_ID_LENGTH) {
    throw new Error(`tool-science: profileId ${JSON.stringify(config.profileId)} is invalid`)
  }
  if (
    config.modeRevision.length === 0
    || config.modeRevision.length > MAX_ID_LENGTH
    || config.modeRevision !== config.modeRevision.trim()
  ) {
    throw new Error(`tool-science: modeRevision ${JSON.stringify(config.modeRevision)} is invalid`)
  }
  if (!Number.isSafeInteger(config.stateHistoryLimit) || config.stateHistoryLimit < 1) {
    throw new Error(`tool-science: stateHistoryLimit ${JSON.stringify(config.stateHistoryLimit)} is invalid`)
  }
  return {
    profileId: ScienceEnvironmentProfileId(config.profileId),
    modeRevision: config.modeRevision,
    stateHistoryLimit: config.stateHistoryLimit,
  }
}
