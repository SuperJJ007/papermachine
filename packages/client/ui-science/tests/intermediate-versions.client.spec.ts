/**
 * Pure same-turn intermediate-draft folding (C2): which versions of one
 * artifact are superseded within their own authorizing turn, within their
 * own producing session, plus the store content-origin mapping the
 * production wiring feeds it.
 */

import { describe, expect, it } from 'vitest'
import type { ScienceIntermediateVersionFact } from '../src/client/intermediate-versions.ts'
import { foldIntermediateVersions } from '../src/client/intermediate-versions.ts'

const SESSION_A = 'session-a'
const SESSION_B = 'session-b'

describe('foldIntermediateVersions', () => {
  it('collapses nothing when a human-edit version splits two different-turn auto versions', () => {
    // mpl_grouped: v1 auto(turn 1), v2 human-edit, v3 auto(turn 2).
    const versions: ScienceIntermediateVersionFact[] = [
      { version: 1, origin: 'run-auto', producerSessionId: SESSION_A, turn: 1 },
      { version: 2, origin: 'human-edit', producerSessionId: SESSION_A },
      { version: 3, origin: 'run-auto', producerSessionId: SESSION_A, turn: 2 },
    ]
    expect(foldIntermediateVersions(versions)).toEqual(new Set())
  })

  it('collapses an earlier same-turn auto version superseded by a later one', () => {
    // occ_emp_wage_scatter: v1 auto(turn 1, step 15), v2 auto(turn 1, step 18).
    const versions: ScienceIntermediateVersionFact[] = [
      { version: 1, origin: 'run-auto', producerSessionId: SESSION_A, turn: 1 },
      { version: 2, origin: 'run-auto', producerSessionId: SESSION_A, turn: 1 },
    ]
    expect(foldIntermediateVersions(versions)).toEqual(new Set([1]))
  })

  it('collapses only versions superseded in their turn, regardless of input order', () => {
    const versions: ScienceIntermediateVersionFact[] = [
      { version: 3, origin: 'run-auto', producerSessionId: SESSION_A, turn: 1 },
      { version: 1, origin: 'run-auto', producerSessionId: SESSION_A, turn: 1 },
      { version: 2, origin: 'import', producerSessionId: SESSION_A, turn: 1 },
    ]
    expect(foldIntermediateVersions(versions)).toEqual(new Set([1, 2]))
  })

  it('never collapses a human-edit version even when a later version shares no turn at all', () => {
    const versions: ScienceIntermediateVersionFact[] = [
      { version: 1, origin: 'human-edit', producerSessionId: SESSION_A },
      { version: 2, origin: 'run-auto', producerSessionId: SESSION_A, turn: 5 },
    ]
    expect(foldIntermediateVersions(versions)).toEqual(new Set())
  })

  it('never collapses a version whose turn no later version repeats, cross-turn', () => {
    const versions: ScienceIntermediateVersionFact[] = [
      { version: 1, origin: 'run-auto', producerSessionId: SESSION_A, turn: 1 },
      { version: 2, origin: 'run-auto', producerSessionId: SESSION_A, turn: 2 },
      { version: 3, origin: 'run-auto', producerSessionId: SESSION_A, turn: 3 },
    ]
    expect(foldIntermediateVersions(versions)).toEqual(new Set())
  })

  it('returns an empty set for a single version', () => {
    expect(foldIntermediateVersions([{ version: 1, origin: 'run-auto', producerSessionId: SESSION_A, turn: 1 }])).toEqual(new Set())
  })

  it('never collapses matching turn numbers produced by different sessions', () => {
    // A version saved under a different producing session restarts its own
    // turn counter at 1; that must never be read as a same-turn re-render of
    // an unrelated session's turn 1.
    const versions: ScienceIntermediateVersionFact[] = [
      { version: 1, origin: 'run-auto', producerSessionId: SESSION_A, turn: 1 },
      { version: 2, origin: 'run-auto', producerSessionId: SESSION_B, turn: 1 },
    ]
    expect(foldIntermediateVersions(versions)).toEqual(new Set())
  })

  it('never collapses a version with no authorizing turn, such as an import', () => {
    const versions: ScienceIntermediateVersionFact[] = [
      { version: 1, origin: 'import', producerSessionId: SESSION_A },
      { version: 2, origin: 'run-auto', producerSessionId: SESSION_A, turn: 1 },
    ]
    expect(foldIntermediateVersions(versions)).toEqual(new Set())
  })
})
