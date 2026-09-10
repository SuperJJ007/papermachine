/** Framework-owned composer target subscription. */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ScienceEditSelection } from '@deepseek-ai/dsh-tool-science/types'
import { ScienceComposerChips } from './ScienceComposerChips.tsx'

/** Session-local target source and removal command. */
export interface ScienceComposerDockInjected {
  hooks: { targets: ObservableSnapshot<readonly ScienceEditSelection[]> }
  remove: (index: number) => void
}

/** Show staged edits through the public input dock. */
export function ScienceComposerDock(props: PropsRuntime<'conversation.input.dock'> & PropsLocale<'science'> & InjectFace<ScienceComposerDockInjected>) {
  const science = props.useProjection('science')
  const targets = props.useTargets(value => value)
  return <ScienceComposerChips selections={targets} artifacts={science?.artifacts ?? []} remove={props.remove} t={props.t} />
}
