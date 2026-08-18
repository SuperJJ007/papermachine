// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import {
  createSnapshotStore, EMPTY_CHAT_SNAPSHOT, EMPTY_CONVERSATION_VIEWS,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { UseSession } from '@deepseek-ai/dsh-client-web-react'
import type { ConversationSnapshot, SessionId, SessionListState, WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionProviderComponent } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  DetailsSlotProps, DetailsToolOwnerProps, DetailsViewEntry, SelectionTarget, ToolDetailsViewProps,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { createChatStore } from '../src/client/stores.ts'
import { AssistantMarkdown, type AssistantMarkdownProps } from '../src/client/chat/AssistantMarkdown.tsx'
import { StatsLine } from '../src/client/chat/StatsLine.tsx'
import { DetailsPanel } from '../src/client/skeleton/DetailsPanel.tsx'
import { ToolDetailsView } from '../src/client/skeleton/ToolDetailsView.tsx'
import { zh } from '../src/client/locales.ts'
import { chatSnapshotFixture } from './chat-snapshot-fixture.client.ts'

// Mirrors the real lookup chain (conversation namespace, then common).
const t: AssistantMarkdownProps['t'] = makeTranslate(zh, commonZh)

/** jsdom has no ResizeObserver; StatsLine watches its row for ellipsis truncation through one. */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => { vi.stubGlobal('ResizeObserver', ResizeObserverStub) })
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const SID = 's1' as SessionId
const TOOL_ENTRY: DetailsViewEntry = { id: 'tool', label: '工具' }

/** Minimal framework seat for direct DetailsPanel/ToolDetailsView host tests. */
const SessionProviderStub: SessionProviderComponent = ({ children }) => children(SID)

/** Observe the owner currency without importing the Tool details renderer. */
function renderToolDetailsProbe(owners?: DetailsToolOwnerProps[]): ToolDetailsViewProps['renderSlot'] {
  return (_key, owner) => {
    owners?.push(owner as unknown as DetailsToolOwnerProps)
    return <div data-testid="tool-details-seat" />
  }
}

/** Fixed non-subscribing ledger of registered `conversation.details.view` entries. */
function detailsViews(entries: readonly DetailsViewEntry[]): DetailsSlotProps['views'] {
  return { list: () => entries, subscribe: () => () => {}, version: () => 0 }
}

/** Observe the routed `conversation.details.view` dispatch without rendering the
 *  real entry component; the keyed `conversation.details.header.actions`
 *  dispatch (a separate renderSlot call DetailsPanel also makes) renders
 *  nothing through this probe — `renderHeaderActionsProbe` below owns it. */
function renderDetailsViewProbe(calls?: { owner: unknown; only: string | undefined }[]): DetailsSlotProps['renderSlot'] {
  return ((key: string, owner: object, opts?: { only?: string }) => {
    if (key !== 'conversation.details.view') return null
    calls?.push({ owner, only: opts?.only })
    return <div data-testid="details-view-seat" />
  }) as DetailsSlotProps['renderSlot']
}

/** Observe the keyed header-actions dispatch without rendering a real entry. */
function renderHeaderActionsProbe(calls?: { owner: unknown; entryKey: string | undefined }[]): DetailsSlotProps['renderSlot'] {
  return ((key: string, owner: object, opts?: { entryKey?: string }) => {
    if (key !== 'conversation.details.header.actions') return null
    calls?.push({ owner, entryKey: opts?.entryKey })
    return <div data-testid="details-header-actions-seat" />
  }) as DetailsSlotProps['renderSlot']
}

/** Observe both DetailsPanel dispatches (view body + header actions) in one renderSlot. */
function renderDetailsPanelProbe(
  viewCalls?: { owner: unknown; only: string | undefined }[],
  headerActionCalls?: { owner: unknown; entryKey: string | undefined }[],
): DetailsSlotProps['renderSlot'] {
  const view = renderDetailsViewProbe(viewCalls) as unknown as (k: string, o: object, p?: object) => unknown
  const headerActions = renderHeaderActionsProbe(headerActionCalls) as unknown as (k: string, o: object, p?: object) => unknown
  return ((key: string, owner: object, opts?: { only?: string; entryKey?: string }) =>
    key === 'conversation.details.header.actions'
      ? headerActions(key, owner, opts)
      : view(key, owner, opts)
  ) as DetailsSlotProps['renderSlot']
}

