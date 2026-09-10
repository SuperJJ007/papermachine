/** Exact artifact-byte route; the Host authorizes the version against the session project. */
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { VersionId } from '@deepseek-ai/dsh-science-artifact-store/ids'

/** @param sessionId - Project-authorizing session. @param versionId - Immutable version. @returns Same-origin byte route. */
export function scienceArtifactUrl(sessionId: SessionId, versionId: VersionId): string {
  return `/api/science-artifact?${new URLSearchParams({ sessionId, versionId })}`
}
