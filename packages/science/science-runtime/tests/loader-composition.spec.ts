/** Real Loader composition of Session, invariants, local subprocess/sandbox, and folded Runtime. */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { ScienceEnvironmentProfileId } from '@deepseek-ai/dsh-science-session'
import * as ScienceSessionPlugin from '@deepseek-ai/dsh-science-session'
import * as ScienceSessionInvariant from '@deepseek-ai/dsh-science-session/invariant'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import LocalSandboxProvider from '@deepseek-ai/dsh-sandbox-local'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as ScienceRuntimeInvariant from '../src/invariant.ts'
import ScienceRuntime, { SCIENCE_RUNTIME_SETTINGS_NAMESPACE } from '../src/index.ts'
import ScienceRuntimeWithSettings from '../src/with-settings.ts'
import {
  ControlledSubprocess, authorizePythonRun, createFakePythonPrefix, createFakeSandboxRunner, createScienceSession,
} from './harness.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Module map every Loader-composition scenario in this file shares. */
function baseModules(): Map<string, unknown> {
  return new Map<string, unknown>([
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-invariants', InvariantRegistry],
    ['@deepseek-ai/dsh-science-session', ScienceSessionPlugin],
    ['@deepseek-ai/dsh-science-session/invariant', ScienceSessionInvariant],
    ['@deepseek-ai/dsh-science-runtime/test-subprocess', ControlledSubprocess],
    ['@deepseek-ai/dsh-sandbox-local', LocalSandboxProvider],
    ['@deepseek-ai/dsh-attachment-local', LocalAttachmentStore],
    ['@deepseek-ai/dsh-science-runtime', ScienceRuntime],
    ['@deepseek-ai/dsh-science-runtime/invariant', ScienceRuntimeInvariant],
  ])
}

/**
 * Boot one real Cordis Loader/Include context against a written `configPath`.
 * `slowImport` delays exactly one specifier's module resolution: the Loader
 * creates sibling entries concurrently, so this is what lets a scenario decide
 * which entry's module lands first instead of inheriting the harness's
 * single-microtask ordering.
 */
async function bootLoaderContext(
  root: string,
  configPath: string,
  modules: Map<string, unknown>,
  slowImport?: string,
): Promise<Context> {
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      if (specifier === slowImport) await new Promise(resolve => setTimeout(resolve, 50))
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()
  return ctx
}

/** Load the Phase 2 host-only tree through the actual Cordis Loader YAML route. */
async function loadRuntime(): Promise<Context> {
  root = await mkdtemp(join(process.cwd(), '.science-runtime-loader-'))
  const prefix = createFakePythonPrefix(root)
  const runner = createFakeSandboxRunner(root)
  const dshHome = join(root, 'dsh-home')
  const configPath = join(root, 'cordis.yml')
  const quote = (value: string): string => JSON.stringify(value)
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-invariants'",
    '  config:',
    '    enabled: true',
    "- name: '@deepseek-ai/dsh-science-session'",
    "- name: '@deepseek-ai/dsh-science-session/invariant'",
    "- name: '@deepseek-ai/dsh-science-runtime/test-subprocess'",
    "- name: '@deepseek-ai/dsh-sandbox-local'",
    '  config:',
    `    runnerCommand: [${quote(runner)}]`,
    "    runnerFailureSignatures: ['science-runtime fake runner failure']",
    "- name: '@deepseek-ai/dsh-attachment-local'",
    '  config:',
    `    dshHome: ${quote(dshHome)}`,
    "- name: '@deepseek-ai/dsh-science-runtime'",
    '  config:',
    `    dshHome: ${quote(dshHome)}`,
    '    profiles:',
    '      fake:',
    `        pythonPrefix: ${quote(prefix)}`,
    "- name: '@deepseek-ai/dsh-science-runtime/invariant'",
    '',
  ].join('\n'))

  context = await bootLoaderContext(root, configPath, baseModules())
  return context
}

/**
 * Load the same tree with an intentionally empty Cordis `profiles` map and a
 * real `@deepseek-ai/dsh-settings-file` provider, over `root` — reused across
 * two calls to prove the `science-runtime` namespace only takes effect on the
 * next Host start.
 */
