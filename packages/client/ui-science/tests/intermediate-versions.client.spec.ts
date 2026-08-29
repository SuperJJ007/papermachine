/** Pure same-turn intermediate-draft folding (C2): which versions of one artifact are superseded within their own authorizing turn. */

import { describe, expect, it } from 'vitest'
import type { ScienceIntermediateVersionFact } from '../src/client/intermediate-versions.ts'
import { foldIntermediateVersions } from '../src/client/intermediate-versions.ts'

describe('foldIntermediateVersions', () => {
  it('collapses nothing when a human-edit version splits two different-turn auto versions', () => {
    // mpl_grouped: v1 auto(turn 1), v2 human-edit, v3 auto(turn 2).
    const versions: ScienceIntermediateVersionFact[] = [
      { version: 1, origin: 'auto', turn: 1 },
      { version: 2, origin: 'human-edit' },
      { version: 3, origin: 'auto', turn: 2 },
    ]
    expect(foldIntermediateVersions(versions)).toEqual(new Set())
  })

  it('collapses an earlier same-turn auto version superseded by a later one', () => {
    // occ_emp_wage_scatter: v1 auto(turn 1, step 15), v2 auto(turn 1, step 18).
    const versions: ScienceIntermediateVersionFact[] = [
      { version: 1, origin: 'auto', turn: 1 },
      { version: 2, origin: 'auto', turn: 1 },
    ]
    expect(foldIntermediateVersions(versions)).toEqual(new Set([1]))
  })

  it('never collapses the latest version of a turn, only the ones it supersedes', () => {
    const versions: ScienceIntermediateVersionFact[] = [
      { version: 1, origin: 'auto', turn: 1 },
      { version: 2, origin: 'model', turn: 1 },
      { version: 3, origin: 'auto', turn: 1 },
    ]
    expect(foldIntermediateVersions(versions)).toEqual(new Set([1, 2]))
  })

  it('never collapses a human-edit version even when a later version shares no turn at all', () => {
    const versions: ScienceIntermediateVersionFact[] = [
      { version: 1, origin: 'human-edit' },
      { version: 2, origin: 'auto', turn: 5 },
    ]
    expect(foldIntermediateVersions(versions)).toEqual(new Set())
  })

  it('never collapses a version whose turn no later version repeats, cross-turn', () => {
    const versions: ScienceIntermediateVersionFact[] = [
      { version: 1, origin: 'auto', turn: 1 },
      { version: 2, origin: 'auto', turn: 2 },
      { version: 3, origin: 'auto', turn: 3 },
    ]
    expect(foldIntermediateVersions(versions)).toEqual(new Set())
  })

  it('returns an empty set for a single version', () => {
    expect(foldIntermediateVersions([{ version: 1, origin: 'auto', turn: 1 }])).toEqual(new Set())
  })
})
