// @vitest-environment jsdom
// ui-science's acceptance chain on the REAL machinery stack: SlotTestRuntime
// (cordis Context + SlotRegistry ledger + the web-react renderer) with
// ui-conversation, ui-tool, and ui-science mounted through their real
// apply() — no hand-built ctx.plugin(...) presentation stub. Proves the
// transcript row → Details column linkage end to end (activating the
// compact `annotate_artifact` row opens that exact version's tab through the
// real openDetailsView write path), the one selection-store instance
// genuinely shared across the transcript row and the artifact viewer, the
// toolbar's provenance control switching to the drill-in, the drill-in's
// Messages sub-tab reaching DetailsPanel's real `inspectCall` owner callback
// (the one ui-conversation touch this redesign made — proven here on the
// real render tree, not a mock), and full disposal removing every
// registration this package adds.

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
const CALL_ID = 'call-artifact-1'

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

const ARTIFACT_ITEM = {
  artifactId: 'chart-1', logicalName: 'loss-curve.png', version: 2,
  title: 'Loss curve',
  attachment: { attachmentId: 'sha256:abc', mediaType: 'image/png', bytes: 100, width: 10, height: 10 },
}
const ARTIFACT_META = { kind: 'science/artifact', version: 1, artifacts: [ARTIFACT_ITEM] }

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
    snapshot: { nodes: [], chat: toolChatSnapshot([toolResult(3, CALL_ID, 'annotate_artifact', ARTIFACT_META)]) },
    session: {
      loadOlder: vi.fn<ISession['loadOlder']>(),
      prompt: vi.fn<ISession['prompt']>(async () => ({ ok: true, value: { accepted: true } })),
      readAttachment: vi.fn<ISession['readAttachment']>(async () => ({
        ok: true,
        value: { attachment: ARTIFACT_ITEM.attachment as never, data: new Uint8Array() },
      })),
      readTextAttachment: vi.fn<ISession['readTextAttachment']>(async () => ({
        ok: true,
        value: { attachment: { attachmentId: 'sha256:txt', mediaType: 'text/plain', bytes: 0 } as never, data: '' },
      })),
    },
  })
  // The projection value the artifact viewer reads (useProjection('science'))
  // — a separate host-computed push channel from the chat transcript's own
  // tool-result node, so the artifact the row presents must also exist here
  // for the viewer to resolve it.
  runtime.sessions.behavior(SID).projections.set('science', {
    mode: { modeId: 'science', presetId: 'science', modeRevision: 'r' },
    environment: null,
    runs: [{
      runId: 'run-1', language: 'python', toolCallId: CALL_ID, requestHeaderSeq: 1,
      environmentRevision: 1, environmentFingerprintPreview: 'f'.repeat(12), startedAt: 500,
      codeSha256: 'c'.repeat(64), status: 'success', finishedAt: 900,
      stdoutBytes: 0, stderrBytes: 0, stdoutTruncated: false, stderrTruncated: false,
    }],
    artifacts: [{
      artifactId: ARTIFACT_ITEM.artifactId, logicalName: ARTIFACT_ITEM.logicalName, version: ARTIFACT_ITEM.version,
      title: ARTIFACT_ITEM.title, origin: 'model', attachment: ARTIFACT_ITEM.attachment, runId: 'run-1',
      toolCallId: CALL_ID, requestHeaderSeq: 1, environmentRevision: 1,
      environmentFingerprintPreview: 'f'.repeat(12), createdAt: 1_000,
    }],
    outcome: null,
    metrics: { runCount: 1, successfulRunCount: 1, artifactCount: 1, artifactVersionCount: 1, outcomeRevision: 0 },
    lastScienceEventSeq: 5,
  })

  await runtime.root.declare(LAYOUT_CHILDREN, AppRoot)
  await runtime.mount({ inject: [...injectConversation], apply: applyConversation })
  await runtime.mount({ inject: [...injectTool], apply: applyTool })
  const scienceHandle = await runtime.mount({ inject: [...injectScience], apply: applyScience })
  return { runtime, slots: runtime.slots, layout, scienceHandle }
}

