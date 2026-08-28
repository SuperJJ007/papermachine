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
import type { ScienceEditMessageSource } from '@deepseek-ai/dsh-tool-science/types'

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

function requestsDirectEditState(options: GenerateOptions): boolean {
  return options.messages.some(message => message.source.kind === 'user'
    && message.content.some(block => block.type === 'text' && block.text === 'Inspect the direct chart edit state.'))
}

function answeredDirectEditState(options: GenerateOptions): boolean {
  return options.messages.some(message => message.role === 'assistant'
    && message.content.some(block => block.type === 'text' && block.text === 'SCIENCE_DIRECT_EDIT_STATE_OK'))
}

/** One deterministic call id per selection count, doubling as the served-edit marker. */
function editCallId(source: ScienceEditMessageSource): string {
  return source.targets.length === 1 ? 'science-selected-edit-call' : 'science-region-edit-call'
}

/** Call ids every earlier tool result in `options` has already answered. */
function servedCallIds(options: GenerateOptions): Set<string> {
  return new Set<string>(options.messages.flatMap(message =>
    message.content.flatMap(block => block.type === 'tool-result' ? [block.toolCallId] : [])))
}

/** The oldest structured edit message no earlier tool result has answered. */
function pendingEditSource(options: GenerateOptions, served: Set<string>): ScienceEditMessageSource | undefined {
  return options.messages
    .flatMap(message => message.source.kind === 'science-edit' ? [message.source] : [])
    .find(source => !served.has(editCallId(source)))
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
function curatedArtifactRef(options: GenerateOptions): { readonly artifactId: string; readonly version: number } {
  // Cite what the receipt reported rather than a version number written into
  // the fixture: a curated version is the one the model was told it curated.
  const match = /" v(\d+) \(([^)]+)\) curated from run /.exec(toolResultTexts(options).join('\n'))
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error('science-mock-llm: no annotate_artifact receipt names an artifact version and id')
  }
  return { artifactId: match[2], version: Number(match[1]) }
}

/** The exact plot version reported by the auto-capture receipt. */
function capturedPlotRef(options: GenerateOptions): { readonly artifactId: string; readonly version: number } {
  const match = /`plot\.png` v(\d+) \(([^;]+);/.exec(toolResultTexts(options).join('\n'))
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error('science-mock-llm: no run receipt names the captured plot version and id')
  }
  return { artifactId: match[2], version: Number(match[1]) }
}

function writeCapture(options: GenerateOptions): void {
  const toolResults = options.messages.flatMap(message =>
    message.content.flatMap(block => block.type === 'tool-result' ? [block] : []))
  const editMessages = options.messages.filter(message => message.source.kind === 'science-edit')
  writeFileSync(capturePath, `${JSON.stringify({
    guidance: scienceGuidance(options.system),
    tools: options.tools?.filter(tool => SCIENCE_TOOLS.includes(tool.name)),
    filesystemTools: options.tools?.filter(tool => ['read', 'write', 'edit'].includes(tool.name)).map(tool => tool.name),
    runtimeContext: runtimeContext(options),
    // An image block reaches the provider as rendered image content, not as
    // its durable handle; record the block's media type and dimensions and
    // keep the internal attachment id out of the model-facing capture.
    editMessages: editMessages.map(message => ({
      source: message.source,
      content: message.content.map(block => block.type === 'image'
        ? {
          type: block.type,
          attachment: { mediaType: block.attachment.mediaType, width: block.attachment.width, height: block.attachment.height },
        }
        : block),
    })),
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
    const served = servedCallIds(options)
    if (requestsDirectEditState(options) && !answeredDirectEditState(options)) {
      if (!served.has('science-direct-edit-state-call')) {
        yield * toolCall('science-direct-edit-state-call', 'get_science_state', {})
        return
      }
      const reply = 'SCIENCE_DIRECT_EDIT_STATE_OK'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: reply }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    const selectedEdit = pendingEditSource(options, served)
    if (selectedEdit !== undefined) {
      if (selectedEdit.targets.length === 0) throw new Error('science-mock-llm: edit source has no targets')
      const transfers = selectedEdit.targets.map((target, index) => {
        const suffix = selectedEdit.targets.length === 1 ? '' : `-${String(index + 1)}`
        return { target, input: `region-source${suffix}.png`, output: `region-edit${suffix}.png`, method: 'write_bytes' }
      })
      const code = ['from pathlib import Path', ...transfers.map(({ input, output, method }) =>
        `Path(SCIENCE_ARTIFACT_DIR, "${output}").${method}(Path("inputs/${input}").read_${method === 'write_text' ? 'text' : 'bytes'}())`),
      ].join('\n')
      yield * toolCall(editCallId(selectedEdit), 'run_python', {
        code,
        artifact_inputs: transfers.map(({ target, input }) => ({
          artifactId: target.artifactId, version: target.version, path: input,
        })),
        edit_of: transfers.map(({ target, output }) => ({
          artifactId: target.artifactId, version: target.version, path: output,
        })),
        raster_artifacts: transfers.filter(({ method }) => method === 'write_bytes').map(({ output }) => output),
      })
      return
    }
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
          raster_artifacts: ['plot.png'],
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
            { kind: 'chart', chart_id: chart.artifactId, version: chart.version },
          ],
        })
        return
      }
      case 4:
        yield * toolCall('science-state-call-2', 'get_science_state', {})
        return
      case 5:
        // Same kernel as the first run, so the result carries no restart
        // line. This assembled call also materializes the curated exact
        // version and branches one edited output from that baseline.
        const baseline = capturedPlotRef(options)
        yield * toolCall('science-run-call-2', 'run_python', {
          code: 'import os\nfrom pathlib import Path\n'
            + 'Path(os.environ["SCIENCE_ARTIFACT_DIR"], "edited.png").write_bytes(Path("inputs/source.png").read_bytes())',
          artifact_inputs: [{ artifactId: baseline.artifactId, version: baseline.version, path: 'source.png' }],
          edit_of: [{ artifactId: baseline.artifactId, version: baseline.version, path: 'edited.png' }],
          raster_artifacts: ['edited.png'],
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
