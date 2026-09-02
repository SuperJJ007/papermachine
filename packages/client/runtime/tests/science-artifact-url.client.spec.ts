/**
 * scienceArtifactUrl: path construction (segment order, percent-encoding)
 * and the same-origin resolution `resolveApiOrigin` already covers in
 * `dsh-host-apiproxy` — verified again here through the actual public
 * export this package hands to feature code, not just its dependency.
 */

import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { VersionId } from '@deepseek-ai/dsh-science-artifact-store/ids'
import { scienceArtifactUrl } from '../src/client/science-artifact-url.ts'

describe('scienceArtifactUrl', () => {
  it('builds the raw-bytes download path with percent-encoded segments', () => {
    const url = scienceArtifactUrl('s 1' as SessionId, 'v/1' as VersionId)
    expect(url).toBe('http://dsh.internal/api/science/artifact/s%201/v%2F1')
  })

  it('resolves against the current page origin when one is present', () => {
    const globalWithLocation = globalThis as { location?: { origin?: string } }
    globalWithLocation.location = { origin: 'http://host.example:5173' }
    try {
      expect(scienceArtifactUrl('s1' as SessionId, 'v1' as VersionId))
        .toBe('http://host.example:5173/api/science/artifact/s1/v1')
    } finally {
      delete globalWithLocation.location
    }
  })
})
