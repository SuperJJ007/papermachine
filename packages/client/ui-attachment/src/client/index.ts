/** Browser attachment plugin: fills conversation's composer and message-image slots. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ComposerAttachments } from './ComposerAttachments.tsx'
import { MessageImages } from './MessageImages.tsx'

export { MessageImage, ImageGallery } from '../MessageImage.tsx'
export type { ImageLoader, MessageImageLabels } from '../MessageImage.tsx'
export { ImageLightbox } from '../ImageLightbox.tsx'
export type { ImageLightboxLabels } from '../ImageLightbox.tsx'

/** Slot registry required by this presentation plugin. */
export const inject = ['slots']

/**
 * Register attachment presentation; `apply` itself needs no exported
 * component values, but this module also re-exports the presentational
 * atoms (`MessageImage`, `ImageGallery`, `ImageLightbox`) for a domain
 * package rendering images outside the chat message flow this plugin fills.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.input.attachments', () => ctx.slots.register({
    name: 'conversation.input.attachments',
    locale: 'conversation',
  }, ComposerAttachments))
  ctx.slots.inject('conversation.message.images', () => ctx.slots.register({
    name: 'conversation.message.images',
    locale: 'conversation',
  }, MessageImages))
}
