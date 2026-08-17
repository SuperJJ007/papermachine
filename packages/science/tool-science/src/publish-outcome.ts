/**
 * `publish_outcome`: a direct exclusive tool that appends
 * `science/outcome-published` after independently resolving every evidence
 * reference and deriving the exact sorted environment-revision set. This
 * Consumer owns the append directly — publication performs no Host
 * filesystem, attachment, subprocess, or lease operation, so routing it
 * through `ScienceRuntimeService` would invent a Runtime responsibility.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue } from '@deepseek-ai/dsh-tools'
import { ScienceChartId, ScienceRunId, replayScience } from '@deepseek-ai/dsh-science-session'
import type { ScienceEvidenceRef, ScienceOutcomePublication, ScienceProjection } from '@deepseek-ai/dsh-science-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { requireDirectDispatch } from './guard.ts'
import { latestRequestHeaderSeq, requireScienceSession } from './run.ts'
import { scienceOutcomePresentation } from './presentation.ts'

const evidenceItemSchema = {
  oneOf: [
    {
      type: 'object', additionalProperties: false,
      properties: { kind: { type: 'string', required: true, enum: ['run'] }, run_id: { type: 'string', required: true } },
    },
    {
      type: 'object', additionalProperties: false,
      properties: {
        kind: { type: 'string', required: true, enum: ['chart'] },
        chart_id: { type: 'string', required: true },
        version: { type: 'integer', required: true },
      },
    },
    {
      type: 'object', additionalProperties: false,
      properties: { kind: { type: 'string', required: true, enum: ['message'] }, seq: { type: 'integer', required: true } },
    },
  ],
} as const

const outcomeResultSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    revision: { type: 'integer', required: true },
    title: { type: 'string', required: true },
    summaryMarkdown: { type: 'string', required: true },
    evidence: { type: 'array', required: true, items: evidenceItemSchema },
    publishedAt: { type: 'integer', required: true },
  },
} as const

/** Bounded structured value for a durably published Outcome revision. */
export type ScienceOutcomeResultValue = InferValue<typeof outcomeResultSchema>
/** One model-supplied evidence item, before durable branding. */
export type ScienceOutcomeEvidenceArg = InferValue<typeof outcomeResultSchema>['evidence'][number]

/** Stable dedupe/lookup key for one evidence item. */
function evidenceKey(item: ScienceOutcomeEvidenceArg): string {
  switch (item.kind) {
    case 'run': return `run:${item.run_id}`
    case 'chart': return `chart:${item.chart_id}:${String(item.version)}`
    case 'message': return `message:${String(item.seq)}`
  }
}

/**
 * Whether one session event is a message-bearing fact an Outcome may cite —
 * the same three carrier types the durable Science fold privately tracks as
 * `messageFacts` (`user/message`, `assistant/message`, `tool/result`), which
 * this Consumer cannot read directly since `ScienceProjection` does not
 * expose the fold's private state.
 * @param session - the exact live Session.
 * @param seq - the candidate message-fact seq.
 * @returns whether `seq` names a message-bearing event in this session.
 */
export function isMessageFact(session: Session, seq: number): boolean {
  return session.events.some(event => event.seq === seq
    && (event.type === 'user/message' || event.type === 'assistant/message' || event.type === 'tool/result'))
}

/**
 * Resolve every model-supplied evidence item against the live projection:
 * reject an empty or duplicate set, require each run/chart/message to name a
 * prior durable fact, and derive the exact sorted environment-revision set
 * from the cited run and chart evidence.
 * @param session - the exact live Session (for message-fact lookup).
 * @param projection - the exact live Science projection.
 * @param items - the model-supplied evidence list.
 * @returns durable evidence references and the derived environment revisions.
 */
function resolveEvidence(
  session: Session,
  projection: ScienceProjection,
  items: readonly ScienceOutcomeEvidenceArg[],
): { evidence: ScienceEvidenceRef[]; environmentRevisions: number[] } {
  if (items.length === 0) throw new Error('tool-science: evidence must be non-empty')
  const seen = new Set<string>()
  const revisions = new Set<number>()
  const evidence: ScienceEvidenceRef[] = []
  for (const item of items) {
    const key = evidenceKey(item)
    if (seen.has(key)) throw new Error(`tool-science: duplicate evidence reference ${key}`)
    seen.add(key)
    switch (item.kind) {
      case 'run': {
        const run = projection.runs.find(candidate => candidate.runId === ScienceRunId(item.run_id))
        if (run === undefined || run.status !== 'success') {
          throw new Error(`tool-science: evidence run ${JSON.stringify(item.run_id)} is not a successful prior run`)
        }
        revisions.add(run.environmentRevision)
        evidence.push({ kind: 'run', runId: run.runId })
        break
      }
      case 'chart': {
        const chart = projection.charts.find(candidate =>
          candidate.chartId === ScienceChartId(item.chart_id) && candidate.version === item.version)
        if (chart === undefined) {
          throw new Error(`tool-science: evidence chart ${JSON.stringify(item.chart_id)}@${String(item.version)} does not exist`)
        }
        revisions.add(chart.environmentRevision)
        evidence.push({ kind: 'chart', chartId: chart.chartId, version: chart.version })
        break
      }
      case 'message': {
        if (!isMessageFact(session, item.seq)) {
          throw new Error(`tool-science: evidence message seq ${String(item.seq)} does not name a prior message`)
        }
        evidence.push({ kind: 'message', seq: item.seq })
        break
      }
    }
  }
  // A session forbids rebinding a new applied environment once any run
  // exists (science-session's fold), so every run and chart in one session
  // shares exactly one applied revision today; `revisions` never exceeds one
  // element and this comparator never actually compares two. It stays exact
  // (not `.sort()` on a single-element optimization) in case that invariant
  // is ever relaxed to allow more than one applied revision per session.
  /* v8 ignore next -- see above: unreachable while at most one applied revision exists per session */
  return { evidence, environmentRevisions: [...revisions].sort((left, right) => left - right) }
}

