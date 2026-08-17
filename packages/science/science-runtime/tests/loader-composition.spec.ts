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
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as ScienceRuntimeInvariant from '../src/invariant.ts'
import ScienceRuntime from '../src/index.ts'
import { ControlledSubprocess, authorizePythonRun, createFakePythonPrefix, createFakeSandboxRunner } from './harness.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

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

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
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
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
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
})
