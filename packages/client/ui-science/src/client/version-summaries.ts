/**
 * Batched, current-value reads of one artifact version's library facts
 * (title, caption, content origin, creation time, media type, byte count):
 * the D9 fix. Every surface that used to read these off the session
 * projection's own presentation snapshot (`ScienceClientArtifactVersion`,
 * slimmed to identity plus the title/caption seen when the event committed)
 * now reads them fresh from the project store through
 * `sessions.scienceVersions`, so the Files panel and the detail panel never
 * show two different names for the same version after a later curation call.
 */

import { useEffect, useRef, useState } from 'react'
import type { RpcResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { VersionId } from '@deepseek-ai/dsh-science-artifact-store/ids'
import type { ScienceArtifactId, ScienceArtifactMediaType, ScienceClientArtifactVersion } from '@deepseek-ai/dsh-science-session/types'
import type { ScienceVersionSummary } from './library-artifact.ts'

/** Injected batch reader: the caller's `sessions.scienceVersions` RPC, scoped to one session. */
export type LoadScienceVersions =
  (versionIds: readonly string[]) => Promise<RpcResult<{ versions: ScienceVersionSummary[] }>>

/**
 * Build one session-scoped {@link LoadScienceVersions}, resolving the live
 * session binding lazily on every call (never at registration time) so a
 * session that connects after this loader is minted still resolves —
 * mirrors `science-attachment-loader.ts`'s own `readArtifact` binding lookup.
 * @param sessions - the injected runtime sessions service.
 * @param sessionId - the owning registration's own session mount.
 * @returns a batch reader for `sessions.scienceVersions`.
 */
export function createLoadScienceVersions(sessions: ISessions, sessionId: SessionId): LoadScienceVersions {
  return async (versionIds) => {
    const session = sessions.binding(sessionId)?.session
    if (session === undefined) throw new Error(`ui-science: session "${sessionId}" resolved no binding`)
    return session.readScienceVersions(versionIds as VersionId[])
  }
}

/** Current facts for a caller-chosen set of versions, keyed by `versionId`. */
export type ScienceVersionSummaryMap = ReadonlyMap<string, ScienceVersionSummary>

const EMPTY_SUMMARIES: ScienceVersionSummaryMap = new Map()

/**
 * Fetch current library facts for exactly the versionIds a view has visible
 * right now, one batched call per distinct set (order-independent — a
 * reordering of the same ids does not refetch). Accumulates every version
 * this hook has ever resolved into a session-lifetime cache and returns that
 * whole cache immediately on every render (not just the latest batch), so a
 * caller that narrows its visible set (closing a tab) keeps the facts it
 * already knows instead of the map shrinking back to `undefined` entries; an
 * id whose fetch is still in flight or failed authorization is simply absent
 * from the returned map (never a placeholder), matching `scienceVersions`'s
 * own silent-omission rule for an unauthorized or nonexistent id.
 * @param loadVersions - the injected per-session batch reader.
 * @param versionIds - the versions this view currently needs facts for.
 * @returns accumulated current facts, keyed by `versionId`.
 */
export function useScienceVersionSummaries(
  loadVersions: LoadScienceVersions,
  versionIds: readonly string[],
): ScienceVersionSummaryMap {
  const key = [...new Set(versionIds)].sort().join(',')
  const cache = useRef(new Map<string, ScienceVersionSummary>())
  const [, forceRender] = useState(0)
  useEffect(() => {
    if (key === '') return
    let live = true
    void loadVersions(key.split(',')).then((result) => {
      if (!live || !result.ok) return
      for (const summary of result.value.versions) cache.current.set(summary.versionId, summary)
      forceRender(count => count + 1)
    })
    return () => { live = false }
  }, [key, loadVersions])
  return cache.current.size === 0 ? EMPTY_SUMMARIES : cache.current
}

/**
 * One artifact version ready to render: session-log identity (`artifactId`,
 * `version`, `versionId`, `sha256`) plus the store's current library facts.
 * The unifying render-time type every content, toolbar, provenance, and
 * trace surface in this package now takes in place of the removed fields on
 * `ScienceClientArtifactVersion`.
 */
export interface ScienceRenderableVersion {
  readonly artifactId: ScienceArtifactId
  readonly logicalName: string
  readonly version: number
  readonly versionId: string
  readonly sha256: string
  readonly title: string
  readonly caption?: string
  readonly mediaType: ScienceArtifactMediaType
  readonly byteCount: number
  readonly contentOrigin: ScienceVersionSummary['contentOrigin']
  readonly createdAt: number
  /** Store-owned producer identity used by the provenance drill-in. */
  readonly producer?: ScienceVersionSummary['producer']
}

/**
 * Combine one session-log artifact identity with its current store facts.
 * @param artifact - the session-log identity (`science.artifacts` entry).
 * @param summaries - accumulated current facts, from {@link useScienceVersionSummaries}.
 * @returns the renderable version, or `undefined` while its summary has not
 * yet loaded (or this session cannot prove it) — callers show a loading or
 * unavailable state rather than rendering with stale/absent facts.
 */
export function toRenderableVersion(
  artifact: ScienceClientArtifactVersion,
  summaries: ScienceVersionSummaryMap,
): ScienceRenderableVersion | undefined {
  const summary = summaries.get(artifact.versionId)
  if (summary === undefined) return undefined
  return {
    artifactId: artifact.artifactId,
    logicalName: summary.logicalName,
    version: artifact.version,
    versionId: artifact.versionId,
    sha256: artifact.sha256,
    title: summary.title ?? summary.logicalName,
    ...summary.caption === undefined ? {} : { caption: summary.caption },
    mediaType: summary.mediaType as ScienceArtifactMediaType,
    byteCount: summary.byteCount,
    contentOrigin: summary.contentOrigin,
    createdAt: summary.createdAt,
    producer: summary.producer,
  }
}