describe('ui-science on the real machinery stack', () => {
  it('activating the compact transcript row opens that exact version\'s tab in the routed Science Details entry', async () => {
    const b = await bench()
    const view = b.runtime.renderRoot()

    const row = view.container.querySelector('[data-tool="science-artifact"]')
    expect(row).not.toBeNull()
    fireEvent.click(row!)

    expect(b.layout.openDetails).toHaveBeenCalledTimes(1)
    const chatStore = b.runtime.storeOf('conversation.view', SID) as { getSnapshot(): { detailsView: string | null } }
    expect(chatStore.getSnapshot().detailsView).toBe('science')

    // The Details column renders the artifact directly in its content view
    // (the tab the row just opened): the title appears once in the
    // transcript row and once in the viewer's own toolbar, plus a tab.
    expect(view.getAllByText('Loss curve')).toHaveLength(3)
    expect(await view.findByRole('tab', { name: 'Loss curve' })).toBeTruthy()
    await b.runtime.dispose()
  })

  it('the transcript row and the artifact viewer observe the one write the row makes (shared selection store)', async () => {
    const b = await bench()
    const view = b.runtime.renderRoot()
    fireEvent.click(view.container.querySelector('[data-tool="science-artifact"]')!)

    // If the row's `openTab` write landed on a store instance different from
    // the one the viewer reads, the tab would never appear here — the tab
    // strip and toolbar appearing is exactly the observable proof that both
    // share one live instance (the framework's own handle × session cache,
    // ui-slots/store.ts), not two independent stores that merely started
    // from the same declaration.
    expect(await view.findByRole('tab', { name: 'Loss curve' })).toBeTruthy()
    const provenanceButton = await view.findByRole('button', { name: 'Provenance' })
    const expandButton = view.getByRole('button', { name: 'Expand' })
    expect(provenanceButton).toBeTruthy()
    expect(expandButton).toBeTruthy()
    await b.runtime.dispose()
  })

  it('the toolbar\'s provenance control opens the drill-in, and its Messages sub-tab reaches the real DetailsPanel inspectCall handoff', async () => {
    const b = await bench()
    const view = b.runtime.renderRoot()
    fireEvent.click(view.container.querySelector('[data-tool="science-artifact"]')!)
    fireEvent.click(await view.findByRole('button', { name: 'Provenance' }))

    fireEvent.click(await view.findByRole('tab', { name: 'Messages' }))
    fireEvent.click(view.getByRole('button', { name: 'Jump to transcript' }))

    // DetailsPanel.tsx supplies this Details-seam owner callback from the
    // same real `store: chatStore` share it already holds for its header
    // controls and routed-entry dispatch — the one ui-conversation touch
    // this redesign made (DetailsViewOwnerProps.inspectCall).
    const chatStore = b.runtime.storeOf('conversation.view', SID) as {
      getSnapshot(): { inspect: { callId: string } | null; view: string | null }
    }
    expect(chatStore.getSnapshot().inspect).toEqual({ callId: CALL_ID })
    expect(chatStore.getSnapshot().view).toBe('trajectory')
    await b.runtime.dispose()
  })

  it('disposing the ui-science fiber removes every registration this package added, leaving ui-conversation/ui-tool intact', async () => {
    const b = await bench()
    b.runtime.renderRoot()
    expect(b.slots.entries('tool.call.toolview').map(e => (e.options as { key?: string }).key))
      .toEqual(expect.arrayContaining(['annotate_artifact', 'publish_outcome']))
    expect(b.slots.entries('conversation.details.view').map(e => e.options.id)).toContain('science')
    expect(b.slots.entries('conversation.session.header.actions').map(e => e.options.id)).toContain('science')

    await b.scienceHandle.dispose()

    expect(b.slots.entries('tool.call.toolview').map(e => (e.options as { key?: string }).key))
      .not.toEqual(expect.arrayContaining(['annotate_artifact', 'publish_outcome']))
    expect(b.slots.entries('conversation.details.view').map(e => e.options.id)).not.toContain('science')
    expect(b.slots.entries('conversation.session.header.actions')).toHaveLength(0)
    // ui-tool's own bash sample (mounted by applyTool, not applyScience)
    // survives the ui-science fiber's disposal.
    expect(b.slots.entries('conversation.chat.node').map(e => (e.options as { key?: string }).key)).toContain('tool-call')
    await b.runtime.dispose()
  })
})
