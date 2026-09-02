/** Pure artifact-level display name resolution (C1), shared across every non-version-scoped surface. */

import { describe, expect, it } from 'vitest'
import { scienceArtifactDisplayTitleOrSelf } from '../src/client/artifact-display-title.ts'

describe('scienceArtifactDisplayTitleOrSelf', () => {
  it('ignores a fact belonging to a different artifact', () => {
    const self = { artifactId: 'a', version: 1, title: 'Self title', logicalName: 'self.png' }
    const other = { artifactId: 'b', version: 9, title: 'Other title', logicalName: 'other.png' }
    expect(scienceArtifactDisplayTitleOrSelf([other], self)).toBe('Self title')
  })

  it('prefers a strictly later version of the same artifact over self', () => {
    const self = { artifactId: 'a', version: 1, title: 'Self title', logicalName: 'self.png' }
    const later = { artifactId: 'a', version: 2, title: 'Later title', logicalName: 'later.png' }
    expect(scienceArtifactDisplayTitleOrSelf([later], self)).toBe('Later title')
  })

  it('keeps self when a matching fact is not later', () => {
    const self = { artifactId: 'a', version: 2, title: 'Self title', logicalName: 'self.png' }
    const earlier = { artifactId: 'a', version: 1, title: 'Earlier title', logicalName: 'earlier.png' }
    expect(scienceArtifactDisplayTitleOrSelf([earlier], self)).toBe('Self title')
  })

  it('falls back to self when facts has no entry for the artifact at all', () => {
    const self = { artifactId: 'a', version: 1, title: 'Self title', logicalName: 'self.png' }
    expect(scienceArtifactDisplayTitleOrSelf([], self)).toBe('Self title')
  })

  it('falls back to the resolved fact\'s logical name when its title is empty', () => {
    const self = { artifactId: 'a', version: 1, title: '', logicalName: 'self.png' }
    expect(scienceArtifactDisplayTitleOrSelf([], self)).toBe('self.png')
  })
})
