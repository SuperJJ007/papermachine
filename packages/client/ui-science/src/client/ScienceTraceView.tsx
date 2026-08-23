/** Science-only semantic trace: user intent and human edits opposite agent intent groups and conclusions. */

import { useMemo } from 'react'
import {
  IconCodeOutline16, IconFolderOpenOutline16, IconThinkOutline16, IconUserOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale, PropsStore, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ScienceArtifactId } from '@deepseek-ai/dsh-science-session/types'
import type { ScienceSelectionStore } from './selection-store.ts'
import {
  buildScienceTraceModel, type ScienceTraceArtifactDelta, type ScienceTraceGroup,
} from './science-trace-model.ts'
import css from './ScienceTraceView.module.css'

/** Cross-view writes supplied by the Science trace registration. */
export interface ScienceTraceInjected {
  /** Open one exact artifact version in the Science Details stage. */
  openArtifact: (selection: { readonly artifactId: ScienceArtifactId; readonly version: number }) => void
}

/** Full props for the Science semantic trace view. */
export type ScienceTraceViewProps = ConvViewProps & PropsLocale<'science'>
  & PropsStore<ScienceSelectionStore> & InjectFace<ScienceTraceInjected>

function compact(text: string): string {
  return text.replace(/\s+/gu, ' ').trim().slice(0, 180)
}

/** @param ms - elapsed milliseconds, or undefined while running. @param t - Science translator. @returns localized duration. */
export function formatScienceTraceDuration(ms: number | undefined, t: TranslateNS<'science'>): string {
  if (ms === undefined) return t('trace.running')
  if (ms < 1_000) return t('trace.durationMs', { value: ms })
  return t('trace.durationSeconds', { value: (ms / 1_000).toFixed(1) })
}

/** @param group - structured intent group. @param t - Science translator. @returns localized pure-function title. */
export function scienceTraceGroupTitle(group: ScienceTraceGroup, t: TranslateNS<'science'>): string {
  switch (group.title.kind) {
    case 'selected-edit': return t('trace.title.selectedEdit', { name: group.title.name })
    case 'edit': return t('trace.title.edit', { name: group.title.name, version: group.title.version })
    case 'generate': return group.title.count === 1
      ? t('trace.title.generate', { name: group.title.name })
      : t('trace.title.generateMany', { name: group.title.name, count: group.title.count })
    case 'curate': return t('trace.title.curate', {
      name: group.title.name, title: group.title.artifactTitle,
    })
    case 'run': return t('trace.title.run', { language: group.title.language })
    case 'browse': return t('trace.title.browse')
  }
}

function artifactDeltaText(artifact: ScienceTraceArtifactDelta, t: TranslateNS<'science'>): string {
  switch (artifact.action) {
    case 'created': return t('trace.artifact.created', { name: artifact.logicalName, version: artifact.version })
    case 'curated': return t('trace.artifact.curated', {
      name: artifact.logicalName, version: artifact.version, title: artifact.title,
    })
    case 'advanced': return t('trace.artifact.advanced', {
      name: artifact.logicalName, version: artifact.version, parent: artifact.parentVersion,
    })
  }
}

