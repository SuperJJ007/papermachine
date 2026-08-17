/**
 * ui-science browser half: locale dictionary registration, the two keyed
 * toolview registrations (`save_chart`, `publish_outcome`), the keyed Science
 * settings card registration under the `science-runtime` namespace, plus
 * fiber-teardown removal (HMR safety).
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as applyHost } from '../src/index.ts'
import { apply, inject } from '../src/client/index.ts'
import { ScienceChartRow } from '../src/client/ScienceChartRow.tsx'
import { ScienceOutcomeRow } from '../src/client/ScienceOutcomeRow.tsx'
import { ScienceSettingsCard } from '../src/client/ScienceSettingsCard.tsx'
import { SCIENCE_RUNTIME_NS } from '../src/client/settings-card-controller.ts'

interface PresentationCapture {
  slots: SlotRegistry
  dictionaries: Array<{ namespace: string; dictionaries: unknown }>
  localeDisposed: boolean
}

/**
 * Provide the presentation, locale, connection/remote, and settings-scope
 * registries and capture the plugin's registrations. `connection`/`remote`
 * are stubbed rather than real (this plugin's own `bind: () => scope` stub
 * never reaches them) — they exist only to satisfy this plugin's declared
 * `inject`, which the fiber will not leave PENDING for otherwise.
 */
function providePresentation(ctx: Context): PresentationCapture {
  const slots = new SlotRegistry(ctx)
  slots.register({
    name: 'root',
    children: {
      'tool.call.toolview': { kind: 'keyed', scope: 'session' },
      'settings.plugin.item': { kind: 'keyed', scope: 'root' },
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
  const { scope } = stubSettingsScope()
  ctx.provide('settingsScope', { bind: () => scope })
  return capture
}

describe('apply', () => {
  it('keeps the package Host entry free of Host-side behavior', () => {
    expect(() => { applyHost() }).not.toThrow()
  })

  it('declares the services it binds — locale/slots for the toolview rows, and connection/remote/settingsScope for the settings card (settingsScope.bind\'s own documented precondition on its caller)', () => {
    expect(inject).toEqual(['locale', 'slots', 'connection', 'remote', 'settingsScope'])
  })

  it('registers the science locale dictionaries and the save_chart / publish_outcome toolview rows', async () => {
    const ctx = new Context()
    const presentation = providePresentation(ctx)
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
    const presentation = providePresentation(ctx)
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

  it('removes every row and the dictionaries when the owning fiber disposes (HMR safety)', async () => {
    const ctx = new Context()
    const presentation = providePresentation(ctx)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(presentation.slots.entries('tool.call.toolview')).toHaveLength(2)
    expect(presentation.slots.entries('settings.plugin.item')).toHaveLength(1)
    await fiber.dispose()
    expect(presentation.slots.entries('tool.call.toolview')).toHaveLength(0)
    expect(presentation.slots.entries('settings.plugin.item')).toHaveLength(0)
    expect(presentation.localeDisposed).toBe(true)
  })
})
