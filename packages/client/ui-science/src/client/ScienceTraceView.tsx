/** Science process view: ordered calls and artifact changes around actor-owned turns. */

import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react'
import { IconFolderOpenOutline16, IconUserOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ScienceArtifactId, ScienceKernelEndReason } from '@deepseek-ai/dsh-science-session/types'
import type { ScienceSelectionStore } from './selection-store.ts'
import {
  buildScienceTraceModel, scienceTracePips,
  type ScienceTraceKernelMarker, type ScienceTraceArtifactDelta,
  type ScienceTraceStep, type ScienceTraceStepMember, type ScienceTraceStepTitle,
} from './science-trace-model.ts'
import css from './ScienceTraceView.module.css'

/** Cross-view writes supplied by the Science trace registration. */
export interface ScienceTraceInjected {
  /** Open one exact artifact version in the Science Details stage. */
  openArtifact: (selection: { readonly artifactId: ScienceArtifactId; readonly version: number }) => void
  /** Select the detailed Trajectory implementation before applying an inspect handoff. */
  selectDetailed: () => void
}

/** Full props for the Science process view. */
export type ScienceTraceViewProps = PropsRuntime<'trajectory.view'> & PropsLocale<'science'>
  & PropsStore<ScienceSelectionStore> & InjectFace<ScienceTraceInjected>

/* v8 ignore next 3 -- exhaustiveness backstop for closed typed unions. */
function assertNever(value: never): never {
  throw new Error(`unhandled trace value: ${JSON.stringify(value)}`)
}

function languageName(language: string, t: TranslateNS<'science'>): string {
  return language === 'python' ? t('trace.language.python') : language === 'r' ? t('trace.language.r') : language
}

function compact(text: string): string {
  return text.replace(/\s+/gu, ' ').trim().slice(0, 180)
}

/** @param ms - Elapsed milliseconds, or undefined while running. @param t - Science translator. @returns Localized duration. */
export function formatScienceTraceDuration(ms: number | undefined, t: TranslateNS<'science'>): string {
  if (ms === undefined) return t('trace.running')
  if (ms < 1_000) return t('trace.durationMs', { value: ms })
  return t('trace.durationSeconds', { value: (ms / 1_000).toFixed(1) })
}

/** @param title - Structured step title. @param t - Science translator. @returns Localized one-line title. */
export function scienceTraceStepTitle(title: ScienceTraceStepTitle, t: TranslateNS<'science'>): string {
  switch (title.kind) {
    case 'run': return t('trace.step.run', { language: languageName(title.language, t) })
    case 'read': return t('trace.step.read', { name: title.name })
    case 'read-image': return t('trace.step.readImage', { name: title.name })
    case 'glob': return t('trace.step.glob', { pattern: title.pattern })
    case 'grep': return t('trace.step.grep', { pattern: title.pattern })
    case 'state': return t('trace.step.state')
    case 'annotate': return t('trace.step.annotate', { name: title.name, version: title.version, title: title.title })
    case 'publish': return t('trace.step.publish', { title: title.title })
    case 'delegate': return t('trace.step.delegate')
    case 'tool': return t('trace.step.tool', { name: title.name })
    case 'browse-many': return t('trace.step.browseMany', { count: title.count })
    /* v8 ignore next -- closed ScienceTraceStepTitle union. */
    default: return assertNever(title)
  }
}

/** @param step - One list row. @param t - Science translator. @returns Result text, or empty when no result is known. */
export function scienceTraceStepStatus(step: ScienceTraceStep, t: TranslateNS<'science'>): string {
  if (step.kind !== 'run' || step.runStatus === undefined) return step.failed ? t('trace.step.failed') : ''
  switch (step.runStatus) {
    case 'running': return ''
    case 'success': return t('trace.step.ok', { duration: formatScienceTraceDuration(step.durationMs, t) })
    case 'failed': return t('trace.step.failed')
    case 'timed-out': return t('trace.step.timedOut')
    case 'cancelled': return t('trace.step.cancelled')
    case 'interrupted': return t('trace.step.interrupted')
    /* v8 ignore next -- closed ScienceClientRun status union. */
    default: return assertNever(step.runStatus)
  }
}

function kernelReason(reason: ScienceKernelEndReason | undefined, t: TranslateNS<'science'>): string {
  switch (reason) {
    case undefined: return t('trace.kernel.reason.unknown')
    case 'idle': return t('trace.kernel.reason.idle')
    case 'session-end': return t('trace.kernel.reason.session-end')
    case 'environment-rebound': return t('trace.kernel.reason.environment-rebound')
    case 'run-escalation': return t('trace.kernel.reason.run-escalation')
    case 'protocol': return t('trace.kernel.reason.protocol')
    case 'crash': return t('trace.kernel.reason.crash')
    case 'service-disposed': return t('trace.kernel.reason.service-disposed')
    /* v8 ignore next -- closed ScienceKernelEndReason union. */
    default: return assertNever(reason)
  }
}

