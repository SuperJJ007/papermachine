/** Strict Science state transitions and supporting Session-fact indexing. */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { decodeScienceDomainEvent } from './codec.ts'
import type { DecodedScienceDomainEvent } from './codec.ts'
import type { ScienceFoldState, IndexedSessionFact, IndexedToolCall } from './fold-state.ts'
import type {
  ScienceEnvironmentBinding,
  ScienceKernel,
  ScienceKernelState,
  ScienceLanguage,
  ScienceRun,
  ScienceRunIdentity,
} from './types.ts'

function requireRequestHeader(state: ScienceFoldState, seq: number): IndexedSessionFact {
  const latest = state.requestHeaders.at(-1)
  if (state.modeBoundSeq === undefined || seq <= state.modeBoundSeq || latest?.seq !== seq) {
    throw new Error(`requestHeaderSeq ${String(seq)} is not the latest post-mode request/header`)
  }
  return latest
}

function requireToolCall(
  state: ScienceFoldState,
  seq: number,
  callId: string,
  requestHeaderSeq: number,
  expectedToolNames: readonly string[],
): IndexedToolCall {
  const allMatches = state.toolCalls.filter(call => call.callId === callId)
  const matches = allMatches.filter(call => call.seq > (state.modeBoundSeq ?? Number.MAX_SAFE_INTEGER)
    && call.seq > requestHeaderSeq
    && call.seq < seq)
  const call = allMatches.length === 1 && matches.length === 1 ? matches[0] : undefined
  if (call === undefined) {
    throw new Error(`toolCallId ${JSON.stringify(callId)} does not identify one call after its cited request/header`)
  }
  if (!expectedToolNames.includes(call.name)) {
    throw new Error(`toolCallId ${JSON.stringify(callId)} names ${JSON.stringify(call.name)}, expected ${expectedToolNames.join(' or ')}`)
  }
  if (state.consumedToolCallSeqs.includes(call.seq)) {
    throw new Error(`toolCallId ${JSON.stringify(callId)} was already consumed by a Science fact`)
  }
  if (state.settledToolCallSeqs.includes(call.seq)) {
    throw new Error(`toolCallId ${JSON.stringify(callId)} was already settled before its Science fact`)
  }
  return call
}

function requireEnvironment(state: ScienceFoldState, revision: number): ScienceEnvironmentBinding {
  const environment = state.environments.find(candidate => candidate.revision === revision)
  if (environment === undefined) throw new Error(`environment revision ${String(revision)} does not exist`)
  return environment
}

/**
 * Assert `revision` names the session's currently bound, latest applied
 * environment, and that `fingerprint` matches `language`'s own available
 * binding on that revision. Shared by the run and kernel `started` paths —
 * the only Science facts that fix new environment provenance. A kernel
 * `exited` fact deliberately carries no such requirement (D4): its revision
 * is pinned to its own `started` fact by {@link sameKernelIdentity} instead,
 * which lets an `environment-rebound` exit legitimately name a
 * since-superseded revision.
 * @param state - fold accumulator to read committed environments from.
 * @param revision - environment revision the fact claims.
 * @param language - language whose binding must match `fingerprint`.
 * @param fingerprint - binding fingerprint the fact claims.
 * @param subject - noun phrase identifying the fact kind in thrown messages.
 * @returns the matched environment, so a caller needing further facts (run start timing) does not re-look it up.
 */
function requireLatestAppliedBinding(
  state: ScienceFoldState,
  revision: number,
  language: ScienceLanguage,
  fingerprint: string,
  subject: string,
): ScienceEnvironmentBinding {
  const environment = requireEnvironment(state, revision)
  if (environment !== state.environments.at(-1) || environment.status !== 'applied') {
    throw new Error(`${subject} must use the latest applied environment revision`)
  }
  const binding = language === 'python' ? environment.python : environment.r
  if (binding === undefined || binding.capability !== 'available' || binding.bindingFingerprint !== fingerprint) {
    throw new Error(`${subject} does not match an available environment binding`)
  }
  return environment
}

