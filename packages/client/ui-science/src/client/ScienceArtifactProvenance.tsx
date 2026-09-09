// The provenance drill-in: an in-panel breadcrumb (`<name> › Provenance`)
// over four sub-tabs — Code, Execution log, Messages, Environment — for one
// resolved artifact version. Reached from the artifact viewer's toolbar
// ("Provenance"); the breadcrumb's root segment returns to the content view.
//
// ScienceDetailsView resolves the version's store-owned producer summary
// from `sessions.scienceVersions`, then joins that exact identity to the
// current session's run and transcript projections. Cross-session and
// non-run versions render explicit unavailable states rather than guessing a
// producer from nearby trajectory coordinates.

import { CodeBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConversationNode, ConversationSnapshot, ToolCallBlock, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: ChatNode narrows the generic view-node store's value for the
// 'tool-call' target the same way ui-conversation's own tool-node reader does.
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { conversationContextKey } from '@deepseek-ai/dsh-client-runtime/client'
import type { ScienceClientEnvironmentBinding, ScienceClientRun } from '@deepseek-ai/dsh-science-session/types'
import type { ScienceProvenanceSubTab } from './selection-store.ts'
import type { ScienceRenderableVersion } from './version-summaries.ts'
import css from './ScienceArtifactProvenance.module.css'

/** One resolved provenance sub-tab and its display label key, in display order. */
const SUB_TABS: readonly { id: ScienceProvenanceSubTab; labelKey: 'provenance.code.title' | 'provenance.log.title' | 'provenance.messages.title' | 'provenance.environment.title' }[] = [
  { id: 'code', labelKey: 'provenance.code.title' },
  { id: 'log', labelKey: 'provenance.log.title' },
  { id: 'messages', labelKey: 'provenance.messages.title' },
  { id: 'environment', labelKey: 'provenance.environment.title' },
]

/** Full props for the provenance drill-in. */
export interface ScienceArtifactProvenanceProps {
  chart: ScienceRenderableVersion
  /** The version's producing run, when resolvable in the current session. */
  run: ScienceClientRun | undefined
  /** The version's producing tool call id, when resolvable in the current session. */
  producingCallId: string | undefined
  environment: ScienceClientEnvironmentBinding | null | undefined
  snapshot: ConversationSnapshot
  subTab: ScienceProvenanceSubTab
  onSubTabChange: (subTab: ScienceProvenanceSubTab) => void
  onBack: () => void
  inspectCall: (callId: string) => void
  /** Select the detailed trajectory subview before inspecting one call. */
  selectDetailed: () => void
  returnToConversation: (anchorKey: string) => void
  /** Display title or id for a producer outside the current session. */
  sourceSessionTitle?: string
  t: TranslateNS<'science'>
}

function normalizedSummary(text: string): string {
  return text.replace(/\s+/gu, ' ').trim()
}

function userText(node: Extract<ConversationNode, { kind: 'user' | 'steering' }>): string {
  return node.content.flatMap(block => block.type === 'text' ? [block.text] : []).join(' ')
}

/** Resolve the generating turn plus nearby dialogue without parsing model prose. */
function generationSummary(snapshot: ConversationSnapshot, callId: string): {
  readonly turn: number
  readonly anchorKey: string
  readonly user: string
  readonly agent: string
} | undefined {
  const nodes = snapshot.nodes
  const assistant = nodes.find(node => node.kind === 'assistant'
    && node.blocks.some(block => block.kind === 'tool-call' && block.callId === callId))
  if (assistant?.kind !== 'assistant') return undefined
  const priorUser = [...nodes].reverse().find(node =>
    (node.kind === 'user' || node.kind === 'steering') && node.seq < assistant.seq)
  const conclusion = [...nodes].reverse().find(node => node.kind === 'assistant' && node.turn === assistant.turn
    && node.blocks.some(block => block.kind === 'text' && block.text.trim() !== ''))
  const agent = conclusion?.kind === 'assistant'
    ? [...conclusion.blocks].reverse().find(block => block.kind === 'text' && block.text.trim() !== '')
    : undefined
  return {
    turn: assistant.turn,
    anchorKey: conversationContextKey('assistant-step', `${String(assistant.turn)}:${String(assistant.step)}`),
    user: priorUser?.kind === 'user' || priorUser?.kind === 'steering' ? normalizedSummary(userText(priorUser)) : '',
    agent: agent?.kind === 'text' ? normalizedSummary(agent.text) : '',
  }
}

/** Resolve one tool call through the internal Chat Node index (direct-dispatch calls are always root). */
function resolveCall(snapshot: ConversationSnapshot, callId: string): ToolCallBlock | undefined {
  const node = snapshot.chat.nodes.get(conversationContextKey('tool-call', callId))
  return node?.kind === 'tool-call' ? (node as ChatNode<'tool-call'>).data.root : undefined
}

/** Flatten a settled result's content blocks into displayable text. */
function resultText(content: ToolResultNode['content']): string {
  const parts: string[] = []
  for (const item of content) {
    parts.push(item.type === 'text' ? item.text : JSON.stringify(item, null, 2))
  }
  return parts.join('\n')
}

/** The call's raw JSON arguments text, when the call head is currently loaded. */
function resolveArgsRaw(block: ToolCallBlock | undefined): string | null {
  if (block === undefined) return null
  return 'kind' in block ? (block.call?.argsRaw ?? null) : block.argsRaw
}

/** The call's settled result content text, when the result is currently loaded and settled. */
function resolveResultText(block: ToolCallBlock | undefined): string | null {
  if (block === undefined || !('kind' in block)) return null
  return resultText(block.content)
}

/** Parse the `{ code: string }` tool argument; malformed/absent JSON reports as absent rather than throwing. */
function parseCode(argsRaw: string | null): string | null {
  if (argsRaw === null) return null
  try {
    const parsed: unknown = JSON.parse(argsRaw)
    if (typeof parsed === 'object' && parsed !== null && typeof (parsed as { code?: unknown }).code === 'string') {
      return (parsed as { code: string }).code
    }
    return null
  } catch {
    return null
  }
}

/** Byte-count and truncation facts, present only on a settled (non-running, non-interrupted) run. */
function terminalCounts(run: ScienceClientRun): {
  stdoutBytes: number
  stderrBytes: number
  stdoutTruncated: boolean
  stderrTruncated: boolean
} | null {
  if (run.status === 'running' || run.status === 'interrupted') return null
  return {
    stdoutBytes: run.stdoutBytes,
    stderrBytes: run.stderrBytes,
    stdoutTruncated: run.stdoutTruncated,
    stderrTruncated: run.stderrTruncated,
  }
}

/**
 * Localize one version's content origin for a "not produced by a run" notice.
 * @param origin - the store's `contentOrigin` fact.
 * @param t - the Science namespace translator.
 * @returns localized origin text.
 */
function contentOriginText(origin: ScienceRenderableVersion['contentOrigin'], t: TranslateNS<'science'>): string {
  switch (origin) {
    case 'run-auto': return t('provenance.origin.runAuto')
    case 'human-edit': return t('provenance.origin.humanEdit')
    case 'import': return t('provenance.origin.import')
    /* v8 ignore next -- closed ScienceContentOrigin union */
    default: return origin
  }
}

/** Shared unavailable body for a cross-session preview or unresolved run. */
function UnavailableRunSection({ chart, sourceSessionTitle, t }: {
  chart: ScienceRenderableVersion
  sourceSessionTitle: string | undefined
  t: TranslateNS<'science'>
}) {
  return (
    <section className={css.section}>
      <p className={css.notice} role="status">
        {sourceSessionTitle === undefined
          ? t('provenance.noRun', { origin: contentOriginText(chart.contentOrigin, t) })
          : t('provenance.crossSession', { session: sourceSessionTitle })}
      </p>
    </section>
  )
}

function CodeSection({ run, block, t }: { run: ScienceClientRun; block: ToolCallBlock | undefined; t: TranslateNS<'science'> }) {
  const code = parseCode(resolveArgsRaw(block))
  return (
    <section className={css.section}>
      <p className={css.anchor}>{t('provenance.code.anchor', { sha256: run.codeSha256 })}</p>
      {code === null
        ? <p className={css.notice} role="status">{t('provenance.code.pending')}</p>
        : <CodeBlock code={code} lang={run.language} copyLabel={t('copy')} copiedLabel={t('copied')} />}
    </section>
  )
}

function ExecutionLogSection({ run, block, t }: { run: ScienceClientRun; block: ToolCallBlock | undefined; t: TranslateNS<'science'> }) {
  const text = resolveResultText(block)
  const counts = terminalCounts(run)
  return (
    <section className={css.section}>
      {counts !== null && (
        <p className={css.anchor}>
          {t('provenance.log.counts', {
            stdoutBytes: counts.stdoutBytes,
            stderrBytes: counts.stderrBytes,
          })}
          {(counts.stdoutTruncated || counts.stderrTruncated) && ` ${t('provenance.log.truncated')}`}
        </p>
      )}
      {run.status === 'running'
        ? <p className={css.notice} role="status">{t('provenance.log.running')}</p>
        : text === null
          ? <p className={css.notice} role="status">{t('provenance.log.pending')}</p>
          : <CodeBlock code={text} lang="text" copyLabel={t('copy')} copiedLabel={t('copied')} />}
    </section>
  )
}

function MessagesSection({
  summary, sourceSessionTitle, returnToConversation, inspectCall, selectDetailed, producingCallId, t,
}: {
  summary: ReturnType<typeof generationSummary>
  sourceSessionTitle: string | undefined
  returnToConversation: (anchorKey: string) => void
  inspectCall: (callId: string) => void
  selectDetailed: () => void
  producingCallId: string | undefined
  t: TranslateNS<'science'>
}) {
  if (sourceSessionTitle !== undefined) {
    return (
      <section className={css.messagesSection}>
        <p className={css.sourceSession}><span>{t('provenance.messages.sourceSession')}</span>{sourceSessionTitle}</p>
        <div className={css.messageActions}>
          <button type="button" className={css.primaryAction} disabled title={t('library.sourceNavigationUnavailable')}>
            {t('provenance.messages.conversation')}
          </button>
        </div>
      </section>
    )
  }
  if (summary === undefined || producingCallId === undefined) {
    return <section className={css.section}><p className={css.notice} role="status">{t('provenance.messages.pending')}</p></section>
  }
  return (
    <section className={css.messagesSection}>
      <div className={css.messageSummary}><span>{t('provenance.messages.question')}</span><p>{summary.user}</p></div>
      <div className={css.messageSummary}><span>{t('provenance.messages.result')}</span><p>{summary.agent}</p></div>
      <div className={css.messageActions}>
        <button type="button" className={css.primaryAction} onClick={() => { returnToConversation(summary.anchorKey) }}>{t('provenance.messages.conversation')}</button>
        <button type="button" className={css.secondaryAction} onClick={() => { selectDetailed(); inspectCall(producingCallId) }}>{t('provenance.messages.trajectory')}</button>
      </div>
    </section>
  )
}

function EnvironmentSection({ run, environment, t }: {
  run: ScienceClientRun
  environment: ScienceClientEnvironmentBinding | null | undefined
  t: TranslateNS<'science'>
}) {
  const current = environment?.revision === run.environmentRevision ? environment : undefined
  return (
    <section className={css.section}>
      {current === undefined
        ? (
          <p className={css.notice} role="status">
            {t('provenance.environment.superseded', {
              revision: run.environmentRevision, fingerprintPreview: run.environmentFingerprintPreview,
            })}
          </p>
        )
        : <CodeBlock code={JSON.stringify(current, null, 2)} lang="json" copyLabel={t('copy')} copiedLabel={t('copied')} />}
    </section>
  )
}

/**
 * Render the provenance drill-in for one resolved artifact version: the
 * breadcrumb, the sub-tab strip, and the active sub-tab's section.
 * @param props - the resolved chart, its producing run and call (when
 * resolvable), the current environment binding, the conversation snapshot,
 * the active sub-tab and its setter, the back-to-content callback, the
 * transcript jump handoffs, an optional cross-session source-session title,
 * and the locale seat.
 * @returns the drill-in body.
 */
export function ScienceArtifactProvenance({
  chart, run, producingCallId, environment, snapshot, subTab, onSubTabChange, onBack, inspectCall, selectDetailed,
  returnToConversation, sourceSessionTitle, t,
}: ScienceArtifactProvenanceProps) {
  const block = producingCallId === undefined ? undefined : resolveCall(snapshot, producingCallId)
  const summary = producingCallId === undefined ? undefined : generationSummary(snapshot, producingCallId)

  return (
    <div className={css.body}>
      <nav className={css.breadcrumb} aria-label={t('provenance.label')}>
        <button type="button" className={css.breadcrumbRoot} onClick={onBack}>{chart.title}</button>
        <span className={css.breadcrumbSep} aria-hidden="true">›</span>
        <span className={css.breadcrumbCurrent}>{t('provenance.label')}</span>
      </nav>
      <div className={css.subTabs} role="tablist" aria-label={t('provenance.label')}>
        {SUB_TABS.map(({ id, labelKey }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={id === subTab}
            className={id === subTab ? `${css.subTab} ${css.subTabActive}` : css.subTab}
            onClick={() => { onSubTabChange(id) }}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>
      {subTab === 'code' && (run === undefined
        ? <UnavailableRunSection chart={chart} sourceSessionTitle={sourceSessionTitle} t={t} />
        : <CodeSection run={run} block={block} t={t} />)}
      {subTab === 'log' && (run === undefined
        ? <UnavailableRunSection chart={chart} sourceSessionTitle={sourceSessionTitle} t={t} />
        : <ExecutionLogSection run={run} block={block} t={t} />)}
      {subTab === 'messages' && <MessagesSection
        summary={summary} sourceSessionTitle={sourceSessionTitle} returnToConversation={returnToConversation}
        inspectCall={inspectCall} selectDetailed={selectDetailed} producingCallId={producingCallId} t={t} />}
      {subTab === 'environment' && (run === undefined
        ? <UnavailableRunSection chart={chart} sourceSessionTitle={sourceSessionTitle} t={t} />
        : <EnvironmentSection run={run} environment={environment} t={t} />)}
    </div>
  )
}
