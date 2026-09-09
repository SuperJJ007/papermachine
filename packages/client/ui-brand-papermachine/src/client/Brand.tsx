import { FishLogo } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import css from './BrandName.module.css'

type PaperMachineBrandMarkProps = HeroBrandMarkOwnerProps & SidebarBrandMarkOwnerProps

/**
 * Render the PaperMachine mark with the presentation requested by its host
 * surface. The mark artwork is undesigned: it reuses `FishLogo` verbatim
 * until PaperMachine has its own.
 * @param props - Host-supplied mark presentation.
 * @returns the mark (currently the shared whale fallback artwork).
 */
export function PaperMachineBrandMark({ size, className }: PaperMachineBrandMarkProps) {
  return <FishLogo size={size} className={className} />
}

/**
 * Render the PaperMachine wordmark: the text "PaperMachine" as one word in
 * two weights ("Paper" 500, "Machine" 700, one ink color) rather than
 * artwork, so it needs no bundled font — the desktop app runs offline and
 * renders through the host OS font stack. Its box matches the 24px-tall
 * default-size box the official svg wordmark occupies in the same slot, so
 * swapping brand plugins moves nothing else in the sidebar brand row.
 * @returns the wordmark element.
 */
export function PaperMachineBrandName() {
  return (
    <span className={css.wordmark}>
      <span className={css.paper}>Paper</span>
      <span className={css.machine}>Machine</span>
    </span>
  )
}
