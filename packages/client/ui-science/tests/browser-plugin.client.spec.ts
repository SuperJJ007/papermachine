/**
 * ui-science browser half: locale dictionary registration and the two keyed
 * toolview registrations (`save_chart`, `publish_outcome`), plus
 * fiber-teardown removal (HMR safety).
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { apply as applyHost } from '../src/index.ts'
import { apply, inject } from '../src/client/index.ts'
import { ScienceChartRow } from '../src/client/ScienceChartRow.tsx'
import { ScienceOutcomeRow } from '../src/client/ScienceOutcomeRow.tsx'

interface PresentationCapture {
  slots: SlotRegistry
  dictionaries: Array<{ namespace: string; dictionaries: unknown }>
  localeDisposed: boolean
}

/** Provide the presentation registries and capture the plugin's registrations. */
function providePresentation(ctx: Context): PresentationCapture {
  const slots = new SlotRegistry(ctx)
  slots.register({
    name: 'root',
    children: { 'tool.call.toolview': { kind: 'keyed', scope: 'session' } },
  } as never, () => null)
  const capture: PresentationCapture = { slots, dictionaries: [], localeDisposed: false }
  ctx.provide('locale', {
    register(namespace: string, dictionaries: unknown) {
      capture.dictionaries.push({ namespace, dictionaries })
      return () => { capture.localeDisposed = true }
    },
    bind: () => (key: string) => key,
  })
  return capture
}

describe('apply', () => {
  it('keeps the package Host entry free of Host-side behavior', () => {
    expect(() => { applyHost() }).not.toThrow()
  })

  it('declares the services it binds', () => {
    expect(inject).toEqual(['locale', 'slots'])
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

  it('removes both rows and the dictionaries when the owning fiber disposes (HMR safety)', async () => {
    const ctx = new Context()
    const presentation = providePresentation(ctx)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(presentation.slots.entries('tool.call.toolview')).toHaveLength(2)
    await fiber.dispose()
    expect(presentation.slots.entries('tool.call.toolview')).toHaveLength(0)
    expect(presentation.localeDisposed).toBe(true)
  })
})
