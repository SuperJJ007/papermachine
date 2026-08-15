/** `get_science_state`: the exact Session's bounded durable Science projection. */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { replayScience } from '@deepseek-ai/dsh-science-session'
import { requireScienceSession } from './run.ts'

/** The bounded projection reshaped for the schema's `type: 'json'` fields. */
interface ScienceStateValue {
  readonly mode: JsonValue
  readonly environment: JsonValue
  readonly runs: JsonValue[]
  readonly charts: JsonValue[]
  readonly outcome: JsonValue
  readonly metrics: JsonValue
  readonly lastScienceEventSeq: number
}

const stateOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    mode: { type: 'json', required: true },
    environment: { type: 'json', required: true },
    runs: { type: 'array', items: { type: 'json' }, required: true },
    charts: { type: 'array', items: { type: 'json' }, required: true },
    outcome: { type: 'json', required: true },
    metrics: { type: 'json', required: true },
    lastScienceEventSeq: { type: 'integer', required: true },
  },
} as const

/**
 * Register `get_science_state`, a no-argument read of the exact Session's
 * bounded Science projection.
 * @param ctx - plugin context.
 */
export function applyScienceStateTool(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'get_science_state',
    description: 'Return the current Science session state: mode, bound environment, run history, charts, and the latest published outcome. Takes no arguments.',
    parameters: {},
    output: {
      schema: stateOutputSchema,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, undefined, 2) }],
    },
    isConcurrencySafe: () => true,
    async execute(_args, exec): Promise<ScienceStateValue> {
      const session = requireScienceSession(exec)
      const projection = replayScience(session.events)
      if (projection === null) throw new Error('tool-science: Science mode is not bound for this session')
      return {
        mode: projection.mode as unknown as JsonValue,
        environment: projection.environment as unknown as JsonValue,
        runs: projection.runs as unknown as JsonValue[],
        charts: projection.charts as unknown as JsonValue[],
        outcome: projection.outcome as unknown as JsonValue,
        metrics: projection.metrics as unknown as JsonValue,
        lastScienceEventSeq: projection.lastScienceEventSeq,
      }
    },
  }))
}
