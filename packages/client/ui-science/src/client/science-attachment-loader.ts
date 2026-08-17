/**
 * Chart-thumbnail loader for the Science Details entry.
 *
 * The `save_chart`/`publish_outcome` transcript rows receive `loadImage`
 * through their tool-call owner share, which traces to the
 * conversation-owned session attachment loader's Map-based cache. The
 * Details entry rides no owner share (`DetailsViewOwnerProps` carries
 * nothing), so it resolves the durable image itself through the same
 * runtime-owned, session-scoped verb that loader calls underneath —
 * `ISession.readAttachment` (`packages/client/runtime/src/client/contract/session.ts`)
 * — one of the explicit "behavior verbs" that interface documents feature
 * packages may call directly. Every call returns a fresh `data:` URI: no
 * Map, no `URL.createObjectURL` handle, and therefore nothing to revoke on
 * session release — at the scale of a session's logical chart count, a
 * second Map-based cache would duplicate the conversation loader's own for
 * no correctness gain.
 */

import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ImageLoader } from '@deepseek-ai/dsh-client-ui-attachment'

/** Base64-encode bytes in fixed-size chunks (call-stack-safe for large PNGs). */
function bytesToBase64(data: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    binary += String.fromCharCode(...data.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

/**
 * Build the Details entry's `loadImage` for one session mount.
 * @param sessions - the injected runtime sessions service.
 * @param sessionId - the Details entry's own session mount (bound per registration inject call).
 * @returns a loader resolving one durable image reference to a displayable `data:` URI.
 */
export function createScienceImageLoader(sessions: ISessions, sessionId: SessionId): ImageLoader {
  return async (attachment: ImageAttachmentRef): Promise<string> => {
    const session = sessions.binding(sessionId)?.session
    if (session === undefined) {
      throw new Error(`ui-science: session "${sessionId}" resolved no binding`)
    }
    const result = await session.readAttachment(attachment.attachmentId)
    if (!result.ok) {
      throw new Error(`${result.error.code}: ${result.error.message}`)
    }
    return `data:${result.value.attachment.mediaType};base64,${bytesToBase64(result.value.data)}`
  }
}
