/** Science-only semantic swimlane: per-turn request, run/artifact facts, and human edits opposite agent intent groups on the timeline. */

import { useMemo } from 'react'
import { IconCodeOutline16, IconFolderOpenOutline16, IconThinkOutline16, IconUserOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ScienceArtifactId } from '@deepseek-ai/dsh-science-session/types'
import type { ScienceSelectionStore } from './selection-store.ts'
import { buildScienceTraceModel, type ScienceTraceGroup } from './science-trace-model.ts'
import css from './ScienceTraceView.module.css'

/** Cross-view writes supplied by the Science trace registration. */
export interface ScienceTraceInjected {
  /** Open one exact artifact version in the Science Details stage. */
  openArtifact: (selection: { readonly artifactId: ScienceArtifactId; readonly version: number }) => void
  /** Select the detailed Trajectory implementation before applying an inspect handoff. */
  selectDetailed: () => void
}

/** Full props for the Science semantic trace view. */
export type ScienceTraceViewProps = PropsRuntime<'trajectory.view'> & PropsLocale<'science'>
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

/** Render the turn-grouped Science trace using actor-owned sides of the center timeline. */
export function ScienceTraceView({
  useSession, useProjection, inspectCall, actions, openArtifact, selectDetailed, t,
}: ScienceTraceViewProps) {
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
          if (group === undefined && humanEdits.length === 0) return null
          const request = dialogues[0]
          const languageCounts = new Map<string, number>()
          for (const row of group?.runs ?? []) {
            languageCounts.set(row.run.language, (languageCounts.get(row.run.language) ?? 0) + 1)
          }
          const runFacts = [...languageCounts].map(([language, count]) => `${language} ×${String(count)}`)
          if (group !== undefined && group.failedCount > 0) runFacts.push(t('trace.failures', { count: group.failedCount }))
          if (group !== undefined && group.miscToolCount > 0) runFacts.push(t('trace.miscTools', { count: group.miscToolCount }))
          return (
            <section className={css.turn} id={`trace-turn-${String(turn)}`} data-anchor={`turn:${String(turn)}`} key={turn}>
              <div className={css.turnLabel}>{t('trace.turn', { turn })}</div>
              {group !== undefined && (
                <article className={css.group} data-actor="agent" data-anchor={group.anchor} data-line-budget="3">
                  {/* Design budget: exactly three semantic rows. Every free-text
                      row clamps to one line; files never create a fourth. */}
                  <p className={css.request} title={request?.text}>{request === undefined ? t('trace.requestUnavailable') : compact(request.text)}</p>
                  <button type="button" className={css.facts} disabled={group.runs.length === 0}
                    onClick={() => {
                      const first = group.runs[0]
                      /* v8 ignore next -- disabled whenever runs is empty, so a click only fires once runs[0] exists. */
                      if (first === undefined) return
                      selectDetailed()
                      inspectCall(first.callId)
                    }}>
                    <IconThinkOutline16 /> {runFacts.join(' · ') || t('trace.noRuns')}
                  </button>
                  <div className={css.chips}>{group.artifacts.map(artifact => (
                    <button type="button" data-anchor={artifact.anchor}
                      key={`${artifact.artifactId}:${String(artifact.version)}:${artifact.action}:${artifact.title}`}
                      onClick={() => {
                        actions.openTab({ artifactId: artifact.artifactId, version: artifact.version })
                        openArtifact(artifact)
                      }}>
                      <IconFolderOpenOutline16 /> <code>{artifact.logicalName} v{artifact.version}</code>
                    </button>
                  ))}{group.artifacts.length === 0 && <span>{t('trace.noArtifacts')}</span>}</div>
                </article>
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
            </section>
          )
        })}
      </div>
    </section>
  )
}
