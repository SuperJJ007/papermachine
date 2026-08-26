/** Branded identities and format constants for the Science session domain. */

import type { Branded } from '@deepseek-ai/dsh-brand'
import { ArtifactId, ProjectId, VersionId } from '@deepseek-ai/dsh-science-artifact-store/ids'

/** Payload version shared by the first Science session event vocabulary. */
export const SCIENCE_EVENT_VERSION = 1 as const

/**
 * The shipped Science preset's id. `ScienceModeRef.presetId` records
 * whichever preset actually bound Science mode rather than a hardcoded
 * literal, so the fold and `dsh-tool-science`'s own preset check are
 * self-consistent instead of independently repeating this string — but
 * today it is the only preset id either recognizes as eligible to bind
 * Science mode. Recognizing another preset id (a genuinely distinct
 * discipline preset, or a copy of this one) as Science-family needs a
 * preset-metadata mechanism this package does not yet consult; until then,
 * a preset whose id differs from this constant cannot bind Science mode.
 */
export const SCIENCE_PRESET_ID = 'science'

/**
 * Persisted-cache invalidation version for the Science projection state.
 * Bump whenever the state shape or the fold semantics change, per the
 * registry's `stateVersion` rule ([session-projection](../../../session/session-projection/README.md#contract)).
 */
export const SCIENCE_PROJECTION_STATE_VERSION = 10

/** Identifies one Science environment profile inside durable session facts. */
export type ScienceEnvironmentProfileId = Branded<'ScienceEnvironmentProfileId'>

/** Identifies one Science run for the lifetime of its owning session. */
export type ScienceRunId = Branded<'ScienceRunId'>

/**
 * Identifies one project's durable artifact store. The store package owns
 * the brand ([ids](../../science-artifact-store/src/ids.ts)); durable Science
 * events record store rows by these shared identities, so the session log and
 * the store index never need an id mapping between them.
 */
export type ScienceProjectId = ProjectId

/** Identifies one logical artifact across its immutable versions; the store package owns the brand. */
export type ScienceArtifactId = ArtifactId

/** Identifies one immutable artifact version row in the owning project's store; the store package owns the brand. */
export type ScienceVersionId = VersionId

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
 * Brand a validated project identifier.
 * @param value - validated store project identifier.
 * @returns the same string with the store's project brand.
 */
export const ScienceProjectId: (value: string) => ScienceProjectId = ProjectId

/**
 * Brand a validated artifact identifier.
 * @param value - validated store artifact identifier.
 * @returns the same string with the store's artifact brand.
 */
export const ScienceArtifactId: (value: string) => ScienceArtifactId = ArtifactId

/**
 * Brand a validated artifact version identifier.
 * @param value - validated store version identifier.
 * @returns the same string with the store's version brand.
 */
export const ScienceVersionId: (value: string) => ScienceVersionId = VersionId

/**
 * Brand a validated scratch content key.
 * @param value - validated content digest.
 * @returns the same string with its scratch-key brand.
 */
export function ScienceScratchKey(value: string): ScienceScratchKey {
  return value as ScienceScratchKey
}
