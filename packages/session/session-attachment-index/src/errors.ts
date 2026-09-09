/** Typed rejection for the Session attachment-reference registry. */

import type { SessionAttachmentIndexErrorCode } from './types.ts'

/**
 * Thrown when a durable event's own type is known and requires a registered
 * extractor to authorize its attachment references, but no extractor is
 * currently registered for that type. Raised by both the live single-reference
 * authorization read and Session export media collection; export raises it
 * before any archive entry is produced for the affected artifact, so no
 * partial ZIP is ever emitted for that failure.
 */
export class SessionAttachmentIndexError extends Error {
  /**
   * @param code - stable rejection classification.
   * @param message - safe caller-facing explanation.
   */
  constructor(readonly code: SessionAttachmentIndexErrorCode, message: string) {
    super(message)
    this.name = 'SessionAttachmentIndexError'
  }
}
