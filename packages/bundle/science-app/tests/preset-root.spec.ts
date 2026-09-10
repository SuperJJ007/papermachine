/** The product preset provider exposes shipped files to injected configuration consumers. */
import { readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import * as ScienceApp from '../src/index.ts'

it('makes the bundled Science preset readable to an injected consumer and withdraws it on disposal', async () => {
  const ctx = new Context()
  let observed: string | undefined
  try {
    await ctx.plugin({
      name: 'preset-root-consumer',
      inject: ['sciencePresetRoot'],
      apply: (consumer: Context) => { observed = consumer.sciencePresetRoot },
    })
    expect(observed).toBeUndefined()
    const provider = ctx.plugin(ScienceApp)
    await provider
    expect(observed).toBe(ctx.sciencePresetRoot)
    expect(isAbsolute(ctx.sciencePresetRoot)).toBe(true)
    const preset = await readFile(join(ctx.sciencePresetRoot, 'science', 'preset.yml'), 'utf8')
    const composition = await readFile(join(ctx.sciencePresetRoot, 'science', 'agent.cordis.yml'), 'utf8')
    expect(preset).toContain('copyable: false')
    expect(composition).toContain('@deepseek-ai/dsh-tool-science')
    await provider.dispose()
    expect(ctx.get('sciencePresetRoot')).toBeUndefined()
  } finally {
    await ctx.fiber.dispose()
  }
})