function snapshotBase(): ConversationSnapshot {
  return {
    sessionId: SID, views: EMPTY_CONVERSATION_VIEWS, chat: EMPTY_CHAT_SNAPSHOT,
    nodes: [], turnTimings: new Map(), turnEnds: new Map(), partial: null, runningCalls: [],
    pending: [], queue: [], running: false, composerPhase: 'active', removed: false, openState: 'open', openError: null,
    hasMore: false, loadingOlder: false, promptError: null, blank: false, subagent: null, lastAgentError: null,
  }
}

/** Shared standard-kit doubles both DetailsPanel and ToolDetailsView require. */
function standardKit(snap: ConversationSnapshot) {
  const emptyList = createSnapshotStore<SessionListState>(
    { ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined })
  const emptyWorkspaces = createSnapshotStore<WorkspaceListState>({
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    baselinesReady: true, recentWorkspaceId: undefined,
  })
  return {
    sessionId: SID,
    useSession: bindSnapshotSelector({ getSnapshot: () => snap, subscribe: () => () => {} }),
    useSessions: bindSnapshotSelector(emptyList),
    useWorkspaces: bindSnapshotSelector(emptyWorkspaces),
    useProjection: (() => undefined),
    useInput: (() => { throw new Error('unused') }),
    inputActions: {
      setDraft: () => {},
      addImages: () => true,
      removeImage: () => {},
      pruneImages: () => {},
      submit: () => {},
    },
    SessionProvider: SessionProviderStub,
  } as const
}

describe('render branch tails', () => {
  it('AssistantMarkdown reasoning row is ok-state when not the streaming tail', () => {
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'done thinking' }, { kind: 'text', text: 'answer' }]}
        streaming
      />,
    )
    // reasoning at index 0 with a later block: running is false → ok state.
    expect(view.container.querySelector('[data-state="ok"]')).not.toBeNull()
  })

  it('StatsLine falls back to window-node counts and drops every token group without projections', () => {
    // No sessionStats key → the window fold supplies the counts (the
    // assembly-without-the-unit fallback). Node `usage` is deliberately
    // ignored: billing rides the durable tokenUsage projection, so an absent
    // projection leaves counts only.
    const nodes = [
      { kind: 'assistant', seq: 1, time: 1, turn: 1, step: 1, blocks: [] },
      { kind: 'assistant', seq: 2, time: 2, turn: 1, step: 2, blocks: [], usage: { inputTokens: 4, outputTokens: 6 } },
      { kind: 'assistant', seq: 3, time: 3, turn: 2, step: 1, blocks: [], usage: { inputTokens: 5 } },
    ] as const
    const snap = {
      ...snapshotBase(),
      chat: chatSnapshotFixture({ nodes }),
      nodes: [
        ...nodes,
      ],
    }
    const source = { getSnapshot: () => snap, subscribe: () => () => {} }
    const view = render(
      <StatsLine
        t={t}
        useSession={bindSnapshotSelector(source) as unknown as UseSession<ConversationSnapshot>}
        useProjection={() => undefined}
      />,
    )
    expect(view.container.textContent).toBe('2 轮 · 3 步')
  })

  it('AssistantMarkdown reasoning as the streaming tail renders the running ring', () => {
    const view = render(
      <AssistantMarkdown t={t} blocks={[{ kind: 'reasoning', text: 'still thinking' }]} streaming />,
    )
    expect(view.container.querySelector('[data-state="running"]')).not.toBeNull()
  })
})

