/**
 * ui-science Host half: publishes this deployment's resolved `toggleScope`
 * (session-scoped by default, app-global when configured) ahead of every
 * plugin bundle so the browser half can read it synchronously at boot. No
 * other Host-side behavior.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import { apply, Config } from '../src/index.ts'
import { TOGGLE_SCOPE_GLOBAL } from '../src/toggle-scope.ts'

/** Collect the injection table the way an index render does. */
function collect(ctx: Context): IndexInjection[] {
  const table: IndexInjection[] = []
  ctx.emit('webserver/index-inject', table)
  return table
}

describe('ui-science host', () => {
  it('publishes the session-scoped default without a config', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    expect(collect(ctx)).toEqual([{ kind: 'global', name: TOGGLE_SCOPE_GLOBAL, value: 'session' }])
    await fiber.dispose()
    expect(collect(ctx)).toEqual([])
  })

  it('publishes a configured global placement, e.g. the desktop composition, validated by the schema', async () => {
    const ctx = new Context()
    await ctx.plugin({ Config, apply }, { toggleScope: 'global' }).await()
    expect(collect(ctx)).toEqual([{ kind: 'global', name: TOGGLE_SCOPE_GLOBAL, value: 'global' }])
  })

  it('rejects a malformed toggleScope at load', async () => {
    const ctx = new Context()
    await expect(ctx.plugin({ Config, apply }, { toggleScope: 'nonsense' } as never).await()).rejects.toThrow()
  })
})
