/** User-facing semantic swimlane projected from the real conversation nodes. */

import { useMemo, useState } from 'react'
import {
  IconCodeOutline16, IconFolderOpenOutline16, IconThinkOutline16, IconUserOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConversationNode } from '@deepseek-ai/dsh-client-runtime/client'
import css from './ScienceTraceView.module.css'

type Lane = 'intent' | 'reasoning' | 'tools' | 'evidence'

interface TraceStep {
  readonly key: string
  readonly turn: number
  readonly lane: Lane
  readonly label: string
  readonly detail: string
  readonly callId?: string
}

function contentText(content: Extract<ConversationNode, { kind: 'user' }>['content']): string {
  return content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n').trim()
}

function brief(text: string, fallback: string): string {
  const oneLine = text.replace(/\s+/gu, ' ').trim()
  return oneLine === '' ? fallback : oneLine.slice(0, 96)
}

function traceSteps(nodes: readonly ConversationNode[], t: ScienceTraceViewProps['t']): TraceStep[] {
  const steps: TraceStep[] = []
  let currentTurn = 0
  for (const node of nodes) {
    switch (node.kind) {
      case 'user':
      case 'steering': {
        currentTurn += 1
        const text = contentText(node.content)
        steps.push({ key: `${node.kind}:${String(node.seq)}`, turn: currentTurn, lane: 'intent', label: brief(text, t('trace.user')), detail: text })
        break
      }
      case 'assistant': {
        currentTurn = Math.max(currentTurn, node.turn)
        for (const [index, block] of node.blocks.entries()) {
          if (block.kind === 'reasoning') {
            steps.push({ key: `reasoning:${String(node.seq)}:${String(index)}`, turn: currentTurn, lane: 'reasoning', label: brief(block.text, t('trace.reasoning')), detail: block.text })
          } else if (block.kind === 'tool-call') {
            steps.push({ key: `call:${block.callId}`, turn: currentTurn, lane: 'tools', label: block.name, detail: block.argsRaw, callId: block.callId })
          } else if (block.kind === 'text' && block.text.trim() !== '') {
            steps.push({ key: `answer:${String(node.seq)}:${String(index)}`, turn: currentTurn, lane: 'evidence', label: brief(block.text, t('trace.answer')), detail: block.text })
          }
        }
        break
      }
      case 'tool-result': {
        const label = node.call?.name ?? node.callId
        const text = contentText(node.content)
        steps.push({ key: `result:${String(node.seq)}`, turn: Math.max(1, currentTurn), lane: 'tools', label, detail: text || (node.isError ? t('trace.failed') : t('trace.completed')), callId: node.callId })
        break
      }
      case 'command':
        steps.push({ key: `command:${String(node.seq)}`, turn: Math.max(1, currentTurn), lane: 'tools', label: node.name ?? t('trace.command'), detail: node.args ?? '' })
        break
      case 'model-retry':
        steps.push({ key: `retry:${String(node.seq)}`, turn: Math.max(1, currentTurn), lane: 'reasoning', label: t('trace.retry'), detail: node.failure.message || node.failure.code })
        break
      case 'turn-error':
        steps.push({ key: `error:${String(node.seq)}`, turn: node.turn, lane: 'evidence', label: t('trace.failed'), detail: node.message })
        break
      case 'turn-max-tokens':
        steps.push({ key: `limit:${String(node.seq)}`, turn: node.turn, lane: 'evidence', label: t('trace.maxTokens'), detail: t('trace.maxTokens') })
        break
      case 'context':
      case 'compaction':
      case 'unknown':
        break
      default: break
    }
  }
  return steps
}

const LANE_ICONS = {
  intent: IconUserOutline16,
  reasoning: IconThinkOutline16,
  tools: IconCodeOutline16,
  evidence: IconFolderOpenOutline16,
} as const

/** Full props for the real semantic trace view. */
export type ScienceTraceViewProps = ConvViewProps & PropsLocale<'trajectory'>

/** Render real session events as turns with compact semantic role accents. */
export function ScienceTraceView({ useSession, inspectCall, t }: ScienceTraceViewProps) {
  const nodes = useSession(snapshot => snapshot.nodes)
  const steps = useMemo(() => traceSteps(nodes, t), [nodes, t])
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const turns = [...new Set(steps.map(step => step.turn))]
  return (
    <section className={css.root} data-conversation-composer-overlay="">
      <header className={css.header}>
        <div><span className={css.eyebrow}>{t('trace.eyebrow')}</span><h2>{t('view.trace')}</h2></div>
        <span className={css.summary}>{t('trace.summary', { turns: turns.length, steps: steps.length })}</span>
      </header>
      {steps.length === 0
        ? <p className={css.empty}>{t('trace.empty')}</p>
        : (
          <div className={css.flow}>
            {turns.map(turn => (
              <section className={css.turn} key={turn}>
                <div className={css.turnLabel}>{t('trace.turn', { turn })}</div>
                <div className={css.steps}>
                  {steps.filter(step => step.turn === turn).map((step, index) => {
                    const Icon = LANE_ICONS[step.lane]
                    const open = expanded.has(step.key)
                    const callId = step.callId
                    return (
                      <div className={css.slot} data-side={index % 2 === 0 ? 'left' : 'right'} key={step.key}>
                        <button type="button" className={css.card} data-lane={step.lane} aria-expanded={open} onDoubleClick={callId === undefined ? undefined : () => { inspectCall(callId) }} onClick={() => {
                          setExpanded((current) => {
                            const next = new Set(current)
                            if (next.has(step.key)) next.delete(step.key); else next.add(step.key)
                            return next
                          })
                        }}>
                          <span className={css.head}><Icon size={14} /><b>{step.label}</b></span>
                          <span className={css.lane}>{t(`trace.lane.${step.lane}`)}</span>
                          {open && <span className={css.detail}>{step.detail}</span>}
                        </button>
                      </div>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
    </section>
  )
}
