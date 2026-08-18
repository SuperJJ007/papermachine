/**
 * Freshness gate: every `KNOWN_SESSION_EVENT_TYPES` member is classified
 * exactly once by this package's closed policy lists, except the one
 * currently-known extractor-required type (`science/artifact-saved`), which
 * intentionally has no static entry — its classification comes from a live
 * `register()` call instead. Adding a known event type without updating one
 * of the lists below (or this allowlist, for a genuinely new
 * extractor-required type) fails this test.
 */

import { describe, expect, it } from 'vitest'
import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import {
  ATTACHMENT_FREE_EVENT_TYPES,
  BUILT_IN_CARRIER_EVENT_TYPES,
  staticAttachmentPolicy,
} from '../src/policy.ts'

/** Known types with no static entry today; each authorizes only through a live registration. */
const KNOWN_EXTRACTOR_REQUIRED_EVENT_TYPES = new Set(['science/artifact-saved'])

describe('session attachment policy', () => {
  it('classifies every known session event type exactly once', () => {
    const classified = new Set([
      ...BUILT_IN_CARRIER_EVENT_TYPES,
      ...ATTACHMENT_FREE_EVENT_TYPES,
      ...KNOWN_EXTRACTOR_REQUIRED_EVENT_TYPES,
    ])
    expect(classified.size).toBe(
      BUILT_IN_CARRIER_EVENT_TYPES.size
      + ATTACHMENT_FREE_EVENT_TYPES.size
      + KNOWN_EXTRACTOR_REQUIRED_EVENT_TYPES.size,
    )
    expect([...classified].sort()).toEqual([...KNOWN_SESSION_EVENT_TYPES].sort())
  })

  it('has no overlap between the built-in and attachment-free lists', () => {
    const overlap = [...BUILT_IN_CARRIER_EVENT_TYPES].filter(type => ATTACHMENT_FREE_EVENT_TYPES.has(type))
    expect(overlap).toEqual([])
  })

  it('resolves a static policy for a built-in and an attachment-free type', () => {
    expect(staticAttachmentPolicy('user/message')).toBe('built-in')
    expect(staticAttachmentPolicy('tool/call')).toBe('attachment-free')
  })

  it('resolves no static policy for an extractor-required or unrecognized type', () => {
    expect(staticAttachmentPolicy('science/artifact-saved')).toBeUndefined()
    expect(staticAttachmentPolicy('not-a-real-event-type')).toBeUndefined()
  })
})
