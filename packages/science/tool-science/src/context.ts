/**
 * First-use Science mode/environment binding and the deterministic
 * `science:environment` dynamic context.
 * @module @deepseek-ai/dsh-tool-science/context
 */

import type { Context } from '@deepseek-ai/cordis'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-science-runtime'
import { replayScience } from '@deepseek-ai/dsh-science-session'
import type { ScienceInterpreterBinding, ScienceProjection } from '@deepseek-ai/dsh-science-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ResolvedConfig } from './config.ts'

/** Unique dynamic-context registration name; also identifies the assembly entry the waterfall replaces. */
export const CONTEXT_NAME = 'science:environment'

/** Prompt order for the Science context, alongside other tool-guidance entries. */
export const CONTEXT_ORDER = 120

/**
 * Render the stable fingerprint prefix shared by Science model-facing values.
 * @param fingerprint - complete durable binding fingerprint.
 * @returns the model-facing prefix.
 */
export function scienceFingerprintPreview(fingerprint: string): string {
  return fingerprint.slice(0, 12)
}

/**
 * Return a subprocess-observed label only when it cannot contain a Host path.
 * @param label - subprocess-observed label.
 * @returns the label, or `undefined` when it contains a path separator.
 */
export function scienceModelObservedLabel(label: string): string | undefined {
  return /[\\/]/.test(label) ? undefined : label
}

const STATE_RULE = 'Each run_python/run_r call starts a fresh interpreter process. Reusable state belongs under SCIENCE_STATE_DIR; final output belongs under SCIENCE_ARTIFACT_DIR.'

/**
 * Whether the exact live Session is bound to the `science` preset and mode.
 * @param session - candidate Session.
 * @returns whether `session.header.agentPreset` is `'science'`.
 */
export function isScienceSession(session: Session): boolean {
  return session.header.agentPreset === 'science'
}

/** Render one interpreter binding line, omitting source, credentials, and Host paths. */
function renderInterpreter(label: string, binding: ScienceInterpreterBinding | undefined): string | undefined {
  if (binding === undefined) return undefined
  if (binding.capability === 'available') {
    const version = scienceModelObservedLabel(binding.languageVersion)
    return `${label}: available${version === undefined ? '' : `, version ${version}`}, fingerprint ${scienceFingerprintPreview(binding.bindingFingerprint)}.`
  }
  return `${label}: ${binding.capability}.`
}

/**
 * Render the deterministic Science dynamic context from a replayed projection.
 * @param projection - the exact Session's replayed Science projection.
 * @returns bounded model-facing text, or `''` before Science mode is bound.
 */
export function renderScienceProjection(projection: ScienceProjection | null): string {
  if (projection === null) return ''
  const lines: string[] = [`Science mode: revision ${projection.mode.modeRevision}.`]
  const { environment } = projection
  if (environment === null) {
    lines.push('Environment: not yet bound.')
  } else {
    lines.push(`Environment: profile "${environment.profileId}", revision ${environment.revision}, status ${environment.status}.`)
    const python = renderInterpreter('Python', environment.python)
    if (python !== undefined) lines.push(python)
    const r = renderInterpreter('R', environment.r)
    if (r !== undefined) lines.push(r)
  }
  const lastRun = projection.runs.at(-1)
  if (lastRun !== undefined) {
    lines.push(`Latest run ${lastRun.runId} (${lastRun.language}): ${lastRun.status}.`)
  }
  lines.push(STATE_RULE)
  return lines.join('\n')
}

/**
 * Render the current Science context for a Session, or `''` outside Science mode.
 * @param session - candidate Session; only a `science`-preset Session renders.
 * @returns bounded model-facing text.
 */
export function renderScienceContext(session: Session): string {
  if (!isScienceSession(session)) return ''
  return renderScienceProjection(replayScience(session.events))
}

/**
 * Bind Science mode on first use and the environment on first missing
 * revision, then return the current projection. No-ops (besides the replay)
 * once both are already bound and matching.
 * @param ctx - context carrying the optional `ctx.scienceRuntime` service.
 * @param session - exact live Session to bind.
 * @param signal - caller-owned cancellation signal for environment binding.
 * @param config - resolved plugin configuration.
 * @returns the projection after binding completes.
 */
export async function ensureScienceBound(
  ctx: Context,
  session: Session,
  signal: AbortSignal,
  config: ResolvedConfig,
): Promise<ScienceProjection> {
  let projection = replayScience(session.events)
  if (projection === null) {
    session.append('science/mode-bound', {
      version: 1,
      mode: { modeId: 'science', presetId: 'science', modeRevision: config.modeRevision },
    })
    projection = replayScience(session.events)
    /* v8 ignore next -- append() commits synchronously; a fresh replay observes it immediately */
    if (projection === null) throw new Error('tool-science: mode-bound append did not commit')
  } else if (projection.mode.modeRevision !== config.modeRevision) {
    throw new Error(`tool-science: session is bound to Science mode revision ${JSON.stringify(projection.mode.modeRevision)}, configured revision is ${JSON.stringify(config.modeRevision)}`)
  }
  if (projection.environment === null) {
    const scienceRuntime = ctx.get('scienceRuntime')
    if (scienceRuntime === undefined) {
      throw new Error('tool-science: no Science Runtime is mounted (ctx.scienceRuntime)')
    }
    await scienceRuntime.bindEnvironment({ session, profileId: config.profileId, signal })
    projection = replayScience(session.events)
    /* v8 ignore next -- bindEnvironment() commits synchronously on success; a fresh replay observes it */
    if (projection === null) throw new Error('tool-science: environment-bound append did not commit')
  }
  return projection
}

/**
 * Register the `science:environment` dynamic context and the
 * `system-prompt/assemble` waterfall that performs first-use binding and
 * replaces that context entry with the post-bind render. Both registrations
 * are Cordis effects; disposing the plugin fiber unregisters them.
 * @param ctx - plugin context.
 * @param config - resolved plugin configuration.
 */
export function applyScienceContext(ctx: Context, config: ResolvedConfig): void {
  ctx.systemPrompt.context({
    name: CONTEXT_NAME,
    order: CONTEXT_ORDER,
    text: context => (context.agent === undefined ? '' : renderScienceContext(context.agent.session)),
  })
  ctx.on('system-prompt/assemble', async (_assembly: PromptAssembly, context, next) => {
    const { agent } = context
    if (agent === undefined || context.signal === undefined || !isScienceSession(agent.session)) {
      return next()
    }
    const projection = await ensureScienceBound(ctx, agent.session, context.signal, config)
    const result = await next()
    const rendered = renderScienceProjection(projection)
    return {
      ...result,
      contexts: result.contexts.map(entry => (entry.name === CONTEXT_NAME ? { ...entry, text: rendered } : entry)),
    }
  })
}
