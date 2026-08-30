/** Opt-in real interpreter regressions for the shipped chart drivers, using private run scratch. */
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { ScienceEnvironmentProfileId, replayScience } from '@deepseek-ai/dsh-science-session'
import { KERNEL_ASSETS_ROOT } from '../src/kernel-assets.ts'
import { authorizeRun, createKernelRuntimeHarness, createScienceSession, installTestKernelSet } from './harness.ts'

const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const pythonSource = `import os
import matplotlib.pyplot as plt
fig, ax = plt.subplots(figsize=(4, 3))
ax.plot([0, 1], [0, 1], label='series', color='#006ba2')
ax.text(.1, .2, 'mean 0.14')
ax.text(.7, .8, 'mean 0.14')
ax.set_title('Original')
fig.savefig(os.path.join(os.environ['SCIENCE_ARTIFACT_DIR'], 'plot.png'), dpi=120, bbox_inches='tight')
ax.set_title('Mutated after export')
`
const rSource = `library(ggplot2)
p <- ggplot(mtcars, aes(wt, mpg, colour=factor(cyl))) + geom_point() + labs(title='Original')
out <- file.path(Sys.getenv('SCIENCE_ARTIFACT_DIR'), 'plot.png')
png(out, width=4, height=3, units='in', res=120, type='cairo', family='sans')
print(p)
dev.off()
ggsave(file.path(Sys.getenv('SCIENCE_ARTIFACT_DIR'), 'ggsave.png'), p, width=4, height=3, dpi=120)
png(file.path(Sys.getenv('SCIENCE_ARTIFACT_DIR'), 'base.png')); plot(1:3); dev.off()
png(file.path(Sys.getenv('SCIENCE_ARTIFACT_DIR'), 'multiple.png')); print(p); print(p); dev.off()
overwritten <- file.path(Sys.getenv('SCIENCE_ARTIFACT_DIR'), 'overwritten.png')
ggsave(overwritten, p, width=4, height=3, dpi=120)
png(overwritten); plot(1:3); dev.off()
p <- p + labs(title='Mutated after export')
`

for (const language of ['python', 'r'] as const) {
  const prefix = process.env[language === 'python' ? 'DSH_SCIENCE_RUNTIME_PYTHON_PREFIX' : 'DSH_SCIENCE_RUNTIME_R_PREFIX']
  describe.skipIf(prefix === undefined)(`real ${language} chart driver`, () => {
    it('preserves export geometry and baseline across preview and saved edits', async () => {
      const root = mkdtempSync(join(process.cwd(), '.science-real-chart-'))
      roots.push(root)
      const { ctx, runtime } = await createKernelRuntimeHarness(root,
        { real: language === 'python' ? { pythonPrefix: prefix! } : { rPrefix: prefix! } }, 60_000)
      contexts.push(ctx)
      installTestKernelSet(ctx, runtime, { assetsRoot: KERNEL_ASSETS_ROOT, kernelStartTimeoutMs: 30_000 })
      const session = createScienceSession(ctx, `real-chart-${language}`)
      await runtime.bindEnvironment({ session, profileId: ScienceEnvironmentProfileId('real'), signal: new AbortController().signal })
      const run = await runtime.startRun({ session, language, code: language === 'python' ? pythonSource : rSource,
        rasterArtifacts: language === 'r' ? ['plot.png', 'ggsave.png', 'base.png', 'multiple.png', 'overwritten.png'] : ['plot.png'], ...authorizeRun(session, language), signal: new AbortController().signal })
      const result = await run.done
      expect(result.terminal.status, JSON.stringify(result)).toBe('success')
      const artifact = replayScience(session.events)?.artifacts.find(value => value.logicalName === 'plot.png')
      expect(artifact?.chart, readdirSync(root, { recursive: true }).filter(file => String(file).includes('chart-extract-result')).map(file => readFileSync(join(root, String(file)), 'utf8')).join('\n')).toBeDefined()
      const chart = artifact!.chart!
      expect(chart.elements.find(value => value.id === 'title')?.current).toBe('Original')
      expect(chart.hitmapStatus).toBe('ok')
      if (language === 'python') {
        const hits = chart.hitmap.filter(hit => hit.id.startsWith('annotation['))
        expect(hits).toHaveLength(2)
        expect(hits[0]!.bbox).not.toEqual(hits[1]!.bbox)
      } else {
        expect(chart.png).toMatchObject({ width: 480, height: 360, dpi: 120 })
        const artifacts = replayScience(session.events)!.artifacts
        expect(artifacts.find(value => value.logicalName === 'ggsave.png')?.chart).toBeDefined()
        for (const name of ['base.png', 'multiple.png', 'overwritten.png']) {
          expect(artifacts.find(value => value.logicalName === name)).toBeDefined()
          expect(artifacts.find(value => value.logicalName === name)?.chart).toBeUndefined()
        }
      }
      const target = { session, artifactId: artifact!.artifactId, version: artifact!.version, signal: new AbortController().signal }
      const preview = await runtime.previewChartEdit({ ...target, ops: [{ op: 'set_title', axes: language === 'python' ? 0 : null, text: 'Preview only' }] })
      expect(preview.failedOps).toEqual([])
      const saved = await runtime.applyChartEdit({ ...target, ops: [{ op: 'set_axis_label', axes: language === 'python' ? 0 : null, axis: 'x', text: 'Edited x' }] })
      expect(saved.failedOps).toEqual([])
      expect(saved.artifact.chart!.elements.find(value => value.id === 'title')?.current).toBe('Original')
      expect(saved.artifact.chart!.hitmapStatus).toBe('ok')
      if (language === 'r') expect(saved.artifact.chart!.png).toEqual(chart.png)
      const nextTarget = { ...target, version: saved.artifact.version }
      const nextPreview = await runtime.previewChartEdit({ ...nextTarget,
        ops: [{ op: 'set_title', axes: language === 'python' ? 0 : null, text: 'Another preview' }] })
      expect(nextPreview.chart.elements.find(value => value.id === 'x_label')?.current).toBe('Edited x')
      const nextSave = await runtime.applyChartEdit({ ...nextTarget,
        ops: [{ op: 'set_title', axes: language === 'python' ? 0 : null, text: 'Final title' }] })
      expect(nextSave.artifact.chart!.elements.find(value => value.id === 'x_label')?.current).toBe('Edited x')
      expect(nextSave.artifact.chart!.elements.find(value => value.id === 'title')?.current).toBe('Final title')
      const regenerated = await runtime.startRun({ session, language,
        code: (language === 'python' ? pythonSource : rSource).replaceAll("'Original'", "'Regenerated'"),
        rasterArtifacts: ['plot.png'], ...authorizeRun(session, language, `regenerate-${language}`), signal: new AbortController().signal })
      expect((await regenerated.done).terminal.status).toBe('success')
      const regeneratedArtifact = replayScience(session.events)!.artifacts.findLast(value => value.artifactId === artifact!.artifactId)!
      const regeneratedSave = await runtime.applyChartEdit({ ...target, version: regeneratedArtifact.version,
        ops: [{ op: 'set_axis_label', axes: language === 'python' ? 0 : null, axis: 'x', text: 'Regenerated x' }] })
      expect(regeneratedSave.artifact.chart!.elements.find(value => value.id === 'title')?.current).toBe('Regenerated')
    }, 120_000)
  })
}