function requireScienceTime(state: ScienceFoldState, event: Pick<SessionEvent, 'seq' | 'time'>): void {
  if (state.lastScienceTime !== undefined && event.time < state.lastScienceTime) {
    throw new Error(`Science event ${String(event.seq)} moves time backwards`)
  }
}

function commitScienceTime(state: ScienceFoldState, event: Pick<SessionEvent, 'seq' | 'time'>): void {
  state.lastScienceTime = event.time
  state.lastScienceEventSeq = event.seq
}

function sameRunIdentity(started: ScienceRunIdentity, terminal: ScienceRunIdentity): boolean {
  return started.runId === terminal.runId
    && started.language === terminal.language
    && started.toolCallId === terminal.toolCallId
    && started.requestHeaderSeq === terminal.requestHeaderSeq
    && started.environmentRevision === terminal.environmentRevision
    && started.environmentFingerprint === terminal.environmentFingerprint
    && started.startedAt === terminal.startedAt
    && started.codeSha256 === terminal.codeSha256
    && started.scratchKey === terminal.scratchKey
    && started.runDirectoryRef === terminal.runDirectoryRef
    && started.kernelEpoch === terminal.kernelEpoch
}

/**
 * Require `run.kernelEpoch` to name a currently open (`started`, not yet
 * `exited`) kernel for `run.language`, and that kernel's own environment
 * provenance to match the run's claimed `environmentRevision`/
 * `environmentFingerprint`. At most one kernel per language is ever open at
 * once (D3), so a matching open record is unambiguous.
 * @param state - fold accumulator to read committed kernel facts from.
 * @param run - the run-started value naming the kernel epoch.
 * @throws when no open kernel matches, or its environment provenance diverges from the run's own.
 */
function requireOpenKernelEpoch(state: ScienceFoldState, run: ScienceRunIdentity): void {
  const kernel = state.kernels.find(candidate => candidate.language === run.language && candidate.kernelEpoch === run.kernelEpoch)
  if (kernel === undefined || !isOpenKernel(kernel)) {
    throw new Error(`Science run kernelEpoch ${String(run.kernelEpoch)} does not name a started kernel for language ${JSON.stringify(run.language)}`)
  }
  if (kernel.environmentRevision !== run.environmentRevision || kernel.environmentFingerprint !== run.environmentFingerprint) {
    throw new Error(`Science run kernelEpoch ${String(run.kernelEpoch)} environment provenance does not match its kernel`)
  }
}

function applyRunStarted(state: ScienceFoldState, event: Extract<DecodedScienceDomainEvent, { type: 'science/run-started' }>): void {
  if (state.mode === undefined) throw new Error('Science run requires a prior mode binding')
  const run = event.data.run
  if (state.runs.some(candidate => candidate.runId === run.runId)) {
    throw new Error(`duplicate Science runId ${JSON.stringify(run.runId)}`)
  }
  if (state.runs.some(candidate => candidate.status === 'running')) {
    throw new Error('only one Science run may be running in a session')
  }
  const environment = requireLatestAppliedBinding(state, run.environmentRevision, run.language, run.environmentFingerprint, 'Science run')
  requireOpenKernelEpoch(state, run)
  const requestHeader = requireRequestHeader(state, run.requestHeaderSeq)
  const toolCall = requireToolCall(
    state,
    event.seq,
    run.toolCallId,
    run.requestHeaderSeq,
    run.language === 'python' ? ['run_python'] : ['run_r'],
  )
  const priorRunFact = state.runFacts.at(-1)
  if (run.startedAt < environment.validatedAt
    || run.startedAt < requestHeader.time
    || run.startedAt < toolCall.time
    || (priorRunFact?.terminalEventTime !== undefined && run.startedAt < priorRunFact.terminalEventTime)
    || run.startedAt > event.time) {
    throw new Error('Science run start time is outside its supporting-fact event interval')
  }
  state.runs.push(run)
  state.runFacts.push({ runId: run.runId, startedSeq: event.seq, startedEventTime: event.time })
  state.consumedToolCallSeqs.push(toolCall.seq)
}

