// ToolGroup: the generic wrapper for ≥2 adjacent `tool-call` Chat Nodes
// (CS-TURN-RENDERING-SPEC.md §2/3). The group title/meta line is a pure
// derivation off the members' current root Tool lifecycles
// (`summarizeToolGroup`); each member still renders through the ordinary
// `ChatNodeSeat` — this file never touches Tool presentation itself, so a
// domain package's own keyed toolview (Science's `run_python`/`run_r`
// included) renders inside a group exactly as it would ungrouped. Both the
// group's open/closed state and each member's own fold state are UI-only:
// neither is logged or projected into a provider request, and both restore
// to their defaults (group closed, member folded) on every reload.

import { useState } from 'react'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNodeOwnerProps, ChatViewSlotProps } from '../contract/slots.ts'
import { resolveGroupRoots, summarizeToolGroup } from './tool-group.ts'
import { ChatNodeSeat } from './ChatNodeSeat.tsx'
import css from './ToolGroup.module.css'

interface ToolGroupProps extends Omit<ChatNodeOwnerProps, 'attachedReasoning'> {
  readonly groupKey: string
  readonly keys: readonly string[]
  readonly useSession: ChatViewSlotProps['useSession']
  readonly renderSlot: ChatViewSlotProps['renderSlot']
  readonly t: ChatViewSlotProps['t']
  /** Successor key -> attached reasoning texts (`reasoning-attach.ts`); a member key may own one. */
  readonly reasoningByKey: ReadonlyMap<string, readonly string[]>
}

/** One auto-titled group over adjacent Tool call rows, closed by default. */
export function ToolGroup({ groupKey, keys, useSession, renderSlot, t, reasoningByKey, ...owner }: ToolGroupProps) {
  const [open, setOpen] = useState(false)
  const roots = useSession(snapshot => resolveGroupRoots(keys, snapshot.chat.nodes))
  const summary = summarizeToolGroup(roots, t)
  return (
    <div className={css.root} data-tool-group={groupKey}>
      <button
        type="button"
        className={css.header}
        aria-expanded={open}
        onClick={() => { setOpen(value => !value) }}
      >
        <span className={css.caret} data-open={open || undefined}><IconChevronDownOutline14 /></span>
        <span className={css.body}>
          <span className={css.title}>{summary.title}</span>
          <span className={css.meta}>
            {summary.failed > 0
              ? t('group.stepsFailed', { count: summary.steps, failed: summary.failed })
              : t('group.steps', { count: summary.steps })}
          </span>
        </span>
      </button>
      {open && (
        <div className={css.members}>
          {keys.map(key => (
            <ChatNodeSeat
              key={key}
              nodeKey={key}
              useSession={useSession}
              renderSlot={renderSlot}
              t={t}
              attachedReasoning={reasoningByKey.get(key)}
              {...owner}
            />
          ))}
        </div>
      )}
    </div>
  )
}