function KernelMarker({ marker, profile, t }: {
  readonly marker: ScienceTraceKernelMarker
  readonly profile: string | undefined
  readonly t: TranslateNS<'science'>
}) {
  const params = { language: languageName(marker.language, t), epoch: marker.kernelEpoch }
  let text: string
  switch (marker.event) {
    case 'started': text = profile === undefined ? t('trace.kernel.startedNoProfile', params)
      : t('trace.kernel.started', { ...params, profile }); break
    case 'exited': text = t('trace.kernel.exited', { ...params, reason: kernelReason(marker.reason, t) }); break
    case 'interrupted': text = t('trace.kernel.interrupted', params); break
    /* v8 ignore next -- closed marker event union. */
    default: return assertNever(marker.event)
  }
  return <div className={css.kernelMarker} data-kind="kernel" data-event={marker.event} data-anchor={marker.anchor}>
    <span className={css.kernelState} data-event={marker.event} aria-hidden="true" />{text}
  </div>
}

function ArtifactChip({ artifact, open }: {
  readonly artifact: ScienceTraceArtifactDelta
  readonly open: ScienceTraceInjected['openArtifact']
}) {
  return <button type="button" data-anchor={artifact.anchor} title={`${artifact.logicalName} v${String(artifact.version)}`}
    onClick={() => { open({ artifactId: artifact.artifactId, version: artifact.version }) }}>
    <IconFolderOpenOutline16 /> <code>{artifact.logicalName} v{artifact.version}</code>
  </button>
}

