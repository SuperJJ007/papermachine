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
const SCIENCE_TOOLS = ['annotate_artifact', 'get_science_state', 'publish_outcome', 'run_python', 'run_r']

/** The auto-captured file this scenario curates through `annotate_artifact`. */
const CURATED_LOGICAL_NAME = 'plot.png'

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
 * model follows before calling `annotate_artifact`.
 */
function latestRunId(options: GenerateOptions): string {
  const match = /Latest run (\S+) \(python\): success\./.exec(runtimeContext(options).join('\n'))
  if (match?.[1] === undefined) throw new Error('science-mock-llm: the runtime context reports no successful python run')
  return match[1]
}

/** The artifact identity the `annotate_artifact` receipt reported. */
function curatedArtifactRef(options: GenerateOptions): { readonly chartId: string; readonly version: number } {
  // Cite what the receipt reported rather than a version number written into
  // the fixture: a curated version is the one the model was told it curated.
  const match = /" v(\d+) \(([^)]+)\) curated from run /.exec(toolResultTexts(options).join('\n'))
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error('science-mock-llm: no annotate_artifact receipt names an artifact version and id')
  }
  return { chartId: match[2], version: Number(match[1]) }
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
    // One step per settled tool result: read state, run code that writes
    // csv/json/md/png artifacts (auto-captured with no separate save step),
    // curate the file that best demonstrates the result, publish the cited
    // Outcome, read the sanitized state those facts produced, then run a
    // second time on the same kernel (proving epoch reuse and no restart line).
    switch (toolResultTexts(options).length) {
      case 0:
        yield * toolCall('science-state-call', 'get_science_state', {})
        return
      case 1:
        yield * toolCall('science-run-call', 'run_python', {
          code: 'from pathlib import Path\n'
            + 'Path(SCIENCE_ARTIFACT_DIR, "summary.csv").write_text("metric,value\\naccuracy,0.97\\n")\n'
            + 'Path(SCIENCE_ARTIFACT_DIR, "meta.json").write_text(\'{"ok":true}\')\n'
            + 'Path(SCIENCE_ARTIFACT_DIR, "notes.md").write_text("# Notes\\n\\nDeterministic snapshot run.\\n")\n'
            + 'Path(SCIENCE_ARTIFACT_DIR, "plot.png").write_bytes(png)',
        })
        return
      case 2:
        yield * toolCall('science-annotate-call', 'annotate_artifact', {
          logical_name: CURATED_LOGICAL_NAME,
          title: 'Main plot',
          caption: 'Deterministic snapshot chart',
        })
        return
      case 3: {
        const chart = curatedArtifactRef(options)
        yield * toolCall('science-outcome-call', 'publish_outcome', {
          title: 'Snapshot finding',
          summary_markdown: 'The deterministic run produced the **cited chart**.',
          evidence: [
            { kind: 'run', run_id: latestRunId(options) },
            { kind: 'chart', chart_id: chart.chartId, version: chart.version },
          ],
        })
        return
      }
      case 4:
        yield * toolCall('science-state-call-2', 'get_science_state', {})
        return
      case 5:
        // Same kernel as the first run, so the result carries no restart
        // line (the driver's own artifact side effect repeats the first
        // run's byte-identical files, deduped rather than a new version).
        yield * toolCall('science-run-call-2', 'run_python', {
          code: 'print("second run, same kernel")',
        })
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
