/**
 * First-use Science mode/environment binding and the deterministic
 * `science:environment` dynamic context.
 * @module @deepseek-ai/dsh-tool-science/context
 */

import type { Context } from '@deepseek-ai/cordis'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-science-runtime'
import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets'
import { SCIENCE_PRESET_ID, replayScience } from '@deepseek-ai/dsh-science-session'
import type { ScienceInterpreterBinding, ScienceKernel, ScienceKernelEndReason, ScienceProjection } from '@deepseek-ai/dsh-science-session'
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

const STATE_RULE = 'Variables persist in each language\'s kernel across run_python/run_r calls until it restarts (idle timeout, environment re-bind, interrupt escalation, crash, or session end). State that must survive a restart belongs under SCIENCE_STATE_DIR; final output belongs under SCIENCE_ARTIFACT_DIR; materialized artifact_inputs are read from SCIENCE_INPUT_DIR.'

/**
 * Model-vocabulary phrase for one closed kernel's end reason — task words
 * only, no transport/implementation vocabulary. `ScienceKernelEndReason`
 * stays closed; TypeScript rejects an unhandled member added later.
 * @param reason - closed kernel end-reason from a durable `science/kernel-state` fact.
 * @returns the model-facing phrase completing "kernel restarted (<phrase>)".
 */
export function modelKernelEndReason(reason: ScienceKernelEndReason): string {
  switch (reason) {
    case 'idle': return 'idle timeout'
    case 'environment-rebound': return 'environment re-bind'
    case 'run-escalation': return 'interrupt escalation'
    case 'crash': return 'kernel crash'
    case 'session-end': return 'session end'
    case 'protocol': return 'the kernel stopped responding correctly'
    case 'service-disposed': return 'Science services restarting'
  }
}

/** A closed kernel's end reason and start time, read together by {@link closedKernelFacts}. */
export interface ClosedKernelFacts {
  readonly reason: ScienceKernelEndReason
  readonly startedAt: number
}

/**
 * Narrow a kernel record to its fold-guaranteed closed fields (types.ts:
 * `reason`/`startedAt` present iff `state === 'exited'`) — TypeScript does
 * not narrow those optional fields from the `state` discriminant alone, so
 * this checks their presence directly rather than re-deriving the invariant
 * the fold already enforced on this already-replayed projection.
 * @param kernel - one kernel record from a replayed Science projection.
 * @returns the closed kernel's end reason and start time, or `undefined` for a still-running or replay-derived interrupted kernel.
 */
export function closedKernelFacts(kernel: ScienceKernel): ClosedKernelFacts | undefined {
  if (kernel.state !== 'exited') return undefined
  const { reason, startedAt } = kernel
  if (reason === undefined || startedAt === undefined) return undefined
  return { reason, startedAt }
}

/**
 * Whether the exact live Session currently runs under the `science` preset.
 *
 * Reads the resolved preset (creation header, overridden by the last
 * `agent-preset/selected` event), not the header alone: a session that
 * switched preset while blank keeps its creation-time header forever, and
 * every turn since the switch runs under the newer composition — the same
 * fact `dsh-host-apiproxy` resolves this way for tool visibility, transcript
 * presenters, and resume/adoption.
 * @param session - candidate Session.
 * @returns whether the session's resolved agent preset is `SCIENCE_PRESET_ID`.
 */
export function isScienceSession(session: Session): boolean {
  return resolveSessionPreset(session) === SCIENCE_PRESET_ID
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
    // The caller already confirmed `isScienceSession(session)`, so the
    // resolved preset here is always `SCIENCE_PRESET_ID` today; recording it
    // rather than a literal keeps this event's `presetId` truthfully "the
    // preset that bound Science mode" if that ever becomes a different id.
    // The caller already confirmed isScienceSession(session), whose predicate
    // requires this same resolver to name the Science preset.
    const presetId = resolveSessionPreset(session) as typeof SCIENCE_PRESET_ID
    session.append('science/mode-bound', {
      version: 1,
      mode: { modeId: 'science', presetId, modeRevision: config.modeRevision },
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
