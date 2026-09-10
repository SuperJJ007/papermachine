/** Project-wide artifact library hosted by the public Sidebar guide. */
import { useEffect, useState } from 'react'
import type { RemoteError } from '@deepseek-ai/dsh-api-remotes/client'
import { IconChevronDownOutline14, IconChevronRightOutline14, relativeTime } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ScienceArtifactId } from '@deepseek-ai/dsh-science-session/types'
import type { ScienceLibraryArtifact, ScienceLibraryHealth } from './library-artifact.ts'
import type { ScienceDetailsInjected } from './ScienceDetailsView.tsx'
import type { ScienceImageLoader } from './science-attachment-loader.ts'
import type { ScienceSelectionStore } from './selection-store.ts'
import { ScienceArtifactImage } from './ScienceArtifactImage.tsx'
import { ArtifactFileTile } from './ArtifactFileTile.tsx'
import { artifactImageLabels } from './ArtifactContent.tsx'
import css from './ScienceDetailsView.module.css'

/** Readers injected into the guide seat. */
export interface ScienceLibraryInjected {
  loadLibrary: ScienceDetailsInjected['loadLibrary']
  loadImage: ScienceImageLoader
}
/** Framework-bound library guide props. */
export type ScienceLibraryProps = PropsRuntime<'sidebar.right.tab.guide'> & PropsLocale<'science'> & PropsStore<ScienceSelectionStore> & ScienceLibraryInjected

/** Render the project library and navigate through the owning tab's session-scoped actions. */
export function ScienceLibrary({
  sessionId, useTabInfo, useProjection, useStore, actions, loadLibrary, loadImage, t,
}: ScienceLibraryProps) {
  const { tab } = useTabInfo()
  const science = useProjection('science')
  const collapsed = useStore(state => state.libraryCollapsed)
  return <ProjectLibrary key={science?.artifacts.map(item => `${item.artifactId}:${String(item.version)}`).join('|') ?? ''}
    loadLibrary={loadLibrary} loadImage={loadImage} currentSessionId={sessionId} collapsed={collapsed}
    onToggleGroup={actions.toggleLibraryGroup} onOpenFiles={() => { tab.actions.openTab('files') }}
    onOpenArtifact={(item) => {
      actions.openTab({ artifactId: item.artifactId as ScienceArtifactId, version: item.latest.ordinal })
      tab.actions.openResource(`dsh-resource://science-artifact/${encodeURIComponent(item.artifactId)}`, { params: { version: item.latest.ordinal } })
    }} t={t} />
}

function formatRelativeTime(at: number, now: number, t: TranslateNS<'science'>): string {
  const value = relativeTime(at, now)
  return t(`relative.${value.unit}`, { n: value.n })
}

function libraryErrorText(error: RemoteError, t: TranslateNS<'science'>): string {
  return error.code === 'science-artifact-error' && 'reason' in error.details && error.details.reason === 'NO_WORKSPACE'
    ? t('library.libraryNoWorkspace') : t('library.libraryLoadFailed')
}

