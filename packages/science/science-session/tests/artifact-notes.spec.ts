import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { applyScienceArtifactNotes, scienceArtifactNotesSchema } from '../src/artifact-notes.ts'
import { ScienceArtifactId } from '../src/index.ts'

function noteEvent<T extends 'science/artifact-note-added' | 'science/artifact-note-removed'>(
  type: T,
  seq: number,
  data: Extract<SessionEvent, { type: T }>['data'],
): Extract<SessionEvent, { type: T }> {
  return { type, seq, time: seq * 10, data, ignorable: true } as Extract<SessionEvent, { type: T }>
}

describe('user-only artifact-note projection', () => {
  it('retains logical artifact identity, visible version, text, time, and add-event sequence', () => {
    const added = noteEvent('science/artifact-note-added', 7, {
      version: 1, artifactId: ScienceArtifactId('chart-1'), artifactVersion: 3,
      text: 'Keep this label', createdAt: 1_000,
    })
    const notes = applyScienceArtifactNotes([], added)
    expect(notes).toEqual([{
      seq: 7, artifactId: ScienceArtifactId('chart-1'), version: 3,
      text: 'Keep this label', createdAt: 1_000,
    }])
    expect(scienceArtifactNotesSchema.safeParse(notes).success).toBe(true)
  })

  it('removes only the addressed active note and ignores unrelated Session events', () => {
    const chart1 = ScienceArtifactId('chart-1')
    const chart2 = ScienceArtifactId('chart-2')
    const state = [
      { seq: 7, artifactId: chart1, version: 1, text: 'first', createdAt: 100 },
      { seq: 8, artifactId: chart2, version: 2, text: 'second', createdAt: 200 },
    ]
    const unrelated = { type: 'turn/start', seq: 9, time: 90, data: { turn: 2 } } as SessionEvent
    expect(applyScienceArtifactNotes(state, unrelated)).toBe(state)
    expect(applyScienceArtifactNotes(state, noteEvent('science/artifact-note-removed', 10, {
      version: 1, artifactId: chart1, noteSeq: 7, removedAt: 300,
    }))).toEqual([state[1]])
  })

  it('rejects empty, overlong, and structurally extended note projection values', () => {
    const base = { seq: 1, artifactId: 'chart-1', version: 1, text: 'note', createdAt: 1 }
    expect(scienceArtifactNotesSchema.safeParse([{ ...base, text: '' }]).success).toBe(false)
    expect(scienceArtifactNotesSchema.safeParse([{ ...base, text: 'x'.repeat(8_193) }]).success).toBe(false)
    expect(scienceArtifactNotesSchema.safeParse([{ ...base, extra: true }]).success).toBe(false)
  })
})
