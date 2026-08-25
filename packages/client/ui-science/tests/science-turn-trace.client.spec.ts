/** Turn-local Science output facts: match/start/update/buildLocationData and the turn-tail selector. */

import { describe, expect, it } from 'vitest'
import type {
  ConversationMatch, ConversationNodeContext, TurnLocation,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { scienceTurnTraceDefinition, selectScienceTurnTrace } from '../src/client/science-turn-trace.ts'
import type { ScienceTurnTraceData } from '../src/client/science-turn-trace.ts'

function match(event: unknown): ConversationMatch {
  return { event, view: undefined, role: 'update', location: { kind: 'session' } } as unknown as ConversationMatch
}

function context(state: ScienceTurnTraceData & { turn: number }): ConversationNodeContext<typeof state> & { state: typeof state } {
  return { key: 'k', kind: 'science-turn-trace', id: '1', matches: [], start: undefined, current: new Map(), state } as unknown as
    ConversationNodeContext<typeof state> & { state: typeof state }
}

describe('scienceTurnTraceDefinition.match', () => {
  it('claims turn/start as the Context start', () => {
    expect(scienceTurnTraceDefinition.match({ type: 'turn/start', data: { turn: 3 } } as never))
      .toEqual({ id: '3', role: 'start' })
  })

  it('claims a run_python or run_r tool/call as an update, but not annotate_artifact', () => {
    expect(scienceTurnTraceDefinition.match(
      { type: 'tool/call', data: { turn: 2, callId: 'c1', name: 'run_python' } } as never,
    )).toEqual({ id: '2', role: 'update' })
    expect(scienceTurnTraceDefinition.match(
      { type: 'tool/call', data: { turn: 2, callId: 'c2', name: 'run_r' } } as never,
    )).toEqual({ id: '2', role: 'update' })
    expect(scienceTurnTraceDefinition.match(
      { type: 'tool/call', data: { turn: 2, callId: 'c3', name: 'annotate_artifact' } } as never,
    )).toBeNull()
  })

  it('claims only an append-origin tool/result as an update', () => {
    expect(scienceTurnTraceDefinition.match(
      { type: 'tool/result', surfaceOp: 'append', data: { turn: 4, meta: undefined } } as never,
    )).toEqual({ id: '4', role: 'update' })
    expect(scienceTurnTraceDefinition.match(
      { type: 'tool/result', surfaceOp: 'replace', data: { turn: 4 } } as never,
    )).toBeNull()
  })

  it('ignores every other event type', () => {
    expect(scienceTurnTraceDefinition.match({ type: 'user/message', data: {} } as never)).toBeNull()
  })
})

describe('scienceTurnTraceDefinition.start', () => {
  it('adopts the starting turn with empty calls and artifacts', () => {
    const state = scienceTurnTraceDefinition.start(
      context({ turn: 0, calls: [], artifacts: [] }),
      match({ type: 'turn/start', data: { turn: 5 } }),
      undefined as never,
    )
    expect(state).toEqual({ turn: 5, calls: [], artifacts: [] })
  })

  it('throws when started from a non-turn/start match', () => {
    expect(() => scienceTurnTraceDefinition.start(
      context({ turn: 0, calls: [], artifacts: [] }),
      match({ type: 'tool/call', data: { turn: 5 } }),
      undefined as never,
    )).toThrow('science-turn-trace start requires turn/start')
  })
})

const ARTIFACT = {
  artifactId: 'artifact-1', logicalName: 'plot.png', version: 1, title: 'Plot',
  attachment: { attachmentId: 'sha256:a', mediaType: 'image/png', bytes: 10, width: 2, height: 2 },
}

describe('scienceTurnTraceDefinition.update', () => {
  it('appends a matched tool/call to calls', () => {
    const state = scienceTurnTraceDefinition.update(
      context({ turn: 1, calls: [], artifacts: [] }),
      match({ type: 'tool/call', data: { turn: 1, callId: 'c1', name: 'run_python' } }),
    )
    expect(state.calls).toEqual([{ callId: 'c1', name: 'run_python' }])
  })

  it('leaves state unchanged for an event that is neither tool/call nor tool/result', () => {
    const current = { turn: 1, calls: [], artifacts: [] }
    const state = scienceTurnTraceDefinition.update(context(current), match({ type: 'turn/start', data: { turn: 1 } }))
    expect(state).toBe(current)
  })

  it('leaves state unchanged for a tool/result whose meta is not a Science artifact presentation', () => {
    const current = { turn: 1, calls: [], artifacts: [] }
    for (const meta of [undefined, 'not-an-object', null, ['array'], { kind: 'other' },
      { kind: 'science/artifact', version: 2, artifacts: [] }, { kind: 'science/artifact', version: 1, artifacts: 'nope' },
      { kind: 'science/artifact', version: 1, artifacts: [] }]) {
      const state = scienceTurnTraceDefinition.update(
        context(current), match({ type: 'tool/result', data: { turn: 1, meta } }),
      )
      expect(state).toBe(current)
    }
  })

  it('adds a new artifact version and replaces an already-recorded one at the same identity', () => {
    const afterAdd = scienceTurnTraceDefinition.update(
      context({ turn: 1, calls: [], artifacts: [] }),
      match({ type: 'tool/result', data: { turn: 1, meta: { kind: 'science/artifact', version: 1, artifacts: [ARTIFACT] } } }),
    )
    expect(afterAdd.artifacts).toEqual([ARTIFACT])

    const curated = { ...ARTIFACT, title: 'Curated plot' }
    const afterReplace = scienceTurnTraceDefinition.update(
      context(afterAdd),
      match({ type: 'tool/result', data: { turn: 1, meta: { kind: 'science/artifact', version: 1, artifacts: [curated] } } }),
    )
    expect(afterReplace.artifacts).toEqual([curated])
  })
})

describe('scienceTurnTraceDefinition.buildLocationData', () => {
  it('publishes only at turn scope with defined state', () => {
    const state = { turn: 7, calls: [], artifacts: [ARTIFACT] }
    expect(scienceTurnTraceDefinition.buildLocationData?.(context(state), 'step')).toBeNull()
    expect(scienceTurnTraceDefinition.buildLocationData?.(
      { ...context(state), state: undefined } as unknown as ConversationNodeContext<typeof state>, 'turn',
    )).toBeNull()
    expect(scienceTurnTraceDefinition.buildLocationData?.(context(state), 'turn')).toEqual({
      kind: 'turn', turn: 7, key: 'science-turn-trace', value: { calls: [], artifacts: [ARTIFACT] },
    })
  })
})

function owner(data: ScienceTurnTraceData | undefined): TurnTailOwnerProps {
  return {
    turn: { data: { get: () => data } } as unknown as TurnLocation,
    seq: 1, openFile: () => {},
  } as unknown as TurnTailOwnerProps
}

describe('selectScienceTurnTrace', () => {
  it('returns null when the turn published no science-turn-trace data', () => {
    expect(selectScienceTurnTrace(owner(undefined))).toBeNull()
  })

  it('returns null when the turn produced no artifacts', () => {
    expect(selectScienceTurnTrace(owner({ calls: [], artifacts: [] }))).toBeNull()
  })

  it('returns the data when the turn produced at least one artifact', () => {
    const data: ScienceTurnTraceData = { calls: [], artifacts: [ARTIFACT] }
    expect(selectScienceTurnTrace(owner(data))).toBe(data)
  })
})
