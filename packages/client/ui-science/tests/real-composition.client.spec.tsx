// @vitest-environment jsdom
// ui-science's acceptance chain on the REAL machinery stack: SlotTestRuntime
// (cordis Context + SlotRegistry ledger + the web-react renderer) with
// ui-conversation, ui-tool, ui-trajectory, and ui-science mounted through their real
// apply() — no hand-built ctx.plugin(...) presentation stub. Proves the
// transcript row → Details column linkage end to end (activating the
// compact `annotate_artifact` row opens that exact version's tab through the
// real openDetailsView write path), the one selection-store instance
// genuinely shared across the transcript row and the artifact viewer, the
// toolbar's provenance control switching to the drill-in, and full disposal
// removing every registration this package adds.
//
// The provenance drill-in's former Messages sub-tab (and its
// DetailsPanel.inspectCall/selectDetailed handoff into Detailed trajectory)
// is gone with the T1/T2 artifact-authority migration: it resolved the
// exact generating run via the now-removed runId/toolCallId fields on the
// client-safe artifact projection, which no client-facing read replaces
// (see ScienceArtifactProvenance.tsx's own module JSDoc). DetailsPanel's
// inspectCall/selectDetailed owner callbacks remain part of the
// 'conversation.details.view' slot's framework contract (ui-conversation's
// territory, unchanged); ui-science simply has no current consumer for them.

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
import { apply as applyTrajectory, inject as injectTrajectory } from '@deepseek-ai/dsh-client-ui-trajectory/client'
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
  content: { versionId: 'version-abc', mediaType: 'image/png', byteCount: 100 },
}
const ARTIFACT_META = { kind: 'science/artifact', version: 2, artifacts: [ARTIFACT_ITEM] }

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
  const turnData = new Map<string, unknown>([
    ['science-turn-artifacts', { artifacts: [ARTIFACT_ITEM] }],
    ['turn-tail', {
      turn: 1, seq: 4, time: 4_000, closing: null, branchUnavailable: true,
    }],
  ])
  const turn = {
    turn: 1, start: undefined, end: undefined, status: 'closed', steps: [],
    data: { get: (key: string) => turnData.get(key) },
  } as never
  const toolNodes: ChatConversationViewNode[] = nodes.map(root => ({
    key: conversationContextKey('tool-call', root.callId),
    kind: 'tool-call',
    id: root.callId,
    target: 'chat',
    anchorSeq: root.seq,
    location: { kind: 'session' },
    visibility: 'visible',
    data: { root },
  }))
  const tail: ChatConversationViewNode = {
    key: conversationContextKey('turn-tail', '1'), kind: 'turn-tail', id: '1', target: 'chat',
    anchorSeq: 4, location: { kind: 'turn', turn }, visibility: 'visible',
    data: turnData.get('turn-tail'),
  }
  const viewNodes = [...toolNodes, tail]
  const byKey = new Map(viewNodes.map(node => [node.key, node]))
  const turnKeys = viewNodes.map(node => node.key)
  const empty: readonly string[] = []
  return {
    order: viewNodes.map(node => node.key),
    nodes: { get: key => byKey.get(key), values: () => viewNodes },
    locations: { getTurn: value => value === 1 ? turnKeys : empty, getStep: () => empty },
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
  runtime.provide('connection', {
    api: { settings: {} },
    isLoopback: false,
    hostDescription: { getSnapshot: () => undefined, subscribe: () => () => {} },
  })
  runtime.provide('remote', { $on: () => () => {} })
  runtime.provide('remote.scienceEdits', {
    submit: () => Promise.resolve({ ok: true, value: { accepted: true } }),
  })
  runtime.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  const layout = { openDetails: vi.fn(), closeDetails: vi.fn() }
  runtime.provide('layout', layout)
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.provide('locale', locale)
  runtime.slots.installLocale(locale)

  await runtime.sessions.add({
    id: SID,
    summary: { title: 'Science', displayTitle: 'Science', agentPreset: 'science' },
    snapshot: { nodes: [
      { kind: 'user', seq: 1, content: [{ type: 'text', text: 'Build a loss curve' }] },
      { kind: 'assistant', seq: 2, turn: 1, step: 0, blocks: [{ kind: 'tool-call', callId: CALL_ID, name: 'run_python' }] },
      { kind: 'assistant', seq: 3, turn: 1, step: 1, blocks: [{ kind: 'text', text: 'The loss curve is ready.' }] },
    ], chat: toolChatSnapshot([toolResult(3, CALL_ID, 'annotate_artifact', ARTIFACT_META)]) } as never,
    session: {
      loadOlder: vi.fn<ISession['loadOlder']>(),
      prompt: vi.fn<ISession['prompt']>(async () => ({ ok: true, value: { accepted: true } })),
      readScienceArtifact: vi.fn<ISession['readScienceArtifact']>(async () => ({
        ok: true,
        value: { ...ARTIFACT_ITEM.content, versionId: ARTIFACT_ITEM.content.versionId as never, data: new Uint8Array() },
      })),
      // The Details column now defaults to the Science entry (`primary: true`
      // in ui-science's registration), so ProjectLibrary's loadLibrary effect
      // fires on first mount, before any transcript-row click.
      readScienceLibrary: vi.fn<ISession['readScienceLibrary']>(async () => ({
        ok: true, value: { projectId: 'project-1' as never, artifacts: [] },
      })),
      // D9: the detail panel's own current-facts read (title/caption/
      // content origin/media type/byte count), independent of the session
      // projection's slimmed snapshot.
      readScienceVersions: vi.fn<ISession['readScienceVersions']>(async () => ({
        ok: true, value: { versions: [{
          versionId: ARTIFACT_ITEM.content.versionId as never, artifactId: ARTIFACT_ITEM.artifactId as never,
          logicalName: ARTIFACT_ITEM.logicalName, ordinal: ARTIFACT_ITEM.version, title: ARTIFACT_ITEM.title,
          contentOrigin: 'run-auto', createdAt: 1_000,
          mediaType: ARTIFACT_ITEM.content.mediaType, byteCount: ARTIFACT_ITEM.content.byteCount,
        }] },
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
    kernels: [],
    artifacts: [{
      artifactId: ARTIFACT_ITEM.artifactId, logicalName: ARTIFACT_ITEM.logicalName, version: ARTIFACT_ITEM.version,
      producerSessionId: SID,
      title: ARTIFACT_ITEM.title, origin: 'model', versionId: ARTIFACT_ITEM.content.versionId,
      sha256: 'abc', mediaType: ARTIFACT_ITEM.content.mediaType, byteCount: ARTIFACT_ITEM.content.byteCount, runId: 'run-1',
      toolCallId: CALL_ID, requestHeaderSeq: 1, environmentRevision: 1,
      environmentFingerprintPreview: 'f'.repeat(12), createdAt: 1_000,
    }],
    outcome: null,
    metrics: { runCount: 1, successfulRunCount: 1, artifactCount: 1, artifactVersionCount: 1, outcomeRevision: 0, kernelCount: 0 },
    lastScienceEventSeq: 5,
  })

  await runtime.root.declare(LAYOUT_CHILDREN, AppRoot)
  await runtime.mount({ inject: [...injectConversation], apply: applyConversation })
  await runtime.mount({ inject: [...injectTool], apply: applyTool })
  await runtime.mount({ inject: [...injectTrajectory], apply: applyTrajectory })
  const scienceHandle = await runtime.mount({ inject: [...injectScience], apply: applyScience })
  return { runtime, slots: runtime.slots, layout, scienceHandle }
}

describe('ui-science on the real machinery stack', () => {
  it('places Process and Detailed inside the single Trajectory tab and defaults Science Sessions to Process', async () => {
    const b = await bench()
    const view = b.runtime.renderRoot()

    fireEvent.click(view.getByRole('tab', { name: 'Trajectory' }))
    expect(view.getByRole('tab', { name: 'Process' }).getAttribute('aria-selected')).toBe('true')
    expect(view.getByRole('tab', { name: 'Detailed' }).getAttribute('aria-selected')).toBe('false')
    fireEvent.click(view.getByRole('tab', { name: 'Detailed' }))
    expect(view.getByRole('tab', { name: 'Detailed' }).getAttribute('aria-selected')).toBe('true')
    expect(view.getByRole('toolbar', { name: 'Trajectory toolbar' })).toBeTruthy()
    fireEvent.click(view.getByRole('tab', { name: 'Process' }))
    expect(view.getByRole('tab', { name: 'Process' }).getAttribute('aria-selected')).toBe('true')
    await b.runtime.dispose()
  })

  it('renders artifact metadata only at the Turn tail and opens that exact version in Science Details', async () => {
    const b = await bench()
    const view = b.runtime.renderRoot()

    expect(view.container.querySelector('[data-tool="science-artifact"]')).toBeNull()
    const card = await view.findByRole('listitem', { name: /^Loss curve/u })
    fireEvent.click(card)

    expect(b.layout.openDetails).toHaveBeenCalledTimes(1)
    const chatStore = b.runtime.storeOf('conversation.view', SID) as { getSnapshot(): { detailsView: string | null } }
    expect(chatStore.getSnapshot().detailsView).toBe('science')

    expect(view.getByText('Artifacts produced this turn: 1')).toBeTruthy()
    expect(await view.findByRole('tab', { name: 'Loss curve' })).toBeTruthy()
    await b.runtime.dispose()
  })

  it('the Turn-tail card and artifact viewer share one selection store', async () => {
    const b = await bench()
    const view = b.runtime.renderRoot()
    fireEvent.click(await view.findByRole('listitem', { name: /^Loss curve/u }))

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

  it('the toolbar Provenance control switches to the drill-in and shows the resolved version\'s current facts', async () => {
    const b = await bench()
    const view = b.runtime.renderRoot()
    fireEvent.click(await view.findByRole('listitem', { name: /^Loss curve/u }))
    fireEvent.click(await view.findByRole('button', { name: 'Provenance' }))

    expect(await view.findByText('Produced by an automatic run')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Loss curve' }))
    expect(await view.findByRole('button', { name: 'Provenance' })).toBeTruthy()
    await b.runtime.dispose()
  })

  it('disposing the ui-science fiber removes every registration this package added, leaving ui-conversation/ui-tool intact', async () => {
    const b = await bench()
    b.runtime.renderRoot()
    expect(b.slots.entries('tool.call.toolview').map(e => (e.options as { key?: string }).key))
      .toEqual(expect.arrayContaining(['annotate_artifact', 'publish_outcome']))
    expect(b.slots.entries('conversation.details.view').map(e => e.options.id)).toContain('science')
    expect(b.slots.entries('conversation.session.header.utilities').map(e => e.options.id)).toContain('science')
    expect(b.slots.entries('trajectory.view').map(e => e.options.id)).toEqual(['process', 'detailed'])

    const outcome = b.slots.entries('tool.call.toolview')
      .find(entry => (entry.options as { key?: string }).key === 'publish_outcome')
    const injected = (outcome?.inject as (sessionId: SessionId) => {
      loadScienceImage(content: typeof ARTIFACT_ITEM.content): Promise<string>
    })(SID)
    // Backed by the raw-bytes endpoint now (scienceArtifactUrl), not a
    // base64 RPC read — resolves synchronously to the browser-navigable URL.
    await expect(injected.loadScienceImage(ARTIFACT_ITEM.content)).resolves.toContain(
      `/api/science/artifact/${SID}/${ARTIFACT_ITEM.content.versionId}`,
    )

    await b.scienceHandle.dispose()

    expect(b.slots.entries('tool.call.toolview').map(e => (e.options as { key?: string }).key))
      .not.toEqual(expect.arrayContaining(['annotate_artifact', 'publish_outcome']))
    expect(b.slots.entries('conversation.details.view').map(e => e.options.id)).not.toContain('science')
    expect(b.slots.entries('conversation.session.header.utilities')).toHaveLength(0)
    expect(b.slots.entries('trajectory.view').map(e => e.options.id)).toEqual(['detailed'])
    // ui-tool's own bash sample (mounted by applyTool, not applyScience)
    // survives the ui-science fiber's disposal.
    expect(b.slots.entries('conversation.chat.node').map(e => (e.options as { key?: string }).key)).toContain('tool-call')
    await b.runtime.dispose()
  })
})