function applyRunFinished(state: ScienceFoldState, event: Extract<DecodedScienceDomainEvent, { type: 'science/run-finished' }>): void {
  const run = event.data.run
  const index = state.runs.findIndex(candidate => candidate.runId === run.runId)
  if (index < 0) throw new Error(`Science run ${JSON.stringify(run.runId)} has no matching start`)
  const current = state.runs[index]
  /* v8 ignore next -- findIndex returned this in-range index */
  if (current === undefined) throw new Error('Science run index disappeared during synchronous replay')
  if (current.status !== 'running') throw new Error(`Science run ${JSON.stringify(run.runId)} is already terminal`)
  if (!sameRunIdentity(current, run)) {
    throw new Error(`Science run ${JSON.stringify(run.runId)} terminal value rewrites start-owned fields`)
  }
  const factIndex = state.runFacts.findIndex(candidate => candidate.runId === run.runId)
  const fact = state.runFacts[factIndex]
  /* v8 ignore next -- every accepted run start appends the matching fact */
  if (fact === undefined) throw new Error('Science run event facts disappeared during synchronous replay')
  if (run.finishedAt < fact.startedEventTime || run.finishedAt > event.time) {
    throw new Error('Science run finish time is outside its durable start-to-finish event interval')
  }
  state.runs[index] = run
  state.runFacts[factIndex] = { ...fact, terminalSeq: event.seq, terminalEventTime: event.time }
}

