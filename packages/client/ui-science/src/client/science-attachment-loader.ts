/**
 * Image and text artifact loaders for Science project-store content.
 *
 * Both loaders call `remote.science.scienceArtifact`, whose Host endpoint folds
 * the named session before reading the project store. `loadImage` returns a
 * fresh `data:` URI and `loadText` decodes the same authenticated bytes as
 * UTF-8. Each loader memoizes by `versionId` (`memoizedByVersionId`): a
 * version's bytes are immutable, so a successful read is cached for the
 * loader's lifetime, and every consumer requesting the same in-flight version
 * shares one read. Neither loader returns or retains object URLs, so eviction
 * never needs to revoke one.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { VersionId } from '@deepseek-ai/dsh-science-artifact-store/ids'
import type { ScienceArtifactMediaType } from '@deepseek-ai/dsh-science-session/types'

/** Browser-visible coordinates for one immutable project-store artifact version. */
export interface ScienceArtifactContentRef {
  readonly versionId: string
  readonly mediaType: ScienceArtifactMediaType
  readonly byteCount: number
}

/** Resolves one durable Science image version to a displayable URL. */
export type ScienceImageLoader = (content: ScienceArtifactContentRef) => Promise<string>

/** Resolves one durable Science text version to decoded UTF-8. */
export type TextLoader = (content: ScienceArtifactContentRef) => Promise<string>

/** Cache bound: an open Details panel realistically shows well under this many distinct versions at once. */
const MAX_MEMOIZED_VERSIONS = 64

/**
 * Wrap a per-content resolver in a `versionId`-keyed cache. A version's bytes
 * never change once written, so a settled read is kept for the wrapped
 * function's lifetime and every caller requesting the same in-flight version
 * shares one promise; a rejected read is evicted immediately so a retry
 * re-fetches instead of replaying the same failure. The cache is bounded to
 * {@link MAX_MEMOIZED_VERSIONS} entries, evicted oldest-inserted-first.
 * @param resolve - the underlying per-content loader to memoize.
 * @returns a loader with the same signature, memoized by `content.versionId`.
 */
function memoizedByVersionId<T>(
  resolve: (content: ScienceArtifactContentRef) => Promise<T>,
): (content: ScienceArtifactContentRef) => Promise<T> {
  const cache = new Map<string, Promise<T>>()
  return (content: ScienceArtifactContentRef): Promise<T> => {
    const cached = cache.get(content.versionId)
    if (cached !== undefined) return cached
    const promise = resolve(content).catch((error: unknown) => {
      cache.delete(content.versionId)
      throw error
    })
    if (cache.size >= MAX_MEMOIZED_VERSIONS) {
      // `cache.size >= 1` on this branch, so this loop always deletes exactly
      // the oldest-inserted key (`Map` iterates insertion order) and stops.
      for (const oldest of cache.keys()) { cache.delete(oldest); break }
    }
    cache.set(content.versionId, promise)
    return promise
  }
}

/** Read project-authorized bytes through the generated Science Remote. */
async function readArtifact(remote: Context['remote'], sessionId: SessionId, content: ScienceArtifactContentRef) {
  const result = await remote.science.scienceArtifact(sessionId, content.versionId as VersionId)
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
  return result.value
}

/**
 * Build the Details entry's `loadImage` for one session mount.
 * @param remote - the generated Science Remote client.
 * @param sessionId - the Details entry's own session mount (bound per registration inject call).
 * @returns a loader resolving one durable image reference to a displayable `data:` URI.
 */
export function createScienceImageLoader(remote: Context['remote'], sessionId: SessionId): ScienceImageLoader {
  return memoizedByVersionId(async (content: ScienceArtifactContentRef): Promise<string> => {
    const value = await readArtifact(remote, sessionId, content)
    return `data:${value.mediaType};base64,${value.data}`
  })
}

/**
 * Build the Details entry's `loadText` for one session mount — the CSV/
 * JSON/Markdown content dispatch's byte source.
 * @param remote - the generated Science Remote client.
 * @param sessionId - the Details entry's own session mount (bound per registration inject call).
 * @returns a loader resolving one durable text reference to its decoded content.
 */
export function createScienceTextLoader(remote: Context['remote'], sessionId: SessionId): TextLoader {
  return memoizedByVersionId(async (content: ScienceArtifactContentRef): Promise<string> => {
    const value = await readArtifact(remote, sessionId, content)
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(value.data), char => char.charCodeAt(0)))
  })
}
