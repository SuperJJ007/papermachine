/** User-only artifact-note projection, independent of model-visible Science state. */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { z } from 'zod'
import type { ZodType } from 'zod'
import { ScienceArtifactId } from './ids.ts'
import type { ScienceArtifactNote, ScienceArtifactNotesProjection } from './types.ts'

/**
 * Maximum stored length of one artifact note's text, enforced at both the RPC
 * admission boundary (`dsh-tool-science`'s `addArtifactNote`) and this
 * projection's replay schema.
 */
export const MAX_SCIENCE_ARTIFACT_NOTE_LENGTH = 8_192

/** Wire and checkpoint schema for active artifact notes. */
export const scienceArtifactNotesSchema: ZodType<ScienceArtifactNotesProjection> = z.array(z.object({
  seq: z.number().int().nonnegative(),
  artifactId: z.string().min(1).transform(ScienceArtifactId),
  version: z.number().int().positive(),
  text: z.string().min(1).max(MAX_SCIENCE_ARTIFACT_NOTE_LENGTH),
  createdAt: z.number().int().nonnegative(),
}).strict())

/**
 * Fold one Session event into the active user-note list.
 * @param state - Active notes after the preceding event.
 * @param event - Next committed Session event.
 * @returns the same list for unrelated events, otherwise a new active-note list.
 */
export function applyScienceArtifactNotes(
  state: ScienceArtifactNotesProjection,
  event: SessionEvent,
): ScienceArtifactNotesProjection {
  if (event.type === 'science/artifact-note-added') {
    const note: ScienceArtifactNote = {
      seq: event.seq,
      artifactId: event.data.artifactId,
      version: event.data.artifactVersion,
      text: event.data.text,
      createdAt: event.data.createdAt,
    }
    return [...state, note]
  }
  if (event.type === 'science/artifact-note-removed') {
    return state.filter(note => note.seq !== event.data.noteSeq || note.artifactId !== event.data.artifactId)
  }
  return state
}
