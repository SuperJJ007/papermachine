/**
 * Science transcript rows, browser half: registers the `science` locale
 * dictionaries and the two dedicated keyed toolview rows — `save_chart` and
 * `publish_outcome`. Both rows are pure functions of the frozen call/result
 * slice, the loaded durable image bytes, and (for the Outcome row) the live
 * `science` session projection; neither owns a store or a byte cache of its
 * own.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: resolves ctx.locale and ctx.slots on ClientContext.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: brings the `science` SessionProjectionMap merge into this program.
import type {} from '@deepseek-ai/dsh-science-session/types'
import { ScienceChartRow } from './ScienceChartRow.tsx'
import { ScienceOutcomeRow } from './ScienceOutcomeRow.tsx'
import { en, NS, zh, type ScienceKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The dedicated chart and Outcome rows' copy. */
    science: ScienceKey
  }
}

/** Required services: the locale and tool-toolview registries. */
export const inject = ['locale', 'slots']

/**
 * Client plugin body: register dictionaries and the two keyed toolview rows.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-science: dictionaries')
  ctx.slots.inject('tool.call.toolview', function* () {
    yield ctx.slots.register({ name: 'tool.call.toolview', key: 'save_chart', locale: NS }, ScienceChartRow)
    yield ctx.slots.register({ name: 'tool.call.toolview', key: 'publish_outcome', locale: NS }, ScienceOutcomeRow)
  })
}
