/**
 * ui-science browser half: locale dictionary registration, the four keyed
 * toolview registrations (`run_python`, `run_r`, `annotate_artifact`,
 * `publish_outcome`), the keyed Science settings card registration under the
 * `science-runtime` namespace, the session-header action and artifact-viewer
 * (Details) entry registrations (both id `science`), the one selection-store
 * handle shared across the toolview/details-view registrations, plus
 * fiber-teardown removal (HMR safety).
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { ScienceArtifactId } from '@deepseek-ai/dsh-science-session'
import type { ScienceEditSelection } from '@deepseek-ai/dsh-tool-science/types'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as applyHost } from '../src/index.ts'
import { apply, inject } from '../src/client/index.ts'
import { ScienceArtifactRow } from '../src/client/ScienceArtifactRow.tsx'
import { ScienceRunRow } from '../src/client/ScienceRunRow.tsx'
import { ScienceOutcomeRow } from '../src/client/ScienceOutcomeRow.tsx'
import { ScienceSettingsCard } from '../src/client/ScienceSettingsCard.tsx'
import { ScienceHeaderAction } from '../src/client/ScienceHeaderAction.tsx'
import { ScienceComposerChips } from '../src/client/ScienceComposerChips.tsx'
import { ScienceDestinations } from '../src/client/ScienceDestinations.tsx'
import { ScienceEmptyDetails } from '../src/client/ScienceEmptyDetails.tsx'
import { ScienceHeroAction } from '../src/client/ScienceHeroAction.tsx'
import { ScienceKernelStatus } from '../src/client/ScienceKernelStatus.tsx'
import { ScienceTraceView } from '../src/client/ScienceTraceView.tsx'
import { ScienceDetailsView, type ScienceDetailsInjected } from '../src/client/ScienceDetailsView.tsx'
import { ScienceOutcomeDetails } from '../src/client/ScienceOutcomeDetails.tsx'
import { SCIENCE_RUNTIME_NS } from '../src/client/settings-card-controller.ts'
import type { ComposerSubmissionHandler } from '@deepseek-ai/dsh-client-ui-conversation/src/client/service.ts'

interface PresentationCapture {
  slots: SlotRegistry
  dictionaries: Array<{ namespace: string; dictionaries: unknown }>
  localeDisposed: boolean
  submissionHandlers: ComposerSubmissionHandler[]
}

/**
 * Provide the presentation, locale, connection/remote, settings-scope, and
 * sessions registries and capture the plugin's registrations. `sessions`
 * (a minimal `binding` stub) resolves the Details entry's own attachment
 * loader factory; nothing here reads `ctx.sessions.list` any more (the
 * artifact viewer is one plain `conversation.details.view` entry with no
 * session-preset-gated dynamic registration).
 */
function providePresentation(ctx: Context, sciencePreset = false) {
  const slots = new SlotRegistry(ctx)
  slots.register({
    name: 'root',
    children: {
      'tool.call.toolview': { kind: 'keyed', scope: 'session' },
      'settings.plugin.item': { kind: 'keyed', scope: 'root' },
      'conversation.session.header.actions': { kind: 'list', scope: 'session' },
      'conversation.details.view': { kind: 'list', scope: 'session' },
      'conversation.page.utilities': { kind: 'list', scope: 'root' },
      'conversation.input.accessory': { kind: 'list', scope: 'session' },
      'conversation.composer.dock': { kind: 'list', scope: 'session' },
      'conversation.view': { kind: 'list', scope: 'session' },
      'sidebar.destinations': { kind: 'list', scope: 'root' },
      'details.files': { kind: 'single', scope: 'root' },
    },
  } as never, () => null)
  const capture: PresentationCapture = { slots, dictionaries: [], localeDisposed: false, submissionHandlers: [] }
  ctx.provide('locale', {
    register(namespace: string, dictionaries: unknown) {
      capture.dictionaries.push({ namespace, dictionaries })
      return () => { capture.localeDisposed = true }
    },
    bind: () => (key: string) => key,
  })
  ctx.provide('connection', {} as never)
  const submit = vi.fn(() => Promise.resolve({ ok: true as const, value: { accepted: true as const } }))
  const scienceEdits = {
    submit,
    commitStyleEdit: () => Promise.resolve({
      ok: true,
      value: { artifactId: 'artifact-2', version: 2, origin: 'human-edit' },
    }),
  }
  ctx.provide('remote', { scienceEdits } as never)
  ctx.provide('remote.scienceEdits', scienceEdits)
  ctx.provide('sessions', {
    binding: () => undefined,
    list: {
      getSnapshot: () => ({
        ids: sciencePreset ? ['session-1'] : [],
        byId: sciencePreset ? { 'session-1': { agentPreset: 'science' } } : {},
      }),
      subscribe: () => () => {},
    },
  } as unknown as ISessions)
  const openDetailsView = vi.fn()
  const openView = vi.fn()
  const viewVisibility: Array<(sessionId: SessionId) => boolean> = []
  ctx.provide('conversation', {
    registerSubmissionHandler: (handler: ComposerSubmissionHandler) => {
      capture.submissionHandlers.push(handler)
      return () => {
        const index = capture.submissionHandlers.indexOf(handler)
        if (index >= 0) capture.submissionHandlers.splice(index, 1)
      }
    },
    openDetailsView,
    openView,
    registerViewVisibility: (_id: string, source: {
      visible: (sessionId: SessionId) => boolean
      subscribe: (callback: () => void) => () => void
    }) => {
      viewVisibility.push(source.visible)
      return () => { viewVisibility.splice(viewVisibility.indexOf(source.visible), 1) }
    },
  } as never)
  const { scope } = stubSettingsScope()
  ctx.provide('settingsScope', { bind: () => scope })
  return { capture, submit, openDetailsView, openView, viewVisibility }
}