async function loadSettingsRestartRuntime(
  root: string,
  runner: string,
  options?: { settingsYaml?: string; slowImport?: string },
): Promise<Context> {
  const dshHome = join(root, 'dsh-home')
  const settingsPath = join(root, 'settings.yaml')
  const configPath = join(root, 'cordis.yml')
  if (options?.settingsYaml !== undefined) await writeFile(settingsPath, options.settingsYaml)
  const quote = (value: string): string => JSON.stringify(value)
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-invariants'",
    '  config:',
    '    enabled: true',
    "- name: '@deepseek-ai/dsh-science-session'",
    "- name: '@deepseek-ai/dsh-science-session/invariant'",
    "- name: '@deepseek-ai/dsh-science-runtime/test-subprocess'",
    "- name: '@deepseek-ai/dsh-sandbox-local'",
    '  config:',
    `    runnerCommand: [${quote(runner)}]`,
    "    runnerFailureSignatures: ['science-runtime fake runner failure']",
    "- name: '@deepseek-ai/dsh-attachment-local'",
    '  config:',
    `    dshHome: ${quote(dshHome)}`,
    "- name: '@deepseek-ai/dsh-settings-file'",
    '  config:',
    `    path: ${quote(settingsPath)}`,
    '    watch: false',
    "- name: '@deepseek-ai/dsh-science-runtime/with-settings'",
    '  config:',
    `    dshHome: ${quote(dshHome)}`,
    '    profiles: {}',
    "- name: '@deepseek-ai/dsh-science-runtime/invariant'",
    '',
  ].join('\n'))

  const modules = baseModules()
  modules.set('@deepseek-ai/dsh-settings-file', FileSettingsProvider)
  modules.set('@deepseek-ai/dsh-science-runtime/with-settings', ScienceRuntimeWithSettings)
  return bootLoaderContext(root, configPath, modules, options?.slowImport)
}

