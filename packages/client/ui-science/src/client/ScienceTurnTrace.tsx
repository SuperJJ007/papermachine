/** Compact, three-row Science trace expanded beneath the producing assistant message. */

import { useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ScienceArtifactId } from '@deepseek-ai/dsh-science-session/types'
import type { ScienceSelectionStore } from './selection-store.ts'
import type { ScienceTurnTraceData } from './science-turn-trace.ts'
import { ScienceRunDetails } from './ScienceRunDetails.tsx'
import css from './ScienceTurnTrace.module.css'

// Wrapping (not `nowrap`) is required for `overflowWrap: 'anywhere'` to have
// any effect; `WebkitLineClamp: 1` then clips the wrapped box back down to
// one visible line with a trailing ellipsis, so a single unbroken long token
// (a filename, a URL) still breaks inside the row instead of overflowing it.
// Reserved for the two free-text rows only — the links row below stays a
// `display: flex` button row (`ScienceTurnTrace.module.css`'s `.links`), so
// applying this box-and-clamp display there would fight that layout.
const compactRowStyle = {
  display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 1,
  overflow: 'hidden', overflowWrap: 'anywhere',
} as const

/** Overflow safety for the links row: no `display` override, so the module's `.links { display: flex }` layout stands. */
const linksRowStyle = { overflow: 'hidden', overflowWrap: 'anywhere' } as const

/** Registration-private actions supplied to the turn-tail entry. */
export interface ScienceTurnTraceInjected { openArtifact: () => void }

/** Props supplied by the turn-tail chain and Science selection store. */
export type ScienceTurnTraceProps = PropsRuntime<'conversation.chat.turnTail'> & { matched: ScienceTurnTraceData }
  & PropsLocale<'science'> & PropsStore<ScienceSelectionStore> & InjectFace<ScienceTurnTraceInjected>

/** Render one producing turn as a collapsed summary and a hard-budget three-row card. */
export function ScienceTurnTrace({
  matched, seq, useSession, useProjection, actions, openArtifact, inspectCall, t,
}: ScienceTurnTraceProps) {
  const [expanded, setExpanded] = useState(false)
  const [expandedCallId, setExpandedCallId] = useState<string | undefined>()
  const snapshot = useSession(value => value)
  const science = useProjection('science')
  const request = [...snapshot.nodes].reverse().find(node => node.kind === 'user' && node.seq < seq)
  const text = request?.kind === 'user'
    ? request.content.flatMap(block => block.type === 'text' ? [block.text] : []).join(' ').replace(/\s+/gu, ' ').trim()
    : t('turnTrace.requestUnavailable')
  const languages = [...new Set(matched.calls.flatMap(call => call.name === 'run_python' ? ['Python']
    : call.name === 'run_r' ? ['R'] : []))]
  return <div className={css.root}>
    <button type="button" className={css.toggle} aria-expanded={expanded} onClick={() => { setExpanded(value => !value) }}>
      {t('turnTrace.summary', { count: matched.artifacts.length })} · {t('turnTrace.open')}
    </button>
    {expanded && <div className={css.card} data-science-turn-card>
      <p className={css.request} style={compactRowStyle} title={text}>{text}</p>
      <p className={css.facts} style={compactRowStyle}>{t('turnTrace.facts', {
        languages: languages.join(' · ') || '—',
        runs: matched.calls.filter(call => call.name === 'run_python' || call.name === 'run_r').length,
        files: matched.artifacts.length,
      })}</p>
      <p className={css.links} style={linksRowStyle}>{matched.calls
        .filter(call => call.name === 'run_python' || call.name === 'run_r').map(call => (
          <button type="button" key={call.callId} aria-expanded={expandedCallId === call.callId}
            onClick={() => { setExpandedCallId(current => current === call.callId ? undefined : call.callId) }}>{call.name}</button>
        ))}{matched.artifacts.map(artifact => <button type="button" key={`${artifact.artifactId}:${String(artifact.version)}`}
        onClick={() => {
          actions.openTab({ artifactId: artifact.artifactId as ScienceArtifactId, version: artifact.version })
          openArtifact()
        }}>
        {artifact.logicalName} v{artifact.version}
      </button>)}</p>
    </div>}
    {expanded && expandedCallId !== undefined && science !== null && science !== undefined && (() => {
      const run = science.runs.find(candidate => candidate.toolCallId === expandedCallId)
      return run === undefined
        ? <button type="button" className={css.inspect} disabled={inspectCall === undefined}
          onClick={inspectCall === undefined ? undefined : () => { inspectCall(expandedCallId) }}>
          {t('turnTrace.inspectRun')}
        </button>
        : <div className={css.runDetails}><ScienceRunDetails run={run} snapshot={snapshot} t={t} /></div>
    })()}
  </div>
}
