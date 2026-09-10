/** Descriptor ownership for the Host's inherited byte-pipe streams. */

import type { ReadStream, WriteStream } from 'node:fs'
import { once } from 'node:events'

/**
 * Destroy the owning stream and await its descriptor close, including a pending destroy.
 * Explicit destruction closes fs stream descriptors even with autoClose disabled;
 * callers must not close the descriptor separately. Close failures remain rejected.
 * @param pipe - stream that exclusively owns its inherited descriptor.
 * @returns completion after the stream emits close, or immediately if already closed.
 */
export async function closeDesktopPipe(pipe: ReadStream | WriteStream): Promise<void> {
  if (pipe.closed) return
  const closed = once(pipe, 'close')
  pipe.destroy()
  await closed
}
