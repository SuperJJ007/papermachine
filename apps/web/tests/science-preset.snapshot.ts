import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { SandboxProvider } from '@deepseek-ai/dsh-sandbox'
import type { ConfinedArgv, SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type {
  SubprocessHandle, SubprocessOutputRead, SubprocessSpawnSpec, SubprocessTerminalHandle, SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import ScienceRuntime from '@deepseek-ai/dsh-science-runtime'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import {
  assertFixtureInventory, launchWebScaffold, recordFixture, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'

const MODE = webSnapshotMode()

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/science-preset', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.jsonl')
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PROMPT = 'Call get_science_state now and report only the mode revision it returns, in one short sentence. Do not run any Python or R code.'

// The shipped Web Host mounts no Science Runtime row (R4 scope: preset
// wiring, not deployment defaults), so this scenario mounts a fake-backed
// one directly on the booted scaffold — the same technique as
// `apps/cli/tests/web-agent-presets.e2e.ts`'s "fake-backed Science Runtime"
// section, isolated behind `ctx.isolate()` so it does not collide with the
// shipped bundle's own real `subprocess`/`sandbox` Host rows.

/** Full-enforcement test double that preserves direct argv. */
class DirectSandbox extends SandboxProvider {
  confine(argv: readonly string[], _policy: SandboxPolicy): ConfinedArgv {
    return { argv: [...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] }
  }
}

function reader(text: string): { readFrom(fromByte: number): SubprocessOutputRead } {
  return { readFrom: () => ({ text, nextOffset: Buffer.byteLength(text), lossy: false, utf8Validity: 'valid' }) }
}

function settledHandle(stdout: string, stderr: string): SubprocessHandle {
  return {
    pid: 4242,
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    collected: { stdout: reader(stdout), stderr: reader(stderr) },
    done: Promise.resolve({ exitCode: 0, signal: null }),
    terminate: () => {},
    waitForExit: async () => true,
  }
}

/** Host-local fake subprocess provider: frozen probes plus a fixed successful run output. */
class FakeSubprocess extends SubprocessRuntime {
  override executionWorld: 'host-local' | 'remote' = 'host-local'

  override async resolveExecutable(command: string): Promise<string> {
    return command
  }

  override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    if (spec.argv.includes('--version')) return settledHandle('Fake Python 3.13.5\n', '')
    if (spec.argv.includes('-c') || spec.argv.includes('-e')) return settledHandle('dsh-科学-✓', '')
    return settledHandle('fake run output\n', '')
  }

  override async spawnTerminal(_spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    throw new Error('FakeSubprocess does not allocate terminals')
  }
}

/** Write a fake Python Conda prefix with the frozen probe/run outputs `FakeSubprocess` returns. */
function createFakePythonPrefix(root: string): string {
  const prefix = join(root, 'fake-conda')
  mkdirSync(join(prefix, 'bin'), { recursive: true })
  mkdirSync(join(prefix, 'conda-meta'), { recursive: true })
  writeFileSync(join(prefix, 'conda-meta', 'history'), '==> 2026-08-16 <==\n+python-3.13.5\n')
  const executable = join(prefix, 'bin', 'python')
  writeFileSync(executable, '#!/bin/sh\nprintf \'fake run output\\n\'\n')
  chmodSync(executable, 0o700)
  return prefix
}

describe('science agent preset', () => {
  let scaffold: WebScaffold
  let agentHandle: AgentHandle
  let scratch: string

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ replayFixture: FIXTURE })
    // Repo-relative, not the scaffold's own os.tmpdir()-based world: Science
    // Runtime scratch roots must not overlap a generic sandbox temp grant.
    scratch = await mkdtemp(join(REPO_ROOT, '.web-science-preset-scratch-'))
    const isolated = scaffold.ctx.isolate('subprocess').isolate('sandbox')
    await isolated.plugin(FakeSubprocess)
    await isolated.plugin(DirectSandbox)
    await isolated.plugin(ScienceRuntime, {
      dshHome: join(scratch, 'dsh-home'),
      profiles: { science: { pythonPrefix: createFakePythonPrefix(scratch) } },
    })
    await writeFile(join(scaffold.workspaceCwd, 'AGENTS.md'), [
      '# Project instructions',
      '',
      'Prefer vectorized pandas operations over explicit Python loops.',
      '',
    ].join('\n'))
    agentHandle = await scaffold.ctx.agents.create({
      sessionId: SessionId('science-preset-smoke'),
      meta: { cwd: scaffold.workspaceCwd, agentPreset: 'science' },
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx, 'science').then(() => undefined),
    })
  }, 120_000)

  afterAll(async () => {
    const failures: unknown[] = []
    await agentHandle?.dispose().catch((error: unknown) => failures.push(error))
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    await rm(scratch, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'science preset smoke teardown failed')
  })

  it('binds mode/environment, sends the exact roster, and reports get_science_state', async () => {
    agentHandle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: PROMPT }],
      source: { kind: 'user' },
    }))
    await agentHandle.agent.whenIdle()

    if (MODE === 'record') {
      await recordFixture(scaffold, SessionId('science-preset-smoke'), FIXTURE)
      return
    }

    const requestHeader = agentHandle.agent.session.requestHeader()
    if (requestHeader === undefined) throw new Error('the science agent issued no model request')
    const log = agentHandle.agent.session.events

    // Durable event ordering: mode/environment binding precedes the first
    // request, which precedes the tool call and its durable result.
    const seqOf = (type: string): number | undefined => log.find(event => event.type === type)?.seq
    const modeBoundSeq = seqOf('science/mode-bound')
    const environmentBoundSeq = seqOf('science/environment-bound')
    const requestHeaderSeq = seqOf('request/header')
    const toolCallSeq = seqOf('tool/call')
    expect(modeBoundSeq).toBeDefined()
    expect(environmentBoundSeq).toBeDefined()
    expect(requestHeaderSeq).toBeDefined()
    expect(toolCallSeq).toBeDefined()
    expect(modeBoundSeq!).toBeLessThan(environmentBoundSeq!)
    expect(environmentBoundSeq!).toBeLessThan(requestHeaderSeq!)
    expect(requestHeaderSeq!).toBeLessThan(toolCallSeq!)

    // The exact shipped model tool roster (glob/grep excluded: they depend on
    // packaged ripgrep being on the machine running the assertion, matching
    // the `minimal`/`standard` preset e2e coverage's own exclusion).
    const rosterTools = requestHeader.tools?.map(tool => tool.name)
      .filter(name => name !== 'glob' && name !== 'grep').sort()
    expect(rosterTools).toEqual([
      'ask_user_question', 'get_science_state', 'read', 'read_image', 'run_python', 'run_r', 'skill', 'todo_write',
    ])
    expect(requestHeader.tools?.toSorted((left, right) => left.name.localeCompare(right.name)))
      .toEqual(scaffold.ctx.tools.schemas(agentHandle.agent).toSorted((left, right) => left.name.localeCompare(right.name)))

    // Model-visible guidance: the Science persona reached the model,
    // including the workspace cwd it deliberately names. (The system section
    // may also carry this checkout's own dev-mode `harness:identity` banner
    // when run in source mode against the DSH repo itself — a real,
    // deliberate fact about running the test from its own checkout, not a
    // Science-preset concern; `DSH_EXAMPLE_MODE=lib pnpm run test:snapshot`
    // exercises the built-artifact path without it.) The Runtime's own
    // internal scratch/profile paths never belong in model-visible text —
    // checked below against the sanitized `science:environment` context and
    // `get_science_state` result, the two surfaces R3 requires to sanitize it.
    expect(requestHeader.system).toContain('You are a Science agent')
    expect(requestHeader.system).toContain('mounted read-only')
    expect(requestHeader.system).toContain(scaffold.workspaceCwd)

    // The seeded project AGENTS.md instructions reach the model as their own
    // logged user/message (dsh-agent-instructions' contract), not folded into
    // requestHeader.system.
    const instructionsMessage = log.find(event =>
      event.type === 'user/message' && event.data.source.kind === 'agent-instructions')
    expect(instructionsMessage).toBeDefined()
    const instructionsText = instructionsMessage!.type === 'user/message'
      ? instructionsMessage!.data.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('')
      : ''
    expect(instructionsText).toContain('Prefer vectorized pandas operations')

    // The deterministic `science:environment` runtime-context message: mode
    // revision and applied environment status, no Host paths or Runtime
    // identity fields.
    const environmentMessage = log.find(event =>
      event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && event.data.source.plugin === '@deepseek-ai/dsh-system-prompt'
      && event.data.content.some(block => block.type === 'text' && block.text.includes('Science mode: revision')))
    expect(environmentMessage).toBeDefined()
    const environmentText = environmentMessage!.type === 'user/message'
      ? environmentMessage!.data.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('')
      : ''
    expect(environmentText).toContain('Science mode: revision science-v1.')
    expect(environmentText).toContain('Environment: profile "science", revision 1, status applied.')
    expect(environmentText).not.toContain(scratch)

    // The `get_science_state` call and its structured, sanitized result.
    const call = log.find(event => event.type === 'tool/call' && event.data.name === 'get_science_state')
    expect(call).toBeDefined()
    const result = log.find(event =>
      event.type === 'tool/result' && call!.type === 'tool/call'
      && event.data.message.source.kind === 'tool' && event.data.message.source.callId === call!.data.callId)
    const toolResultBlock = result?.type === 'tool/result' ? result.data.message.content[0] : undefined
    expect(toolResultBlock?.isError).toBe(false)
    const resultText = toolResultBlock === undefined
      ? ''
      : toolResultBlock.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('')
    expect(resultText).toContain('science-v1')
    expect(resultText).not.toContain(scratch)

    await assertFixtureInventory(SNAPSHOT_DIR, ['session.jsonl'])
  }, 30_000)
})