describe('DetailsPanel routing shell', () => {
  it('title falls to 详情 when the tool entry is active but the selection has no toolName and no material', () => {
    localStorage.clear()
    const snap = snapshotBase()
    const chat = createChatStore().create()
    chat.actions.select({ turnSeq: 1, callId: 'ghost' } satisfies SelectionTarget)
    const calls: { owner: unknown; only: string | undefined }[] = []
    const view = render(
      <DetailsPanel
        {...standardKit(snap)}
        renderSlot={renderDetailsViewProbe(calls)}
        useStore={bindSnapshotSelector(chat)}
        actions={chat.actions}
        closeDetails={vi.fn()}
        views={detailsViews([TOOL_ENTRY])}
        t={t}
      />,
    )
    expect(view.getByText('详情')).toBeTruthy()
    // Dispatch reaches the built-in tool entry: no stored detailsView falls
    // back to it, same as an id naming an unregistered entry would.
    expect(calls).toEqual([{ owner: {}, only: 'tool' }])
  })

  it('title falls to the selection\'s carried toolName when the tool entry is active but the call resolves no material', () => {
    localStorage.clear()
    const snap = snapshotBase()
    const chat = createChatStore().create()
    // Window-truncated: the call is outside the loaded snapshot, so
    // materialFor resolves nothing — the carried toolName is what remains.
    chat.actions.select({ turnSeq: 1, callId: 'ghost', toolName: 'bash' } satisfies SelectionTarget)
    const view = render(
      <DetailsPanel
        {...standardKit(snap)}
        renderSlot={renderDetailsViewProbe()}
        useStore={bindSnapshotSelector(chat)}
        actions={chat.actions}
        closeDetails={vi.fn()}
        views={detailsViews([TOOL_ENTRY])}
        t={t}
      />,
    )
    expect(view.getByText('bash')).toBeTruthy()
  })

  it('title resolves the selected call name for a nested run_code leaf while the tool entry is active', () => {
    localStorage.clear()
    const snap = snapshotBase()
    snap.runningCalls = [{
      callId: 'p1', name: 'run_code', argsRaw: '{}', turn: 1, step: 1,
      time: 7_000, callView: null, subCalls: [{
        kind: 'tool-result', seq: 8, time: 8_000, callId: 'p1:code:1',
        call: { name: 'run_code', argsRaw: '{"code":"return 1"}' },
        callTime: 8_000,
        content: [], isError: false, callView: null, resultView: null,
        subCalls: [{
          kind: 'tool-result', seq: 9, time: 9_000, callId: 'p1:code:1:code:1',
          call: { name: 'read', argsRaw: '{"path":"notes/demo.txt"}' },
          callTime: 8_500,
          content: [{ type: 'text', text: 'x' }], isError: false, callView: null, resultView: null,
          subCalls: [],
        }],
      }],
    }]
    snap.chat = chatSnapshotFixture({ runningCalls: snap.runningCalls })
    const chat = createChatStore().create()
    chat.actions.select({ turnSeq: 9, callId: 'p1:code:1:code:1', toolName: 'read' } satisfies SelectionTarget)
    const view = render(
      <DetailsPanel
        {...standardKit(snap)}
        renderSlot={renderDetailsViewProbe()}
        useStore={bindSnapshotSelector(chat)}
        actions={chat.actions}
        closeDetails={vi.fn()}
        views={detailsViews([TOOL_ENTRY])}
        t={t}
      />,
    )
    // The resolved material's own name ('read') wins over the selection's
    // carried toolName once the call is found in the current window.
    expect(view.getByText('read')).toBeTruthy()
  })

  it('title falls to the registered label when a non-tool entry is active, ignoring a stale tool selection', () => {
    localStorage.clear()
    const snap = snapshotBase()
    const chat = createChatStore().create()
    // A leftover tool selection from before a header action switched entries.
    chat.actions.select({ turnSeq: 1, callId: 'c1', toolName: 'bash' } satisfies SelectionTarget)
    chat.actions.setDetailsView('science')
    const calls: { owner: unknown; only: string | undefined }[] = []
    const view = render(
      <DetailsPanel
        {...standardKit(snap)}
        renderSlot={renderDetailsViewProbe(calls)}
        useStore={bindSnapshotSelector(chat)}
        actions={chat.actions}
        closeDetails={vi.fn()}
        views={detailsViews([TOOL_ENTRY, { id: 'science', label: 'Science' }])}
        t={t}
      />,
    )
    expect(view.getByText('Science')).toBeTruthy()
    expect(view.queryByText('bash')).toBeNull()
    expect(calls).toEqual([{ owner: {}, only: 'science' }])
  })

  it('falls back to the built-in tool entry when the stored id names a removed/unregistered entry', () => {
    localStorage.clear()
    const snap = snapshotBase()
    const chat = createChatStore().create()
    chat.actions.setDetailsView('science') // HMR-disposed since the last write.
    const calls: { owner: unknown; only: string | undefined }[] = []
    const view = render(
      <DetailsPanel
        {...standardKit(snap)}
        renderSlot={renderDetailsViewProbe(calls)}
        useStore={bindSnapshotSelector(chat)}
        actions={chat.actions}
        closeDetails={vi.fn()}
        views={detailsViews([TOOL_ENTRY])}
        t={t}
      />,
    )
    expect(view.getByText('详情')).toBeTruthy()
    expect(calls).toEqual([{ owner: {}, only: 'tool' }])
  })

  it('shows the generic empty state without dispatching the view body or header actions when no entry is registered at all', () => {
    localStorage.clear()
    const snap = snapshotBase()
    const chat = createChatStore().create()
    const calls: { owner: unknown; only: string | undefined }[] = []
    const headerCalls: { owner: unknown; entryKey: string | undefined }[] = []
    const view = render(
      <DetailsPanel
        {...standardKit(snap)}
        renderSlot={renderDetailsPanelProbe(calls, headerCalls)}
        useStore={bindSnapshotSelector(chat)}
        actions={chat.actions}
        closeDetails={vi.fn()}
        views={detailsViews([])}
        t={t}
      />,
    )
    expect(view.getByText('点击消息流中的工具行查看详情')).toBeTruthy()
    expect(calls).toEqual([])
    // No active entry at all (not even the built-in tool fallback): the shell
    // does not attempt the header-actions dispatch either.
    expect(headerCalls).toEqual([])
    expect(view.queryByTestId('details-header-actions-seat')).toBeNull()
  })

  it('dispatches the active entry\'s own keyed header-actions entry between the title and the close button', () => {
    localStorage.clear()
    const snap = snapshotBase()
    const chat = createChatStore().create()
    chat.actions.setDetailsView('science')
    const headerCalls: { owner: unknown; entryKey: string | undefined }[] = []
    const view = render(
      <DetailsPanel
        {...standardKit(snap)}
        renderSlot={renderDetailsPanelProbe(undefined, headerCalls)}
        useStore={bindSnapshotSelector(chat)}
        actions={chat.actions}
        closeDetails={vi.fn()}
        views={detailsViews([TOOL_ENTRY, { id: 'science', label: 'Science' }])}
        t={t}
      />,
    )
    // Keyed by the active entry's id, the one write capability the shell
    // holds (openView, from its own store: chatStore registration) and
    // nothing else, and rendered exactly once.
    expect(headerCalls).toHaveLength(1)
    expect(headerCalls[0]?.entryKey).toBe('science')
    expect(Object.keys(headerCalls[0]?.owner as object)).toEqual(['openView'])
    // openView writes through to the shell's own store: chatStore.setView —
    // the same write chatStore.actions.setView performs directly.
    const openView = (headerCalls[0]?.owner as { openView: (id: string) => void }).openView
    openView('trajectory')
    expect(chat.getSnapshot().view).toBe('trajectory')
    const seat = view.getByTestId('details-header-actions-seat')
    const header = seat.parentElement?.parentElement
    // Positioned between the title and the shell's own close button.
    const positions = header === null || header === undefined ? [] : [...header.children]
    expect(positions[0]?.textContent).toBe('Science')
    expect(positions[1]?.contains(seat)).toBe(true)
    expect(positions[2]?.tagName).toBe('BUTTON')
  })

  it('a different active entry (the built-in tool entry) dispatches its own header-actions key', () => {
    localStorage.clear()
    const snap = snapshotBase()
    const chat = createChatStore().create()
    const headerCalls: { owner: unknown; entryKey: string | undefined }[] = []
    render(
      <DetailsPanel
        {...standardKit(snap)}
        renderSlot={renderDetailsPanelProbe(undefined, headerCalls)}
        useStore={bindSnapshotSelector(chat)}
        actions={chat.actions}
        closeDetails={vi.fn()}
        views={detailsViews([TOOL_ENTRY])}
        t={t}
      />,
    )
    // The dispatch always follows whichever entry is actually active (here
    // the built-in `tool` fallback, not a hardcoded id); the keyed slot
    // engine renders nothing for a key with no registrant (proven generically
    // by the `tool.call.toolview` fallback coverage), so a `science`-only
    // registration contributes no controls while `tool` is active.
    expect(headerCalls).toHaveLength(1)
    expect(headerCalls[0]?.entryKey).toBe('tool')
    expect(Object.keys(headerCalls[0]?.owner as object)).toEqual(['openView'])
  })

  it('closeDetails fires on close-button activation', () => {
    localStorage.clear()
    const snap = snapshotBase()
    const chat = createChatStore().create()
    const closeDetails = vi.fn()
    const view = render(
      <DetailsPanel
        {...standardKit(snap)}
        renderSlot={renderDetailsViewProbe()}
        useStore={bindSnapshotSelector(chat)}
        actions={chat.actions}
        closeDetails={closeDetails}
        views={detailsViews([TOOL_ENTRY])}
        t={t}
      />,
    )
    view.getByLabelText('关闭详情').click()
    expect(closeDetails).toHaveBeenCalledTimes(1)
  })
})

