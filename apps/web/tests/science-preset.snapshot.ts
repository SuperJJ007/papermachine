import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { CallId, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import ScienceRuntime from '@deepseek-ai/dsh-science-runtime'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import {
  assertFixtureInventory, launchWebScaffold, recordFixture, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { createFakePythonPrefix, DirectSandbox, installTestKernelSet } from './science-persistent-kernel-test-helpers.ts'

const MODE = webSnapshotMode()

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/science-preset', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.jsonl')
const OVERLAY = fileURLToPath(new URL('./science-preset.overlay.yml', import.meta.url))
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PROMPT = 'Call get_science_state now and report only the mode revision it returns, in one short sentence. Do not run any Python or R code.'
const PNG = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
))

// The shipped Web Host now mounts its own settings-bound, intentionally
// unconfigured Science Runtime row (R6c's default `with-settings` entry).
// `OVERLAY` disables that row for this scenario alone, because Cordis's
// single-object `scienceRuntime` service registration cannot hold two
// providers at once (unlike `subprocess`/`sandbox` below, isolating the
// name is not an option here: the agent this scenario creates resolves
// services from the root context, not from the isolated child the fake
// plugins mount under). The rest of the composition mounts a fake-backed
// root entry directly on the booted scaffold — the same technique as
// `apps/cli/tests/web-agent-presets.e2e.ts`'s "fake-backed Science Runtime"
// section, isolated behind `ctx.isolate()` so `subprocess`/`sandbox` do not
// collide with the shipped bundle's own real Host rows for those two.

