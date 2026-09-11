/** Existing changed-file chips and explicitly declared files for a closing turn. */
import { useEffect } from 'react'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import { Button, FileDeliveryGroup } from '@deepseek-ai/dsh-client-ui-primitives'
import type { GlobalStandardProps, InjectFace, PropsLocale, PropsRuntime, SessionStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { PresentedOpenController } from './present-open.ts'
import { ProducedFiles } from './ProducedFiles.tsx'
import { presentedForClosing, selectProducedFiles, type PresentedPath } from './turn-deliverables.ts'
import type { NS } from './locales.ts'
import { presentedFileUrl } from '../presented.ts'
import { PresentedFileCard } from './PresentedFileCard.tsx'
import css from './Deliverables.module.css'

interface DeliverablesMatch { produced: readonly string[]; presented: readonly PresentedPath[] }

/** Native-open callbacks and shared gesture status supplied by the plugin. */
export interface DeliverablesInjected {
  hooks: {
    presentedOpen: ObservableSnapshot<ReturnType<PresentedOpenController['state']['getSnapshot']>>
    presentedHost: ObservableSnapshot<ReturnType<PresentedOpenController['host']['getSnapshot']>>
  }
  reloadPresentedHost: PresentedOpenController['loadHost']
  openPresented: PresentedOpenController['open']
}

/**
 * Claim turns containing modified paths or declared files.
 * @param owner - closing turn.
 * @returns matched files, or null for an empty turn.
 */
export function selectDeliverables(owner: TurnTailOwnerProps): DeliverablesMatch | null {
  const produced = selectProducedFiles(owner) ?? []
  const presented = presentedForClosing(owner)
  return produced.length + presented.length === 0 ? null : { produced, presented }
}

/**
 * Render workspace file actions and default-application buttons for declared files.
 * @param props - matched files, workspace opener, and localized copy.
 * @returns the closing turn's file rows.
 */
export function Deliverables({ matched, collapsedCount, openFile, t, sessionId, useSessions, openPresented, usePresentedOpen, usePresentedHost, reloadPresentedHost }: Pick<TurnTailOwnerProps, 'openFile'> & { matched: DeliverablesMatch; collapsedCount: number } & PropsLocale<typeof NS> & Pick<SessionStandardProps, 'sessionId'> & Pick<GlobalStandardProps, 'useSessions'> & InjectFace<DeliverablesInjected>) {
  const presented = matched.presented
  const cwd = useSessions(state => state.byId[sessionId]?.cwd)
  const states = usePresentedOpen(value => value)
  const host = usePresentedHost(value => value)
  useEffect(() => {
    if (presented.length > 0 && host === null) void reloadPresentedHost()
  }, [presented.length, host, reloadPresentedHost])
  return <>
    {matched.produced.length > 0 && <ProducedFiles matched={matched.produced} openFile={openFile} t={t} />}
    {matched.presented.length > 0 && <div
      className={css.root}
      data-after-produced-files={matched.produced.length > 0 || undefined}
    >
      {host === 'error' && <div className={css.hostStatus}>
        <span>{t('presented.hostError')}</span>
        <Button size="sm" onClick={() => { void reloadPresentedHost() }}>{t('presented.retry')}</Button>
      </div>}
      {host !== null && host !== 'error' && !host.available && <span className={css.hostStatus}>{t('presented.unavailable')}</span>}
      <div data-presented-files-row><FileDeliveryGroup collapsedCount={collapsedCount}
        expandLabel={t('presented.all', { count: matched.presented.length })} collapseLabel={t('presented.collapse')}
        expandAriaLabel={t('presented.expandAria', { count: matched.presented.length })}
        collapseAriaLabel={t('presented.collapseAria', { count: matched.presented.length })}
        items={presented.map(file => ({ id: `${file.seq}:${file.index}`, content: <PresentedFileCard file={file} cwd={cwd}
          phase={states[presentedFileUrl(sessionId, file.seq, file.index)]}
          host={host === 'error' ? null : host} t={t}
          onPreview={() => { openFile(file.path) }}
          onAction={(action) => { void openPresented(sessionId, file.seq, file.index, action) }} /> }))} /></div>
    </div>}
  </>
}

/**
 * Select workspace files independently of other output list entries.
 * @param props - Chat owner data and workspace file capabilities.
 * @returns Workspace output groups, or null when empty.
 */
export function DeliverablesEntry(props: PropsRuntime<'conversation.chat.turnTail'> & PropsLocale<typeof NS>
  & InjectFace<DeliverablesInjected>) {
  const matched = selectDeliverables(props)
  return matched === null ? null : <Deliverables {...props} matched={matched} />
}