/** Render the turn-grouped Science trace using actor-owned sides of the center timeline. */
export function ScienceTraceView({ useSession, useProjection, inspectCall, actions, openArtifact, t }: ScienceTraceViewProps) {
  const nodes = useSession(snapshot => snapshot.nodes)
  const turnTimes = useSession(snapshot => snapshot.turnTimings)
  const science = useProjection('science')
  const model = useMemo(
    () => science === null || science === undefined ? undefined : buildScienceTraceModel(nodes, science, turnTimes),
    [nodes, science, turnTimes],
  )
  if (model === undefined) return <p className={css.empty}>{t('trace.empty')}</p>
  return (
    <section className={css.root} data-conversation-composer-overlay="" aria-label={t('trace.label')}>
      <header className={css.header}>
        <div><span className={css.eyebrow}>{t('trace.eyebrow')}</span><h2>{t('trace.view')}</h2></div>
        <span className={css.summary}>{t('trace.summary', { turns: model.turns.length, groups: model.groups.length })}</span>
      </header>
      <div className={css.flow}>
        {model.environment !== undefined && (
          <article className={css.node} data-actor="agent" data-kind="environment" data-anchor={model.environment.anchor}>
            <span className={css.icon}><IconCodeOutline16 /></span>
            <div><b>{t('trace.environment')}</b><p>{t('trace.environmentSummary', {
              profile: model.environment.profileId,
              languages: model.environment.languages.join(' · '),
              kernels: model.environment.kernels.join(', '),
            })}</p></div>
          </article>
        )}
        {model.turns.map((turn) => {
          const dialogues = model.dialogues.filter(item => item.turn === turn)
          const group = model.groups.find(item => item.turn === turn)
          const humanEdits = model.humanEdits.filter(item => item.turn === turn)
          return (
            <section className={css.turn} id={`trace-turn-${String(turn)}`} data-anchor={`turn:${String(turn)}`} key={turn}>
              <div className={css.turnLabel}>{t('trace.turn', { turn })}</div>
              {dialogues.filter(item => item.actor === 'user').map(item => (
                <article className={css.node} data-actor="user" data-kind={item.selection ? 'selection' : 'dialogue'}
                  data-anchor={item.anchor} key={item.anchor}>
                  <span className={css.icon}><IconUserOutline16 /></span>
                  <div><b>{item.selection ? t('trace.yourSelection') : t('trace.you')}</b><p>{compact(item.text)}</p></div>
                </article>
              ))}
              {group !== undefined && (
                <details className={css.group} data-actor="agent" data-anchor={group.anchor} open={group.failedCount > 0}>
                  <summary>
                    <span className={css.icon}><IconThinkOutline16 /></span>
                    <span><b>{scienceTraceGroupTitle(group, t)}</b><small>{group.failedCount === 0
                      ? t('trace.groupStatus', {
                        attempts: group.runs.length, duration: formatScienceTraceDuration(group.durationMs, t),
                      })
                      : t('trace.groupStatusFailed', {
                        attempts: group.runs.length, failures: group.failedCount,
                        duration: formatScienceTraceDuration(group.durationMs, t),
                      })}</small></span>
                  </summary>
                  {group.artifacts.length > 0 && <div className={css.chips}>{group.artifacts.map(artifact => (
                    <button type="button" data-anchor={artifact.anchor}
                      key={`${artifact.artifactId}:${String(artifact.version)}:${artifact.action}:${artifact.title}`}
                      onClick={() => {
                        actions.openTab({ artifactId: artifact.artifactId, version: artifact.version })
                        openArtifact(artifact)
                      }}>
                      <IconFolderOpenOutline16 /> <code>{artifact.logicalName} v{artifact.version}</code>
                    </button>
                  ))}</div>}
                  <div className={css.details}>
                    {group.runs.map(row => (
                      <button type="button" className={css.run} data-failed={row.failed || undefined}
                        data-anchor={`call:${row.callId}`} key={row.run.runId} onClick={() => { inspectCall(row.callId) }}>
                        <span>{row.run.language} · {formatScienceTraceDuration(row.durationMs, t)} · {t(`trace.run.${row.run.status}`)}</span>
                        <small>{t('trace.runInputs', { count: row.run.inputs?.length ?? 0 })} · <code>{row.anchor}</code></small>
                      </button>
                    ))}
                    {group.artifacts.map(artifact => (
                      <p data-anchor={artifact.anchor}
                        key={`delta:${artifact.artifactId}:${String(artifact.version)}:${artifact.action}:${artifact.title}`}>
                        {artifactDeltaText(artifact, t)}
                      </p>
                    ))}
                    {group.miscToolCount > 0 && <p>{t('trace.miscTools', { count: group.miscToolCount })}</p>}
                    {group.delegatedCallIds.map(callId => (
                      <button type="button" className={css.delegation} data-anchor={`call:${callId}`} key={callId}
                        onClick={() => { inspectCall(callId) }}>{t('trace.delegation')}</button>
                    ))}
                  </div>
                </details>
              )}
              {humanEdits.map(item => (
                <article className={css.node} data-actor="user" data-kind="human-edit" data-anchor={item.anchor} key={item.anchor}>
                  <span className={css.icon}><IconUserOutline16 /></span>
                  <div><b>{t('trace.humanEdit', { name: item.artifact.logicalName, version: item.artifact.version,
                    parent: item.artifact.parent.version })}</b>
                  <button type="button" onClick={() => {
                    actions.openTab({ artifactId: item.artifact.artifactId, version: item.artifact.version })
                    openArtifact(item.artifact)
                  }}>{t('trace.openArtifact')}</button></div>
                </article>
              ))}
              {dialogues.filter(item => item.actor === 'agent').map(item => (
                <article className={css.node} data-actor="agent" data-kind="dialogue" data-anchor={item.anchor} key={item.anchor}>
                  <span className={css.icon}><IconThinkOutline16 /></span>
                  <div><b>{t('trace.agentConclusion')}</b><p>{compact(item.text)}</p></div>
                </article>
              ))}
            </section>
          )
        })}
      </div>
    </section>
  )
}
