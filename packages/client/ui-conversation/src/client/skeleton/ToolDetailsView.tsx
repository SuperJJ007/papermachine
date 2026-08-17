// ToolDetailsView: the built-in `tool` entry of the Details column's routed
// body — args as JSON, the result raw except for a terminal-card call, whose
// Output section is the command's terminal card. Reads the selection from
// the shared chat store (conversation writes, this entry reads — the
// cross-registration share the store seat exists for) and derives the call
// material from the session snapshot — no data of its own. The Details shell
// (DetailsPanel) owns title chrome and close behavior; this entry owns only
// the body content dispatched into it.

import { Fragment } from 'react'
import { CodeBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import { shallowEqual } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConversationSnapshot, RunningToolCall, ToolCallBlock, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { ToolDetailsViewProps } from '../contract/slots.ts'
import { findToolCall } from '../chat/tool-node-reader.ts'
import css from './DetailsPanel.module.css'

/**
 * Selected call material: the call's display name and args plus the frozen
 * block slice it came from. `block` is a snapshot-cached reference, so the
 * wrapper stays shallow-equal across unrelated snapshot frames; the settled /
 * running split is read off it with the `'kind' in block` discrimination
 * instead of duplicated as flags.
 */
export interface CallMaterial {
  name: string
  argsRaw: string | null
  block: ToolCallBlock
}

/** Material of a settled result node (native call or run_code sub-dispatch). */
function settledMaterial(node: ToolResultNode, callId: string): CallMaterial {
  return { name: node.call?.name ?? callId, argsRaw: node.call?.argsRaw ?? null, block: node }
}

/** Material of an in-flight call (native call or run_code sub-dispatch). */
function runningMaterial(call: RunningToolCall): CallMaterial {
  return { name: call.name, argsRaw: call.argsRaw, block: call }
}

/**
 * Resolve the selected call's display material from a session snapshot.
 * Shared by the Details shell (title) and this entry (body): both read the
 * same session state, so they stay consistent without one deriving from
 * the other.
 * @param s - conversation snapshot to search.
 * @param callId - the selected call's identity.
 * @returns the resolved material, or null when the call is outside the current window.
 */
export function materialFor(s: ConversationSnapshot, callId: string): CallMaterial | null {
  const found = findToolCall(s, callId)
  if (found === undefined) return null
  return 'kind' in found ? settledMaterial(found, callId) : runningMaterial(found)
}

function pretty(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    // Not JSON (streaming fragment or plain text): show verbatim.
    return raw
  }
}

/** Flatten a settled result for the no-ui-tool fallback. */
function rawResultText(block: ToolCallBlock): string {
  if (!('kind' in block)) return ''
  const parts = block.content.map(item => item.type === 'text' ? item.text : JSON.stringify(item, null, 2))
  if (parts.length === 0 && block.error !== undefined) parts.push(`${block.error.name}: ${block.error.code}`)
  return parts.join('\n')
}

/**
 * Renders the built-in `tool` Details entry: the selected call's Input/Output
 * sections over the keyed `conversation.details.tool` child seat.
 * @param props - Details entry runtime, store, render, and locale shares.
 * @returns the empty/not-in-window/running states, or the Input/Output sections.
 */
export function ToolDetailsView({ useSession, useSessions, sessionId, useStore, renderSlot, t }: ToolDetailsViewProps) {
  const selection = useStore(s => s.selection)
  // Session workspace root: an omitted or relative terminal cwd resolves
  // against it, which the pure presenter cannot see.
  const sessionCwd = useSessions(list => list.byId[sessionId]?.cwd)
  const callId = selection?.callId
  // materialFor builds a fresh wrapper; shallowEqual short-circuits on its
  // stable members (result node reference rides the snapshot's structural sharing).
  const material = useSession(
    s => (callId === undefined ? null : materialFor(s, callId)),
    (a, b) => shallowEqual(a, b))

  if (selection === null || callId === undefined) return <div className={css.empty}>{t('details.empty')}</div>
  if (material === null) return <div className={css.empty}>{t('details.notInWindow')}</div>

  return (
    <>
      {material.argsRaw !== null && (
        <section className={css.section}>
          <div className={css.sectionLabel}>{t('details.input')}</div>
          <CodeBlock code={pretty(material.argsRaw)} lang="json" copyLabel={t('copy')} copiedLabel={t('copied')} />
        </section>
      )}
      <section className={css.section}>
        <div className={css.sectionLabel}>{t('details.output')}</div>
        {/* Keyed by the selected call: the body owns per-call view
            state (the terminal card's expand and copy), which React
            would otherwise carry into the next selection because this
            entry does not unmount between calls. */}
        <Fragment key={callId}>
          {renderSlot('conversation.details.tool', { block: material.block, cwd: sessionCwd }, {
            fallback: 'kind' in material.block
              ? (
                <pre className={css.code} data-error={material.block.isError || undefined}>
                  {rawResultText(material.block)}
                </pre>
              )
              : <div className={css.empty}>{t('details.running')}</div>,
          })}
        </Fragment>
      </section>
    </>
  )
}
