/** Restart-scoped `science-runtime` settings-namespace ownership of the Conda profile map. */

import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { ScienceEnvironmentProfileId } from '@deepseek-ai/dsh-science-session'
import * as ScienceSessionInvariant from '@deepseek-ai/dsh-science-session/invariant'
import SessionStore from '@deepseek-ai/dsh-session'
import ScienceRuntime, { SCIENCE_RUNTIME_SETTINGS_NAMESPACE } from '../src/index.ts'
import ScienceRuntimeWithSettings from '../src/with-settings.ts'
import type { Config } from '../src/config.ts'
import {
  ControlledSubprocess, DirectSandbox, createFakePythonPrefix, createScienceSession, mountArtifactStore,
} from './harness.ts'

/** The smallest real provider: one in-memory document, always writable. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown>

  constructor(ctx: ConstructorParameters<typeof SettingsProvider>[0], options?: { doc?: Record<string, unknown> }) {
    super(ctx)
    this.doc = structuredClone(options?.doc ?? {})
  }

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  while (contexts.length > 0) await contexts.pop()!.fiber.dispose()
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
})

function freshRoot(): string {
  const root = mkdtempSync(join(process.cwd(), '.science-runtime-settings-'))
  roots.push(root)
  return root
}

/**
 * Mount Session/invariant/subprocess/sandbox/attachments, an optional
 * in-memory settings provider, and one Runtime entry.
 */
async function boot(
  root: string,
  profiles: Config['profiles'],
  options?: { doc?: Record<string, unknown>; settings?: boolean; entry?: typeof ScienceRuntime },
): Promise<{
  readonly ctx: Context
  readonly runtimeFiber: Awaited<ReturnType<Context['plugin']>>
}> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(ScienceSessionInvariant)
  await ctx.plugin(ControlledSubprocess)
  await ctx.plugin(DirectSandbox)
  await mountArtifactStore(ctx, root)
  if (options?.settings !== false) {
    await ctx.plugin(MemorySettings, options?.doc === undefined ? {} : { doc: options.doc })
  }
  const entry = options?.entry ?? ScienceRuntimeWithSettings
  const runtimeFiber = await ctx.plugin(entry, { dshHome: join(root, 'dsh-home'), profiles })
  return { ctx, runtimeFiber }
}

describe('Science Runtime settings-namespace ownership', () => {
  it('registers the science-runtime namespace with the Cordis profiles as a restart-applying composition base', async () => {
    const root = freshRoot()
    const prefix = createFakePythonPrefix(root)
    const { ctx } = await boot(root, { fake: { pythonPrefix: prefix } })

    const [descriptor] = ctx.settings.describe().filter(row => String(row.ns) === 'science-runtime')
    expect(descriptor).toMatchObject({
      applies: 'restart',
      base: { fake: { pythonPrefix: prefix } },
      value: { fake: { pythonPrefix: prefix } },
    })
    expect(descriptor?.user).toBeUndefined()
  })

  it('keeps pythonPrefix and rPrefix write-only under redaction', async () => {
    const root = freshRoot()
    const prefix = createFakePythonPrefix(root)
    const { ctx } = await boot(root, { fake: { pythonPrefix: prefix } })

    const [descriptor] = ctx.settings.describe({ redactSecrets: true })
      .filter(row => String(row.ns) === 'science-runtime')
    expect(JSON.stringify(descriptor)).not.toContain(prefix)
    expect(descriptor?.secrets).toEqual([
      { path: ['fake', 'pythonPrefix'], set: true },
      { path: ['fake', 'rPrefix'], set: false },
    ])
  })

  it('captures the resolved profile map once at load: a later write reaches only a restarted Runtime', async () => {
    const root = freshRoot()
    const prefix = createFakePythonPrefix(root)
    const { ctx, runtimeFiber } = await boot(root, {})
    const session = createScienceSession(ctx, 'science-settings-restart')

    await expect(ctx.scienceRuntime.bindEnvironment({
      session, profileId: ScienceEnvironmentProfileId('fake'), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'PROFILE_NOT_CONFIGURED' })
    expect(session.events.map(event => event.type).filter(type => type.startsWith('science/'))).toEqual([
      'science/mode-bound',
    ])

    await ctx.settings.update(SCIENCE_RUNTIME_SETTINGS_NAMESPACE, { fake: { pythonPrefix: prefix } })

    // The write changed storage, not this already-constructed instance.
    await expect(ctx.scienceRuntime.bindEnvironment({
      session, profileId: ScienceEnvironmentProfileId('fake'), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'PROFILE_NOT_CONFIGURED' })

    // Simulate a restart: dispose the Runtime's own fiber (releasing its
    // namespace registration) and mount a fresh one over the same document.
    await runtimeFiber.dispose()
    await ctx.plugin(ScienceRuntimeWithSettings, { dshHome: join(root, 'dsh-home'), profiles: {} })
    const restarted = createScienceSession(ctx, 'science-settings-restarted')
    await expect(ctx.scienceRuntime.bindEnvironment({
      session: restarted, profileId: ScienceEnvironmentProfileId('fake'), signal: new AbortController().signal,
    })).resolves.toMatchObject({ status: 'applied' })
  })

  it('rejects a settings write it cannot serve, and fails registration over an already-invalid stored section', async () => {
    const root = freshRoot()
    const { ctx } = await boot(root, {})

    await expect(ctx.settings.update(SCIENCE_RUNTIME_SETTINGS_NAMESPACE, {
      'not valid': { pythonPrefix: '/prefix' },
    })).rejects.toThrow(/profile id/)
    await expect(ctx.settings.update(SCIENCE_RUNTIME_SETTINGS_NAMESPACE, {
      fake: { pythonPrefix: 'relative' },
    })).rejects.toThrow(/absolute/)

    const badRoot = freshRoot()
    await expect(boot(badRoot, {}, { doc: { 'science-runtime': { fake: {} } } }))
      .rejects.toThrow(/requires pythonPrefix or rPrefix/)
  })

  it('releases the namespace when the Runtime plugin unloads', async () => {
    const root = freshRoot()
    const { ctx, runtimeFiber } = await boot(root, {})
    expect(ctx.settings.describe().map(row => String(row.ns))).toContain('science-runtime')

    await runtimeFiber.dispose()

    expect(ctx.settings.describe().map(row => String(row.ns))).not.toContain('science-runtime')
  })

  it('leaves the settings-bound entry inactive rather than falling back when no provider is mounted', async () => {
    const root = freshRoot()
    const prefix = createFakePythonPrefix(root)
    const { ctx } = await boot(root, { fake: { pythonPrefix: prefix } }, { settings: false })

    // The unmet `settings` injection keeps this entry PENDING: silently
    // serving the Cordis map would be the load-order fallback this entry exists
    // to rule out.
    expect(ctx.get('settings')).toBeUndefined()
    expect(ctx.get('scienceRuntime')).toBeUndefined()
  })

  it('keeps the root entry free of settings even when a provider is mounted', async () => {
    const root = freshRoot()
    const prefix = createFakePythonPrefix(root)
    const { ctx } = await boot(root, { fake: { pythonPrefix: prefix } }, { entry: ScienceRuntime })

    expect(ctx.settings.describe().map(row => String(row.ns))).not.toContain('science-runtime')
    const session = createScienceSession(ctx, 'science-settings-root-entry')
    await expect(ctx.scienceRuntime.bindEnvironment({
      session, profileId: ScienceEnvironmentProfileId('fake'), signal: new AbortController().signal,
    })).resolves.toMatchObject({ status: 'applied' })
  })
})
