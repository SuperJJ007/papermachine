// @vitest-environment jsdom
// ui-science's acceptance chain on the REAL machinery stack: SlotTestRuntime
// (cordis Context + SlotRegistry ledger + the web-react renderer) with
// ui-conversation, ui-tool, and ui-science mounted through their real
// apply() — no hand-built ctx.plugin(...) presentation stub. Proves the
// transcript row → Details column linkage end to end (activating the
// compact `save_chart` row selects the exact version and opens the routed
// Science entry through the real openDetailsView write path), the artifact
// panel's version rail switching, the header actions' provenance/expand
// controls, the one selection-store instance genuinely shared across the
// transcript row, the artifact panel, and the header actions registrations,
// the provenance tab's session-preset gating through the real `ctx.sessions`
// double, and full disposal removing every registration this package adds.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent } from '@testing-library/react'
import type {
  ChatConversationViewNode, ChatSnapshot, ISession, SessionId, ToolResultNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import { conversationContextKey } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotTestRuntime, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply as applyConversation, inject as injectConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { apply as applyTool, inject as injectTool } from '@deepseek-ai/dsh-client-ui-tool/client'
import { apply as applyScience, inject as injectScience } from '../src/client/index.ts'

const SID = 'sci-1' as SessionId
const STANDARD_SID = 'std-1' as SessionId
const CALL_ID = 'call-chart-1'

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

const CHART_META = {
  kind: 'science/chart', version: 1,
  chartId: 'chart-1', logicalName: 'loss-curve', chartVersion: 2,
  title: 'Loss curve', runId: 'run-1',
  attachment: { attachmentId: 'sha256:abc', mediaType: 'image/png', bytes: 100, width: 10, height: 10 },
  createdAt: 1_000,
}

function toolResult(seq: number, callId: string, name: string, meta?: unknown): ToolResultNode {
  return {
    kind: 'tool-result', seq, time: seq * 1_000, callId,
    call: { name, argsRaw: '{}' },
    callTime: seq * 1_000 - 500,
    content: [{ type: 'text', text: 'saved' }], isError: false, callView: null, resultView: null, subCalls: [],
    ...meta === undefined ? {} : { meta },
  }
}

/** Real production key format (matches `conversation-nodes/tool.ts`'s chatNode `context.key`). */
function toolChatSnapshot(nodes: readonly ToolResultNode[]): ChatSnapshot {
  const viewNodes: ChatConversationViewNode[] = nodes.map(root => ({
    key: conversationContextKey('tool-call', root.callId),
    kind: 'tool-call',
    id: root.callId,
    target: 'chat',
    anchorSeq: root.seq,
    location: { kind: 'session' },
    visibility: 'visible',
    data: { root },
  }))
  const byKey = new Map(viewNodes.map(node => [node.key, node]))
  const empty: readonly string[] = []
  return {
    order: viewNodes.map(node => node.key),
    nodes: { get: key => byKey.get(key), values: () => viewNodes },
    locations: { getTurn: () => empty, getStep: () => empty },
    timeline: { turnOrder: [], turns: new Map() },
    legacy: { nodes, runningCalls: [], partial: null, turnTimings: new Map(), turnEnds: new Map() },
  }
}

/** Test-owned root: declares and renders both the resident conversation and Details column. */
type AppRootProps = PropsRenderSlots<'conversation' | 'details'>
function AppRoot({ renderSlot }: AppRootProps) {
  return <>{renderSlot('conversation', {})}{renderSlot('details', {})}</>
}

const LAYOUT_CHILDREN = {
  conversation: { kind: 'single', scope: 'session-maybe' },
  details: { kind: 'single', scope: 'session' },
} as const

async function bench() {
  const runtime = await SlotTestRuntime.create()
  runtime.provide('connection', { api: { settings: {} }, isLoopback: false })
  runtime.provide('remote', { $on: () => () => {} })
  runtime.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  const layout = { openDetails: vi.fn(), closeDetails: vi.fn() }
  runtime.provide('layout', layout)
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.provide('locale', locale)
  runtime.slots.installLocale(locale)

  await runtime.sessions.add({
    id: SID,
    summary: { title: 'Science', displayTitle: 'Science', agentPreset: 'science' },
    snapshot: { nodes: [], chat: toolChatSnapshot([toolResult(3, CALL_ID, 'save_chart', CHART_META)]) },
    session: {
      loadOlder: vi.fn<ISession['loadOlder']>(),
      prompt: vi.fn<ISession['prompt']>(async () => ({ ok: true, value: { accepted: true } })),
      readAttachment: vi.fn<ISession['readAttachment']>(async () => ({
        ok: true,
        value: { attachment: CHART_META.attachment as never, data: new Uint8Array() },
      })),
    },
  })
  // The projection value the artifact panel and header controls read
  // (useProjection('science')) — a separate host-computed push channel from
  // the chat transcript's own tool-result node, so the chart the row
  // presents must also exist here for the panel to resolve it.
  runtime.sessions.behavior(SID).projections.set('science', {
    mode: { modeId: 'science', presetId: 'science', modeRevision: 'r' },
    environment: null,
    runs: [{
      runId: 'run-1', language: 'python', toolCallId: CALL_ID, requestHeaderSeq: 1,
      environmentRevision: 1, environmentFingerprintPreview: 'f'.repeat(12), startedAt: 500,
      codeSha256: 'c'.repeat(64), status: 'success', finishedAt: 900,
      stdoutBytes: 0, stderrBytes: 0, stdoutTruncated: false, stderrTruncated: false,
    }],
    charts: [{
      chartId: CHART_META.chartId, logicalName: CHART_META.logicalName, version: CHART_META.chartVersion,
      title: CHART_META.title, attachment: CHART_META.attachment, runId: 'run-1',
      toolCallId: CALL_ID, requestHeaderSeq: 1, environmentRevision: 1,
      environmentFingerprintPreview: 'f'.repeat(12), createdAt: CHART_META.createdAt,
    }],
    outcome: null,
    metrics: { runCount: 1, successfulRunCount: 1, chartCount: 1, chartVersionCount: 1, outcomeRevision: 0 },
    lastScienceEventSeq: 5,
  })

  await runtime.root.declare(LAYOUT_CHILDREN, AppRoot)
  await runtime.mount({ inject: [...injectConversation], apply: applyConversation })
  await runtime.mount({ inject: [...injectTool], apply: applyTool })
  const scienceHandle = await runtime.mount({ inject: [...injectScience], apply: applyScience })
  return { runtime, slots: runtime.slots, layout, scienceHandle }
}

describe('ui-science on the real machinery stack', () => {
  it('activating the compact transcript row selects the exact version and opens the routed Science Details entry', async () => {
    const b = await bench()
    const view = b.runtime.renderRoot()

    const row = view.container.querySelector('[data-tool="science-chart"]')
    expect(row).not.toBeNull()
    fireEvent.click(row!)

    expect(b.layout.openDetails).toHaveBeenCalledTimes(1)
    const chatStore = b.runtime.storeOf('conversation.view', SID) as { getSnapshot(): { detailsView: string | null } }
    expect(chatStore.getSnapshot().detailsView).toBe('science')

    // The Details column renders the artifact directly in detail mode (the
    // selection the row just wrote): the title appears once in the
    // transcript row and once in the panel's artifact detail, plus a
    // version rail.
    expect(view.getAllByText('Loss curve')).toHaveLength(2)
    expect(await view.findByLabelText('Versions')).toBeTruthy()
    await b.runtime.dispose()
  })

  it('the transcript row, the artifact panel, and the Details header controls all observe the one write the row makes', async () => {
    const b = await bench()
    const view = b.runtime.renderRoot()
    fireEvent.click(view.container.querySelector('[data-tool="science-chart"]')!)

    // If the row's `select` write landed on a store instance different from
    // the one the artifact panel and header controls read, neither would
    // ever see it — the version rail and the two header controls appearing
    // here is exactly the observable proof that all three share one live
    // instance (the framework's own handle × session cache,
    // ui-slots/store.ts), not three independent stores that merely started
    // from the same declaration.
    expect(await view.findByLabelText('Versions')).toBeTruthy()
    const provenanceButton = await view.findByRole('button', { name: 'Provenance' })
    const expandButton = view.getByRole('button', { name: 'Expand' })
    expect(provenanceButton).toBeTruthy()
    expect(expandButton).toBeTruthy()

    fireEvent.click(provenanceButton)
    const chatStore = b.runtime.storeOf('conversation.view', SID) as { getSnapshot(): { view: string | null } }
    await vi.waitFor(() => { expect(chatStore.getSnapshot().view).toBe('science.provenance') })
    await b.runtime.dispose()
  })

  it('the provenance tab is present for the current Science session and absent once a Standard session becomes current', async () => {
    const b = await bench()
    b.runtime.renderRoot()
    // The gate reconciles synchronously against ctx.sessions.list at mount
    // time; the Science session added in bench() is already current.
    expect(b.slots.entries('conversation.view').map(e => e.options.id)).toContain('science.provenance')

    await b.runtime.sessions.add({ id: STANDARD_SID, summary: { title: 'Standard', displayTitle: 'Standard' } })
    expect(b.slots.entries('conversation.view').map(e => e.options.id)).not.toContain('science.provenance')

    await b.runtime.sessions.setCurrent(SID)
    expect(b.slots.entries('conversation.view').map(e => e.options.id)).toContain('science.provenance')
    await b.runtime.dispose()
  })

  it('disposing the ui-science fiber removes every registration this package added, leaving ui-conversation/ui-tool intact', async () => {
    const b = await bench()
    b.runtime.renderRoot()
    expect(b.slots.entries('tool.call.toolview').map(e => (e.options as { key?: string }).key))
      .toEqual(expect.arrayContaining(['save_chart', 'publish_outcome']))
    expect(b.slots.entries('conversation.details.view').map(e => e.options.id)).toContain('science')
    expect(b.slots.entries('conversation.details.header.actions').map(e => (e.options as { key?: string }).key))
      .toContain('science')
    expect(b.slots.entries('conversation.view').map(e => e.options.id)).toContain('science.provenance')
    expect(b.slots.entries('conversation.session.header.actions').map(e => e.options.id)).toContain('science')

    await b.scienceHandle.dispose()

    expect(b.slots.entries('tool.call.toolview').map(e => (e.options as { key?: string }).key))
      .not.toEqual(expect.arrayContaining(['save_chart', 'publish_outcome']))
    expect(b.slots.entries('conversation.details.view').map(e => e.options.id)).not.toContain('science')
    expect(b.slots.entries('conversation.details.header.actions')).toHaveLength(0)
    expect(b.slots.entries('conversation.view').map(e => e.options.id)).not.toContain('science.provenance')
    expect(b.slots.entries('conversation.session.header.actions')).toHaveLength(0)
    // ui-tool's own bash sample (mounted by applyTool, not applyScience)
    // survives the ui-science fiber's disposal.
    expect(b.slots.entries('conversation.chat.node').map(e => (e.options as { key?: string }).key)).toContain('tool-call')
    await b.runtime.dispose()
  })
})
