/** Opt-in Python/R regressions through the production runtime and product sandbox. */

import { mkdtempSync, rmSync } from 'node:fs'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalSandboxProvider from '@deepseek-ai/dsh-sandbox-local'
import ScienceArtifactStore from '@deepseek-ai/dsh-science-artifact-store'
import { decodeScienceChartState, ScienceEnvironmentProfileId, replayScience } from '@deepseek-ai/dsh-science-session'
import type { ScienceArtifactVersion, ScienceChartState } from '@deepseek-ai/dsh-science-session'
import SessionStore from '@deepseek-ai/dsh-session'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import ScienceRuntime from '../src/index.ts'
import { planRunScratch, planSessionScratch } from '../src/scratch.ts'
import { authorizeRun, createScienceSession } from './harness.ts'
import { capturePrefixManifest, diffPrefixManifest } from './prefix-manifest.ts'

const pythonPrefix = process.env.DSH_SCIENCE_RUNTIME_PYTHON_PREFIX
const rPrefix = process.env.DSH_SCIENCE_RUNTIME_R_PREFIX
const enabled = process.env.DSH_SCIENCE_RUNTIME_TEST_OWNED === '1' && pythonPrefix !== undefined && rPrefix !== undefined
const roots: string[] = []
const contexts: Context[] = []
const prefixManifests = new Map<string, Awaited<ReturnType<typeof capturePrefixManifest>>>()

/** Read one version's decoded live-figure-object state from the store, or `undefined` when it carries none. */
async function chartOf(ctx: Context, artifact: ScienceArtifactVersion): Promise<ScienceChartState | undefined> {
  const state = await ctx.scienceArtifactStore.getFigureState(artifact.projectId, artifact.versionId)
  return state === undefined ? undefined : decodeScienceChartState(JSON.parse(state.stateJson))
}

beforeAll(async () => {
  if (!enabled) return
  for (const prefix of [pythonPrefix, rPrefix]) prefixManifests.set(prefix, await capturePrefixManifest(prefix))
}, 120_000)

afterAll(async () => {
  for (const [prefix, before] of prefixManifests) {
    expect(diffPrefixManifest(before, await capturePrefixManifest(prefix))).toEqual([])
  }
}, 120_000)

class ObservedSubprocess extends LocalSubprocessRuntime {
  readonly kernels: SubprocessHandle[] = []
  readonly readers: SubprocessHandle[] = []

  override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    const handle = super.spawn(spec)
    if (spec.stdio.stdin === 'pipe') this.kernels.push(handle)
    if (spec.stdio.stdout === 'pipe') this.readers.push(handle)
    return handle
  }
}

