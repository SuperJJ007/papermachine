/** Message-side code, execution log, and environment facts for one Science run. */

import { CodeBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { conversationContextKey } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConversationSnapshot, ToolCallBlock, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ScienceClientRun } from '@deepseek-ai/dsh-science-session/types'
import css from './ScienceRunDetails.module.css'

function resolveRunCall(snapshot: ConversationSnapshot, toolCallId: string): ToolCallBlock | undefined {
  const node = snapshot.chat.nodes.get(conversationContextKey('tool-call', toolCallId))
  return node?.kind === 'tool-call' ? (node as ChatNode<'tool-call'>).data.root : undefined
}

function resultText(content: ToolResultNode['content']): string {
  return content.map(item => item.type === 'text' ? item.text : JSON.stringify(item, null, 2)).join('\n')
}

function argsRaw(block: ToolCallBlock | undefined): string | null {
  if (block === undefined) return null
  return 'kind' in block ? block.call?.argsRaw ?? null : block.argsRaw
}

function codeOf(block: ToolCallBlock | undefined): string | null {
  const raw = argsRaw(block)
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null && typeof (parsed as { code?: unknown }).code === 'string'
      ? (parsed as { code: string }).code : null
  } catch {
    return null
  }
}

function outputOf(block: ToolCallBlock | undefined): string | null {
  return block === undefined || !('kind' in block) ? null : resultText(block.content)
}

/** Render expandable run facts without copying the assistant's prose answer. */
export function ScienceRunDetails({ run, snapshot, t }: {
  run: ScienceClientRun
  snapshot: ConversationSnapshot
  t: TranslateNS<'science'>
}) {
  const block = resolveRunCall(snapshot, run.toolCallId)
  const code = codeOf(block)
  const output = outputOf(block)
  return <div className={css.root}>
    <section>
      <h4>{t('provenance.code.title')}</h4>
      <p>{t('provenance.code.anchor', { sha256: run.codeSha256 })}</p>
      {code === null ? <p role="status">{t('provenance.code.pending')}</p>
        : <CodeBlock code={code} lang={run.language} copyLabel={t('copy')} copiedLabel={t('copied')} />}
    </section>
    <section>
      <h4>{t('provenance.log.title')}</h4>
      {run.status === 'running' ? <p role="status">{t('provenance.log.running')}</p>
        : output === null ? <p role="status">{t('provenance.log.pending')}</p>
          : <CodeBlock code={output} lang="text" copyLabel={t('copy')} copiedLabel={t('copied')} />}
    </section>
    <section>
      <h4>{t('provenance.environment.title')}</h4>
      <p>{t('provenance.environment.run', {
        revision: run.environmentRevision, fingerprintPreview: run.environmentFingerprintPreview,
      })}</p>
    </section>
  </div>
}
