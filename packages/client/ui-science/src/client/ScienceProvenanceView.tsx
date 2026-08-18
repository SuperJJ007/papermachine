// Provenance view: a `conversation.view` tab (id `science.provenance`) that
// resolves the four-part provenance bundle for the ui-science selection
// store's selected artifact version — code, execution log, conversation
// turn, and environment — from the same `science` projection and the
// conversation snapshot the transcript already loads. `apply.ts` registers
// this entry only while the current session names the `science` preset (the
// gate a `conversation.view` tab needs to be absent, not merely empty, for a
// Standard or custom session — `views.list()` is a static registration
// ledger, not session-filtered); this component re-checks the same fact so a
// stale registration can never render for the wrong session.

import { CodeBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import {
  conversationContextKey,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ConversationSnapshot, ToolCallBlock, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: ChatNode narrows the generic view-node store's value for the
// 'tool-call' target the same way ui-conversation's own tool-node reader does.
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  ScienceClientChartVersion, ScienceClientEnvironmentBinding, ScienceClientProjection, ScienceClientRun,
} from '@deepseek-ai/dsh-science-session/types'
import type { ScienceSelectionStore } from './selection-store.ts'
import css from './ScienceProvenanceView.module.css'

/** Full props for the provenance view: runtime + selection store + locale seat. */
export type ScienceProvenanceViewProps =
  PropsRuntime<'conversation.view'> & PropsStore<ScienceSelectionStore> & PropsLocale<'science'>

/** The material one artifact version resolves before code/log/environment can render. */
interface ArtifactMaterial {
  readonly chart: ScienceClientChartVersion
  readonly run: ScienceClientRun
}

/** Resolve the selected artifact's chart and source-run projection records. */
function resolveArtifact(
  science: ScienceClientProjection | null | undefined,
  selected: { chartId: string; version: number },
): ArtifactMaterial | null {
  const chart = science?.charts.find(candidate => candidate.chartId === selected.chartId && candidate.version === selected.version)
  if (chart === undefined) return null
  const run = science?.runs.find(candidate => candidate.runId === chart.runId)
  if (run === undefined) return null
  return { chart, run }
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

/** Browser-locale timestamp; no fixed format is imposed on the reader's Intl settings. */
function formatTime(ms: number): string {
  return new Date(ms).toLocaleString()
}

function CodeSection({ run, block, t }: { run: ScienceClientRun; block: ToolCallBlock | undefined; t: TranslateNS<'science'> }) {
  const code = parseCode(resolveArgsRaw(block))
  return (
    <section className={css.section}>
      <div className={css.sectionLabel}>{t('provenance.code.title')}</div>
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
      <div className={css.sectionLabel}>{t('provenance.log.title')}</div>
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

function ConversationSection({ run, inspectCall, t }: {
  run: ScienceClientRun
  inspectCall: (callId: string) => void
  t: TranslateNS<'science'>
}) {
  return (
    <section className={css.section}>
      <div className={css.sectionLabel}>{t('provenance.conversation.title')}</div>
      <p className={css.anchor}>
        {t('provenance.conversation.turn', { requestHeaderSeq: run.requestHeaderSeq, startedAt: formatTime(run.startedAt) })}
      </p>
      <button type="button" className={css.jumpButton} onClick={() => { inspectCall(run.toolCallId) }}>
        {t('provenance.conversation.jump')}
      </button>
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
      <div className={css.sectionLabel}>{t('provenance.environment.title')}</div>
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
 * Render the four-part provenance bundle for the selection store's current
 * artifact version.
 * @param props - runtime slot currency, the shared selection store, and the science locale seat.
 * @returns the provenance tab body.
 */
export function ScienceProvenanceView({
  sessionId, useSessions, useSession, useProjection, useStore, inspectCall, t,
}: ScienceProvenanceViewProps) {
  const preset = useSessions(state => state.byId[sessionId]?.agentPreset)
  const selected = useStore(s => s.selected)
  const science = useProjection('science')
  const snapshot = useSession(s => s)

  if (preset !== 'science') return null

  if (selected === null) {
    return (
      <div className={css.body}>
        <p className={css.notice} role="status">{t('provenance.noSelection')}</p>
      </div>
    )
  }

  const material = resolveArtifact(science, selected)
  if (material === null) {
    return (
      <div className={css.body}>
        <p className={css.notice} role="status">{t('provenance.artifactUnavailable')}</p>
      </div>
    )
  }

  const { run } = material
  const block = resolveRunCall(snapshot, run.toolCallId)

  return (
    <div className={css.body}>
      <CodeSection run={run} block={block} t={t} />
      <ExecutionLogSection run={run} block={block} t={t} />
      <ConversationSection run={run} inspectCall={inspectCall} t={t} />
      <EnvironmentSection run={run} environment={science?.environment} t={t} />
    </div>
  )
}