afterEach(async () => {
  for (const ctx of contexts.splice(0)) {
    const observed = ctx.subprocess as ObservedSubprocess
    const handles = [...observed.kernels, ...observed.readers]
    await ctx.fiber.dispose()
    for (const handle of handles) expect(await handle.waitForExit(AbortSignal.timeout(5_000))).toBe(true)
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function realHarness(timeoutMs = 30_000) {
  const root = mkdtempSync(join(process.cwd(), '.science-real-persistent-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(ObservedSubprocess)
  await ctx.plugin(LocalSandboxProvider)
  await ctx.plugin(ScienceArtifactStore, { dshHome: root })
  await ctx.plugin(ScienceRuntime, {
    dshHome: root, timeoutMs, chartExtractTimeoutMs: 10_000, chartLiveRunsRetained: 1,
    profiles: { real: { pythonPrefix: pythonPrefix!, rPrefix: rPrefix! } },
  })
  return { root, ctx, runtime: ctx.scienceRuntime }
}

describe.skipIf(!enabled)('real persistent Science kernels', () => {
  for (const language of ['python', 'r'] as const) {
    for (const cause of ['cancel', 'timeout'] as const) {
      it(`releases an uninterruptible cold ${language} replay after ${cause} without retiring the analysis kernel`, async () => {
        const { root, ctx, runtime } = await realHarness(cause === 'timeout' ? 3_000 : 30_000)
        const session = createScienceSession(ctx, `cold-stop-${language}-${cause}`, root)
        const signal = new AbortController().signal
        await runtime.bindEnvironment({ session, profileId: ScienceEnvironmentProfileId('real'), signal })
        const marker = join(root, 'start-infinite-replay')
        const code = language === 'python'
          ? `import os, signal, time\nimport matplotlib\nmatplotlib.use('Agg')\nimport matplotlib.pyplot as plt\nif os.path.exists(${JSON.stringify(marker)}):\n    signal.signal(signal.SIGINT, signal.SIG_IGN)\n    print('replay-ready', flush=True)\n    while True: time.sleep(.1)\nvalue = 1\nfig, ax = plt.subplots()\nax.plot([0,1])\nfig.savefig(os.path.join(os.environ['SCIENCE_ARTIFACT_DIR'], 'first.png'))`
          : `library(ggplot2)\nif (file.exists(${JSON.stringify(marker)})) { cat('replay-ready\\n'); flush.console(); suspendInterrupts(repeat { Sys.sleep(.1) }) }\nvalue <- 1\np <- ggplot(data.frame(x=0:1,y=0:1),aes(x,y)) + geom_point()\nggsave(file.path(Sys.getenv('SCIENCE_ARTIFACT_DIR'),'first.png'),p,width=4,height=3,dpi=100)`
        const initial = await runtime.startRun({ session, language, code, rasterArtifacts: ['first.png'],
          ...authorizeRun(session, language, 'first'), signal })
        expect((await initial.done).terminal.status).toBe('success')
        const artifact = replayScience(session.events)!.artifacts[0]!
        const later = await runtime.startRun({ session, language,
          code: `${code.replaceAll('first.png', 'second.png')}\n${language === 'python' ? 'value = 99' : 'value <- 99'}`,
          rasterArtifacts: ['second.png'],
          ...authorizeRun(session, language, 'later'), signal })
        const epoch = (await later.done).terminal.kernelEpoch
        await writeFile(marker, '')
        const events = session.events.length
        const controller = new AbortController()
        const preview = runtime.previewChartEdit({ session, artifactId: artifact.artifactId, version: artifact.version,
          ops: [{ op: 'toggle_grid', axes: null, visible: false }], signal: controller.signal })
        const assertion = expect(preview).rejects.toMatchObject({ code: cause === 'cancel' ? 'OPERATION_CANCELLED' : 'OPERATION_TIMED_OUT' })
        if (cause === 'cancel') {
          const scratch = await planSessionScratch(root, session)
          await expect.poll(async () => {
            const replay = (await readdir(scratch.runs)).find(name => name.startsWith('replay-'))
            return replay === undefined ? '' : readFile(join(scratch.runs, replay, 'stdout.txt'), 'utf8').catch(() => '')
          }, { timeout: 5_000 }).toContain('replay-ready')
          controller.abort()
        }
        await assertion
        expect(session.events).toHaveLength(events)
        const resumed = await runtime.startRun({ session, language, code: 'print(value)',
          ...authorizeRun(session, language, 'resumed'), signal })
        const result = await resumed.done
        expect(result.stdout.text).toContain('99')
        expect(result.terminal.kernelEpoch).toBe(epoch)
        const handles = (ctx.subprocess as ObservedSubprocess).kernels
        expect(handles).toHaveLength(2)
        expect(await handles[1]!.waitForExit(AbortSignal.timeout(1_000))).toBe(true)
      }, 60_000)
    }

    it(`isolates cold ${language} chart replay from variables, mutable objects, and process state`, async () => {
      const { root, ctx, runtime } = await realHarness()
      const session = createScienceSession(ctx, `cold-state-${language}`, root)
      const signal = new AbortController().signal
      await runtime.bindEnvironment({ session, profileId: ScienceEnvironmentProfileId('real'), signal })
      let call = 0
      const run = async (code: string, rasterArtifacts: readonly string[] = []) => {
        const handle = await runtime.startRun({ session, language, code, rasterArtifacts,
          ...authorizeRun(session, language, `state-${++call}`), signal })
        const result = await handle.done
        expect(result.terminal.status, JSON.stringify(result)).toBe('success')
        return result
      }
      const plot = language === 'python'
        ? "fig, ax = plt.subplots()\nax.plot([0, 1], [0, loss_value])\nax.set_title('Original')\nfig.savefig(os.path.join(os.environ['SCIENCE_ARTIFACT_DIR'], 'first.png'))\n"
        : "p <- ggplot(data.frame(x=0:1, y=c(0,loss_value)), aes(x,y)) + geom_point() + labs(title='Original')\nggsave(file.path(Sys.getenv('SCIENCE_ARTIFACT_DIR'), 'first.png'), p, width=4, height=3, dpi=100)\n"
      await run((language === 'python'
        ? "import builtins, os\nfrom pathlib import Path\nimport matplotlib\nmatplotlib.use('Agg')\nimport matplotlib.pyplot as plt\nloss_value = 1\nstate = globals().get('state', {'values': []})\nstate['values'].append(1)\nbuiltins.science_probe = 1\nos.environ['SCIENCE_PROBE'] = '1'\nPath(os.environ['SCIENCE_STATE_DIR'], 'value.txt').write_text('1')\n"
        : "library(ggplot2)\nloss_value <- 1\nif (!exists('state', inherits=FALSE)) state <- new.env()\nstate$value <- 1\noptions(science.probe=1)\nSys.setenv(SCIENCE_PROBE='1')\nwriteLines('1', file.path(Sys.getenv('SCIENCE_STATE_DIR'), 'value.txt'))\n") + plot, ['first.png'])
      const artifact = replayScience(session.events)!.artifacts.find(value => value.logicalName === 'first.png')!
      expect(await chartOf(ctx, artifact)).toBeDefined()
      await run((language === 'python'
        ? "loss_value = 99\nstate['values'][:] = [99]\nbuiltins.science_probe = 99\nos.environ['SCIENCE_PROBE'] = '99'\nPath(os.environ['SCIENCE_STATE_DIR'], 'value.txt').write_text('99')\n"
        : "loss_value <- 99\nstate$value <- 99\noptions(science.probe=99)\nSys.setenv(SCIENCE_PROBE='99')\nwriteLines('99', file.path(Sys.getenv('SCIENCE_STATE_DIR'), 'value.txt'))\n") + plot.replaceAll('first.png', 'second.png'), ['second.png'])
      const inspect = language === 'python'
        ? "print(loss_value, state['values'], builtins.science_probe, os.environ['SCIENCE_PROBE'], Path(os.environ['SCIENCE_STATE_DIR'], 'value.txt').read_text())"
        : "cat(loss_value, state$value, getOption('science.probe'), Sys.getenv('SCIENCE_PROBE'), readLines(file.path(Sys.getenv('SCIENCE_STATE_DIR'), 'value.txt')))"
      const before = await run(inspect)
      const events = session.events.length
      const preview = await runtime.previewChartEdit({ session, artifactId: artifact.artifactId, version: artifact.version,
        ops: [{ op: 'set_title', axes: null, text: 'Preview only' }], signal })
      expect(preview.failedOps).toEqual([])
      expect(session.events).toHaveLength(events)
      const after = await run(inspect)
      expect(after.stdout.text).toBe(before.stdout.text)
      expect(after.terminal.kernelEpoch).toBe(before.terminal.kernelEpoch)
    }, 120_000)
  }

  it('completes runs, host file reads, and cancellation with Python and R alive in two sessions', async () => {
    const { root, ctx, runtime } = await realHarness()
    const sessions = [0, 1].map(index => createScienceSession(ctx, `four-kernels-${index}`, root))
    const signal = new AbortController().signal
    for (const session of sessions) {
      const environment = await runtime.bindEnvironment({ session, profileId: ScienceEnvironmentProfileId('real'), signal })
      expect(environment.python?.capability, JSON.stringify(environment)).toBe('available')
      expect(environment.r?.capability, JSON.stringify(environment)).toBe('available')
      for (const language of ['python', 'r'] as const) {
        const run = await runtime.startRun({ session, language, code: language === 'python' ? 'value = 99\nprint(value)' : 'value <- 99; print(value)',
          ...authorizeRun(session, language, `start-${language}`), signal })
        const result = await run.done
        expect(result.terminal.status, JSON.stringify(result)).toBe('success')
        expect(result.stdout.text).toContain('99')
      }
    }
    expect((ctx.subprocess as ObservedSubprocess).kernels).toHaveLength(4)
    const probe = join(root, 'unrelated-host-file.txt')
    await writeFile(probe, 'host remains responsive')
    expect(await readFile(probe, 'utf8')).toBe('host remains responsive')
    for (const session of sessions) {
      for (const language of ['python', 'r'] as const) {
        const run = await runtime.startRun({ session, language,
          code: language === 'python' ? "import time\nprint('ready', flush=True)\ntime.sleep(60)" : "cat('ready\\n'); flush.console(); Sys.sleep(60)",
          ...authorizeRun(session, language, `cancel-${language}`), signal })
        const scratch = planRunScratch(await planSessionScratch(root, session), run.runId, language)
        await expect.poll(async () => readFile(scratch.stdout, 'utf8').catch(() => ''), { timeout: 5_000 }).toContain('ready')
        run.cancel()
        expect((await run.done).terminal).toMatchObject({ status: 'cancelled', failureCode: 'CANCELLED' })
        const next = await runtime.startRun({ session, language, code: 'print(value)',
          ...authorizeRun(session, language, `after-cancel-${language}`), signal })
        expect((await next.done).stdout.text).toContain('99')
      }
      expect(replayScience(session.events)?.kernels.filter(kernel => kernel.state === 'started')).toHaveLength(2)
    }
  }, 120_000)
})
