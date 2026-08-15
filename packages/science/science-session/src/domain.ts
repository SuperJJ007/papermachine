/** Durable Science event payloads and Session event declaration merging. */

import type {
  ScienceChartVersion,
  ScienceEnvironmentBinding,
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

/** Payload that records one immutable chart version. */
export interface ScienceChartSavedEvent {
  readonly version: 1
  readonly chart: ScienceChartVersion
}

/** Payload that publishes one whole-value outcome revision. */
export interface ScienceOutcomePublishedEvent {
  readonly version: 1
  readonly outcome: ScienceOutcomePublication
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
    /** Records one immutable Science chart attachment version. */
    'science/chart-saved': ScienceChartSavedEvent
    /** Publishes one whole-value Science outcome revision. */
    'science/outcome-published': ScienceOutcomePublishedEvent
  }
}

/** The six required Science event types owned by this package. */
export type ScienceDomainEventType =
  | 'science/mode-bound'
  | 'science/environment-bound'
  | 'science/run-started'
  | 'science/run-finished'
  | 'science/chart-saved'
  | 'science/outcome-published'
