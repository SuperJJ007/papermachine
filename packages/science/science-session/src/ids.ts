/** Branded identities and format constants for the Science session domain. */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Payload version shared by the first Science session event vocabulary. */
export const SCIENCE_EVENT_VERSION = 1 as const

/** Persisted-cache invalidation version for the Science projection state. */
export const SCIENCE_PROJECTION_STATE_VERSION = 3

/** Identifies one Science environment profile inside durable session facts. */
export type ScienceEnvironmentProfileId = Branded<'ScienceEnvironmentProfileId'>

/** Identifies one Science run for the lifetime of its owning session. */
export type ScienceRunId = Branded<'ScienceRunId'>

/** Identifies one logical artifact across its immutable versions. */
export type ScienceArtifactId = Branded<'ScienceArtifactId'>

/** Content-addressed key for one immutable Science scratch source. */
export type ScienceScratchKey = Branded<'ScienceScratchKey'>

/**
 * Brand a validated environment profile identifier.
 * @param value - validated opaque identifier.
 * @returns the same string with its environment-profile brand.
 */
export function ScienceEnvironmentProfileId(value: string): ScienceEnvironmentProfileId {
  return value as ScienceEnvironmentProfileId
}

/**
 * Brand a validated run identifier.
 * @param value - validated session-local identifier.
 * @returns the same string with its run brand.
 */
export function ScienceRunId(value: string): ScienceRunId {
  return value as ScienceRunId
}

/**
 * Brand a validated artifact identifier.
 * @param value - validated session-local identifier.
 * @returns the same string with its artifact brand.
 */
export function ScienceArtifactId(value: string): ScienceArtifactId {
  return value as ScienceArtifactId
}

/**
 * Brand a validated scratch content key.
 * @param value - validated content digest.
 * @returns the same string with its scratch-key brand.
 */
export function ScienceScratchKey(value: string): ScienceScratchKey {
  return value as ScienceScratchKey
}