function applyArtifactSaved(state: ScienceFoldState, event: Extract<DecodedScienceDomainEvent, { type: 'science/artifact-saved' }>): void {
  if (state.mode === undefined) throw new Error('Science artifact requires a prior mode binding')
  const artifact = event.data.artifact
  const source = state.runs.find(candidate => candidate.runId === artifact.runId)
  if (source === undefined || source.status === 'running' || source.status === 'interrupted') {
    throw new Error('Science artifact must reference a run that reached a terminal status')
  }
  const requestHeader = requireRequestHeader(state, artifact.requestHeaderSeq)
  // An auto-captured save (origin 'auto') is not a distinct model-issued
  // call: it carries exactly its source run's own toolCallId/requestHeaderSeq,
  // already proven and consumed by that run's science/run-started fact, so it
  // never re-consumes a tool call — many captured files share one run's call.
  // A curating save (origin 'model', today only annotate_artifact) consumes a
  // fresh tool call exactly once, whether it opens a version or supersedes one.
  let toolCallTime: number | undefined
  let consumedToolCallSeq: number | undefined
  if (artifact.origin === 'auto') {
    if (artifact.toolCallId !== source.toolCallId || artifact.requestHeaderSeq !== source.requestHeaderSeq) {
      throw new Error('an auto-captured Science artifact must carry its source run\'s own toolCallId and requestHeaderSeq')
    }
  } else {
    const toolCall = requireToolCall(state, event.seq, artifact.toolCallId, artifact.requestHeaderSeq, ['annotate_artifact'])
    toolCallTime = toolCall.time
    consumedToolCallSeq = toolCall.seq
  }
  if (artifact.environmentRevision !== source.environmentRevision
    || artifact.environmentFingerprint !== source.environmentFingerprint) {
    throw new Error('Science artifact environment provenance must match its source run')
  }
  const sourceFact = state.runFacts.find(candidate => candidate.runId === artifact.runId)
  /* v8 ignore next -- a terminal run always has its terminal fact */
  if (sourceFact?.terminalEventTime === undefined) throw new Error('Science artifact source-run event facts are missing')
  if (artifact.createdAt < source.finishedAt
    || artifact.createdAt < sourceFact.terminalEventTime
    || artifact.createdAt < requestHeader.time
    || (toolCallTime !== undefined && artifact.createdAt < toolCallTime)
    || artifact.createdAt > event.time) {
    throw new Error('Science artifact creation time is outside its supporting-fact event interval')
  }
  // A version is what one request turn produced, so a re-save either opens the
  // next version or supersedes an existing one in place. Superseding is
  // admitted on exactly two grounds: the save repeats the target version's own
  // request turn (the model rewrote the same file while still answering that
  // request), or it repeats the target's attachment byte-for-byte (a
  // metadata-only curation). Anything else is a new turn changing the content,
  // which is what a reader means by a new version.
  const logical = state.artifacts.filter(candidate => candidate.logicalName === artifact.logicalName)
  const target = logical.find(candidate => candidate.version === artifact.version)
  if (target === undefined) {
    const latest = logical.at(-1)
    if (latest === undefined) {
      if (artifact.version !== 1) throw new Error('the first logical artifact version must be 1')
      const reusedId = state.artifacts.find(candidate => candidate.artifactId === artifact.artifactId)
      if (reusedId !== undefined) throw new Error('an artifactId cannot name two logical artifacts')
    } else if (artifact.artifactId !== latest.artifactId
      || artifact.version !== latest.version + 1
      || artifact.createdAt < latest.createdAt) {
      throw new Error('artifact versions must retain artifactId and advance contiguously')
    }
    state.artifacts.push(artifact)
    state.artifactFacts.push({ artifactId: artifact.artifactId, version: artifact.version, seq: event.seq, time: event.time })
  } else {
    if (artifact.artifactId !== target.artifactId || artifact.createdAt < target.createdAt) {
      throw new Error('artifact versions must retain artifactId and advance contiguously')
    }
    if (artifact.requestHeaderSeq !== target.requestHeaderSeq
      && artifact.attachment.attachmentId !== target.attachment.attachmentId) {
      throw new Error('a Science artifact version is superseded only by its own request turn or by an unchanged attachment')
    }
    state.artifacts[state.artifacts.indexOf(target)] = artifact
    const factIndex = state.artifactFacts.findIndex(candidate =>
      candidate.artifactId === artifact.artifactId && candidate.version === artifact.version)
    /* v8 ignore next -- every accepted version appended its matching fact */
    if (factIndex < 0) throw new Error('Science artifact event facts disappeared during synchronous replay')
    state.artifactFacts[factIndex] = { artifactId: artifact.artifactId, version: artifact.version, seq: event.seq, time: event.time }
  }
  if (consumedToolCallSeq !== undefined) state.consumedToolCallSeqs.push(consumedToolCallSeq)
}

