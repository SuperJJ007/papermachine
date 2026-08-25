/** Durable Science event payloads and Session event declaration merging. */

import type {
  ScienceArtifactVersion,
  ScienceArtifactId,
  ScienceEnvironmentBinding,
  ScienceKernelState,
  ScienceModeRef,
  ScienceOutcomePublication,
  ScienceRunStarted,
  ScienceRunTerminal,
} from './types.ts'

/** Payload that binds one session to the Science mode contract. */
export interface ScienceModeBoundEvent {
  readonly version: 1
  readonly mode: ScienceModeRef
}

/** Payload that records one whole-value environment revision. */
export interface ScienceEnvironmentBoundEvent {
  readonly version: 1
  readonly environment: ScienceEnvironmentBinding
}

/** Payload that records one whole-value run start. */
export interface ScienceRunStartedEvent {
  readonly version: 1
  readonly run: ScienceRunStarted
}

/** Payload that records one whole-value run terminal state. */
export interface ScienceRunFinishedEvent {
  readonly version: 1
  readonly run: ScienceRunTerminal
}

/** Payload that records one immutable artifact version. */
export interface ScienceArtifactSavedEvent {
  readonly version: 1
  readonly artifact: ScienceArtifactVersion
}

/** Payload adding one user-only note to a logical artifact. */
export interface ScienceArtifactNoteAddedEvent {
  readonly version: 1
  readonly artifactId: ScienceArtifactId
  readonly artifactVersion: number
  readonly text: string
  readonly createdAt: number
}

/** Payload removing one prior user-only artifact note. */
export interface ScienceArtifactNoteRemovedEvent {
  readonly version: 1
  readonly artifactId: ScienceArtifactId
  readonly noteSeq: number
  readonly removedAt: number
}

/** Payload that publishes one whole-value outcome revision. */
export interface ScienceOutcomePublishedEvent {
  readonly version: 1
  readonly outcome: ScienceOutcomePublication
}

/** Payload that records one whole-value persistent kernel lifecycle transition. */
export interface ScienceKernelStateEvent {
  readonly version: 1
  readonly kernel: ScienceKernelState
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Binds this session once to the durable Science mode contract. */
    'science/mode-bound': ScienceModeBoundEvent
    /** Records one validated whole-value Science environment revision. */
    'science/environment-bound': ScienceEnvironmentBoundEvent
    /** Records one whole-value Science run start. */
    'science/run-started': ScienceRunStartedEvent
    /** Records one whole-value Science run terminal state. */
    'science/run-finished': ScienceRunFinishedEvent
    /** Records one immutable Science artifact attachment version. */
    'science/artifact-saved': ScienceArtifactSavedEvent
    /**
     * Adds a user-only note to one logical artifact.
     * @param artifactId - Logical artifact that owns the note.
     * @param artifactVersion - Version visible when the note was added.
     * @param text - Plain user-authored note text.
     * @param createdAt - Epoch milliseconds when the user added the note.
     */
    'science/artifact-note-added': ScienceArtifactNoteAddedEvent
    /**
     * Removes one prior user-only artifact note.
     * @param artifactId - Logical artifact that owns the note.
     * @param noteSeq - Sequence of the note-add event being removed.
     * @param removedAt - Epoch milliseconds when the user removed the note.
     */
    'science/artifact-note-removed': ScienceArtifactNoteRemovedEvent
    /** Publishes one whole-value Science outcome revision. */
    'science/outcome-published': ScienceOutcomePublishedEvent
    /** Records one whole-value persistent Science kernel lifecycle transition. */
    'science/kernel-state': ScienceKernelStateEvent
  }

  interface IgnorableSessionEventMap {
    /** User-only artifact-note addition; absent notes do not affect an agent run. */
    'science/artifact-note-added': true
    /** User-only artifact-note removal; absent notes do not affect an agent run. */
    'science/artifact-note-removed': true
  }
}

// This package owns the sole `ctx.sessionAttachments.register()` call for
// `science/artifact-saved` (see `./index.ts`); the merge widens that generic
// registry's typed key set to include it, alongside the `SessionEventMap`
// merge above for the same event.
declare module '@deepseek-ai/dsh-session-attachment-index/types' {
  interface SessionAttachmentExtractorMap {
    'science/artifact-saved': true
  }
}

/** The seven required Science event types owned by this package. */
export type ScienceDomainEventType =
  | 'science/mode-bound'
  | 'science/environment-bound'
  | 'science/run-started'
  | 'science/run-finished'
  | 'science/artifact-saved'
  | 'science/outcome-published'
  | 'science/kernel-state'
