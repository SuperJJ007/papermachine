/** Built-in scanner for the model-visible-content event carriers. */

import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'

/** Durable event fields consumed by the carrier scanner. */
export interface AttachmentCarrierEvent {
  readonly type: string
  readonly data: unknown
}

/**
 * Collect every image reference inside one content array, descending into
 * nested tool-result content the way live model history does.
 * @param content - an event content array, or nested tool-result content.
 * @param refs - the array being filled, in encounter order.
 */
function collectFromContent(content: unknown, refs: ImageAttachmentRef[]): void {
  if (!Array.isArray(content)) return
  for (const value of content) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
    const block = value as { type?: unknown; attachment?: unknown; content?: unknown }
    if (block.type === 'image' && typeof block.attachment === 'object' && block.attachment !== null) {
      refs.push(block.attachment as ImageAttachmentRef)
    }
    if (block.type === 'tool-result') collectFromContent(block.content, refs)
  }
}

/**
 * Scan one built-in-carrier event for every image reference it durably
 * names. Accepts a loosely-typed value so a raw parsed Session-log row
 * (Session export's cold read) and a live `SessionEvent` share one scanner —
 * both are the same durable JSON shape.
 * @param event - a Session event whose type is classified `built-in`.
 * @returns every reference found, in encounter order (may repeat an id).
 */
export function extractBuiltInAttachments(event: AttachmentCarrierEvent): readonly ImageAttachmentRef[] {
  const refs: ImageAttachmentRef[] = []
  const data = event.data as {
    content?: unknown
    message?: { content?: unknown }
    inserted?: Array<{ content?: unknown }>
    chunk?: { type?: unknown; block?: unknown }
  }
  collectFromContent(data.content, refs)
  if (data.message !== undefined) collectFromContent(data.message.content, refs)
  if (data.inserted !== undefined) {
    for (const message of data.inserted) collectFromContent(message.content, refs)
  }
  if (event.type === 'assistant/chunk' && data.chunk?.type === 'block-end') {
    collectFromContent([data.chunk.block], refs)
  }
  return refs
}
