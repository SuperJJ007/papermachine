/** Turn-local Science output facts published to the chat turn-tail chain. */

import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-runtime/client'
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-client-runtime/client'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ScienceArtifactPresentation } from '@deepseek-ai/dsh-tool-science/types'

interface ScienceTurnCall {
  readonly callId: string
  readonly name: string
}

/** Science calls and produced artifact references owned by one conversation turn. */
export interface ScienceTurnTraceData {
  readonly calls: readonly ScienceTurnCall[]
  readonly artifacts: ScienceArtifactPresentation['artifacts']
}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  interface ConversationTurnDataMap {
    /** Science execution and produced-artifact facts accumulated in this Turn. */
    'science-turn-trace': ScienceTurnTraceData
  }
}

interface ScienceTurnState extends ScienceTurnTraceData {
  readonly turn: number
}

function artifactPresentation(value: unknown): ScienceArtifactPresentation | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (record['kind'] !== 'science/artifact' || record['version'] !== 1 || !Array.isArray(record['artifacts'])) return undefined
  return value as unknown as ScienceArtifactPresentation
}

/** Conversation Definition accumulating Science calls and artifact receipts by authoritative Turn. */
export const scienceTurnTraceDefinition: ConversationNodeDefinition<ScienceTurnState> = {
  kind: 'science-turn-trace',
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    // annotate_artifact is deliberately excluded: it never renders a call
    // button (the card's links row only surfaces run_python/run_r calls), so
    // matching it would only pad `calls` with an entry nothing displays.
    if (event.type === 'tool/call' && (event.data.name === 'run_python' || event.data.name === 'run_r')) {
      return { id: String(event.data.turn), role: 'update' }
    }
    if (event.type === 'tool/result' && isAppendSurfaceEvent(event)) {
      return { id: String(event.data.turn), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('science-turn-trace start requires turn/start')
    return { turn: match.event.data.turn, calls: [], artifacts: [] }
  },
  update: (context, match) => {
    if (match.event.type === 'tool/call') {
      return { ...context.state, calls: [...context.state.calls, {
        callId: String(match.event.data.callId), name: match.event.data.name,
      }] }
    }
    if (match.event.type !== 'tool/result') return context.state
    const presentation = artifactPresentation(match.event.data.meta)
    if (presentation === undefined || presentation.artifacts.length === 0) return context.state
    const artifacts = [...context.state.artifacts]
    for (const artifact of presentation.artifacts) {
      const index = artifacts.findIndex(candidate => candidate.artifactId === artifact.artifactId
        && candidate.version === artifact.version)
      if (index === -1) artifacts.push(artifact)
      else artifacts[index] = artifact
    }
    return { ...context.state, artifacts }
  },
  buildLocationData: (context, scope) => scope !== 'turn' || context.state === undefined
    ? null
    : { kind: 'turn', turn: context.state.turn, key: 'science-turn-trace', value: {
      calls: context.state.calls, artifacts: context.state.artifacts,
    } },
}

/**
 * Claim the chain only for a completed turn that produced Science artifacts.
 * @param owner - Completed turn and its published location data.
 * @returns The turn-local Science facts, or null when the turn produced no artifact.
 */
export function selectScienceTurnTrace(owner: TurnTailOwnerProps): ScienceTurnTraceData | null {
  const data = owner.turn.data.get('science-turn-trace')
  return data !== undefined && data.artifacts.length > 0 ? data : null
}
