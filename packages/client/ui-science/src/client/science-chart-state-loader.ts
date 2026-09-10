/**
 * Live chart-object state reader for one open PNG artifact version
 * (`sessions.scienceChartState`, via `ISession.readScienceChartState`) —
 * `ArtifactContent.tsx`'s chart edit panel mounts from this. Unlike
 * `version-summaries.ts`'s batched facts read, a caller only ever needs the
 * exactly one version its own open content is currently showing, so this
 * loader is neither batched nor accumulated across renders — `loadImage`/
 * `loadText`'s own memoization is the template for a future cache should one
 * become necessary.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { VersionId } from '@deepseek-ai/dsh-science-artifact-store/ids'
import type { ScienceChartState } from '@deepseek-ai/dsh-science-session/types'
import type { ScienceArtifactContentRef } from './science-attachment-loader.ts'

/** Resolves one durable PNG version to its live chart-object state, or `null` when it has none. */
export type ScienceChartStateLoader = (content: ScienceArtifactContentRef) => Promise<ScienceChartState | null>

/**
 * Build the Details entry's `loadChartState` for one session mount,
 * resolving the live session binding lazily on every call — mirrors
 * `science-attachment-loader.ts`'s own `readArtifact` binding lookup.
 * @param remote - the generated Science Remote client.
 * @param sessionId - the owning registration's own session mount.
 * @returns a loader for `sessions.scienceChartState`.
 */
export function createScienceChartStateLoader(remote: Context['remote'], sessionId: SessionId): ScienceChartStateLoader {
  return async (content: ScienceArtifactContentRef): Promise<ScienceChartState | null> => {
    const result = await remote.science.scienceChartState(sessionId, content.versionId as VersionId)
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
    return result.value.chart
  }
}
