/**
 * Generic Tool grouping: adjacent `tool-call` Chat Nodes (≥ 2, unbroken by
 * any other row kind) collect under one auto-generated group title. This is
 * ordinary main-chat behavior for every Session — the wire tool name is the
 * only thing this module reads, so a domain package's own registered
 * `tool.call.toolview` (Science's `run_python`/`run_r` included) never needs
 * importing here. Failure counts read the structured settled result
 * (`isError`), never the flattened result text.
 */
import type { ConversationSnapshot, ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { isSettledTool } from '../contract/chat-nodes.ts'
import type { ChatNode } from '../contract/chat-nodes.ts'

/** One rendered flow entry: an ungrouped Node, or an adjacent-tool-call group. */
export type ChatFlowEntry =
  | { readonly kind: 'single'; readonly key: string }
  | { readonly kind: 'group'; readonly groupKey: string; readonly keys: readonly string[] }

/**
 * Fold the flow order into ungrouped rows and adjacent-tool-call runs of two
 * or more. A run of exactly one `tool-call` key stays ungrouped — the same
 * single-row cell it always was.
 * @param order - the Session's current rendered Node key order.
 * @param kindOf - resolve one key's current Chat Node kind (absent for a key
 *   not yet materialized, treated as a boundary).
 * @returns the flow entries in the same order, tool-call runs folded.
 */
export function groupAdjacentToolNodes(
  order: readonly string[],
  kindOf: (key: string) => string | undefined,
): readonly ChatFlowEntry[] {
  const entries: ChatFlowEntry[] = []
  let run: string[] = []
  // Captured directly off the first push, rather than read back from `run`,
  // so the group key never needs an index-access assertion.
  let runStart: string | null = null
  const flushRun = (): void => {
    if (runStart === null) return
    entries.push(
      run.length === 1
        ? { kind: 'single', key: runStart }
        : { kind: 'group', groupKey: `tool-group:${runStart}`, keys: run },
    )
    run = []
    runStart = null
  }
  for (const key of order) {
    if (kindOf(key) === 'tool-call') {
      if (runStart === null) runStart = key
      run.push(key)
      continue
    }
    flushRun()
    entries.push({ kind: 'single', key })
  }
  flushRun()
  return entries
}

/** Wire tool name off either lifecycle form, matching `ToolCallTree`'s own `callName`. */
function callName(root: ToolCallBlock): string {
  return isSettledTool(root) ? root.call?.name ?? '' : root.name
}

/** Declared render-intent card, when the tool named one (Science's own rows never do). */
function callCard(root: ToolCallBlock): string | undefined {
  return isSettledTool(root) ? root.resultView?.card : root.callView?.card
}

/** Generic category a group title buckets a member into. */
export type ToolGroupCategory = 'run' | 'read' | 'search' | 'edit' | 'skill' | 'other'

const RUN_NAMES = new Set(['run_python', 'run_r', 'bash', 'pwsh'])
const READ_NAMES = new Set(['read', 'glob', 'grep'])
const SEARCH_NAMES = new Set(['web_search', 'web_fetch'])
const EDIT_NAMES = new Set(['write', 'edit'])
const SKILL_NAMES = new Set(['skill'])

/** Category display order in a mixed-category title. */
const CATEGORY_ORDER: readonly ToolGroupCategory[] = ['run', 'read', 'search', 'edit', 'skill', 'other']

/**
 * Classify one call by its wire name, falling back to its declared
 * render-intent card for a name this module does not otherwise recognize
 * (any tool declaring `card:'terminal'`, `'read'`, `'diff'`, or `'web'`
 * reaches the matching bucket without a name literal here). `grep`/`glob`
 * declare `card:'search'` in `ui-tool`'s own vocabulary but bucket as this
 * module's "read" category — the two "search" words name different things.
 * @param name - the call's wire tool name.
 * @param card - the call's declared render-intent card, if any.
 * @returns the bucket this call's row belongs to.
 */
export function classifyToolCategory(name: string, card: string | undefined): ToolGroupCategory {
  if (RUN_NAMES.has(name) || card === 'terminal') return 'run'
  if (READ_NAMES.has(name) || card === 'read' || card === 'search') return 'read'
  if (SEARCH_NAMES.has(name) || card === 'web') return 'search'
  if (EDIT_NAMES.has(name) || card === 'diff') return 'edit'
  if (SKILL_NAMES.has(name)) return 'skill'
  return 'other'
}

/** Generated group title, plus the "N steps · M failed" meta counts. */
export interface ToolGroupSummary {
  readonly title: string
  readonly steps: number
  readonly failed: number
}

/**
 * Generate one group's title and step/failure counts from its members'
 * current root lifecycle values.
 * @param roots - each member's root Tool lifecycle, in flow order.
 * @param t - the conversation locale seat.
 * @returns the generated summary.
 */
export function summarizeToolGroup(roots: readonly ToolCallBlock[], t: TranslateNS<'conversation'>): ToolGroupSummary {
  const counts = new Map<ToolGroupCategory, number>()
  let failed = 0
  for (const root of roots) {
    const category = classifyToolCategory(callName(root), callCard(root))
    counts.set(category, (counts.get(category) ?? 0) + 1)
    if (isSettledTool(root) && root.isError) failed += 1
  }
  const phrases = CATEGORY_ORDER
    .map(category => ({ category, count: counts.get(category) ?? 0 }))
    .filter(entry => entry.count > 0)
    .map(entry => t(`group.category.${entry.category}`, { count: entry.count }))
  return { title: phrases.join(t('group.categorySeparator')), steps: roots.length, failed }
}

/**
 * Resolve one group's member root Tool lifecycles from the current snapshot,
 * dropping a key not yet materialized (a member Node the window has not
 * loaded this render) rather than throwing.
 * @param keys - the group's member Node keys, in flow order.
 * @param nodes - the Session's current Chat Node store.
 * @returns each materialized member's root lifecycle, in the same order.
 */
export function resolveGroupRoots(
  keys: readonly string[],
  nodes: ConversationSnapshot['chat']['nodes'],
): readonly ToolCallBlock[] {
  const roots: ToolCallBlock[] = []
  for (const key of keys) {
    const node = nodes.get(key)
    if (node?.kind !== 'tool-call') continue
    roots.push((node as ChatNode<'tool-call'>).data.root)
  }
  return roots
}
