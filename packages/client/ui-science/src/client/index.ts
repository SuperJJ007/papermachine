/** Science browser entry; P4 owns sidebar and controller integration. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { ScienceKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Science presentation vocabulary. */
    science: ScienceKey
  }
}

/** No services are requested by the P1 placeholder. */
export const inject: readonly string[] = []

/**
 * Refuse Science browser activation until P4 implements the public sidebar integration.
 * @param _ctx - Browser plugin context.
 * @throws Always; the Science profile must keep this plugin disabled during P1.
 */
export function apply(_ctx: Context): void {
  // FIXME(replant): P4 replaces this entry with public sidebar and Session Controller integration.
  throw new Error('Science browser migration is pending (P4)')
}
