/** PaperMachine desktop occupants for the generic browser-brand slots. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { PaperMachineBrandMark, PaperMachineBrandName } from './Brand.tsx'

/** Required service: the UI slot registry. */
export const inject = ['slots']

/**
 * Fill every shipped brand slot as one declaration-aware registration set,
 * and provide the `clientBrand` product name the document-title projection
 * (`ui-renderer`) reads.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', () =>
      ctx.slots.inject('conversation.hero.brand.mark', function* () {
        yield ctx.slots.register({ name: 'sidebar.brand.mark' }, PaperMachineBrandMark)
        yield ctx.slots.register({ name: 'sidebar.brand.name' }, PaperMachineBrandName)
        yield ctx.slots.register({ name: 'conversation.hero.brand.mark' }, PaperMachineBrandMark)
      })))
  ctx.provide('clientBrand', { productName: 'PaperMachine' })
}
