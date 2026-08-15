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

function writeCapture(options: GenerateOptions): void {
  const toolResults = options.messages.flatMap(message =>
    message.content.flatMap(block => block.type === 'tool-result' ? [block] : []))
  writeFileSync(capturePath, `${JSON.stringify({
    guidance: scienceGuidance(options.system),
    tools: options.tools?.filter(tool => ['get_science_state', 'run_python', 'run_r'].includes(tool.name)),
    filesystemTools: options.tools?.filter(tool => ['read', 'write', 'edit'].includes(tool.name)).map(tool => tool.name),
    runtimeContext: runtimeContext(options),
    toolResults: toolResults.map(result => ({ toolCallId: result.toolCallId, content: result.content })),
  }, undefined, 2)}\n`)
}

class ScienceMockAdapter extends LlmAdapter {
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    writeCapture(options)
    const toolResults = options.messages.flatMap(message =>
      message.content.flatMap(block => block.type === 'tool-result' ? [block] : []))
    if (toolResults.length === 0) {
      const args = '{}'
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: CallId('science-state-call'), name: 'get_science_state', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId('science-state-call'), name: 'get_science_state', arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    if (toolResults.length === 1) {
      const args = JSON.stringify({ code: 'print("science snapshot")' })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: CallId('science-run-call'), name: 'run_python', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId('science-run-call'), name: 'run_python', arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }

    const reply = 'SCIENCE_TOOLS_SNAPSHOT_OK'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: reply }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'science-mock-llm'
export const inject = ['llm']

/** Register the deterministic Science snapshot route. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['science-snapshot'], new ScienceMockAdapter())
}