describe('ToolDetailsView body', () => {
  it('resolves to the not-in-window state when the selection has no material', () => {
    localStorage.clear()
    const snap = snapshotBase()
    const chat = createChatStore().create()
    chat.actions.select({ turnSeq: 1, callId: 'ghost' } satisfies SelectionTarget)
    const view = render(
      <ToolDetailsView
        {...standardKit(snap)}
        renderSlot={renderToolDetailsProbe()}
        useStore={bindSnapshotSelector(chat)}
        actions={chat.actions}
        t={t}
      />,
    )
    expect(view.getByText('该调用不在当前窗口内')).toBeTruthy()
  })

  it('resolves a nested run_code leaf to its full logged args and output', () => {
    localStorage.clear()
    const snap = snapshotBase()
    const longText = 'x'.repeat(1_000)
    snap.runningCalls = [{
      callId: 'p1', name: 'run_code', argsRaw: '{}', turn: 1, step: 1,
      time: 7_000, callView: null, subCalls: [{
        kind: 'tool-result', seq: 8, time: 8_000, callId: 'p1:code:1',
        call: { name: 'run_code', argsRaw: '{"code":"return 1"}' },
        callTime: 8_000,
        content: [], isError: false, callView: null, resultView: null,
        subCalls: [{
          kind: 'tool-result', seq: 9, time: 9_000, callId: 'p1:code:1:code:1',
          call: { name: 'read', argsRaw: '{"path":"notes/demo.txt"}' },
          callTime: 8_500,
          content: [{ type: 'text', text: longText }], isError: false, callView: null, resultView: null,
          subCalls: [],
        }],
      }],
    }]
    snap.chat = chatSnapshotFixture({ runningCalls: snap.runningCalls })
    const chat = createChatStore().create()
    chat.actions.select({ turnSeq: 9, callId: 'p1:code:1:code:1', toolName: 'read' } satisfies SelectionTarget)
    const owners: DetailsToolOwnerProps[] = []
    const view = render(
      <ToolDetailsView
        {...standardKit(snap)}
        renderSlot={renderToolDetailsProbe(owners)}
        useStore={bindSnapshotSelector(chat)}
        actions={chat.actions}
        t={t}
      />,
    )
    // Conversation resolves the selected sub-call and hands its complete
    // frozen block to the Tool-owned details seat.
    expect(view.getByTestId('tool-details-seat')).toBeTruthy()
    expect(owners).toHaveLength(1)
    expect(owners[0]?.block).toMatchObject({
      callId: 'p1:code:1:code:1',
      call: { name: 'read', argsRaw: '{"path":"notes/demo.txt"}' },
      content: [{ type: 'text', text: longText }],
    })
  })
})