describe('Science Runtime real Loader composition', () => {
  it('loads, binds, runs, and unloads the folded Runtime through Loader', async () => {
    const loaded = await loadRuntime()
    const unloaded = [...loaded.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])
    expect(loaded.subprocess).toBeInstanceOf(ControlledSubprocess)
    expect(loaded.sandbox).toBeInstanceOf(LocalSandboxProvider)
    expect(loaded.scienceRuntime).toBeInstanceOf(ScienceRuntime)
    const session = loaded.sessions.create(SessionId('science-loader-composed'), { meta: { agentPreset: 'science' } })
    session.append('science/mode-bound', {
      version: 1,
      mode: { modeId: 'science', presetId: 'science', modeRevision: 'phase-2-loader-test' },
    })
    process.env.SCIENCE_RUNTIME_LEAK = 'must-not-reach-real-local-providers'
    try {
      await expect(loaded.scienceRuntime.bindEnvironment({
        session,
        profileId: ScienceEnvironmentProfileId('fake'),
        signal: new AbortController().signal,
      })).resolves.toMatchObject({ status: 'applied', python: { capability: 'available' } })
      const handle = await loaded.scienceRuntime.startRun({
        session,
        language: 'python',
        code: 'print("Loader path")',
        ...authorizePythonRun(session, 'science-loader-run'),
        signal: new AbortController().signal,
      })
      await expect(handle.done).resolves.toMatchObject({
        terminal: { runId: handle.runId, status: 'success' },
        stdout: { text: 'fake run output\n' },
      })
    } finally {
      delete process.env.SCIENCE_RUNTIME_LEAK
    }
    expect(session.events.map(event => event.type).filter(type => type.startsWith('science/'))).toEqual([
      'science/mode-bound',
      'science/environment-bound',
      'science/run-started',
      'science/run-finished',
    ])
    const runtimeEntry = [...loaded.loader.entries()].find(entry => entry.options.name === '@deepseek-ai/dsh-science-runtime')
    if (runtimeEntry?.fiber === undefined) throw new Error('Science Runtime Loader entry is not active')
    await runtimeEntry.fiber.dispose()
    expect(loaded.scienceRuntime).toBeUndefined()
  })

  it('executes one confined child through the real local sandbox and subprocess providers', async () => {
    root = await mkdtemp(join(process.cwd(), '.science-runtime-local-provider-'))
    const runner = createFakeSandboxRunner(root)
    context = new Context()
    await context.plugin(LocalSubprocessRuntime)
    await context.plugin(LocalSandboxProvider, {
      runnerCommand: [runner],
      runnerFailureSignatures: ['science-runtime fake runner failure'],
    })
    const confined = context.sandbox.confine(['/usr/bin/env'], {
      mode: 'workspace-write', workspaceRoot: root, sessionId: SessionId('science-local-provider'),
    })
    expect(confined.enforcement).toBe('full')
    process.env.SCIENCE_RUNTIME_LEAK = 'must-not-reach-real-local-providers'
    try {
      const handle = context.subprocess.spawn({
        argv: confined.argv,
        cwd: root,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: 1_024 },
          stderr: { maxBytes: 1_024 },
        },
        graceMs: 3_000,
        environmentBase: 'empty',
        env: {
          HOME: root,
          TMPDIR: root,
          PATH: '/usr/bin:/bin',
          LANG: 'en_US.UTF-8',
          LC_ALL: 'en_US.UTF-8',
          TZ: 'UTC',
        },
      })
      await expect(handle.done).resolves.toEqual({ exitCode: 0, signal: null })
      await expect(handle.waitForExit()).resolves.toBe(true)
      expect(handle.collected.stdout?.readFrom(0).text).toContain(`HOME=${root}\n`)
      expect(handle.collected.stdout?.readFrom(0).text).not.toContain('SCIENCE_RUNTIME_LEAK=')
      expect(handle.collected.stderr?.readFrom(0).text).toBe('')
    } finally {
      delete process.env.SCIENCE_RUNTIME_LEAK
    }
  })

  it('leaves an intentionally empty Cordis profile map unusable until a settings-file write survives a real restart', async () => {
    root = await mkdtemp(join(process.cwd(), '.science-runtime-settings-restart-'))
    const prefix = createFakePythonPrefix(root)
    const runner = createFakeSandboxRunner(root)

    context = await loadSettingsRestartRuntime(root, runner)
    const before = createScienceSession(context, 'science-settings-restart-before')
    await expect(context.scienceRuntime.bindEnvironment({
      session: before, profileId: ScienceEnvironmentProfileId('fake'), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    expect(before.events.map(event => event.type).filter(type => type.startsWith('science/'))).toEqual([
      'science/mode-bound',
    ])

    await context.get('settings')!.update(SCIENCE_RUNTIME_SETTINGS_NAMESPACE, { fake: { pythonPrefix: prefix } })
    // Same Host lifecycle: the write reached storage, not this already-constructed Runtime.
    await expect(context.scienceRuntime.bindEnvironment({
      session: before, profileId: ScienceEnvironmentProfileId('fake'), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'INVALID_REQUEST' })

    await context.fiber.dispose()
    context = undefined

    // Real restart: a fresh Loader composition over the same Harness home reads the persisted settings.yaml.
    context = await loadSettingsRestartRuntime(root, runner)
    const after = createScienceSession(context, 'science-settings-restart-after')
    await expect(context.scienceRuntime.bindEnvironment({
      session: after, profileId: ScienceEnvironmentProfileId('fake'), signal: new AbortController().signal,
    })).resolves.toMatchObject({ status: 'applied', python: { capability: 'available' } })
  })

  it('fails the Runtime Loader entry when the persisted settings section is unserviceable', async () => {
    root = await mkdtemp(join(process.cwd(), '.science-runtime-settings-invalid-'))
    const runner = createFakeSandboxRunner(root)
    await expect(loadSettingsRestartRuntime(root, runner, {
      settingsYaml: ['science-runtime:', '  fake: {}', ''].join('\n'),
    })).rejects.toThrow(/requires pythonPrefix or rPrefix/)
  })

  // The Loader creates sibling entries concurrently, so whichever module
  // finishes importing first is not a composition fact. Binding the namespace
  // on a load-moment readiness probe therefore dropped the stored profile
  // whenever the settings provider's module landed second, and the entry order
  // in cordis.yml did not repair it. Declaring `settings` among this entry's
  // injections is what makes both timings agree.
  for (const slowImport of ['@deepseek-ai/dsh-settings-file', '@deepseek-ai/dsh-science-runtime/with-settings']) {
    it(`reads the persisted profile whichever module lands first (slow: ${slowImport})`, async () => {
      root = await mkdtemp(join(process.cwd(), '.science-runtime-settings-order-'))
      const prefix = createFakePythonPrefix(root)
      const runner = createFakeSandboxRunner(root)

      context = await loadSettingsRestartRuntime(root, runner, {
        settingsYaml: ['science-runtime:', '  fake:', `    pythonPrefix: ${JSON.stringify(prefix)}`, ''].join('\n'),
        slowImport,
      })

      expect(context.get('settings')!.describe().map(row => String(row.ns))).toContain('science-runtime')
      const session = createScienceSession(context, `science-settings-order-${slowImport.length}`)
      await expect(context.scienceRuntime.bindEnvironment({
        session, profileId: ScienceEnvironmentProfileId('fake'), signal: new AbortController().signal,
      })).resolves.toMatchObject({ status: 'applied', python: { capability: 'available' } })
    })
  }
})
