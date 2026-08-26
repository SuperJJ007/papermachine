/**
 * Image and text artifact loaders for Science project-store content.
 *
 * Both loaders call `ISession.readScienceArtifact`, whose Host endpoint folds
 * the named session before reading the project store. `loadImage` returns a
 * fresh `data:` URI and `loadText` decodes the same authenticated bytes as
 * UTF-8. Neither loader retains URLs or a duplicate cache.
 */

import type { ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
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
export function createScienceImageLoader(sessions: ISessions, sessionId: SessionId): ScienceImageLoader {
  return async (content: ScienceArtifactContentRef): Promise<string> => {
    const session = sessions.binding(sessionId)?.session
    if (session === undefined) {
      throw new Error(`ui-science: session "${sessionId}" resolved no binding`)
    }
    const result = await session.readScienceArtifact(content.versionId as VersionId)
    if (!result.ok) {
      throw new Error(`${result.error.code}: ${result.error.message}`)
    }
    return `data:${result.value.mediaType};base64,${bytesToBase64(result.value.data)}`
  }
}

/**
 * Build the Details entry's `loadText` for one session mount — the CSV/
 * JSON/Markdown content dispatch's byte source.
 * @param sessions - the injected runtime sessions service.
 * @param sessionId - the Details entry's own session mount (bound per registration inject call).
 * @returns a loader resolving one durable text reference to its decoded content.
 */
export function createScienceTextLoader(sessions: ISessions, sessionId: SessionId): TextLoader {
  return async (content: ScienceArtifactContentRef): Promise<string> => {
    const session = sessions.binding(sessionId)?.session
    if (session === undefined) {
      throw new Error(`ui-science: session "${sessionId}" resolved no binding`)
    }
    const result = await session.readScienceArtifact(content.versionId as VersionId)
    if (!result.ok) {
      throw new Error(`${result.error.code}: ${result.error.message}`)
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(result.value.data)
  }
}