describe('apply', () => {
  it('keeps the package Host entry free of Host-side behavior', () => {
    expect(() => { applyHost() }).not.toThrow()
  })

  it('declares the services it binds — locale/slots for the toolview rows, connection/remote/settingsScope for the settings card (settingsScope.bind\'s own documented precondition on its caller), and sessions for the Details entry\'s own attachment loader', () => {
    expect(inject).toEqual(['locale', 'slots', 'connection', 'remote', 'remote.scienceEdits', 'settingsScope', 'sessions', 'conversation'])
  })

  it('registers the science locale dictionaries and the run_python / run_r / annotate_artifact / publish_outcome toolview rows', async () => {
    const ctx = new Context()
    const { capture: presentation } = providePresentation(ctx)
    await ctx.plugin({ inject: [...inject], apply }).await()

    expect(presentation.dictionaries).toHaveLength(1)
    expect(presentation.dictionaries[0]?.namespace).toBe('science')

    const entries = presentation.slots.entries('tool.call.toolview')
    const artifact = entries.find(entry => (entry.options as { key?: string }).key === 'annotate_artifact')
    const runPython = entries.find(entry => (entry.options as { key?: string }).key === 'run_python')
    const runR = entries.find(entry => (entry.options as { key?: string }).key === 'run_r')
    const outcome = entries.find(entry => (entry.options as { key?: string }).key === 'publish_outcome')
    expect(artifact?.component).toBe(ScienceArtifactRow)
    expect(artifact?.locale).toBe('science')
    expect(runPython?.component).toBe(ScienceRunRow)
    expect(runPython?.locale).toBe('science')
    expect(runR?.component).toBe(ScienceRunRow)
    expect(runR?.locale).toBe('science')
    expect(outcome?.component).toBe(ScienceOutcomeRow)
    expect(outcome?.locale).toBe('science')
  })

  it('registers the Science settings card keyed on the science-runtime namespace', async () => {
    const ctx = new Context()
    const { capture: presentation } = providePresentation(ctx)
    await ctx.plugin({ inject: [...inject], apply }).await()

    const entries = presentation.slots.entries('settings.plugin.item')
    expect(entries).toHaveLength(1)
    expect(entries[0]?.options).toMatchObject({ key: SCIENCE_RUNTIME_NS })
    expect(entries[0]?.component).toBe(ScienceSettingsCard)
    expect(entries[0]?.locale).toBe('science')

    // The registration's inject factory hands the rendered card the
    // controller's snapshot store and form actions.
    const face = entries[0]?.inject?.() as { hooks: { scienceSettingsCard: unknown } } | undefined
    expect(face?.hooks.scienceSettingsCard).toBeDefined()
  })

  it('registers the Science session-header action, visible only for a built-in Science session', async () => {
    const ctx = new Context()
    const { capture: presentation } = providePresentation(ctx)
    await ctx.plugin({ inject: [...inject], apply }).await()

    const entries = presentation.slots.entries('conversation.session.header.actions')
    expect(entries).toHaveLength(1)
    expect(entries[0]?.options).toMatchObject({ id: 'science' })
    expect(entries[0]?.component).toBe(ScienceHeaderAction)
    expect(entries[0]?.locale).toBe('science')
  })

  it('registers the artifact viewer (Science Details entry) with id "science" and a registered label from the science namespace', async () => {
    const ctx = new Context()
    const { capture: presentation } = providePresentation(ctx)
    await ctx.plugin({ inject: [...inject], apply }).await()

    const entries = presentation.slots.entries('conversation.details.view')
    expect(entries).toHaveLength(2)
    const entry = entries.find(candidate => (candidate.options as { id?: string }).id === 'science')
    const options = entry?.options as { id?: string; order?: number; label?: () => string } | undefined
    expect(options?.id).toBe('science')
    expect(options?.order).toBe(10)
    expect(options?.label?.()).toBe('details.label')
    expect(entry?.component).toBe(ScienceDetailsView)
    expect(entry?.locale).toBe('science')
    expect(entries.find(candidate => (candidate.options as { id?: string }).id === 'science-outcomes')?.component)
      .toBe(ScienceOutcomeDetails)

    // The registration's inject factory hands the rendered entry its own
    // session-scoped attachment loader — never an owner-supplied one, since
    // the Details seam's owner share carries only its own inspectCall callback.
    const injectFn = entry?.inject as unknown as ((sessionId: SessionId) => ScienceDetailsInjected) | undefined
    const face = injectFn?.('any-session' as SessionId)
    expect(typeof face?.loadImage).toBe('function')
    expect(typeof face?.loadText).toBe('function')
    expect(typeof face?.addToConversation).toBe('function')
    expect(typeof face?.commitStyleEdit).toBe('function')
    expect(() => { face?.addToConversation([]) }).not.toThrow()
    await expect(face?.commitStyleEdit({} as never)).resolves.toMatchObject({
      ok: true, value: { version: 2, origin: 'human-edit' },
    })
  })

  it('registers every Science shell slot contribution', async () => {
    const ctx = new Context()
    const { capture, openDetailsView, openView, viewVisibility } = providePresentation(ctx, true)
    await ctx.plugin({ inject: [...inject], apply }).await()

    const destinations = capture.slots.entries('sidebar.destinations')[0]
    expect(destinations?.component).toBe(ScienceDestinations)
    const openScience = destinations?.inject?.() as {
      openScience: (sessionId: SessionId, destination: 'files' | 'outcomes') => void
    }
    expect(() => { openScience.openScience('unmounted' as SessionId, 'files') }).not.toThrow()
    expect(openDetailsView).toHaveBeenCalledWith('unmounted', 'science')
    openScience.openScience('unmounted' as SessionId, 'outcomes')
    expect(openDetailsView).toHaveBeenLastCalledWith('unmounted', 'science-outcomes')
    expect(capture.slots.entries('conversation.page.utilities')[0]?.component).toBe(ScienceHeroAction)
    expect(capture.slots.entries('details.files')[0]?.component).toBe(ScienceEmptyDetails)
    const accessory = capture.slots.entries('conversation.input.accessory')[0]
    expect(accessory?.component).not.toBe(ScienceComposerChips)
    const Accessory = accessory?.component as (props: { sessionId: SessionId; t: (key: string) => string }) => {
      props: { remove: (index: number) => void }
    }
    const rendered = Accessory({
      sessionId: 'session-1' as SessionId, t: (key: string) => key, useProjection: () => ({}),
    } as never)
    rendered.props.remove(0)
    expect(Accessory({ sessionId: 'session-1' as SessionId, t: (key: string) => key, useProjection: () => null } as never)).toBeNull()
    expect(Accessory({ sessionId: 'session-1' as SessionId, t: (key: string) => key, useProjection: () => undefined } as never)).toBeNull()
    expect(capture.slots.entries('conversation.composer.dock')[0]?.component).toBe(ScienceKernelStatus)
    const trace = capture.slots.entries('conversation.view')[0]
    expect(trace?.component).toBe(ScienceTraceView)
    expect((trace?.options as { label?: () => string }).label?.()).toBe('trace.view')
    const injectTrace = trace?.inject as unknown as (sessionId: SessionId) => { openArtifact: () => void }
    const traceFace = injectTrace('session-1' as SessionId)
    traceFace.openArtifact()
    expect(openDetailsView).toHaveBeenCalledWith('session-1', 'science')
    expect(viewVisibility).toHaveLength(1)
    expect(viewVisibility[0]?.('session-1' as SessionId)).toBe(true)
    expect(viewVisibility[0]?.('unmounted' as SessionId)).toBe(false)

    const details = capture.slots.entries('conversation.details.view')[0]
    const detailsFace = (details?.inject as unknown as (sessionId: SessionId) => ScienceDetailsInjected)('session-1' as SessionId)
    detailsFace.removeFromConversation({
      artifactId: ScienceArtifactId('missing'), version: 1, target: { kind: 'spec-path', path: 'mark' },
    })
    const scrollIntoView = vi.fn()
    vi.stubGlobal('document', { getElementById: vi.fn(() => ({ scrollIntoView })) })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
    detailsFace.openTrace(4)
    expect(openView).toHaveBeenCalledWith('session-1', 'trace')
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })

  it('submits staged targets, rejects ordinary images, reports Remote errors, and clears only after success', async () => {
    const ctx = new Context()
    const { capture, submit } = providePresentation(ctx)
    await ctx.plugin({ inject: [...inject], apply }).await()
    const details = capture.slots.entries('conversation.details.view')[0]
    const injectDetails = details?.inject as unknown as ((sessionId: SessionId) => ScienceDetailsInjected)
    const handler = capture.submissionHandlers[0]
    if (handler === undefined) throw new Error('expected submission handler')
    const target: ScienceEditSelection = {
      artifactId: ScienceArtifactId('chart-1'), version: 1,
      target: { kind: 'spec-path', path: 'encoding.y' },
    }
    const submission = { sessionId: 'session-1' as SessionId, text: '', imageIds: [], mode: 'queue' as const,
      signal: new AbortController().signal }

    injectDetails('session-1' as SessionId).addToConversation([target])
    await expect(handler({
      ...submission, imageIds: ['image-1' as never],
    })).resolves.toEqual({ kind: 'error', text: 'edit.imagesUnsupported' })
    expect(submit).not.toHaveBeenCalled()

    submit.mockResolvedValueOnce({ ok: false, error: { code: 'rejected', message: 'no edit' } } as never)
    await expect(handler({
      ...submission, text: 'change it',
    })).resolves.toEqual({ kind: 'error', text: 'no edit' })

    await expect(handler(submission)).resolves.toEqual({ kind: 'success' })
    expect(submit).toHaveBeenLastCalledWith('session-1', { targets: [target], instruction: '' })
    expect(handler(submission)).toBeUndefined()
  })

  it('shares one selection-store handle across the toolview and details-view registrations', async () => {
    const ctx = new Context()
    const { capture: presentation } = providePresentation(ctx)
    await ctx.plugin({ inject: [...inject], apply }).await()

    const artifactEntry = presentation.slots.entries('tool.call.toolview')
      .find(entry => (entry.options as { key?: string }).key === 'annotate_artifact')
    const runEntry = presentation.slots.entries('tool.call.toolview')
      .find(entry => (entry.options as { key?: string }).key === 'run_python')
    const detailsEntry = presentation.slots.entries('conversation.details.view')
      .find(entry => entry.options.id === 'science')
    const traceEntry = presentation.slots.entries('conversation.view')
      .find(entry => entry.options.id === 'trace')
    expect(artifactEntry?.store).toBeDefined()
    expect(artifactEntry?.store).toBe(detailsEntry?.store)
    expect(runEntry?.store).toBe(detailsEntry?.store)
    expect(traceEntry?.store).toBe(detailsEntry?.store)
    // publish_outcome carries no selection concern and declares no store.
    const outcomeEntry = presentation.slots.entries('tool.call.toolview')
      .find(entry => (entry.options as { key?: string }).key === 'publish_outcome')
    expect(outcomeEntry?.store).toBeUndefined()
  })

  it('removes every row, the header action, the artifact viewer entry, and the dictionaries when the owning fiber disposes (HMR safety)', async () => {
    const ctx = new Context()
    const { capture: presentation } = providePresentation(ctx)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(presentation.slots.entries('tool.call.toolview')).toHaveLength(4)
    expect(presentation.slots.entries('settings.plugin.item')).toHaveLength(1)
    expect(presentation.slots.entries('conversation.session.header.actions')).toHaveLength(1)
    expect(presentation.slots.entries('conversation.details.view')).toHaveLength(2)
    expect(presentation.slots.entries('sidebar.destinations')).toHaveLength(1)
    expect(presentation.slots.entries('conversation.page.utilities')).toHaveLength(1)
    expect(presentation.slots.entries('details.files')).toHaveLength(1)
    expect(presentation.slots.entries('conversation.input.accessory')).toHaveLength(1)
    expect(presentation.slots.entries('conversation.composer.dock')).toHaveLength(1)
    expect(presentation.slots.entries('conversation.view')).toHaveLength(1)
    expect(presentation.submissionHandlers).toHaveLength(1)
    await fiber.dispose()
    expect(presentation.slots.entries('tool.call.toolview')).toHaveLength(0)
    expect(presentation.slots.entries('settings.plugin.item')).toHaveLength(0)
    expect(presentation.slots.entries('conversation.session.header.actions')).toHaveLength(0)
    expect(presentation.slots.entries('conversation.details.view')).toHaveLength(0)
    expect(presentation.slots.entries('sidebar.destinations')).toHaveLength(0)
    expect(presentation.slots.entries('conversation.page.utilities')).toHaveLength(0)
    expect(presentation.slots.entries('details.files')).toHaveLength(0)
    expect(presentation.slots.entries('conversation.input.accessory')).toHaveLength(0)
    expect(presentation.slots.entries('conversation.composer.dock')).toHaveLength(0)
    expect(presentation.slots.entries('conversation.view')).toHaveLength(0)
    expect(presentation.submissionHandlers).toHaveLength(0)
    expect(presentation.localeDisposed).toBe(true)
  })
})