function applyOutcomePublished(state: ScienceFoldState, event: Extract<DecodedScienceDomainEvent, { type: 'science/outcome-published' }>): void {
  if (state.mode === undefined) throw new Error('Science outcome requires a prior mode binding')
  const outcome = event.data.outcome
  if (outcome.revision !== state.outcomes.length + 1) {
    throw new Error(`outcome revision must be ${String(state.outcomes.length + 1)}`)
  }
  const prior = state.outcomes.at(-1)
  if (outcome.publishedAt > event.time || (prior !== undefined && outcome.publishedAt < prior.publishedAt)) {
    throw new Error('Science outcome publication time is not monotonic')
  }
  const requestHeader = requireRequestHeader(state, outcome.requestHeaderSeq)
  const toolCall = requireToolCall(state, event.seq, outcome.toolCallId, outcome.requestHeaderSeq, ['publish_outcome'])
  if (outcome.publishedAt < requestHeader.time || outcome.publishedAt < toolCall.time) {
    throw new Error('Science outcome publication time precedes its authorizing facts')
  }
  for (const revision of outcome.environmentRevisions) {
    if (requireEnvironment(state, revision).status !== 'applied') {
      throw new Error(`outcome environment revision ${String(revision)} was not applied`)
    }
  }
  const citedEnvironmentRevisions = new Set<number>()
  for (const evidence of outcome.evidence) {
    switch (evidence.kind) {
      case 'run': {
        const run = state.runs.find(candidate => candidate.runId === evidence.runId)
        if (run === undefined || run.status !== 'success') {
          throw new Error(`outcome run evidence ${JSON.stringify(evidence.runId)} is not a successful prior run`)
        }
        const fact = state.runFacts.find(candidate => candidate.runId === evidence.runId)
        /* v8 ignore next -- a successful run always has its terminal fact */
        if (fact?.terminalEventTime === undefined) throw new Error('Science outcome run event facts are missing')
        if (outcome.publishedAt < fact.terminalEventTime) {
          throw new Error('Science outcome publication time precedes cited run evidence')
        }
        citedEnvironmentRevisions.add(run.environmentRevision)
        break
      }
      case 'chart': {
        const artifact = state.artifacts.find(candidate => candidate.artifactId === evidence.chartId
          && candidate.version === evidence.version)
        if (artifact === undefined) {
          throw new Error(`outcome chart evidence ${JSON.stringify(evidence.chartId)}@${String(evidence.version)} is missing`)
        }
        const fact = state.artifactFacts.find(candidate => candidate.artifactId === evidence.chartId
          && candidate.version === evidence.version)
        /* v8 ignore next -- every accepted artifact appends the matching fact */
        if (fact === undefined) throw new Error('Science outcome chart event facts are missing')
        if (outcome.publishedAt < fact.time) {
          throw new Error('Science outcome publication time precedes cited chart evidence')
        }
        citedEnvironmentRevisions.add(artifact.environmentRevision)
        break
      }
      case 'message': {
        const fact = state.messageFacts.find(candidate => candidate.seq === evidence.seq)
        if (fact === undefined) throw new Error(`outcome message evidence seq ${String(evidence.seq)} is missing`)
        if (outcome.publishedAt < fact.time) {
          throw new Error('Science outcome publication time precedes cited message evidence')
        }
        break
      }
    }
  }
  if (citedEnvironmentRevisions.size !== outcome.environmentRevisions.length
    || outcome.environmentRevisions.some(revision => !citedEnvironmentRevisions.has(revision))) {
    throw new Error('outcome environmentRevisions must exactly match cited run and chart evidence')
  }
  state.outcomes.push(outcome)
  state.consumedToolCallSeqs.push(toolCall.seq)
}

/**
 * Test whether a replayed kernel record is a still-open `started` fact, never matched by an `exited` fact or end-seed derivation.
 * @param record - kernel record from the strict replay accumulator.
 * @returns whether `record` is an open `started` kernel.
 */
export function isOpenKernel(record: ScienceKernel): record is ScienceKernelState & { readonly state: 'started' } {
  return record.state === 'started'
}

/**
 * Compare an exited kernel-state fact's start-owned fields against the open
 * `started` fact it closes. `kernelEpoch`/`language` are already matched by
 * the fold's lookup; this additionally proves the exited fact carries the
 * same provenance the started fact fixed, mirroring `sameRunIdentity`.
 */
function sameKernelIdentity(started: ScienceKernelState, exited: ScienceKernelState): boolean {
  return started.kernelEpoch === exited.kernelEpoch
    && started.language === exited.language
    && started.environmentRevision === exited.environmentRevision
    && started.environmentFingerprint === exited.environmentFingerprint
}

