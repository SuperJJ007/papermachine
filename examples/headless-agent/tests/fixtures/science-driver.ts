#!/usr/bin/env node
/** Drive one Science-bound agent through the keyless snapshot composition. */

import type { Context } from '@deepseek-ai/cordis'
import { boot, installFailLoud, loadEnv, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { foldScience } from '@deepseek-ai/dsh-science-session'
import type {} from '@deepseek-ai/dsh-tool-science'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'

const NAME = 'science-snapshot-driver'
const [configPath, ...taskParts] = process.argv.slice(2)
if (configPath === undefined || taskParts.length === 0 || taskParts.every(part => part.trim() === '')) {
  throw new Error(`${NAME}: expected <config-path> <task...>`)
}

const uninstallFailLoud = installFailLoud(NAME)
let ctx: Context | undefined
try {
  loadEnv(NAME)
  ctx = await boot(NAME, resolveConfigPath(configPath, undefined))
  const sessionId = SessionId('science-tools-snapshot')
  await ctx.agents.create({
    sessionId,
    // The Science project artifact store keys its store directory by this
    // workspace path (this driver's own process cwd, already scrubbed from
    // every snapshot assertion below), required since S2: `bindEnvironment`
    // and `startRun` both resolve the session's owning project from it.
    meta: { agentPreset: 'science', cwd: process.cwd() },
    agentOptions: { provider: 'science-snapshot', model: 'science-snapshot' },
  })
  const result = await runFixtureTurn(ctx, {
    task: taskParts.join(' '),
    onEvent: (sessionId: string, event: SessionEvent) => {
      process.stdout.write(`${JSON.stringify({ type: 'session_event', sessionId, event })}\n`)
    },
  })
  const agent = ctx.agents.get(sessionId)
  if (agent === undefined) throw new Error(`${NAME}: configured Science agent is not live`)
  const chart = foldScience(agent.session.events).artifacts.find(artifact => artifact.logicalName === 'plot.png')
  if (chart === undefined) throw new Error(`${NAME}: first turn produced no plot.png artifact`)
  if (chart.chart === undefined || chart.chart.ops.length !== 0) {
    throw new Error(`${NAME}: first-turn plot.png did not preserve its initial chart state`)
  }
  let editOutput = ''
  const disposeEditListener = ctx.on('session/event', (session, event) => {
    if (session !== agent.session) return
    process.stdout.write(`${JSON.stringify({ type: 'session_event', sessionId, event })}\n`)
    if (event.type === 'assistant/message') {
      editOutput = event.data.message.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('')
    }
  })
  try {
    await ctx.scienceEdits.submit(agent, {
      targets: [{
        artifactId: chart.artifactId,
        version: chart.version,
        target: { kind: 'normalized-region', x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
        comment: 'Keep the scale readable at small sizes.',
      }],
      instruction: 'Use a zero-based quantitative scale.',
    })
    await agent.whenIdle()
    const edited = foldScience(agent.session.events).artifacts.findLast(artifact => artifact.logicalName === 'region-edit.png')
    if (edited === undefined) throw new Error(`${NAME}: the edit produced no region-edit.png artifact`)
    await ctx.scienceEdits.submit(agent, {
      targets: [
        {
          artifactId: chart.artifactId,
          version: chart.version,
          target: { kind: 'normalized-region', x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
        },
        {
          artifactId: edited.artifactId,
          version: edited.version,
          target: { kind: 'normalized-region', x: 0, y: 0, width: 0.5, height: 0.5 },
        },
      ],
      instruction: 'Brighten both selected regions and align their styling.',
    })
    await agent.whenIdle()
  } finally {
    disposeEditListener()
  }
  await ctx.sessions.flush(agent.session)
  process.stdout.write(`${JSON.stringify({ ...result, output: editOutput })}\n`)
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  await ctx?.fiber.dispose()
  uninstallFailLoud()
}
