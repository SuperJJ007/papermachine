/** Private plain-JSON state retained by the Science projection registry. */

import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { ScienceFoldState } from './fold-state.ts'

/** Redacted Session event retained to verify a persisted checkpoint. */
export interface ScienceProjectionWitnessEvent {
  readonly seq: number
  readonly time: number
  readonly type: string
  readonly data: JsonValue
}

/** JSON form of strict replay state; optional fields use explicit `null`. */
export interface ScienceProjectionFoldJson {
  readonly mode: ScienceFoldState['mode'] | null
  readonly modeBoundSeq: number | null
  readonly preModeStepStarted: boolean
  readonly environments: ScienceFoldState['environments']
  readonly runs: ScienceFoldState['runs']
  readonly charts: ScienceFoldState['charts']
  readonly outcomes: ScienceFoldState['outcomes']
  readonly requestHeaders: ScienceFoldState['requestHeaders']
  readonly toolCalls: ScienceFoldState['toolCalls']
  readonly settledToolCallSeqs: readonly number[]
  readonly consumedToolCallSeqs: readonly number[]
  readonly messageFacts: ScienceFoldState['messageFacts']
  readonly runFacts: readonly {
    readonly runId: string
    readonly startedSeq: number
    readonly startedEventTime: number
    readonly terminalSeq: number | null
    readonly terminalEventTime: number | null
  }[]
  readonly chartFacts: ScienceFoldState['chartFacts']
  readonly lastScienceTime: number | null
  readonly lastScienceEventSeq: number | null
}

/** Internal checkpoint state; public readers receive a derived value only. */
export interface ScienceProjectionState {
  /** Last committed Session event observed by this projection, or -1 for an empty log. */
  readonly observedSeq: number
  readonly fold: ScienceProjectionFoldJson
  readonly witness: readonly ScienceProjectionWitnessEvent[]
}
