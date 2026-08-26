/** Turn-local Science artifact facts published to the chat tail. */

import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-runtime/client'
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-client-runtime/client'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ScienceArtifactPresentation, ScienceArtifactPresentationItem } from '@deepseek-ai/dsh-tool-science/types'

/** Latest artifact versions produced by one conversation Turn. */
export interface ScienceTurnArtifactsData {
  readonly artifacts: ScienceArtifactPresentation['artifacts']
}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  interface ConversationTurnDataMap {
    /** Science artifacts accumulated within one authoritative Turn. */
    'science-turn-artifacts': ScienceTurnArtifactsData
  }
}

interface ScienceTurnArtifactsState extends ScienceTurnArtifactsData { readonly turn: number }

function isItem(value: unknown): value is ScienceArtifactPresentationItem {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  if (typeof item.artifactId !== 'string' || typeof item.logicalName !== 'string') return false
  if (typeof item.version !== 'number' || typeof item.title !== 'string') return false
  const content = item.content
  if (typeof content !== 'object' || content === null) return false
  const fields = content as Record<string, unknown>
  return typeof fields.versionId === 'string' && typeof fields.mediaType === 'string'
    && typeof fields.byteCount === 'number'
}

function presentation(value: unknown): ScienceArtifactPresentation | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (record.kind !== 'science/artifact' || record.version !== 2 || !Array.isArray(record.artifacts)) return undefined
  if (!record.artifacts.every(isItem)) return undefined
  return value as ScienceArtifactPresentation
}

/** Definition accumulating tool-result artifact receipts by authoritative Turn. */
export const scienceTurnArtifactsDefinition: ConversationNodeDefinition<ScienceTurnArtifactsState> = {
  kind: 'science-turn-artifacts',
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'tool/result' && isAppendSurfaceEvent(event)) {
      return { id: String(event.data.turn), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('science-turn-artifacts start requires turn/start')
    return { turn: match.event.data.turn, artifacts: [] }
  },
  update: (context, match) => {
    if (match.event.type !== 'tool/result') return context.state
    const receipt = presentation(match.event.data.meta)
    if (receipt === undefined) return context.state
    const artifacts = [...context.state.artifacts]
    for (const artifact of receipt.artifacts) {
      const index = artifacts.findIndex(candidate => candidate.artifactId === artifact.artifactId)
      if (index === -1) { artifacts.push(artifact); continue }
      const existing = artifacts[index]
      /* v8 ignore next -- dense-array guard: index is bounded by artifacts.length after findIndex found a match. */
      if (existing === undefined) continue
      if (existing.version <= artifact.version) artifacts[index] = artifact
    }
    return { ...context.state, artifacts }
  },
  buildLocationData: (context, scope) => scope !== 'turn' || context.state === undefined
    ? null
    : { kind: 'turn', turn: context.state.turn, key: 'science-turn-artifacts', value: {
      artifacts: context.state.artifacts,
    } },
}

/**
 * Claim the Turn-tail chain only when the completed Turn produced artifacts.
 * @param owner Completed Turn and its projected conversation data.
 * @returns Artifact data for the Turn or null when it produced none.
 */
export function selectScienceTurnArtifacts(owner: TurnTailOwnerProps): ScienceTurnArtifactsData | null {
  const data = owner.turn.data.get('science-turn-artifacts')
  return data !== undefined && data.artifacts.length > 0 ? data : null
}
