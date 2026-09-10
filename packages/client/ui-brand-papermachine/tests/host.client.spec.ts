/** Browser-only branding remains loadable as a Host plugin. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import * as brand from '../src/index.ts'

it('mounts and disposes without Host service dependencies', async () => {
  const ctx = new Context()
  const fiber = ctx.plugin(brand)
  await fiber.await()
  expect(ctx.registry.get(brand)).toBeDefined()
  await fiber.dispose()
  expect(ctx.registry.has(brand)).toBe(false)
})
