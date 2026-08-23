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
    meta: { agentPreset: 'science' },
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
  const chart = foldScience(agent.session.events).artifacts.find(artifact => artifact.logicalName === 'chart.vl.json')
  if (chart === undefined) throw new Error(`${NAME}: first turn produced no chart.vl.json artifact`)
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
    const styled = await ctx.scienceEdits.commitStyleEdit(agent, {
      artifactId: chart.artifactId,
      version: chart.version,
      spec: '{"$schema":"https://vega.github.io/schema/vega-lite/v6.json","data":{"values":[{"metric":"accuracy","value":0.97}]},"mark":{"type":"bar","color":"#2455a4","fontSize":16},"encoding":{"x":{"field":"metric","type":"nominal"},"y":{"field":"value","type":"quantitative"}}}',
    })
    ctx.scienceEdits.submit(agent, {
      artifactId: styled.artifactId,
      version: styled.version,
      target: { kind: 'spec-path', path: 'encoding.y' },
      instruction: 'Use a zero-based quantitative scale.',
    })
    await agent.whenIdle()
    const plot = foldScience(agent.session.events).artifacts.findLast(artifact => artifact.logicalName === 'plot.png')
    if (plot === undefined) throw new Error(`${NAME}: the run produced no plot.png artifact`)
    ctx.scienceEdits.submit(agent, {
      artifactId: plot.artifactId,
      version: plot.version,
      target: { kind: 'normalized-region', x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
      instruction: 'Brighten the selected region.',
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
