/**
 * ui-science browser half: locale dictionary registration, the two keyed
 * toolview registrations (`save_chart`, `publish_outcome`), the keyed Science
 * settings card registration under the `science-runtime` namespace, the
 * session-header action and artifact-viewer (Details) entry registrations
 * (both id `science`), the one selection-store handle shared across the
 * toolview/details-view registrations, plus fiber-teardown removal (HMR
 * safety).
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as applyHost } from '../src/index.ts'
import { apply, inject } from '../src/client/index.ts'
import { ScienceChartRow } from '../src/client/ScienceChartRow.tsx'
import { ScienceOutcomeRow } from '../src/client/ScienceOutcomeRow.tsx'
import { ScienceSettingsCard } from '../src/client/ScienceSettingsCard.tsx'
import { ScienceHeaderAction } from '../src/client/ScienceHeaderAction.tsx'
import { ScienceDetailsView, type ScienceDetailsInjected } from '../src/client/ScienceDetailsView.tsx'
import { SCIENCE_RUNTIME_NS } from '../src/client/settings-card-controller.ts'

interface PresentationCapture {
  slots: SlotRegistry
  dictionaries: Array<{ namespace: string; dictionaries: unknown }>
  localeDisposed: boolean
}

/**
 * Provide the presentation, locale, connection/remote, settings-scope, and
 * sessions registries and capture the plugin's registrations. `sessions`
 * (a minimal `binding` stub) resolves the Details entry's own attachment
 * loader factory; nothing here reads `ctx.sessions.list` any more (the
 * artifact viewer is one plain `conversation.details.view` entry with no
 * session-preset-gated dynamic registration).
 */
function providePresentation(ctx: Context) {
  const slots = new SlotRegistry(ctx)
  slots.register({
    name: 'root',
    children: {
      'tool.call.toolview': { kind: 'keyed', scope: 'session' },
      'settings.plugin.item': { kind: 'keyed', scope: 'root' },
      'conversation.session.header.actions': { kind: 'list', scope: 'session' },
      'conversation.details.view': { kind: 'list', scope: 'session' },
    },
  } as never, () => null)
  const capture: PresentationCapture = { slots, dictionaries: [], localeDisposed: false }
  ctx.provide('locale', {
    register(namespace: string, dictionaries: unknown) {
      capture.dictionaries.push({ namespace, dictionaries })
      return () => { capture.localeDisposed = true }
    },
    bind: () => (key: string) => key,
  })
  ctx.provide('connection', {} as never)
  ctx.provide('remote', {} as never)
  ctx.provide('sessions', { binding: () => undefined } as unknown as ISessions)
  const { scope } = stubSettingsScope()
  ctx.provide('settingsScope', { bind: () => scope })
  return { capture }
}

describe('apply', () => {
  it('keeps the package Host entry free of Host-side behavior', () => {
    expect(() => { applyHost() }).not.toThrow()
  })

  it('declares the services it binds — locale/slots for the toolview rows, connection/remote/settingsScope for the settings card (settingsScope.bind\'s own documented precondition on its caller), and sessions for the Details entry\'s own attachment loader', () => {
    expect(inject).toEqual(['locale', 'slots', 'connection', 'remote', 'settingsScope', 'sessions'])
  })

  it('registers the science locale dictionaries and the save_chart / publish_outcome toolview rows', async () => {
    const ctx = new Context()
    const { capture: presentation } = providePresentation(ctx)
    await ctx.plugin({ inject: [...inject], apply }).await()

    expect(presentation.dictionaries).toHaveLength(1)
    expect(presentation.dictionaries[0]?.namespace).toBe('science')

    const entries = presentation.slots.entries('tool.call.toolview')
    const chart = entries.find(entry => (entry.options as { key?: string }).key === 'save_chart')
    const outcome = entries.find(entry => (entry.options as { key?: string }).key === 'publish_outcome')
    expect(chart?.component).toBe(ScienceChartRow)
    expect(chart?.locale).toBe('science')
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
    expect(entries).toHaveLength(1)
    const options = entries[0]?.options as { id?: string; order?: number; label?: () => string } | undefined
    expect(options?.id).toBe('science')
    expect(options?.order).toBe(10)
    expect(options?.label?.()).toBe('details.label')
    expect(entries[0]?.component).toBe(ScienceDetailsView)
    expect(entries[0]?.locale).toBe('science')

    // The registration's inject factory hands the rendered entry its own
    // session-scoped attachment loader — never an owner-supplied one, since
    // the Details seam's owner share carries only its own inspectCall callback.
    const injectFn = entries[0]?.inject as unknown as ((sessionId: SessionId) => ScienceDetailsInjected) | undefined
    const face = injectFn?.('any-session' as SessionId)
    expect(typeof face?.loadImage).toBe('function')
  })

  it('shares one selection-store handle across the toolview and details-view registrations', async () => {
    const ctx = new Context()
    const { capture: presentation } = providePresentation(ctx)
    await ctx.plugin({ inject: [...inject], apply }).await()

    const chartEntry = presentation.slots.entries('tool.call.toolview')
      .find(entry => (entry.options as { key?: string }).key === 'save_chart')
    const detailsEntry = presentation.slots.entries('conversation.details.view')
      .find(entry => entry.options.id === 'science')
    expect(chartEntry?.store).toBeDefined()
    expect(chartEntry?.store).toBe(detailsEntry?.store)
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
    expect(presentation.slots.entries('tool.call.toolview')).toHaveLength(2)
    expect(presentation.slots.entries('settings.plugin.item')).toHaveLength(1)
    expect(presentation.slots.entries('conversation.session.header.actions')).toHaveLength(1)
    expect(presentation.slots.entries('conversation.details.view')).toHaveLength(1)
    await fiber.dispose()
    expect(presentation.slots.entries('tool.call.toolview')).toHaveLength(0)
    expect(presentation.slots.entries('settings.plugin.item')).toHaveLength(0)
    expect(presentation.slots.entries('conversation.session.header.actions')).toHaveLength(0)
    expect(presentation.slots.entries('conversation.details.view')).toHaveLength(0)
    expect(presentation.localeDisposed).toBe(true)
  })
})
