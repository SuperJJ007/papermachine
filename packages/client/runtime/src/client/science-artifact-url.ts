/** Browser-navigable URL for the Science raw-bytes download/preview endpoint. */

import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { VersionId } from '@deepseek-ai/dsh-science-artifact-store/ids'
import { resolveApiOrigin } from '@deepseek-ai/dsh-host-apiproxy/client'

/**
 * Build the URL for `GET /api/science/artifact/:sessionId/:versionId` (see
 * `dsh-host-apiproxy`'s `DownloadsApi.scienceArtifact`): the raw-bytes
 * counterpart to `readScienceArtifact`'s base64 RPC, meant for an `<img
 * src>`, a `fetch()` preview read, or a download anchor's `href`. Resolves
 * against the current page origin through the same {@link resolveApiOrigin}
 * the RPC transport itself uses for its POST/WebSocket traffic — never a
 * hardcoded host or port, since the desktop app's per-launch random port
 * makes any fixed value wrong by construction.
 * @param sessionId - the session whose fold must prove the version (the
 * endpoint derives authorization from this id alone; it accepts no
 * `projectId`).
 * @param versionId - the store version to stream.
 * @returns an absolute URL a browser can navigate to directly.
 */
export function scienceArtifactUrl(sessionId: SessionId, versionId: VersionId): string {
  return new URL(
    `/api/science/artifact/${encodeURIComponent(sessionId)}/${encodeURIComponent(versionId)}`,
    resolveApiOrigin(),
  ).toString()
}