/** Render process groups; expansion and the selected step live only in this mounted view. */
export function ScienceTraceView({
  useSession, useProjection, inspectCall, actions, openArtifact, selectDetailed, t,
}: ScienceTraceViewProps) {
  const nodes = useSession(snapshot => snapshot.nodes)
  const turnTimes = useSession(snapshot => snapshot.turnTimings)
  const science = useProjection('science')
  const [expandedTurns, setExpandedTurns] = useState<ReadonlySet<number>>(() => new Set())
  const [highlight, setHighlight] = useState<{ turn: number; row: number } | null>(null)
  const highlightedRow = useRef<HTMLLIElement>(null)
  const id = useId()
  useEffect(() => { highlightedRow.current?.scrollIntoView({ block: 'nearest' }) }, [highlight])
  const model = useMemo(
    () => science === null || science === undefined ? undefined : buildScienceTraceModel(nodes, science, turnTimes),
    [nodes, science, turnTimes],
  )
  if (model === undefined) return <p className={css.empty}>{t('trace.empty')}</p>
  const open: ScienceTraceInjected['openArtifact'] = (selection) => {
    actions.openTab(selection)
    openArtifact(selection)
  }
  const duration = model.turns.reduce((sum, turn) => {
    const timing = turnTimes.get(turn)
    return sum + (timing?.endTime === undefined
      ? model.groups.find(group => group.turn === turn)?.durationMs ?? 0 : Math.max(0, timing.endTime - timing.startTime))
  }, 0)
  return (
    <section className={css.root} data-conversation-composer-overlay="" aria-label={t('trace.label')}>
      <header className={css.header}>
        <span className={css.summary}>{t('trace.summary', {
          turns: model.turns.length, steps: model.groups.reduce((sum, group) => sum + group.stepCount, 0),
          runs: model.groups.reduce((sum, group) => sum + group.runs.length, 0),
          artifacts: new Set(science?.artifacts.map(artifact => artifact.artifactId)).size,
          duration: formatScienceTraceDuration(duration, t),
        })}{science?.outcome != null && <> · {t('trace.published')}</>}</span>
      </header>
      {model.groups.length === 0 && model.humanEdits.length === 0 && <p className={css.empty}>{t('trace.empty')}</p>}
      <div className={css.flow}>
        {model.turns.map((turn) => {
          const request = model.dialogues.find(item => item.turn === turn)
          const group = model.groups.find(item => item.turn === turn)
          const humanEdits = model.humanEdits.filter(item => item.turn === turn)
          const expanded = expandedTurns.has(turn)
          const pips = group === undefined ? [] : scienceTracePips(group)
          const latest = new Map<ScienceArtifactId, ScienceTraceArtifactDelta>()
          for (const artifact of group?.artifacts ?? []) {
            if (artifact.version >= (latest.get(artifact.artifactId)?.version ?? 0)) latest.set(artifact.artifactId, artifact)
          }
          const tallyParams = { steps: group?.stepCount ?? 0, runs: group?.runs.length ?? 0,
            duration: formatScienceTraceDuration(group?.durationMs, t) }
          const tally = group !== undefined && group.failedCount > 0
            ? t('trace.tallyFailed', { ...tallyParams, failures: group.failedCount }) : t('trace.tally', tallyParams)
          const [beforeFailure, afterFailure] = t('trace.tallyFailed', { ...tallyParams, failures: '\u0000' }).split('\u0000')
          return (
            <Fragment key={turn}>
              {model.kernelMarkers.filter(marker => marker.beforeTurn === turn).map(marker => (
                <KernelMarker key={`${marker.language}:${String(marker.kernelEpoch)}:${marker.event}`} marker={marker}
                  profile={model.environment?.profileId} t={t} />
              ))}
              {(group !== undefined || humanEdits.length > 0) && <section className={css.turn} id={`trace-turn-${String(turn)}`} data-anchor={`turn:${String(turn)}`} key={turn}>
                <div className={css.turnLabel}>{t('trace.turn', { turn })}</div>
                {group !== undefined && (
                  <article className={css.group} data-actor="agent" data-anchor={group.anchor}
                    data-line-budget="3" data-expanded={expanded}>
                    <p className={css.request} title={request?.text}>{request === undefined ? t('trace.requestUnavailable') : compact(request.text)}</p>
                    <div className={css.facts}>
                      <div className={css.strip} role="group" aria-label={t('trace.strip')}>
                        {pips.slice(0, 120).map((pip, index) => (
                          <button key={index} type="button" className={css.pip} data-kind={pip.kind} data-failed={pip.failed}
                            title={scienceTraceStepTitle(pip.title, t)} aria-label={scienceTraceStepTitle(pip.title, t)}
                            aria-controls={`${id}-${String(turn)}-steps`} onClick={() => {
                              setExpandedTurns(previous => new Set([...previous, turn]))
                              setHighlight({ turn, row: pip.rowIndex })
                            }} />
                        ))}
                        {pips.length > 120 && <span title={t('trace.stripTruncated', { count: pips.length })}
                          aria-label={t('trace.stripTruncated', { count: pips.length })}>…</span>}
                      </div>
                      <button type="button" className={css.toggle} aria-expanded={expanded}
                        aria-controls={`${id}-${String(turn)}-steps`} aria-label={`${t(expanded ? 'trace.collapse' : 'trace.expand')} · ${tally}`}
                        onClick={() => {
                          setExpandedTurns((previous) => {
                            const next = new Set(previous)
                            if (next.has(turn)) next.delete(turn)
                            else next.add(turn)
                            return next
                          })
                        }}>
                        <span>{group.failedCount > 0 ? <>{beforeFailure}<b>{group.failedCount}</b>{afterFailure}</> : tally}</span>
                        <span aria-hidden="true">{expanded ? '▴' : '▾'}</span>
                      </button>
                    </div>
                    {expanded && (
                      <ol className={css.steps} id={`${id}-${String(turn)}-steps`} aria-label={t('trace.steps')}>
                        {group.steps.map((step, row) => {
                          const highlighted = highlight?.turn === turn && highlight.row === row
                          const status = scienceTraceStepStatus(step, t)
                          return <li key={step.anchor} className={css.step} data-highlight={highlighted}
                            ref={highlighted ? highlightedRow : undefined} data-anchor={step.anchor}>
                            <span className={css.stepNumber} data-repeated={step.step === group.steps[row - 1]?.step}
                              aria-label={t('trace.stepNumber', { step: step.step })}>{step.step}</span>
                            <span className={css.pip} data-kind={step.kind} data-failed={step.failed} aria-hidden="true" />
                            <div className={css.stepContent}>
                              <button className={css.stepTitle} type="button" title={scienceTraceStepTitle(step.title, t)}
                                onClick={() => { selectDetailed(); inspectCall((step.members[0] as ScienceTraceStepMember).callId) }}>
                                {scienceTraceStepTitle(step.title, t)}
                              </button>
                              <div className={css.chips}>{step.artifacts.map((artifact, index) => (
                                <ArtifactChip key={index} artifact={artifact} open={open} />
                              ))}</div>
                            </div>
                            <span className={css.result} data-failed={step.failed}>{status !== '' && <>● {status}</>}</span>
                          </li>
                        })}
                      </ol>
                    )}
                    <div className={css.chips}>{[...latest.values()].map(artifact => (
                      <ArtifactChip key={artifact.artifactId} artifact={artifact} open={open} />
                    ))}{group.artifacts.length === 0 && <span>{t('trace.noArtifacts')}</span>}</div>
                  </article>
                )}
                {humanEdits.map(item => (
                  <article className={css.node} data-actor="user" data-kind="human-edit" data-anchor={item.anchor} key={item.anchor}>
                    <span className={css.icon}><IconUserOutline16 /></span>
                    <div><b>{t('trace.humanEdit', { name: item.artifact.logicalName, version: item.artifact.version,
                      parent: item.artifact.parent.version })}</b>
                    <button type="button" onClick={() => {
                      open({ artifactId: item.artifact.artifactId, version: item.artifact.version })
                    }}>{t('trace.openArtifact')}</button></div>
                  </article>
                ))}
              </section>}
            </Fragment>
          )
        })}
        {model.kernelMarkers.filter(marker => !model.turns.includes(marker.beforeTurn)).map(marker => (
          <KernelMarker key={`${marker.language}:${String(marker.kernelEpoch)}:${marker.event}`} marker={marker}
            profile={model.environment?.profileId} t={t} />
        ))}
      </div>
    </section>
  )
}
