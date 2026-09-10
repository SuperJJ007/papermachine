/** Public Sidebar navigation controls and reactive artifact titles. */
import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconFolderOpenOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './sidebar-entries.module.css'
import type { ScienceDetailsInjected } from './ScienceDetailsView.tsx'
import type { ScienceLibraryArtifact } from './library-artifact.ts'

/** Session-header entry opens the project library page. */
export function ScienceLibraryAction({ openLibrary, t }: PropsRuntime<'conversation.session.header.utilities'> & PropsLocale<'science'> & { openLibrary: () => void }) {
  return <button type="button" className={css.entry} aria-label={t('library.home')} onClick={openLibrary}>{t('library.home')}</button>
}

/** A stable resource address gets its live title from the session or selected library facts. */
export function ScienceArtifactTitle({ useTabInfo, useProjection, loadLibrary }: PropsRuntime<'sidebar.right.pane.tab.title'> & Pick<ScienceDetailsInjected, 'loadLibrary'>) {
  const { tab } = useTabInfo()
  const id = decodeURIComponent(new URL(tab.contentId).pathname.slice(1))
  const science = useProjection('science')
  const [item, setItem] = useState<ScienceLibraryArtifact>()
  useEffect(() => {
    let cancelled = false
    void loadLibrary().then((result) => {
      if (!cancelled && result.ok) setItem(result.value.artifacts.find(value => value.artifactId === id))
    })
    return () => { cancelled = true }
  }, [id, loadLibrary])
  const artifact = science?.artifacts.find(artifact => artifact.artifactId === id)
  return <span>{item?.title ?? artifact?.title ?? item?.logicalName ?? id}</span>
}

/** Content action contributed to the native tab menu. */
export function ScienceArtifactMenu({ tab, dismiss, openLibrary, t }: PropsRuntime<'sidebar.right.tab.menu.item'> & PropsLocale<'science'> & { openLibrary: () => void }) {
  if (tab.kind !== 'science-artifact') return null
  return <button type="button" className={css.entry} role="menuitem" onClick={() => { openLibrary(); dismiss() }}>{t('library.home')}</button>
}

/** Keep the project library reachable before the first message in a blank session. */
export function ScienceLibraryFooter({ useSessions, openLibrary, t, wide }: PropsRuntime<'sidebar.footer.action'> & PropsLocale<'science'> & {
  openLibrary: (sessionId: import('@deepseek-ai/dsh-session').SessionId) => void
  wide?: boolean
}) {
  const current = useSessions(state => state.current)
  if (current === undefined) return null
  return <button type="button" className={`${css.entry} ${css.footer}`} aria-label={t('library.home')} onClick={() => { openLibrary(current) }}><IconFolderOpenOutline16 />{wide && t('library.home')}</button>
}

/** Home marker for the Science library inside the native document strip. */
export function ScienceLibraryTitle({ t }: PropsLocale<'science'>) {
  return <span className={css.home} aria-label={t('library.home')} title={t('library.home')}>⌂</span>
}
