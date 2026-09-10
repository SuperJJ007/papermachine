// @vitest-environment jsdom
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { en, zh } from '../src/client/locales.ts'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply, inject } from '../src/client/index.ts'
import { PaperMachineBrandMark, PaperMachineBrandName } from '../src/client/Brand.tsx'
import css from '../src/client/BrandName.module.css'

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

const HOLES = [
  'sidebar.brand.mark',
  'sidebar.brand.name',
  'conversation.hero.brand.mark',
] as const

async function bench(declare = true) {
  const ctx = new Context()
  ctx.provide('locale', new LocaleRuntime(ctx))
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const declareHoles = () => slots.register({
    name: 'root',
    children: Object.fromEntries(HOLES.map(name => [name, { kind: 'single', scope: 'root' }])),
  } as never, () => null)
  const disposeHoles = declare ? declareHoles() : undefined
  return { ctx, slots, declareHoles, disposeHoles }
}

describe('PaperMachine browser-brand plugin', () => {
  it('declares the slot and locale services it uses', () => {
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('fills declarations before or after apply and removes every occupant on teardown', async () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'papermachine')
    const before = await bench()
    const fiber = before.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(1)
    expect(before.slots.entries('sidebar.brand.name')[0]?.locale).toBe('brand.papermachine')
    const t = before.ctx.locale.bind('brand.papermachine')
    for (const language of ['en', 'zh']) {
      before.ctx.locale.setLocale(language)
      expect(t('wordmark.paper') + t('wordmark.machine')).toBe('PaperMachine')
    }

    before.disposeHoles?.()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(0)
    before.declareHoles()
    await Promise.resolve()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(1)

    await fiber.dispose()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(0)
    expect(t('wordmark.paper')).toBe('wordmark.paper')

    const after = await bench(false)
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of HOLES) expect(after.slots.entries(hole)).toHaveLength(0)
    after.declareHoles()
    await Promise.resolve()
    for (const hole of HOLES) expect(after.slots.entries(hole)).toHaveLength(1)
  })

  it('leaves brand slots empty outside a PaperMachine build', async () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'official')
    const subject = await bench()
    const fiber = subject.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    for (const hole of HOLES) expect(subject.slots.entries(hole)).toHaveLength(0)
    await fiber.dispose()
  })

  it('renders the wordmark as one word split across two weight classes, independent of both requested mark sizes', () => {
    const locale = new LocaleRuntime(new Context())
    locale.register('brand.papermachine', { en, zh })
    const name = render(<PaperMachineBrandName t={locale.bind('brand.papermachine')} />)
    expect(name.container.textContent).toBe('PaperMachine')
    const [paper, machine] = name.container.querySelectorAll('span > span')
    expect(paper?.textContent).toBe('Paper')
    expect(machine?.textContent).toBe('Machine')
    expect(paper?.className).toBe(css.paper)
    expect(machine?.className).toBe(css.machine)
    expect(css.paper).not.toBe(css.machine)
    name.unmount()

    const mark = render(<PaperMachineBrandMark size={34} className="hero-mark" />)
    expect(mark.container.querySelector('svg')?.getAttribute('width')).toBe('34')
    expect(mark.container.querySelector('svg')?.getAttribute('class')).toBe('hero-mark')
    mark.rerender(<PaperMachineBrandMark size={24} />)
    expect(mark.container.querySelector('svg')?.getAttribute('width')).toBe('24')
  })
})