function ReconcileBanner({ health, artifacts, t }: {
  health: ScienceLibraryHealth
  artifacts: readonly ScienceLibraryArtifact[]
  t: TranslateNS<'science'>
}) {
  const [expanded, setExpanded] = useState(false)
  if (health.reconstructed === 0 && health.missingContent === 0) return null
  const affected = artifacts.filter(item => item.latest.health?.reconstructed === true || item.latest.health?.missingContent === true)
  return (
    <div className={css.reconcileBanner} role="status">
      {health.reconstructed > 0 && <p className={css.notice}>{t('library.reconcile.reconstructed', { count: health.reconstructed })}</p>}
      {health.missingContent > 0 && <p className={css.notice}>{t('library.reconcile.missingContent', { count: health.missingContent })}</p>}
      {affected.length > 0 && (
        <button type="button" className={css.reconcileBannerToggle} aria-expanded={expanded} onClick={() => { setExpanded(value => !value) }}>
          {expanded ? t('library.reconcile.collapse') : t('library.reconcile.expand')}
        </button>
      )}
      {expanded && (
        <ul className={css.reconcileBannerList}>
          {affected.map(item => (
            <li key={item.artifactId}>
              <span>{item.title ?? item.logicalName}</span>
              <span className={css.badge}>
                {item.latest.health?.reconstructed === true ? t('library.reconcile.itemReconstructed') : t('library.reconcile.itemMissingContent')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Project-level library home: latest artifacts plus bounded workspace browsing. */
function ProjectLibrary({
  loadLibrary, loadImage, onOpenArtifact, onOpenFiles, currentSessionId, collapsed, onToggleGroup, t,
}: {
  loadLibrary: ScienceDetailsInjected['loadLibrary']
  loadImage: ScienceImageLoader
  onOpenArtifact: (artifact: ScienceLibraryArtifact) => void
  onOpenFiles: () => void
  currentSessionId: string
  collapsed: Readonly<Record<string, true>>
  onToggleGroup: (sessionId: string) => void
  t: TranslateNS<'science'>
}) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'newest' | 'oldest' | 'name'>('newest')
  const [layout, setLayout] = useState<'grid' | 'list'>('grid')
  const [artifacts, setArtifacts] = useState<ScienceLibraryArtifact[]>([])
  const [health, setHealth] = useState<ScienceLibraryHealth>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    let live = true
    setError(undefined)
    void loadLibrary().then((result) => {
      if (!live) return
      if (result.ok) { setArtifacts(result.value.artifacts); setHealth(result.value.health) }
      else setError(libraryErrorText(result.error, t))
    })
    return () => { live = false }
  }, [loadLibrary, t])

  const now = Date.now()
  const needle = query.trim().toLocaleLowerCase()
  const visibleArtifacts = artifacts.filter(item => `${item.logicalName}\n${item.title ?? ''}`.toLocaleLowerCase().includes(needle))
  const groupsBySession = new Map<string, { title: string; latestAt: number; items: ScienceLibraryArtifact[] }>()
  for (const item of visibleArtifacts) {
    const group = groupsBySession.get(item.originSessionId)
    if (group === undefined) {
      groupsBySession.set(item.originSessionId, {
        title: item.originSessionTitle ?? t('library.unknownSession'), latestAt: item.latest.createdAt, items: [item],
      })
    } else {
      group.latestAt = Math.max(group.latestAt, item.latest.createdAt)
      group.items.push(item)
    }
  }
  const groups = [...groupsBySession].sort(([leftId, left], [rightId, right]) => {
    if (leftId === currentSessionId) return -1
    if (rightId === currentSessionId) return 1
    return right.latestAt - left.latestAt
  })
  for (const [, group] of groups) group.items.sort((a, b) => {
    if (sort === 'name') return (a.title ?? a.logicalName).localeCompare(b.title ?? b.logicalName)
    return sort === 'newest' ? b.latest.createdAt - a.latest.createdAt : a.latest.createdAt - b.latest.createdAt
  })

  return (
    <div className={css.libraryHome}>
      <div className={css.libraryToolbar}><button type="button" onClick={onOpenFiles}>{t('library.files')}</button>
        <input aria-label={t('library.search')} placeholder={t('library.search')} value={query} onChange={(event) => { setQuery(event.target.value) }} />
        <>
          <select aria-label={t('library.sort')} value={sort} onChange={(event) => { setSort(event.target.value as typeof sort) }}>
            <option value="newest">{t('library.newest')}</option><option value="oldest">{t('library.oldest')}</option><option value="name">{t('library.name')}</option>
          </select>
          <button type="button" aria-label={t('library.layout')} onClick={() => { setLayout(value => value === 'grid' ? 'list' : 'grid') }}>{layout === 'grid' ? t('library.grid') : t('library.list')}</button>
        </>
        <span>{t('library.artifactCount', { count: visibleArtifacts.length })}</span>
      </div>
      {error !== undefined && <p role="alert" className={css.notice}>{error}</p>}
      {health !== undefined && <ReconcileBanner health={health} artifacts={artifacts} t={t} />}
      <>
        {visibleArtifacts.length === 0 && <p className={css.libraryEmpty} role="status">{t('details.artifacts.empty')}</p>}
        <div className={css.libraryGroups}>{groups.map(([sessionId, group]) => {
          const title = `${group.title}${sessionId === currentSessionId ? ` · ${t('library.currentSession')}` : ''}`
          const isCollapsed = collapsed[sessionId] === true
          return <section key={sessionId} aria-label={title}>
            <h3 className={css.libraryGroupHeading}>
              <button type="button" className={css.libraryGroupToggle} aria-expanded={!isCollapsed}
                onClick={() => { onToggleGroup(sessionId) }}>
                {isCollapsed ? <IconChevronRightOutline14 /> : <IconChevronDownOutline14 />}
                <span className={css.libraryGroupTitle}>{title}</span>{' '}
                <span className={css.libraryGroupFacts}>
                  {group.items.length} · {formatRelativeTime(group.latestAt, now, t)}
                </span>
              </button>
            </h3>
            {!isCollapsed && <ul className={layout === 'grid' ? css.chartList : css.libraryList}>{group.items.map((item) => {
              const title = item.title ?? item.logicalName
              return <li key={item.artifactId} className={css.chartItem}><div role="button" tabIndex={0} aria-label={t('details.artifact.select', { title, version: item.latest.ordinal })} className={css.libraryCard} onClick={() => { onOpenArtifact(item) }} onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                onOpenArtifact(item)
              }}>
                <span className={css.libraryCardThumb}>
                  {item.latest.mediaType === 'image/png'
                    ? <ScienceArtifactImage content={item.latest} label={title} load={loadImage} variant={layout === 'grid' ? 'card' : 'tile'} labels={artifactImageLabels(t)} />
                    : <ArtifactFileTile mediaType={item.latest.mediaType} t={t} />}
                </span>
                <span className={css.chartMeta}>
                  <span className={css.chartTitle}>{title}</span>
                  <span className={css.libraryFacts}>
                    {t('artifact.version', { version: item.latest.ordinal })} · {formatRelativeTime(item.latest.createdAt, now, t)}
                  </span>
                </span>
              </div></li>
            })}</ul>}
          </section>
        })}</div>
      </>
    </div>
  )
}
