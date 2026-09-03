/**
 * downloads domain contract: host-only download surfaces — the GET-download
 * channel family, the mirror of the SSE-stream `events` domain. No wire
 * envelope: the carrier's GET routes answer these directly, and the browser
 * `IApiClient` never exposes them.
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { VersionId } from '@deepseek-ai/dsh-science-artifact-store/ids'

/** Host-only download surfaces (no wire envelope; absent from IApiClient). */
export interface DownloadsApi {
  /**
   * Stream one session-log ZIP — the root artifact verbatim plus each subagent
   * descendant's — as an attachment response. The carrier's GET route answers
   * this directly; the browser never calls it.
   * @param request - the root session id and whether to include descendants.
   * @param signal - cancellation for the underlying reads.
   * @returns the ZIP attachment response; missing services answer 500 and a
   * missing root session 404 before any byte is produced.
   */
  sessionLog(
    request: { sessionId: SessionId; includeDescendants?: boolean },
    signal: AbortSignal,
  ): Promise<Response>

  /**
   * Stream one Science project-store artifact version's raw content-addressed
   * bytes as an attachment response, verbatim and unencoded — the raw-bytes
   * counterpart to the base64 `session.scienceArtifact` RPC. The carrier
   * routes both GET and HEAD here directly (HEAD answers headers-only, body
   * cancelled — the client's download flow HEAD-checks this exact URL to
   * classify a failure before ever creating a save anchor); the browser
   * never calls it through `IApiClient`. Authorization reuses
   * `authorizedScienceArtifact`'s three
   * proof paths (the same fold `session.scienceArtifact` uses) against the
   * named session's own log — the request never carries a `projectId`, so a
   * caller cannot select an authorization domain of its own choosing.
   * @param request - the session whose fold must prove the version, and the version to stream.
   * @param signal - cancellation for the underlying store read.
   * @returns the attachment response on success. A session or version this
   * session cannot prove answers 404 without naming a reason. A version whose
   * blob is absent from the store answers 410 with an
   * `x-science-artifact-error: missing_content` header; one whose blob fails
   * SHA-256 verification answers 409 with `content_corrupt`. A deployment
   * without `@deepseek-ai/dsh-science-artifact-store` mounted, or an
   * unexpected read failure, answers 500.
   */
  scienceArtifact(
    request: { sessionId: SessionId; versionId: VersionId },
    signal: AbortSignal,
  ): Promise<Response>
}
