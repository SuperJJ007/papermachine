import { memo, useMemo } from 'react'
import type { AssistantBlock } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNodeViewProps, TurnTailOwnerProps } from '../contract/slots.ts'
import { AssistantMarkdown } from './AssistantMarkdown.tsx'

/** Streaming, settled, and interrupted Assistant states share one keyed renderer instance. */
export const AssistantNodeView = memo(function AssistantNodeView({
  node, useTurnData, openFile, renderMessageImages, fileMentions, attachedReasoning, t,
}: ChatNodeViewProps<'assistant-step'>) {
  const data = node.data
  const turn = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn
    : undefined
  const tail = useTurnData('turn-tail')
  const owner = useMemo<TurnTailOwnerProps | undefined>(() => {
    if (turn?.status !== 'closed' || data.finalNode === undefined) return undefined
    if (tail?.closing?.finalNode.seq !== data.finalNode.seq) return undefined
    return { turn, seq: data.finalNode.seq, openFile }
  }, [data.finalNode, openFile, tail, turn])
  const mentions = useMemo(
    () => owner === undefined ? undefined : fileMentions(owner),
    [fileMentions, owner],
  )
  // Reasoning folded from one or more preceding pure-reasoning steps
  // (`reasoning-attach.ts`) renders through this same Node's own leading
  // `reasoning` blocks — the identical Think summary row `AssistantMarkdown`
  // already draws for a step's own in-line reasoning, so a cross-step fold
  // introduces no new presentation.
  const blocks = useMemo<readonly AssistantBlock[]>(
    () => attachedReasoning === undefined || attachedReasoning.length === 0
      ? data.blocks
      : [...attachedReasoning.map((text): AssistantBlock => ({ kind: 'reasoning', text })), ...data.blocks],
    [attachedReasoning, data.blocks],
  )
  return (
    <AssistantMarkdown
      blocks={blocks}
      streaming={data.status === 'running'}
      interrupted={data.status === 'interrupted'}
      renderMessageImages={renderMessageImages}
      mentions={mentions}
      t={t}
    />
  )
})
