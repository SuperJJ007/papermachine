/** Keyless adapter that records the exact model-facing Science surface. */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  CallId,
  LlmAdapter,
  type GenerateOptions,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

const capturePath = join(process.cwd(), 'science-model-view.json')

/** Science tools whose model-facing schemas this snapshot pins verbatim. */
const SCIENCE_TOOLS = ['get_science_state', 'publish_outcome', 'run_python', 'run_r', 'save_chart']

/** One logical chart saved twice, so the snapshot proves contiguous versioning. */
const CHART_NAME = 'main-plot'

function runtimeContext(options: GenerateOptions): string[] {
  return options.messages.flatMap(message =>
    message.source.kind === 'plugin'
      && message.source.plugin === '@deepseek-ai/dsh-system-prompt'
      ? message.content.flatMap(block => block.type === 'text' ? [block.text] : [])
      : [])
}

function scienceGuidance(system: string | undefined): string[] {
  return (system ?? '').split('\n\n').filter(section =>
    section.includes('run_python') || section.includes('SCIENCE_STATE_DIR'))
}

function toolResultTexts(options: GenerateOptions): string[] {
  return options.messages.flatMap(message =>
    message.content.flatMap(block => block.type === 'tool-result'
      ? [block.content.flatMap(item => item.type === 'text' ? [item.text] : []).join('\n')]
      : []))
}

/**
 * The run the Science runtime context reports as the latest successful one.
 * The rendered run result deliberately carries no run id, so the durable
 * context snapshot is the model's only source for it — exactly the path a real
 * model follows before calling `save_chart`.
 */
function latestRunId(options: GenerateOptions): string {
  const match = /Latest run (\S+) \(python\): success\./.exec(runtimeContext(options).join('\n'))
  if (match?.[1] === undefined) throw new Error('science-mock-llm: the runtime context reports no successful python run')
  return match[1]
}

/** The chart identity the first `save_chart` receipt reported. */
function savedChartId(options: GenerateOptions): string {
  const match = /\(([^)]+)\) saved from run /.exec(toolResultTexts(options).join('\n'))
  if (match?.[1] === undefined) throw new Error('science-mock-llm: no save_chart receipt names a chart id')
  return match[1]
}

function writeCapture(options: GenerateOptions): void {
  const toolResults = options.messages.flatMap(message =>
    message.content.flatMap(block => block.type === 'tool-result' ? [block] : []))
  writeFileSync(capturePath, `${JSON.stringify({
    guidance: scienceGuidance(options.system),
    tools: options.tools?.filter(tool => SCIENCE_TOOLS.includes(tool.name)),
    filesystemTools: options.tools?.filter(tool => ['read', 'write', 'edit'].includes(tool.name)).map(tool => tool.name),
    runtimeContext: runtimeContext(options),
    toolResults: toolResults.map(result => ({ toolCallId: result.toolCallId, content: result.content })),
  }, undefined, 2)}\n`)
}

function * toolCall(id: string, name: string, args: unknown): Generator<StreamChunk> {
  const callId = CallId(id)
  const argumentsJson = JSON.stringify(args)
  yield { type: 'block-start', index: 0, blockType: 'tool-call' }
  yield { type: 'tool-call-delta', index: 0, id: callId, name, argumentsDelta: argumentsJson }
  yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name, arguments: argumentsJson } }
  yield { type: 'finish', reason: { kind: 'tool-calls' } }
}

class ScienceMockAdapter extends LlmAdapter {
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    writeCapture(options)
    const chartArgs = (): unknown => ({
      run_id: latestRunId(options),
      artifact_path: 'plot.png',
      logical_name: CHART_NAME,
      title: 'Main plot',
      caption: 'Deterministic snapshot chart',
    })
    // One step per settled tool result: read state, run code that writes a
    // PNG, save that artifact twice, publish the cited Outcome, then read the
    // sanitized state the two publications produced.
    switch (toolResultTexts(options).length) {
      case 0:
        yield * toolCall('science-state-call', 'get_science_state', {})
        return
      case 1:
        yield * toolCall('science-run-call', 'run_python', {
          code: 'from pathlib import Path\nPath(SCIENCE_ARTIFACT_DIR, "plot.png").write_bytes(png)',
        })
        return
      case 2:
        yield * toolCall('science-chart-call-1', 'save_chart', chartArgs())
        return
      case 3:
        yield * toolCall('science-chart-call-2', 'save_chart', chartArgs())
        return
      case 4:
        yield * toolCall('science-outcome-call', 'publish_outcome', {
          title: 'Snapshot finding',
          summary_markdown: 'The deterministic run produced the **cited chart**.',
          evidence: [
            { kind: 'run', run_id: latestRunId(options) },
            { kind: 'chart', chart_id: savedChartId(options), version: 2 },
          ],
        })
        return
      case 5:
        yield * toolCall('science-state-call-2', 'get_science_state', {})
        return
      default: {
        const reply = 'SCIENCE_TOOLS_SNAPSHOT_OK'
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: reply }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
  }
}

export const name = 'science-mock-llm'
export const inject = ['llm']

/** Register the deterministic Science snapshot route. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['science-snapshot'], new ScienceMockAdapter())
}
