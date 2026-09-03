/**
 * Image and text artifact loaders backed by the raw-bytes download/preview
 * endpoint (`GET /api/science/artifact/:sessionId/:versionId`, via
 * `scienceArtifactUrl`) rather than `science-attachment-loader.ts`'s base64
 * `readScienceArtifact` RPC. `ScienceArtifactImage` and `TextArtifactBody`
 * consume the exact same `ScienceImageLoader`/`TextLoader` function shapes
 * either loader factory produces, so swapping which factory a registration
 * wires in is the whole migration — no consuming component changed.
 */

import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { scienceArtifactUrl } from '@deepseek-ai/dsh-client-runtime/client'
import type { VersionId } from '@deepseek-ai/dsh-science-artifact-store/ids'
import type { ScienceArtifactContentRef, ScienceImageLoader, TextLoader } from './science-attachment-loader.ts'

/**
 * Build the Details entry's `loadImage` for one session mount: resolves
 * immediately to the browser-navigable raw-bytes URL, so `<img
 * src={resolvedUrl}>` fetches the bytes itself with no base64 pass through
 * this package's JS heap.
 * @param sessionId - the session whose fold authorizes every read this loader resolves.
 * @returns a loader resolving one durable image reference to its raw-bytes URL.
 */
export function createScienceImageUrlLoader(sessionId: SessionId): ScienceImageLoader {
  return (content: ScienceArtifactContentRef): Promise<string> =>
    Promise.resolve(scienceArtifactUrl(sessionId, content.versionId as VersionId))
}

/**
 * Build the Details entry's `loadText` for one session mount: fetches the
 * raw-bytes URL and lets the browser decode the response per its
 * `Content-Type` (see the raw-bytes endpoint's Agent Note for why this
 * package never re-decodes/re-encodes text itself).
 * @param sessionId - the session whose fold authorizes every read this loader resolves.
 * @returns a loader resolving one durable text reference to its decoded content.
 */
export function createScienceTextUrlLoader(sessionId: SessionId): TextLoader {
  return async (content: ScienceArtifactContentRef): Promise<string> => {
    const response = await fetch(scienceArtifactUrl(sessionId, content.versionId as VersionId))
    if (!response.ok) throw new Error(`science artifact text read failed: ${String(response.status)}`)
    return response.text()
  }
}
