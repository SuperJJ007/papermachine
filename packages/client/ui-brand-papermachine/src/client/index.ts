/** PaperMachine desktop occupants for the generic browser-brand slots. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { en, zh, type BrandKey } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { PaperMachineBrandMark, PaperMachineBrandName } from './Brand.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** PaperMachine wordmark copy. */
    'brand.papermachine': BrandKey
  }
}

/** Required services: the UI slot and locale registries. */
export const inject = ['slots', 'locale']

/**
 * Fill the PaperMachine sidebar and hero brand slots.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  if (process.env.DSH_CLIENT_BUILD_PROFILE !== 'papermachine') return
  ctx.effect(() => ctx.locale.register('brand.papermachine', { zh, en }))
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', () =>
      ctx.slots.inject('conversation.hero.brand.mark', function* () {
        yield ctx.slots.register({ name: 'sidebar.brand.mark' }, PaperMachineBrandMark)
        yield ctx.slots.register({ name: 'sidebar.brand.name', locale: 'brand.papermachine' }, PaperMachineBrandName)
        yield ctx.slots.register({ name: 'conversation.hero.brand.mark' }, PaperMachineBrandMark)
      })))
}
