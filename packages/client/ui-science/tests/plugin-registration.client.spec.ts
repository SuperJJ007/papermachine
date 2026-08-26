// @vitest-environment jsdom
/** ui-science registers folded tool cells, Turn-tail artifacts, and the Trajectory swimlane reversibly. */

import { createElement, type ComponentType } from 'react'
import { Context } from '@deepseek-ai/cordis'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import type { ScienceEditSelection } from '@deepseek-ai/dsh-tool-science/types'
import { apply, inject } from '../src/client/index.ts'
import { ScienceAnnotationRow } from '../src/client/ScienceAnnotationRow.tsx'
import { ScienceExecutionRow } from '../src/client/ScienceExecutionRow.tsx'
import { ScienceOutcomeRow } from '../src/client/ScienceOutcomeRow.tsx'
import { ScienceTraceView } from '../src/client/ScienceTraceView.tsx'
import { ScienceTurnArtifacts } from '../src/client/ScienceTurnArtifacts.tsx'
import { TOGGLE_SCOPE_GLOBAL } from '../src/toggle-scope.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const SID = 's1' as SessionId

/** Narrow a possibly-absent resolved service to its defined value, for a service this test's own `setup()` always provides. */
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected the service to be provided')
  return value
}

/** One resolvable `science` projection face, with an inspectable subscribe spy. */
function makeFace(snapshot: unknown = null, disposer = vi.fn()) {
  return { getSnapshot: () => snapshot, subscribe: vi.fn(() => disposer) }
}

interface SessionsFakeState {
  ids: string[]
  byId: Record<string, { agentPreset?: string }>
  faces?: Record<string, ReturnType<typeof makeFace> | undefined>
}

/** Configurable `sessions` service double: list membership and per-session science-face resolution. */
function makeSessionsFake() {
  let ids: string[] = []
  let byId: Record<string, { agentPreset?: string }> = {}
  const faces = new Map<string, ReturnType<typeof makeFace> | undefined>()
  const listListeners = new Set<() => void>()
  return {
    api: {
      list: {
        getSnapshot: () => ({ ids: [...ids], byId }),
        subscribe: (cb: () => void) => { listListeners.add(cb); return () => { listListeners.delete(cb) } },
      },
      binding: (id: string) => {
        const face = faces.get(id)
        return face === undefined ? undefined : { session: { projections: { faceOf: () => face } } }
      },
    },
    setSessions(next: SessionsFakeState) {
      ids = next.ids
      byId = next.byId
      faces.clear()
      for (const [id, face] of Object.entries(next.faces ?? {})) faces.set(id, face)
    },
    fireListChanged() { for (const cb of listListeners) cb() },
  }
}