/** Execute one direct Science tool through the assembled registry and append the same call/result pair the agent loop owns. */
async function executeScienceTool(
  agentHandle: AgentHandle,
  turn: number,
  name: string,
  args: unknown,
): Promise<ToolExecutionResult> {
  const session: Session = agentHandle.agent.session
  session.append('step/start', { turn, step: 1 })
  session.append('request/header', {
    header: { config: { provider: 'snapshot', model: 'science-r5' } },
    reason: 'initial',
  })
  const callId = CallId(`science-r5-${name}-${String(turn)}`)
  const argumentsJson = JSON.stringify(args)
  const call = session.append('tool/call', { turn, step: 1, callId, name, arguments: argumentsJson })
  const result = await agentHandle.agent.ctx.tools.execute({
    callId,
    name,
    arguments: args,
    agent: agentHandle.agent,
    signal: new AbortController().signal,
  })
  session.append('tool/result', {
    turn,
    step: 1,
    message: createToolResultMessage({ callId, content: result.content, isError: result.isError }),
    ...result.error?.info === undefined ? {} : { error: result.error.info },
    ...result.meta === undefined ? {} : { meta: result.meta },
  }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
  session.append('step/end', { turn, step: 1 })
  return result
}

describe('science agent preset', () => {
  let scaffold: WebScaffold
  let agentHandle: AgentHandle
  let scratch: string | undefined

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ replayFixture: FIXTURE, extraOverlayPath: OVERLAY })
    // Repo-relative, not the scaffold's own os.tmpdir()-based world: Science
    // Runtime scratch roots must not overlap a generic sandbox temp grant.
    scratch = await mkdtemp(join(REPO_ROOT, '.web-science-preset-scratch-'))
    const isolated = scaffold.ctx.isolate('subprocess').isolate('sandbox')
    await isolated.plugin(LocalSubprocessRuntime)
    await isolated.plugin(DirectSandbox)
    await isolated.plugin(ScienceRuntime, {
      dshHome: join(scratch, 'dsh-home'),
      profiles: { science: { pythonPrefix: createFakePythonPrefix(scratch) } },
    })
    installTestKernelSet(isolated, isolated.scienceRuntime)
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
    if (scratch !== undefined) {
      await rm(scratch, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
    }
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'science preset smoke teardown failed')
  })

  it('binds the preset, then runs, versions, publishes, and replays the R5 Science transcript', async () => {
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
      'annotate_artifact', 'ask_user_question', 'exit_plan_mode', 'get_science_state', 'install_science_packages',
      'interrupt_agent', 'list_agents', 'read', 'read_image', 'run_python', 'run_r', 'send_message', 'skill',
      'subagent', 'todo_write', 'web_fetch', 'web_search',
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
    expect(environmentText).not.toContain(scratch!)

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
    expect(resultText).not.toContain(scratch!)

    const runResult = await executeScienceTool(agentHandle, 2, 'run_python', {
      code: JSON.stringify({
        stdout: 'fake run output\n',
        artifact: 'tiny-png',
      }),
      raster_artifacts: ['plot.png'],
    })
    expect(runResult.isError).toBe(false)
    if (runResult.isError) throw new Error('R5 snapshot run failed')
    const runValue = runResult.value as unknown as {
      runId: string
      status: string
      capturedArtifacts?: readonly { logicalName: string; version: number }[]
    }
    expect(runValue.status).toBe('success')
    // Auto-capture durably saves the fake kernel driver's PNG with no
    // separate save step, so it is already version 1 (origin auto) here.
    expect(runValue.capturedArtifacts).toEqual([expect.objectContaining({ logicalName: 'plot.png', version: 1 })])

    const annotateArgs = { logical_name: 'plot.png', title: 'Main plot', caption: 'Deterministic snapshot chart' }
    const firstAnnotate = await executeScienceTool(agentHandle, 3, 'annotate_artifact', annotateArgs)
    const secondAnnotate = await executeScienceTool(agentHandle, 4, 'annotate_artifact', annotateArgs)
    expect(firstAnnotate.isError).toBe(false)
    expect(secondAnnotate.isError).toBe(false)
    if (firstAnnotate.isError || secondAnnotate.isError) throw new Error('R5 snapshot artifact curation failed')
    const firstArtifact = firstAnnotate.value as unknown as { artifactId: string; version: number }
    const secondArtifact = secondAnnotate.value as unknown as { artifactId: string; version: number }
    expect(firstArtifact).toMatchObject({ version: 1 })
    expect(secondArtifact).toMatchObject({ artifactId: firstArtifact.artifactId, version: 1 })

    const current = await executeScienceTool(agentHandle, 5, 'get_science_state', {})
    expect(current.isError).toBe(false)
    if (current.isError) throw new Error('R5 snapshot state replay failed')
    const currentValue = current.value as unknown as {
      artifacts: readonly Record<string, unknown>[]
      metrics: { artifactCount: number; artifactVersionCount: number }
    }
    // Model curation reuses the auto-captured attachment and its version.
    expect(currentValue.artifacts).toHaveLength(1)
    expect(currentValue).not.toHaveProperty('outcome')
    expect(currentValue.metrics).toMatchObject({ artifactCount: 1, artifactVersionCount: 1 })
    for (const artifactState of currentValue.artifacts) {
      expect(artifactState).not.toHaveProperty('attachmentId')
      expect(artifactState).not.toHaveProperty('environmentFingerprint')
      expect(artifactState).not.toHaveProperty('toolCallId')
      expect(artifactState).not.toHaveProperty('requestHeaderSeq')
      // Model-visible state never exposes the project store's own
      // coordinates: those stay Host-internal, resolved only by the
      // durable event the Client reads separately.
      expect(artifactState).not.toHaveProperty('projectId')
      expect(artifactState).not.toHaveProperty('versionId')
      expect(artifactState).not.toHaveProperty('sha256')
    }

    const r5Events = agentHandle.agent.session.events.filter(event => event.seq > result!.seq)
    expect(r5Events.filter(event => event.type === 'science/artifact-saved')).toHaveLength(3)
    expect(r5Events.filter(event => event.type === 'science/outcome-published')).toHaveLength(0)
    const r5ToolResults = r5Events.filter(event => event.type === 'tool/result')
    expect(r5ToolResults.every(event => event.type !== 'tool/result'
      || event.data.message.content.every(block => block.type !== 'tool-result'
        || block.content.every(content => content.type !== 'image')))).toBe(true)
    const annotateEvents = r5ToolResults.filter(event => event.type === 'tool/result'
      && event.data.message.source.callId.toString().includes('annotate_artifact'))
    expect(annotateEvents.map(event => event.type === 'tool/result' ? event.data.meta : undefined)).toEqual([
      expect.objectContaining({ kind: 'science/artifact', version: 2, artifacts: [expect.objectContaining({ version: 1 })] }),
      expect.objectContaining({ kind: 'science/artifact', version: 2, artifacts: [expect.objectContaining({ version: 1 })] }),
    ])
    const serializedR5 = JSON.stringify(r5Events)
    expect(serializedR5).not.toContain(scratch!)
    expect(serializedR5).not.toContain(Buffer.from(PNG).toString('base64'))

    const artifactEvent = r5Events.find(event => event.type === 'science/artifact-saved')
    if (artifactEvent?.type !== 'science/artifact-saved') throw new Error('R5 snapshot artifact event is missing')
    const savedArtifact = artifactEvent.data.artifact
    if (savedArtifact.mediaType !== 'image/png') throw new Error('R5 snapshot artifact is not a PNG')
    const stored = await scaffold.ctx.scienceArtifactStore.readBlob(savedArtifact.projectId, savedArtifact.sha256)
    expect(Buffer.from(stored)).toEqual(Buffer.from(PNG))

    await assertFixtureInventory(SNAPSHOT_DIR, ['session.jsonl'])
  }, 30_000)
})