function applyKernelState(state: ScienceFoldState, event: Extract<DecodedScienceDomainEvent, { type: 'science/kernel-state' }>): void {
  if (state.mode === undefined) throw new Error('Science kernel state requires a prior mode binding')
  const kernel = event.data.kernel
  if (kernel.at > event.time) throw new Error('Science kernel state time cannot follow its event time')
  const latestForLanguage = state.kernels.filter(candidate => candidate.language === kernel.language).at(-1)
  if (kernel.state === 'started') {
    if (latestForLanguage !== undefined && isOpenKernel(latestForLanguage)) {
      throw new Error(`Science kernel for language ${JSON.stringify(kernel.language)} is already started at epoch ${String(latestForLanguage.kernelEpoch)}`)
    }
    if (kernel.kernelEpoch <= state.kernelEpochWatermark) {
      throw new Error(`Science kernel epoch ${String(kernel.kernelEpoch)} does not exceed the session's prior kernel epoch ${String(state.kernelEpochWatermark)}`)
    }
    requireLatestAppliedBinding(state, kernel.environmentRevision, kernel.language, kernel.environmentFingerprint, 'Science kernel started fact')
    state.kernels.push(kernel)
    state.kernelEpochWatermark = kernel.kernelEpoch
    return
  }
  if (latestForLanguage === undefined || !isOpenKernel(latestForLanguage) || latestForLanguage.kernelEpoch !== kernel.kernelEpoch) {
    throw new Error(`Science kernel exited fact for language ${JSON.stringify(kernel.language)} epoch ${String(kernel.kernelEpoch)} has no matching started kernel`)
  }
  if (!sameKernelIdentity(latestForLanguage, kernel)) {
    throw new Error(`Science kernel exited fact for language ${JSON.stringify(kernel.language)} epoch ${String(kernel.kernelEpoch)} terminal value rewrites start-owned fields`)
  }
  if (kernel.at < latestForLanguage.at) {
    throw new Error(`Science kernel exited fact for language ${JSON.stringify(kernel.language)} epoch ${String(kernel.kernelEpoch)} time precedes its started fact's time`)
  }
  if (kernel.startedAt !== latestForLanguage.at) {
    throw new Error(`Science kernel exited fact for language ${JSON.stringify(kernel.language)} epoch ${String(kernel.kernelEpoch)} startedAt does not match its started fact's at`)
  }
  const kernelIndex = state.kernels.findIndex(
    candidate => candidate.language === kernel.language && candidate.kernelEpoch === kernel.kernelEpoch,
  )
  /* v8 ignore next -- latestForLanguage above already matched this language/epoch pair by value */
  if (kernelIndex < 0) throw new Error('Science kernel record disappeared during synchronous replay')
  state.kernels[kernelIndex] = kernel
}

function applyDomainEvent(state: ScienceFoldState, event: DecodedScienceDomainEvent): void {
  requireScienceTime(state, event)
  switch (event.type) {
    case 'science/mode-bound':
      if (state.mode !== undefined) throw new Error('Science mode may be bound only once')
      if (state.preModeStepStarted || state.requestHeaders.length > 0 || state.toolCalls.length > 0) {
        throw new Error('Science mode cannot follow pre-mode step/start, request/header, or tool/call facts')
      }
      state.mode = event.data.mode
      state.modeBoundSeq = event.seq
      break
    case 'science/environment-bound': {
      if (state.mode === undefined) throw new Error('Science environment requires a prior mode binding')
      const environment = event.data.environment
      if (environment.revision !== state.environments.length + 1) {
        throw new Error(`environment revision must be ${String(state.environments.length + 1)}`)
      }
      // A2 finding 10: an applied revision may legitimately supersede an
      // earlier one after runs already exist (D6 environment-rebound) — the
      // stale kernel ends and the next run starts on a fresh epoch against
      // the new revision. Only a run genuinely in flight blocks it: rebinding
      // out from under an executing run would leave that run's own committed
      // environmentRevision no longer resolvable as "the latest applied" one.
      if (environment.status === 'applied' && state.runs.some(run => run.status === 'running')) {
        throw new Error('an applied Science environment cannot be bound while a Science run is in progress')
      }
      if (environment.validatedAt > event.time) {
        throw new Error('environment validation time cannot follow its event time')
      }
      state.environments.push(environment)
      break
    }
    case 'science/run-started': applyRunStarted(state, event); break
    case 'science/run-finished': applyRunFinished(state, event); break
    case 'science/artifact-saved': applyArtifactSaved(state, event); break
    case 'science/outcome-published': applyOutcomePublished(state, event); break
    case 'science/kernel-state': applyKernelState(state, event); break
  }
  commitScienceTime(state, event)
}