function setup(sessionsOverride?: unknown) {
  const ctx = new Context()
  const slots = new SlotRegistry(ctx)
  slots.register({ name: 'root', children: {
    'tool.call.toolview': { kind: 'keyed', scope: 'session' },
    'conversation.chat.turnTail': { kind: 'chain', scope: 'session' },
    'trajectory.view': { kind: 'list', scope: 'session' },
    'settings.plugin.item': { kind: 'keyed', scope: 'root' },
    'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
    'conversation.page.utilities': { kind: 'list', scope: 'root' },
    'conversation.details.view': { kind: 'list', scope: 'session' },
    'conversation.input.accessory': { kind: 'list', scope: 'session' },
    'conversation.composer.dock': { kind: 'list', scope: 'session' },
    'sidebar.destinations': { kind: 'list', scope: 'root' },
    'details.files': { kind: 'single', scope: 'root' },
  } } as never, () => null)
  const subscribers = new Set<() => void>()
  ctx.provide('locale', {
    register: () => () => {}, bind: () => (key: string) => key,
    subscribe: (listener: () => void) => { subscribers.add(listener); return () => { subscribers.delete(listener) } },
  })
  ctx.provide('connection', {} as never)
  // apply() reaches this service through the `ctx.remote.scienceEdits` property
  // proxy (not `ctx.get('remote.scienceEdits')`), so both provides must share
  // one object for a test to observe or override its real calls.
  const scienceEdits = {
    submit: vi.fn<() => Promise<{ ok: boolean; value?: { accepted: boolean }; error?: { message: string } }>>(
      () => Promise.resolve({ ok: true, value: { accepted: true } }),
    ),
    addArtifactNote: vi.fn(() => Promise.resolve({ ok: false, error: { message: 'unused' } })),
    removeArtifactNote: vi.fn(() => Promise.resolve({ ok: false, error: { message: 'unused' } })),
    commitStyleEdit: vi.fn(() => Promise.resolve({ ok: false, error: { message: 'unused' } })),
  }
  ctx.provide('remote', { scienceEdits } as never)
  ctx.provide('remote.scienceEdits', scienceEdits)
  const face = { getSnapshot: () => null, subscribe: () => () => {} }
  const readScienceLibrary = vi.fn(() => Promise.resolve({ ok: true, value: { projectId: 'project-1', artifacts: [] } }))
  const readWorkspaceFiles = vi.fn(() => Promise.resolve({ ok: true, value: { root: '', entries: [] } }))
  const readWorkspaceFile = vi.fn(() => Promise.resolve({
    ok: true, value: { mediaType: 'text/plain', byteCount: 1, data: Uint8Array.of(65) },
  }))
  ctx.provide('sessions', sessionsOverride ?? {
    binding: () => ({ session: {
      projections: { faceOf: () => face }, readScienceLibrary, readWorkspaceFiles, readWorkspaceFile,
    } }),
    list: { getSnapshot: () => ({ ids: ['s1'], byId: { s1: { agentPreset: 'science' } } }), subscribe: () => () => {} },
  } as never)
  // conversationCancel is returned as its own plain local below (not read back
  // via ctx.get(...).cancel) so an assertion against it never trips the
  // unbound-method lint rule that a real interface-typed method reference would.
  const conversationCancel = vi.fn(() => Promise.resolve())
  const conversation = {
    registerSubmissionHandler: vi.fn(() => () => {}), openDetailsView: vi.fn(), openView: vi.fn(), openChatAt: vi.fn(),
    registerTranscriptDetailVisibility: vi.fn(() => () => {}), cancel: conversationCancel,
  }
  ctx.provide('conversation', conversation as never)
  ctx.provide('conversationEvents', { register: vi.fn() } as never)
  ctx.provide('trajectorySubviews', {
    registerVisibility: vi.fn(() => () => {}), select: vi.fn(),
  } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  return {
    ctx, slots, scienceEdits, conversation, conversationCancel,
    readScienceLibrary, readWorkspaceFiles, readWorkspaceFile,
  }
}

describe('ui-science apply', () => {
  it('declares every service used by its registrations', () => {
    expect(inject).toEqual(['locale', 'slots', 'connection', 'remote', 'remote.scienceEdits', 'settingsScope', 'sessions', 'conversation', 'conversationEvents', 'trajectorySubviews'])
  })

  it('registers the folded rows, one Turn-tail group, one swimlane, and no Outcome details view', async () => {
    const { ctx, slots } = setup()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const tools = new Map(slots.entries('tool.call.toolview').map(entry => [entry.options.key, entry.component]))
    expect(tools.get('run_python')).toBe(ScienceExecutionRow)
    expect(tools.get('run_r')).toBe(ScienceExecutionRow)
    expect(tools.get('annotate_artifact')).toBe(ScienceAnnotationRow)
    expect(tools.get('publish_outcome')).toBe(ScienceOutcomeRow)
    expect(slots.entries('conversation.chat.turnTail')[0]?.component).toBe(ScienceTurnArtifacts)
    expect(slots.entries('trajectory.view')[0]?.component).toBe(ScienceTraceView)
    expect(slots.entries('trajectory.view')[0]?.options).toMatchObject({ id: 'swimlane', order: 0 })
    expect(slots.entries('conversation.details.view').map(entry => entry.options.id)).toEqual(['science'])

    await fiber.dispose()
    expect(slots.entries('tool.call.toolview')).toHaveLength(0)
    expect(slots.entries('conversation.chat.turnTail')).toHaveLength(0)
    expect(slots.entries('trajectory.view')).toHaveLength(0)
  })

  it('the run_python/run_r toolview registrations inject a cancel that drives the existing whole-turn Stop', async () => {
    const { ctx, slots, conversationCancel } = setup()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    for (const key of ['run_python', 'run_r']) {
      const entry = slots.entries('tool.call.toolview').find(candidate => candidate.options.key === key)
      if (entry?.inject === undefined) throw new Error(`expected an injected ${key} toolview`)
      ;(entry.inject() as { cancel: () => void }).cancel()
    }
    expect(conversationCancel).toHaveBeenCalledTimes(2)
    await fiber.dispose()
  })

  it('registers the app-global toggle instead of a session-header action when the Host injects the global placement', async () => {
    vi.stubGlobal(TOGGLE_SCOPE_GLOBAL, 'global')
    const { ctx, slots } = setup()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(slots.entries('conversation.session.header.utilities')).toHaveLength(0)
    expect(slots.entries('conversation.page.utilities').map(entry => entry.options.id)).toEqual(['science'])
    await fiber.dispose()
  })

  it('the sidebar destination opens the Files details entry for its addressed session', async () => {
    const { ctx, slots } = setup()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entry = slots.entries('sidebar.destinations')[0]
    if (entry?.inject === undefined) throw new Error('expected an injected sidebar destination')
    ;(entry.inject() as { openScience: (id: SessionId) => void }).openScience(SID)
    expect(must(ctx.get('conversation')).openDetailsView).toHaveBeenCalledExactlyOnceWith(SID, 'science')
    await fiber.dispose()
  })

  it('the settings card injects its section face', async () => {
    const { ctx, slots } = setup()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entry = slots.entries('settings.plugin.item')[0]
    if (entry?.inject === undefined) throw new Error('expected an injected settings section')
    expect(entry.inject()).toBeDefined()
    await fiber.dispose()
  })

  it('renders composer chips only once the session has a science projection and staged targets, and removes one on click', async () => {
    const { ctx, slots } = setup()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const accessory = slots.entries('conversation.input.accessory')[0]
    const details = slots.entries('conversation.details.view')[0]
    if (accessory === undefined || details?.inject === undefined) throw new Error('expected the accessory and details entries')
    const Component = accessory.component as ComponentType<Record<string, unknown>>
    const t = (key: string, params?: Record<string, unknown>) => {
      let text = key
      for (const [name, value] of Object.entries(params ?? {})) text = text.replace(`{${name}}`, String(value))
      return text
    }

    // No science projection yet: the accessory contributes nothing.
    const blank = render(createElement(Component, {
      useProjection: () => undefined, sessionId: SID, t,
    } as never))
    expect(blank.container.innerHTML).toBe('')
    blank.unmount()

    // Stage one target through the Details column's own injected face.
    const target: ScienceEditSelection = {
      artifactId: 'chart-1' as never, version: 1, target: { kind: 'spec-path', path: '$.mark' },
    }
    const injected = (details.inject as (sessionId: SessionId) => {
      addToConversation: (targets: readonly ScienceEditSelection[]) => void
      removeFromConversation: (target: ScienceEditSelection) => void
    })(SID)
    injected.addToConversation([target])

    render(createElement(Component, { useProjection: () => ({}), sessionId: SID, t } as never))
    const remove = screen.getByRole('button', { name: 'edit.removeTarget' })
    fireEvent.click(remove)
    expect(screen.queryByRole('button', { name: 'edit.removeTarget' })).toBeNull()

    // removeFromConversation removes an exact target regardless of position.
    injected.addToConversation([target])
    injected.removeFromConversation(target)
    expect(screen.queryByRole('button', { name: 'edit.removeTarget' })).toBeNull()
    await fiber.dispose()
  })

  it('the Science Details entry forwards project reads, Chat navigation, and review/style Remotes', async () => {
    const { ctx, slots, conversation, readScienceLibrary, readWorkspaceFiles, readWorkspaceFile } = setup()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entry = slots.entries('conversation.details.view')[0]
    if (entry?.inject === undefined) throw new Error('expected the injected Details entry')
    const injected = (entry.inject as (sessionId: SessionId) => {
      returnToConversation: (anchorKey: string) => void
      loadLibrary: () => Promise<unknown>
      loadWorkspaceFiles: (path: string) => Promise<unknown>
      loadWorkspaceFile: (path: string) => Promise<unknown>
      addArtifactNote: (request: unknown) => Promise<unknown>
      removeArtifactNote: (request: unknown) => Promise<unknown>
      commitStyleEdit: (request: unknown) => Promise<unknown>
    })(SID)
    injected.returnToConversation('assistant-anchor')
    expect(conversation.openChatAt).toHaveBeenCalledWith(SID, 'assistant-anchor')

    await injected.loadLibrary()
    await injected.loadWorkspaceFiles('data')
    await injected.loadWorkspaceFile('data/results.csv')
    expect(readScienceLibrary).toHaveBeenCalledOnce()
    expect(readWorkspaceFiles).toHaveBeenCalledWith('data')
    expect(readWorkspaceFile).toHaveBeenCalledWith('data/results.csv')

    await expect(injected.addArtifactNote({})).resolves.toEqual({ ok: false, error: { message: 'unused' } })
    await expect(injected.removeArtifactNote({})).resolves.toEqual({ ok: false, error: { message: 'unused' } })
    await expect(injected.commitStyleEdit({})).resolves.toEqual({ ok: false, error: { message: 'unused' } })
    await fiber.dispose()
  })

  it('rejects Details injection after its session binding disappears', async () => {
    const sessionsFake = makeSessionsFake()
    const { ctx, slots } = setup(sessionsFake.api)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entry = slots.entries('conversation.details.view')[0]
    if (entry?.inject === undefined) throw new Error('expected the injected Details entry')
    const injectDetails = entry.inject as (sessionId: SessionId) => unknown
    expect(() => injectDetails(SID)).toThrow('science details: session s1 is unavailable')
    await fiber.dispose()
  })

  it('the swimlane\'s own trajectory.view entry opens the artifact viewer and selects the detailed subview', async () => {
    const { ctx, slots } = setup()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entry = slots.entries('trajectory.view')[0]
    if (entry?.inject === undefined) throw new Error('expected the injected swimlane entry')
    const injected = (entry.inject as (sessionId: SessionId) => { openArtifact: () => void; selectDetailed: () => void })(SID)
    injected.openArtifact()
    expect(must(ctx.get('conversation')).openDetailsView).toHaveBeenCalledExactlyOnceWith(SID, 'science')
    injected.selectDetailed()
    expect(must(ctx.get('trajectorySubviews')).select).toHaveBeenCalledWith(SID, 'detailed')
    await fiber.dispose()
  })

  it('the composer submission handler declines with no staged targets, blocks an image-attached submission, and clears targets on a successful edit', async () => {
    const { ctx, slots, scienceEdits } = setup()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const details = slots.entries('conversation.details.view')[0]
    if (details?.inject === undefined) throw new Error('expected the injected Details entry')
    const handler = (must(ctx.get('conversation')).registerSubmissionHandler as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      (submission: { sessionId: SessionId; imageIds: readonly string[]; text: string }) => Promise<unknown> | undefined

    expect(await handler({ sessionId: SID, imageIds: [], text: 'edit it' })).toBeUndefined()

    const injected = (details.inject as (sessionId: SessionId) => {
      addToConversation: (targets: readonly ScienceEditSelection[]) => void
      composerSelections: { getSnapshot: () => readonly ScienceEditSelection[] }
    })(SID)
    const target: ScienceEditSelection = {
      artifactId: 'chart-1' as never, version: 1, target: { kind: 'spec-path', path: '$.mark' },
    }
    injected.addToConversation([target])

    expect(await handler({ sessionId: SID, imageIds: ['img-1'], text: 'edit it' })).toMatchObject({ kind: 'error' })

    // scienceEdits.submit already resolves { ok: true } from setup()'s default.
    expect(await handler({ sessionId: SID, imageIds: [], text: 'edit it' })).toEqual({ kind: 'success' })
    expect(scienceEdits.submit).toHaveBeenCalledWith(SID, { targets: [target], instruction: 'edit it' })
    expect(injected.composerSelections.getSnapshot()).toEqual([])
    await fiber.dispose()
  })

  it('the composer submission handler reports a failed edit and keeps its staged targets', async () => {
    const { ctx, slots, scienceEdits } = setup()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const details = slots.entries('conversation.details.view')[0]
    if (details?.inject === undefined) throw new Error('expected the injected Details entry')
    const handler = (must(ctx.get('conversation')).registerSubmissionHandler as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      (submission: { sessionId: SessionId; imageIds: readonly string[]; text: string }) => Promise<unknown> | undefined
    const injected = (details.inject as (sessionId: SessionId) => {
      addToConversation: (targets: readonly ScienceEditSelection[]) => void
      composerSelections: { getSnapshot: () => readonly ScienceEditSelection[] }
    })(SID)
    const target: ScienceEditSelection = {
      artifactId: 'chart-1' as never, version: 1, target: { kind: 'spec-path', path: '$.mark' },
    }
    injected.addToConversation([target])

    scienceEdits.submit.mockResolvedValueOnce({ ok: false, error: { message: 'rejected' } })
    expect(await handler({ sessionId: SID, imageIds: [], text: 'edit it' })).toEqual({ kind: 'error', text: 'rejected' })
    expect(injected.composerSelections.getSnapshot()).toEqual([target])
    await fiber.dispose()
  })

  it('the swimlane visibility source treats a science-preset or resolved-projection session as visible, and declines every other', async () => {
    const sessionsFake = makeSessionsFake()
    sessionsFake.setSessions({
      ids: ['preset', 'projected', 'neither'],
      byId: { preset: { agentPreset: 'science' }, projected: {}, neither: { agentPreset: 'other' } },
      faces: { projected: makeFace({}) },
    })
    const { ctx } = setup(sessionsFake.api)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const registerVisibility = must(ctx.get('trajectorySubviews')).registerVisibility as ReturnType<typeof vi.fn>
    const source = registerVisibility.mock.calls[0]?.[1] as { visible: (id: SessionId) => boolean }

    expect(source.visible('preset' as SessionId)).toBe(true)
    expect(source.visible('projected' as SessionId)).toBe(true)
    expect(source.visible('neither' as SessionId)).toBe(false)
    // A session id absent from the list resolves through the optional chain and declines.
    expect(source.visible('absent' as SessionId)).toBe(false)
    await fiber.dispose()
  })

  it('the swimlane visibility source subscribes only sessions with a resolvable science face, and resyncs as the session list changes', async () => {
    const sessionsFake = makeSessionsFake()
    const staleDisposer = vi.fn()
    const staleFace = makeFace(null, staleDisposer)
    sessionsFake.setSessions({
      ids: ['bound', 'unbound'],
      byId: { bound: {}, unbound: {} },
      faces: { bound: staleFace },
    })
    const { ctx } = setup(sessionsFake.api)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const registerVisibility = must(ctx.get('trajectorySubviews')).registerVisibility as ReturnType<typeof vi.fn>
    const source = registerVisibility.mock.calls[0]?.[1] as {
      subscribe: (callback: () => void) => () => void
    }

    const callback = vi.fn()
    const unsubscribe = source.subscribe(callback)
    // The one session with a resolvable face is bound; the other is skipped.
    expect(staleFace.subscribe).toHaveBeenCalledExactlyOnceWith(callback)

    // A no-op relist (same ids) hits the already-bound skip path without resubscribing.
    sessionsFake.fireListChanged()
    expect(staleFace.subscribe).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledTimes(1)

    // Swap the bound session for a new one: the stale binding disposes and the new one subscribes.
    const freshFace = makeFace()
    sessionsFake.setSessions({ ids: ['fresh'], byId: { fresh: {} }, faces: { fresh: freshFace } })
    sessionsFake.fireListChanged()
    expect(staleDisposer).toHaveBeenCalledTimes(1)
    expect(freshFace.subscribe).toHaveBeenCalledExactlyOnceWith(callback)

    unsubscribe()
    await fiber.dispose()
  })
})
