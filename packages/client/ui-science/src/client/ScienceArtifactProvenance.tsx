// The provenance drill-in: an in-panel breadcrumb (`<name> › Provenance`)
// over four sub-tabs — Code, Execution log, Messages, Environment — for one
// resolved artifact version. Reached from the artifact viewer's toolbar
// ("Provenance"); the breadcrumb's root segment returns to the content view.
// Resolution (which chart/run this bundle is for) is the caller's job
// (ScienceDetailsView.tsx) — this component always renders for a chart/run
// pair that already resolved, so it carries no "no selection"/"unavailable"
// branch of its own.

import { CodeBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConversationNode, ConversationSnapshot, ToolCallBlock, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: ChatNode narrows the generic view-node store's value for the
// 'tool-call' target the same way ui-conversation's own tool-node reader does.
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { conversationContextKey } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ScienceClientArtifactVersion, ScienceClientEnvironmentBinding, ScienceClientRun,
} from '@deepseek-ai/dsh-science-session/types'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ScienceProvenanceSubTab } from './selection-store.ts'
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
  chart: ScienceClientArtifactVersion
  run: ScienceClientRun
  environment: ScienceClientEnvironmentBinding | null | undefined
  snapshot: ConversationSnapshot
  subTab: ScienceProvenanceSubTab
  onSubTabChange: (subTab: ScienceProvenanceSubTab) => void
  onBack: () => void
  inspectCall: (callId: string) => void
  /** Select the detailed trajectory subview before inspecting one call. */
  selectDetailed: () => void
  currentSessionId: SessionId
  sourceSessionTitle: string | undefined
  returnToConversation: (anchorKey: string) => void
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

/** Resolve one root run_python/run_r call through the internal Chat Node index (direct-dispatch calls are always root). */
function resolveRunCall(snapshot: ConversationSnapshot, toolCallId: string): ToolCallBlock | undefined {
  const node = snapshot.chat.nodes.get(conversationContextKey('tool-call', toolCallId))
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
  chart, run, summary, currentSessionId, sourceSessionTitle, returnToConversation, inspectCall, selectDetailed, t,
}: {
  chart: ScienceClientArtifactVersion
  run: ScienceClientRun
  summary: ReturnType<typeof generationSummary>
  currentSessionId: SessionId
  sourceSessionTitle: string | undefined
  returnToConversation: (anchorKey: string) => void
  inspectCall: (callId: string) => void
  selectDetailed: () => void
  t: TranslateNS<'science'>
}) {
  if (summary === undefined) return <section className={css.section}><p className={css.notice}>{t('provenance.messages.pending')}</p></section>
  const local = chart.producerSessionId === currentSessionId
  return (
    <section className={css.messagesSection}>
      <div className={css.messageSummary}><span>{t('provenance.messages.question')}</span><p>{summary.user}</p></div>
      <div className={css.messageSummary}><span>{t('provenance.messages.result')}</span><p>{summary.agent}</p></div>
      {local
        ? <div className={css.messageActions}>
          <button type="button" className={css.primaryAction} onClick={() => { returnToConversation(summary.anchorKey) }}>{t('provenance.messages.conversation')}</button>
          <button type="button" className={css.secondaryAction} onClick={() => { selectDetailed(); inspectCall(run.toolCallId) }}>{t('provenance.messages.trajectory')}</button>
        </div>
        : <p className={css.sourceSession}><span>{t('provenance.messages.sourceSession')}</span>{sourceSessionTitle ?? chart.producerSessionId}</p>}
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
 * @param props - the resolved chart/run pair, the current environment
 * binding, the conversation snapshot, the active sub-tab and its setter, the
 * back-to-content callback, the transcript jump handoff, and the locale seat.
 * @returns the drill-in body.
 */
export function ScienceArtifactProvenance({
  chart, run, environment, snapshot, subTab, onSubTabChange, onBack, inspectCall, selectDetailed,
  currentSessionId, sourceSessionTitle, returnToConversation, t,
}: ScienceArtifactProvenanceProps) {
  const block = resolveRunCall(snapshot, run.toolCallId)
  const summary = generationSummary(snapshot, run.toolCallId)

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
      {subTab === 'code' && <CodeSection run={run} block={block} t={t} />}
      {subTab === 'log' && <ExecutionLogSection run={run} block={block} t={t} />}
      {subTab === 'messages' && <MessagesSection chart={chart} run={run} summary={summary}
        currentSessionId={currentSessionId} sourceSessionTitle={sourceSessionTitle}
        returnToConversation={returnToConversation} inspectCall={inspectCall} selectDetailed={selectDetailed} t={t} />}
      {subTab === 'environment' && <EnvironmentSection run={run} environment={environment} t={t} />}
    </div>
  )
}