/** Reject an empty or whitespace-only field before it reaches the durable codec. */
function nonEmpty(value: string, field: string): string {
  if (value.trim().length === 0) throw new Error(`tool-science: ${field} must be a non-empty string`)
  return value
}

/**
 * Flatten a durable Outcome publication into the tool's canonical value.
 * @param outcome - the durable publication `publish_outcome` appended.
 * @returns the canonical structured value the tool returns.
 */
export function outcomeResultFromPublication(outcome: ScienceOutcomePublication): ScienceOutcomeResultValue {
  return {
    revision: outcome.revision,
    title: outcome.title,
    summaryMarkdown: outcome.summaryMarkdown,
    evidence: outcome.evidence.map((item): ScienceOutcomeEvidenceArg => {
      switch (item.kind) {
        case 'run': return { kind: 'run', run_id: String(item.runId) }
        case 'chart': return { kind: 'chart', chart_id: String(item.chartId), version: item.version }
        case 'message': return { kind: 'message', seq: item.seq }
      }
    }),
    publishedAt: outcome.publishedAt,
  }
}

/**
 * Render one Outcome result as plain text, so a Client without Science UI
 * still receives a useful result and the next model step sees exactly what
 * was published.
 * @param value - the canonical Outcome result to render.
 * @returns the rendered Native text.
 */
export function formatOutcomeResult(value: ScienceOutcomeResultValue): string {
  const lines = [
    `Outcome revision ${String(value.revision)}: ${value.title}`,
    '',
    value.summaryMarkdown,
    '',
    'Evidence:',
  ]
  for (const item of value.evidence) {
    if (item.kind === 'run') lines.push(`- run ${item.run_id}`)
    else if (item.kind === 'chart') lines.push(`- chart ${item.chart_id}@${String(item.version)}`)
    else lines.push(`- message seq ${String(item.seq)}`)
  }
  return lines.join('\n')
}

/**
 * Register `publish_outcome`.
 * @param ctx - plugin context.
 */
export function applyPublishOutcomeTool(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'publish_outcome',
    description: 'Publish the current Science result as the session\'s next Outcome revision: a title, a Markdown summary, and non-empty unique evidence citing only prior successful runs, exact saved chart versions, and/or prior messages. Each publish replaces the model-visible current Outcome with a new contiguous revision; it does not read or change Goal state.',
    parameters: {
      title: { type: 'string', required: true, description: 'Human-readable result title.' },
      summary_markdown: { type: 'string', required: true, description: 'Markdown summary of the result.' },
      evidence: {
        type: 'array', required: true,
        description: 'Non-empty, unique list of prior facts this Outcome cites: {kind:"run",run_id}, {kind:"chart",chart_id,version}, or {kind:"message",seq}.',
        items: evidenceItemSchema,
      },
    },
    output: {
      schema: outcomeResultSchema,
      render: (_args, value) => [{ type: 'text', text: formatOutcomeResult(value) }],
      presentationMeta: (_args, value) => scienceOutcomePresentation(value),
    },
    execute(args, exec): Promise<ScienceOutcomeResultValue> {
      requireDirectDispatch(exec, 'publish_outcome')
      const session = requireScienceSession(exec)
      const projection = replayScience(session.events)
      if (projection === null) throw new Error('tool-science: Science mode is not bound for this session')
      const requestHeaderSeq = latestRequestHeaderSeq(session)
      if (requestHeaderSeq === undefined) {
        throw new Error('tool-science: no request/header is recorded for this session')
      }
      const { evidence, environmentRevisions } = resolveEvidence(session, projection, args.evidence)
      const outcome: ScienceOutcomePublication = {
        revision: (projection.outcome?.revision ?? 0) + 1,
        title: nonEmpty(args.title, 'title'),
        summaryMarkdown: nonEmpty(args.summary_markdown, 'summary_markdown'),
        evidence,
        publishedAt: Date.now(),
        toolCallId: exec.callId,
        requestHeaderSeq,
        environmentRevisions,
      }
      session.append('science/outcome-published', { version: 1, outcome })
      return Promise.resolve(outcomeResultFromPublication(outcome))
    },
  }))
}