function applyEndSeed(state: ScienceFoldState, event: SessionEvent<'session/end-seed'>): void {
  const hasOpenRun = state.runs.some(run => run.status === 'running')
  const hasOpenKernel = state.kernels.some(isOpenKernel)
  if (!hasOpenRun && !hasOpenKernel) return
  requireScienceTime(state, event)
  const interruptedIds = new Set<string>(state.runs
    .filter(run => run.status === 'running')
    .map(run => run.runId))
  state.runs = state.runs.map((run): ScienceRun => run.status === 'running'
    ? { ...run, status: 'interrupted', finishedAt: event.time, interruptedAtSeq: event.seq }
    : run)
  state.runFacts = state.runFacts.map(fact => interruptedIds.has(fact.runId)
    ? { ...fact, terminalSeq: event.seq, terminalEventTime: event.time }
    : fact)
  state.kernels = state.kernels.map((kernel): ScienceKernel => isOpenKernel(kernel)
    ? {
      kernelEpoch: kernel.kernelEpoch,
      language: kernel.language,
      state: 'interrupted',
      environmentRevision: kernel.environmentRevision,
      environmentFingerprint: kernel.environmentFingerprint,
      startedAt: kernel.at,
      finishedAt: event.time,
      interruptedAtSeq: event.seq,
    }
    : kernel)
  commitScienceTime(state, event)
}

/**
 * Validate and apply one contiguous Session event to the strict accumulator.
 * @param state - mutable accumulator positioned at `event.seq`.
 * @param event - next Session event in the contiguous log.
 */
export function applyScienceEvent(state: ScienceFoldState, event: SessionEvent): void {
  if (!Number.isSafeInteger(event.seq) || event.seq !== state.nextSeq) {
    throw new Error(`session event seq ${String(event.seq)} is discontinuous; expected ${String(state.nextSeq)}`)
  }
  if (!Number.isSafeInteger(event.time) || event.time < 0) {
    throw new Error(`session event ${String(event.seq)} has an invalid time`)
  }
  const domainEvent = decodeScienceDomainEvent(event)
  if (domainEvent !== undefined) applyDomainEvent(state, domainEvent)
  else {
    switch (event.type) {
      case 'step/start':
        if (state.mode === undefined) state.preModeStepStarted = true
        break
      case 'step/end':
        for (const call of state.toolCalls) {
          if (call.turn === event.data.turn && call.step === event.data.step
            && !state.settledToolCallSeqs.includes(call.seq)) state.settledToolCallSeqs.push(call.seq)
        }
        break
      case 'request/header': state.requestHeaders.push({ seq: event.seq, time: event.time }); break
      case 'tool/call':
        state.toolCalls.push({
          seq: event.seq,
          time: event.time,
          callId: event.data.callId,
          turn: event.data.turn,
          step: event.data.step,
          name: event.data.name,
        })
        break
      case 'user/message':
      case 'assistant/message': state.messageFacts.push({ seq: event.seq, time: event.time }); break
      case 'tool/result':
        state.messageFacts.push({ seq: event.seq, time: event.time })
        for (const call of state.toolCalls) {
          if (call.callId === event.data.message.source.callId
            && !state.settledToolCallSeqs.includes(call.seq)) state.settledToolCallSeqs.push(call.seq)
        }
        break
      case 'session/end-seed': applyEndSeed(state, event); break
      default:
        // SessionEventMap is merge-extensible; unrelated facts do not change Science state.
        break
    }
  }
  state.nextSeq += 1
}
