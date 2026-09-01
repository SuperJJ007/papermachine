/** Opt-in real Python/R chart fidelity through the production Runtime, kernels, and sandbox. */

import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import LocalSandboxProvider from '@deepseek-ai/dsh-sandbox-local'
import ScienceArtifactStore from '@deepseek-ai/dsh-science-artifact-store'
import { decodeScienceChartState, ScienceEnvironmentProfileId, replayScience } from '@deepseek-ai/dsh-science-session'
import type { ScienceArtifactVersion, ScienceChartOp, ScienceChartState, ScienceLanguage } from '@deepseek-ai/dsh-science-session'
import * as ScienceSessionInvariant from '@deepseek-ai/dsh-science-session/invariant'
import SessionStore from '@deepseek-ai/dsh-session'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import ScienceRuntime from '../src/index.ts'
import { authorizeRun, createScienceSession } from './harness.ts'

const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(context => context.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function source(language: ScienceLanguage, width: number, title: string, name = 'plot.png'): string {
  if (language === 'python') return `
import os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
plt.rcParams.update({"font.family": "DejaVu Sans", "savefig.pad_inches": 0.3, "savefig.dpi": 125})
fig = plt.figure(figsize=(${width}, 4), dpi=100)
gs = fig.add_gridspec(1, 3, width_ratios=[4, 1, 0.25], wspace=0.4)
ax = fig.add_subplot(gs[0, 0])
side = fig.add_subplot(gs[0, 1])
cax = fig.add_subplot(gs[0, 2])
im = ax.imshow([[1, 2], [3, 4]])
fig.colorbar(im, cax=cax)
side.plot([0, 1], [2, 1])
ax.set_xlabel("Original X", fontsize=15, fontweight="bold")
fig.suptitle(${JSON.stringify(title)}, fontsize=19, fontweight="bold")
fig.savefig(os.path.join(os.environ["SCIENCE_ARTIFACT_DIR"], ${JSON.stringify(name)}), dpi=None, bbox_inches="tight", transparent=True)
assert plt.get_fignums()[-1] == fig.number
fig.suptitle("Mutation after saving")
plt.rcParams["savefig.pad_inches"] = 2
`
  return `
library(ggplot2)
p <- ggplot(data.frame(x=c(1,2,3), y=c(3,1,2)), aes(x,y)) + geom_point() +
  labs(title=${JSON.stringify(title)}, x="Original X", y="Original Y") + theme_minimal()
ggsave(file.path(Sys.getenv("SCIENCE_ARTIFACT_DIR"), ${JSON.stringify(name)}), plot=p,
       width=${width}, height=4, units="in", dpi=100, bg="#fff2e6")
p <- p + labs(title="Mutation after saving")
`
}

/** Read one version's decoded live-figure-object state from the store, or `undefined` when it carries none. */
async function chartOf(ctx: Context, artifact: ScienceArtifactVersion): Promise<ScienceChartState | undefined> {
  const state = await ctx.scienceArtifactStore.getFigureState(artifact.projectId, artifact.versionId)
  return state === undefined ? undefined : decodeScienceChartState(JSON.parse(state.stateJson))
}

async function chartHarness(language: ScienceLanguage, prefix: string) {
  const root = await mkdtemp(join(process.cwd(), '.science-chart-fidelity-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(ScienceSessionInvariant)
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(LocalSandboxProvider)
  await ctx.plugin(ScienceArtifactStore, { dshHome: root })
  const config = { dshHome: root, timeoutMs: 60_000, chartExtractTimeoutMs: 30_000,
    profiles: { real: language === 'python' ? { pythonPrefix: prefix } : { rPrefix: prefix } } }
  const runtimeFiber = await ctx.plugin(ScienceRuntime, config)
  const session = createScienceSession(ctx, `chart-fidelity-${language}`, root)
  const signal = new AbortController().signal
  const binding = await ctx.scienceRuntime.bindEnvironment({ session, profileId: ScienceEnvironmentProfileId('real'), signal })
  expect(binding.status).toBe('applied')
  let call = 0
  const run = async (code: string, filename = 'plot.png', addressable = true) => {
    const handle = await ctx.scienceRuntime.startRun({ session, language, code, rasterArtifacts: [filename],
      ...authorizeRun(session, language, `chart-${++call}`), signal })
    const result = await handle.done
    expect(result.terminal.status, result.stderr.text).toBe('success')
    const artifact = replayScience(session.events)!.artifacts.findLast(a => a.logicalName === filename)!
    const chart = await chartOf(ctx, artifact)
    if (addressable) expect(chart, JSON.stringify(result.capture)).toBeDefined()
    else expect(chart).toBeUndefined()
    return artifact
  }
  const preview = (artifact: ScienceArtifactVersion, ops: readonly ScienceChartOp[]) =>
    ctx.scienceRuntime.previewChartEdit({ session, artifactId: artifact.artifactId, version: artifact.version, ops, signal })
  return { ctx, session, signal, run, preview, runtimeFiber, config }
}

for (const language of ['python', 'r'] as const) {
  const prefix = process.env[language === 'python' ? 'DSH_SCIENCE_RUNTIME_PYTHON_PREFIX' : 'DSH_SCIENCE_RUNTIME_R_PREFIX']
  describe.skipIf(!prefix)(`${language} chart fidelity with a configured real Conda prefix`, () => {
    it('preserves the latest source and export settings across discarded previews, commits, and cold replay', async () => {
      const { ctx, session, signal, run, preview, runtimeFiber, config } = await chartHarness(language, prefix!)
      const titleOp = { op: 'set_title', axes: null, text: 'Edited title' } as const
      const labelOp = { op: 'set_axis_label', axes: language === 'python' ? 0 : null, axis: 'x', text: 'DISCARDED' } as const
      await run(source(language, 6, 'First title'))
      const latest = await run(source(language, 10, 'Original title'))
      expect(latest.version).toBe(2)
      const latestChart = await chartOf(ctx, latest)
      expect(latestChart!.png.dpi).toBe(language === 'python' ? 125 : 100)
      expect(latestChart!.elements.find(e => e.kind === 'title')?.current).toBe('Original title')
      const eventsBefore = session.events.length
      await preview(latest, [labelOp])
      const edited = await preview(latest, [titleOp])
      expect(session.events).toHaveLength(eventsBefore)
      expect(edited.failedOps).toEqual([])
      expect(edited.chart.png).toEqual(latestChart!.png)
      expect(edited.chart.elements.find(e => e.kind === 'x_label')?.current).toBe('Original X')
      const control = await run(source(language, 10, 'Edited title', 'control.png'), 'control.png')
      const expectedPng = await ctx.scienceArtifactStore.readBlob(control.projectId, control.sha256)
      expect(Buffer.from(edited.png).equals(Buffer.from(expectedPng)), 'edited PNG matches a direct source render').toBe(true)
      const saved = await ctx.scienceRuntime.applyChartEdit({ session, artifactId: latest.artifactId, version: 2, ops: [titleOp], signal })
      const savedChart = await chartOf(ctx, saved.artifact)
      expect(savedChart!.ops).toEqual([titleOp])
      expect(saved.artifact.sha256).toBe(control.sha256)
      const secondOps = [{ ...labelOp, text: 'Saved X' }]
      const warm = await preview(saved.artifact, secondOps)
      expect(warm.chart.elements.find(e => e.kind === 'title')?.current).toBe('Edited title')
      expect(warm.chart.elements.find(e => e.kind === 'x_label')?.current).toBe('Saved X')
      const runCount = replayScience(session.events)!.runs.length
      await runtimeFiber.dispose()
      await ctx.plugin(ScienceRuntime, config)
      const cold = await preview(saved.artifact, secondOps)
      expect(cold.failedOps).toEqual([])
      expect(Buffer.from(cold.png).equals(Buffer.from(warm.png)), 'cold and warm preview PNGs match').toBe(true)
      const savedAgain = await ctx.scienceRuntime.applyChartEdit({ session, artifactId: latest.artifactId,
        version: saved.artifact.version, ops: secondOps, signal })
      const savedAgainChart = await chartOf(ctx, savedAgain.artifact)
      expect(savedAgainChart!.ops).toEqual([titleOp, ...secondOps])
      expect(replayScience(session.events)!.runs).toHaveLength(runCount)
      const bytes = await ctx.scienceArtifactStore.readBlob(savedAgain.artifact.projectId, savedAgain.artifact.sha256)
      expect(Buffer.from(bytes).equals(Buffer.from(warm.png)), 'saved and preview PNGs match').toBe(true)
      if (language === 'python') {
        const uncopyable = source(language, 10, 'Custom figure', 'custom.png').replace('fig.savefig(', `
class Uncopyable:
    def __deepcopy__(self, memo):
        raise TypeError("custom artist state cannot be copied")
fig.custom_state = Uncopyable()
fig.savefig(`)
        const png = await run(uncopyable, 'custom.png', false)
        const pngRecord = await ctx.scienceArtifactStore.getVersion(png.projectId, png.versionId)
        expect(pngRecord?.mediaType).toBe('image/png')
      }
    }, 120_000)

    const cases: { name: string; ratio: number; dpi: string; ops: readonly ScienceChartOp[] }[] = language === 'r'
      ? [{ name: 'subtitle without changing the main title', ratio: 1, dpi: '100', ops: [
        { op: 'set_subtitle', axes: null, text: 'Edited subtitle' },
      ] }, { name: 'independent title and subtitle', ratio: 1, dpi: '100', ops: [
        { op: 'set_title', axes: null, text: 'Edited title' },
        { op: 'set_subtitle', axes: null, text: 'Edited subtitle' },
      ] }]
      : [
        { name: 'every legend, including one after an axis without a legend', ratio: 1, dpi: '100',
          ops: [{ op: 'set_legend_position', axes: null, position: 'lower right' }] },
        { name: 'axes subtitle without changing the figure title', ratio: 1, dpi: '100',
          ops: [{ op: 'set_subtitle', axes: 2, text: 'Edited subtitle' }] },
        ...[1, 2].flatMap(ratio => ["'figure'", '150'].map(dpi => ({ name: `pixel ratio ${ratio} at export DPI ${dpi}`, ratio, dpi,
          ops: [{ op: 'toggle_grid', axes: null, visible: true }] as const }))),
      ]
    it.each(cases)('preserves $name through preview, commit, and cold replay', async ({ ratio, dpi, ops }) => {
      const { ctx, session, signal, run, preview, runtimeFiber, config } = await chartHarness(language, prefix!)
      const code = (edited: boolean, filename: string) => language === 'r' ? `
library(ggplot2)
p <- ggplot(data.frame(x=1:3, y=3:1), aes(x,y)) + geom_point() +
  labs(title=${JSON.stringify(edited && ops.some(op => op.op === 'set_title') ? 'Edited title' : 'Main title')}, subtitle=${JSON.stringify(edited ? 'Edited subtitle' : 'Original subtitle')})
ggsave(file.path(Sys.getenv("SCIENCE_ARTIFACT_DIR"), ${JSON.stringify(filename)}), p, width=6, height=3, dpi=100)
` : `
import os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
fig, axes = plt.subplots(1, 3, figsize=(6, 3), dpi=100)
fig.suptitle("Main title")
for index, ax in enumerate(axes):
    ax.plot([0, 1], [0, 1], label="Line")
    ax.set_title("Edited subtitle" if ${edited && ops[0]!.op === 'set_subtitle' ? 'True' : 'False'} and index == 2 else "Original subtitle")
    if index != 1:
        ax.legend(loc=${JSON.stringify(edited && ops[0]!.op === 'set_legend_position' ? 'lower right' : 'upper left')})
    ax.grid(${edited && ops[0]!.op === 'toggle_grid' ? 'True' : 'False'})
fig.canvas._set_device_pixel_ratio(${ratio})
fig.savefig(os.path.join(os.environ["SCIENCE_ARTIFACT_DIR"], ${JSON.stringify(filename)}), dpi=${dpi})
`
      const original = await run(code(false, 'plot.png'))
      const edited = await preview(original, ops)
      expect(edited.failedOps).toEqual([])
      const control = await run(code(true, 'control.png'), 'control.png')
      const controlChart = await chartOf(ctx, control)
      expect(edited.chart.png).toEqual(controlChart!.png)
      const expected = await ctx.scienceArtifactStore.readBlob(control.projectId, control.sha256)
      expect(Buffer.from(edited.png).equals(Buffer.from(expected)), 'preview matches a direct source render').toBe(true)
      const unchanged = await preview(original, [{ op: 'set_title', axes: null, text: 'Main title' }])
      const baseline = await ctx.scienceArtifactStore.readBlob(original.projectId, original.sha256)
      expect(Buffer.from(unchanged.png).equals(Buffer.from(baseline)), 'preview leaves the original unchanged').toBe(true)
      const saved = await ctx.scienceRuntime.applyChartEdit({ session, artifactId: original.artifactId,
        version: original.version, ops, signal })
      expect(saved.artifact.sha256).toBe(control.sha256)
      await runtimeFiber.dispose()
      await ctx.plugin(ScienceRuntime, config)
      const cold = await preview(saved.artifact, ops)
      expect(Buffer.from(cold.png).equals(Buffer.from(expected)), 'cold replay preserves the committed image').toBe(true)
    }, 120_000)
  })
}
