/** Durable viewer edits use the standard Chat user row with their recorded instruction. */
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import type {} from '@deepseek-ai/dsh-science-session/types'
import { scienceTargetDescriptor } from './ScienceComposerChips.tsx'

/**
 * Own Science edit presentation without exposing model-facing execution context.
 * @param t - Science translator.
 * @returns Event definition for recorded viewer edits.
 */
export function scienceEditMessageDefinition(t: TranslateNS<'science'>): ConversationNodeDefinition<ChatNode<'user'>['data']> {
  return {
    kind: 'science-edit-message', target: 'chat', userSourceKind: 'science-edit',
    match: event => event.type === 'user/message' && isAppendSurfaceEvent(event) && event.data.source.kind === 'science-edit'
      ? { id: String(event.data.id), role: 'start' } : null,
    start: (_context, match) => {
      if (match.event.type !== 'user/message' || match.event.data.source.kind !== 'science-edit') {
        throw new Error('Science input requires a science-edit source')
      }
      const event = match.event
      const source = match.event.data.source
      return {
        kind: 'user', seq: event.seq, time: event.time, source,
        content: [{ type: 'text', text: source.instruction }, ...event.data.content.filter(block => block.type === 'image')],
        referenceLabels: source.targets.map(selection => t('display.editTarget', {
          name: selection.logicalName, version: selection.version,
          target: scienceTargetDescriptor(selection.target, t),
          comment: selection.comment === undefined ? '' : `: ${selection.comment}`,
        })),
      }
    },
    update: context => context.state,
    buildViewNode: context => context.state === undefined ? null : {
      key: context.key, id: context.id, kind: 'user', target: 'chat', anchorSeq: context.state.seq,
      location: context.start?.location ?? { kind: 'unresolved' }, visibility: 'visible', data: context.state,
    } satisfies ChatNode<'user'>,
  }
}
