/** Open artifact and project-file tabs in the Details header's second row. */
import { IconCloseFill14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ScienceDisplayTitleFact } from './artifact-display-title.ts'
import { scienceArtifactDisplayTitle } from './artifact-display-title.ts'
import { scienceTabId } from './selection-store.ts'
import type { ScienceOpenTab, ScienceSelectionStore } from './selection-store.ts'
import css from './ScienceDetailsTabs.module.css'

type Props = PropsRuntime<'conversation.details.header.tabs'> & PropsLocale<'science'> & PropsStore<ScienceSelectionStore>

function TabStrip({ tabs, artifacts, activeTabId, onActivate, onClose, t }: {
  tabs: readonly ScienceOpenTab[]
  artifacts: readonly ScienceDisplayTitleFact[]
  activeTabId: string | null
  onActivate: (tabId: string) => void
  onClose: (tabId: string) => void
  t: TranslateNS<'science'>
}) {
  return (
    <div className={css.tabStrip} role="tablist" aria-label={t('toolbar.openArtifacts')}>
      {tabs.map((tab) => {
        // C1: the tab label is the artifact's latest known title, not the
        // exact open version's own title, so it stays fixed while the
        // toolbar's version stepper walks the tab between versions.
        const label = tab.kind === 'artifact'
          ? scienceArtifactDisplayTitle(artifacts, tab.artifactId) ?? tab.artifactId
          : tab.path.split('/').at(-1) || tab.path
        const id = scienceTabId(tab)
        const active = id === activeTabId
        return (
          <div key={id} className={active ? `${css.tab} dsh-header-tab dsh-header-tab-active` : `${css.tab} dsh-header-tab`}>
            <button type="button" role="tab" aria-selected={active} className={css.tabButton} onClick={() => { onActivate(id) }}>
              {label}
            </button>
            <button
              type="button" className={css.tabClose} aria-label={t('toolbar.closeNamedTab', { title: label })}
              onClick={() => { onClose(id) }}
            >
              <IconCloseFill14 size={10} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Render the shared open-document selection from session and library metadata.
 * @param props - Framework projection and selection-store seats.
 * @returns The open tab strip, or nothing while no tabs are open.
 */
export function ScienceDetailsTabs({ useProjection, useStore, actions, t }: Props) {
  const science = useProjection('science')
  const tabs = useStore(state => state.openArtifacts)
  const activeTabId = useStore(state => state.activeTabId)
  const libraryTabs = useStore(state => state.libraryTabs)
  const artifacts = [...(science?.artifacts ?? []), ...Object.values(libraryTabs).map(item => ({
    artifactId: item.artifactId, logicalName: item.logicalName, title: item.title ?? item.logicalName,
    version: item.latest.ordinal,
  }))]
  if (tabs.length === 0) return null
  return <TabStrip tabs={tabs} artifacts={artifacts} activeTabId={activeTabId}
    onActivate={actions.activateTab} onClose={actions.closeTab} t={t} />
}
