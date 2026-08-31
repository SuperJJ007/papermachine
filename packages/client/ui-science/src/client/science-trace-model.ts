/** Pure Science process projection over conversation nodes and the browser-safe Science projection. */

import type { ConversationNode } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ScienceArtifactId, ScienceClientArtifactVersion, ScienceClientProjection, ScienceClientRun, ScienceKernelEndReason,
  ScienceRunId,
} from '@deepseek-ai/dsh-science-session/types'

/** Stable cross-view anchor vocabulary shared by the trace, trajectory, and artifact viewer. */
export type ScienceTraceAnchor =
  | `turn:${number}` | `call:${string}` | `run:${string}` | `artifact:${string}@${number}` | `seq:${number}`
  | `kernel:${string}:${number}:${'started' | 'exited' | 'interrupted'}`

/** One artifact delta summarized by a turn group. */
interface ScienceTraceArtifactDeltaBase {
  readonly artifactId: ScienceArtifactId
  readonly logicalName: string
  readonly title: string
  readonly version: number
  readonly anchor: ScienceTraceAnchor
}

/** Artifact delta classified without inspecting generated code or prose. */
export type ScienceTraceArtifactDelta = ScienceTraceArtifactDeltaBase & (
  | { readonly action: 'created' | 'curated' }
  | { readonly action: 'advanced'; readonly parentVersion: number }
)

/** One run row inside a turn group. */
export interface ScienceTraceRunRow {
  readonly run: ScienceClientRun
  readonly callId: string
  readonly durationMs?: number | undefined
  readonly failed: boolean
  readonly anchor: ScienceTraceAnchor
}

/** Step classification shared by the strip and expanded list. */
export type ScienceTraceStepKind = 'run' | 'browse' | 'curate' | 'publish' | 'delegate' | 'other'

/** Structured step title; localization belongs to the view. */
export type ScienceTraceStepTitle =
  | { readonly kind: 'run'; readonly language: string }
  | { readonly kind: 'read'; readonly name: string }
  | { readonly kind: 'read-image'; readonly name: string }
  | { readonly kind: 'glob'; readonly pattern: string }
  | { readonly kind: 'grep'; readonly pattern: string }
  | { readonly kind: 'state' }
  | { readonly kind: 'annotate'; readonly name: string; readonly version?: number | undefined; readonly title: string }
  | { readonly kind: 'publish'; readonly title: string }
  | { readonly kind: 'delegate' }
  | { readonly kind: 'tool'; readonly name: string }
  | { readonly kind: 'browse-many'; readonly count: number }

/** One real call, retained separately even when its list row is merged. */
export interface ScienceTraceStepMember {
  readonly callId: string
  /** Logged arguments and result; details are mounted only when requested. */
  readonly argsRaw: string
  readonly result: Extract<ConversationNode, { kind: 'tool-result' }> | undefined
  readonly run: ScienceClientRun | undefined
  readonly title: ScienceTraceStepTitle
  readonly failed: boolean
  readonly anchor: ScienceTraceAnchor
}

/** One expanded list row, possibly containing consecutive non-failed browse calls. */
export interface ScienceTraceStep {
  /** Parallel calls from one assistant step share this number. */
  readonly step: number
  readonly kind: ScienceTraceStepKind
  readonly failed: boolean
  readonly title: ScienceTraceStepTitle
  /** Always contains at least one real call. */
  readonly members: readonly [ScienceTraceStepMember, ...ScienceTraceStepMember[]]
  /** Run elapsed time; absent while running or before the run record arrives. */
  readonly durationMs?: number | undefined
  readonly runStatus?: ScienceClientRun['status'] | undefined
  readonly artifacts: readonly ScienceTraceArtifactDelta[]
  readonly anchor: ScienceTraceAnchor
}

/** One turn's recorded calls and artifact changes. */
export interface ScienceTraceGroup {
  readonly turn: number
  readonly runs: readonly ScienceTraceRunRow[]
  readonly artifacts: readonly ScienceTraceArtifactDelta[]
  readonly failedCount: number
  /** Turn wall time, falling back to completed run durations without a turn end. */
  readonly durationMs?: number | undefined
  readonly steps: readonly ScienceTraceStep[]
  /** Distinct assistant step numbers represented in the displayed rows. */
  readonly stepCount: number
  readonly anchor: ScienceTraceAnchor
}

/** One user or agent dialogue node retained around the grouped work. */
export interface ScienceTraceDialogue {
  readonly actor: 'user'
  readonly turn: number
  readonly text: string
  readonly seq: number
  readonly anchor: ScienceTraceAnchor
}

/** A direct human artifact edit that must not be attributed to the agent. */
export interface ScienceTraceHumanEdit {
  readonly actor: 'user'
  readonly turn: number
  readonly artifact: ScienceClientArtifactVersion & { readonly origin: 'human-edit' }
  readonly anchor: ScienceTraceAnchor
}

/** Environment facts used by kernel lifecycle labels. */
export interface ScienceTraceEnvironment {
  readonly profileId: string
  readonly languages: readonly string[]
  readonly kernels: readonly number[]
  readonly anchor: ScienceTraceAnchor
}

/** One lifecycle marker on the process timeline. */
export interface ScienceTraceKernelMarker {
  readonly kernelEpoch: number
  readonly language: string
  readonly event: 'started' | 'exited' | 'interrupted'
  readonly reason?: ScienceKernelEndReason | undefined
  readonly at: number
  /** Containing turn, otherwise the first later turn, or lastTurn + 1 after all turns. */
  readonly beforeTurn: number
  readonly anchor: ScienceTraceAnchor
}

/** Complete semantic-trace model. */
export interface ScienceTraceModel {
  readonly environment?: ScienceTraceEnvironment
  readonly turns: readonly number[]
  /**
   * User and steering entries in sequence order. Model answers stay in Chat
   * and are never copied into the semantic trace.
   */
  readonly dialogues: readonly ScienceTraceDialogue[]
  readonly groups: readonly ScienceTraceGroup[]
  /** Retained records whose producing calls are absent from the loaded conversation. */
  readonly unassigned: {
    readonly runs: readonly ScienceClientRun[]
    readonly artifacts: readonly ScienceClientArtifactVersion[]
  }
  readonly humanEdits: readonly ScienceTraceHumanEdit[]
  readonly kernelMarkers: readonly ScienceTraceKernelMarker[]
}

function textOf(node: Extract<ConversationNode, { kind: 'user' | 'steering' }>): string {
  return node.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n').trim()
}

function humanEditTurn(
  artifact: ScienceClientArtifactVersion & { readonly origin: 'human-edit' },
  turnTimes: ReadonlyMap<number, { readonly startTime: number; readonly endTime?: number }>,
  lastTurn: number,
): number {
  for (const [turn, timing] of turnTimes) {
    if (artifact.createdAt >= timing.startTime && artifact.createdAt <= (timing.endTime ?? Number.POSITIVE_INFINITY)) return turn
  }
  return lastTurn
}

function runDuration(run: ScienceClientRun): number | undefined {
  return run.status === 'running' ? undefined : Math.max(0, run.finishedAt - run.startedAt)
}

function artifactCallId(
  artifact: { readonly runId?: ScienceRunId; readonly toolCallId: string },
  runs: ReadonlyMap<ScienceRunId, ScienceClientRun>,
): string | undefined {
  return artifact.runId === undefined ? artifact.toolCallId : runs.get(artifact.runId)?.toolCallId
}

interface TraceCall {
  readonly callId: string
  readonly name: string
  readonly argsRaw: string
  readonly turn: number
  readonly step: number
  readonly seq: number
}

function basename(value: string): string {
  return value.slice(Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\')) + 1)
}

function shortTitle(value: string): string {
  return value.length > 40 ? `${value.slice(0, 40)}…` : value
}

function stepKind(name: string): ScienceTraceStepKind {
  switch (name) {
    case 'run_python': case 'run_r': return 'run'
    case 'read': case 'read_image': case 'glob': case 'grep': case 'get_science_state': return 'browse'
    case 'annotate_artifact': return 'curate'
    case 'publish_outcome': return 'publish'
    default: return name.startsWith('subagent') ? 'delegate' : 'other'
  }
}

function stepTitle(call: TraceCall, run: ScienceClientRun | undefined): ScienceTraceStepTitle {
  const fallback = { kind: 'tool', name: call.name } as const
  let args: unknown
  try { args = JSON.parse(call.argsRaw) }
  catch {
    // Model tool arguments may be incomplete or invalid JSON; retain the tool name.
    return fallback
  }
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return fallback
  switch (call.name) {
    case 'run_python': case 'run_r':
      return { kind: 'run', language: run?.language ?? (call.name === 'run_r' ? 'r' : 'python') }
    case 'read': case 'read_image':
      return 'file_path' in args && typeof args.file_path === 'string'
        ? { kind: call.name === 'read' ? 'read' : 'read-image', name: basename(args.file_path) } : fallback
    case 'glob': case 'grep': {
      if (!('pattern' in args) || typeof args.pattern !== 'string') return fallback
      const pattern = args.pattern
      return { kind: call.name, pattern: /^(?:[/\\]|[a-z]:[/\\])/iu.test(pattern) ? basename(pattern) : pattern }
    }
    case 'get_science_state': return { kind: 'state' }
    case 'annotate_artifact':
      return 'logical_name' in args && typeof args.logical_name === 'string'
        && 'title' in args && typeof args.title === 'string'
        ? { kind: 'annotate', name: basename(args.logical_name),
          version: 'version' in args && typeof args.version === 'number' ? args.version : undefined, title: shortTitle(args.title) } : fallback
    case 'publish_outcome':
      return 'title' in args && typeof args.title === 'string' ? { kind: 'publish', title: shortTitle(args.title) } : fallback
    default: return call.name.startsWith('subagent') ? { kind: 'delegate' } : fallback
  }
}

function mergeBrowseSteps(steps: readonly ScienceTraceStep[]): readonly ScienceTraceStep[] {
  const rows: ScienceTraceStep[] = []
  for (const step of steps) {
    const previous = rows.at(-1)
    if (step.kind === 'browse' && !step.failed && previous?.kind === 'browse' && !previous.failed) {
      const members: [ScienceTraceStepMember, ...ScienceTraceStepMember[]] = [...previous.members, ...step.members]
      rows[rows.length - 1] = { ...previous, title: { kind: 'browse-many', count: members.length },
        members, artifacts: [...previous.artifacts, ...step.artifacts] }
    } else rows.push(step)
  }
  return rows
}

/**
 * Expand every real call into a strip pip without losing merged-row destinations.
 * @param group - One turn's process group.
 * @returns Call-ordered pips pointing at expanded list rows.
 */
export function scienceTracePips(group: ScienceTraceGroup): readonly {
  readonly rowIndex: number
  readonly kind: ScienceTraceStepKind
  readonly failed: boolean
  readonly title: ScienceTraceStepTitle
}[] {
  return group.steps.flatMap((step, rowIndex) => step.members.map(member => ({
    rowIndex, kind: step.kind, failed: member.failed, title: member.title,
  })))
}

/**
 * Build ordered process steps without parsing model prose, source code, or shell text.
 * @param nodes - Assembled conversation nodes.
 * @param science - Current browser-safe Science projection.
 * @param turnTimes - Authoritative turn timing map.
 * @returns Process steps and artifact changes grouped by turn.
 */
export function buildScienceTraceModel(
  nodes: readonly ConversationNode[],
  science: ScienceClientProjection,
  turnTimes: ReadonlyMap<number, { readonly startTime: number; readonly endTime?: number }>,
): ScienceTraceModel {
  const callTurns = new Map<string, number>()
  const calls = new Map<string, TraceCall>()
  const results = new Map<string, Extract<ConversationNode, { kind: 'tool-result' }>>()
  const assistantTurns = new Set<number>()
  const dialogues: ScienceTraceDialogue[] = []
  let inferredTurn = 0
  for (const node of nodes) {
    if (node.kind === 'user') {
      const text = textOf(node)
      if (text === '') continue
      inferredTurn = node.turn ?? inferredTurn + 1
      dialogues.push({ actor: 'user', turn: inferredTurn, text, seq: node.seq, anchor: `seq:${node.seq}` })
      continue
    }
    if (node.kind === 'steering') {
      const text = textOf(node)
      if (text !== '') dialogues.push({ actor: 'user', turn: node.turn ?? Math.max(1, inferredTurn), text, seq: node.seq, anchor: `seq:${node.seq}` })
      continue
    }
    if (node.kind === 'tool-result') results.set(node.callId, node)
    if (node.kind !== 'assistant') continue
    inferredTurn = Math.max(inferredTurn, node.turn)
    assistantTurns.add(node.turn)
    for (const block of node.blocks) {
      if (block.kind === 'tool-call') {
        callTurns.set(block.callId, node.turn)
        calls.set(block.callId, { ...block, turn: node.turn, step: node.step, seq: node.seq })
      }
    }
  }

  const lastTurn = Math.max(1, inferredTurn)
  const runsById = new Map(science.runs.map(run => [run.runId, run]))
  const artifactsByTurn = new Map<number, {
    artifact: Exclude<ScienceClientArtifactVersion, { origin: 'human-edit' }>
    callId: string
  }[]>()
  const humanEdits: ScienceTraceHumanEdit[] = []
  const unassigned: { runs: ScienceClientRun[]; artifacts: ScienceClientArtifactVersion[] } = { runs: [], artifacts: [] }
  const seenVersions = new Set<string>()
  for (const artifact of science.artifacts) {
    if (artifact.origin === 'human-edit') {
      const turn = humanEditTurn(artifact, turnTimes, lastTurn)
      humanEdits.push({ actor: 'user', turn, artifact, anchor: `artifact:${artifact.artifactId}@${artifact.version}` })
      continue
    }
    const callId = artifactCallId(artifact, runsById)
    const turn = callId === undefined ? undefined : callTurns.get(callId)
    if (callId === undefined || turn === undefined) {
      unassigned.artifacts.push(artifact)
      continue
    }
    const list = artifactsByTurn.get(turn) ?? []
    list.push({ artifact, callId })
    artifactsByTurn.set(turn, list)
  }

  const runsByTurn = new Map<number, ScienceClientRun[]>()
  const runsByCall = new Map(science.runs.map(run => [run.toolCallId as string, run]))
  for (const run of science.runs) {
    const turn = callTurns.get(run.toolCallId)
    if (turn === undefined) {
      unassigned.runs.push(run)
      continue
    }
    const list = runsByTurn.get(turn) ?? []
    list.push(run)
    runsByTurn.set(turn, list)
  }

  const turns = [...new Set([
    ...dialogues.map(item => item.turn), ...assistantTurns, ...runsByTurn.keys(),
    ...artifactsByTurn.keys(), ...humanEdits.map(item => item.turn),
  ])].sort((a, b) => a - b)
  const orderedCalls = [...calls.values()].sort((a, b) => a.seq - b.seq)
  const groups = turns.map((turn): ScienceTraceGroup => {
    const runRows = (runsByTurn.get(turn) ?? []).map((run): ScienceTraceRunRow => ({
      run, callId: run.toolCallId, durationMs: runDuration(run), failed: run.status !== 'running' && run.status !== 'success',
      anchor: `run:${run.runId}`,
    }))
    const artifactsByCall = new Map<string, ScienceTraceArtifactDelta[]>()
    const artifacts = (artifactsByTurn.get(turn) ?? []).map(({ artifact, callId }): ScienceTraceArtifactDelta => {
      const key = `${artifact.artifactId}@${artifact.version}`
      const curated = seenVersions.has(key)
      seenVersions.add(key)
      const base = {
        artifactId: artifact.artifactId, logicalName: basename(artifact.logicalName), title: artifact.title,
        version: artifact.version,
        anchor: `artifact:${artifact.artifactId}@${artifact.version}` as const,
      } satisfies ScienceTraceArtifactDeltaBase
      const delta: ScienceTraceArtifactDelta = curated ? { ...base, action: 'curated' }
        : artifact.parent === undefined ? { ...base, action: 'created' }
          : { ...base, action: 'advanced', parentVersion: artifact.parent.version }
      const list = artifactsByCall.get(callId) ?? []
      list.push(delta)
      artifactsByCall.set(callId, list)
      return delta
    })
    const turnCalls = orderedCalls.filter(call => call.turn === turn)
    const steps = turnCalls.map((call): ScienceTraceStep => {
      const run = runsByCall.get(call.callId)
      const result = results.get(call.callId)
      const failed = run === undefined ? result?.isError ?? false : run.status !== 'running' && run.status !== 'success'
      const anchor = `call:${call.callId}` as const
      const title = stepTitle(call, run)
      return { step: call.step, kind: stepKind(call.name), failed, title,
        members: [{ callId: call.callId, argsRaw: call.argsRaw, result, run, title, failed, anchor }],
        durationMs: run === undefined ? undefined : runDuration(run), runStatus: run?.status,
        artifacts: artifactsByCall.get(call.callId) ?? [], anchor }
    })
    const durations = runRows.flatMap(row => row.durationMs === undefined ? [] : [row.durationMs])
    const timing = turnTimes.get(turn)
    const displayedSteps = mergeBrowseSteps(steps)
    return {
      turn, runs: runRows, artifacts, failedCount: steps.filter(step => step.failed).length,
      durationMs: timing?.endTime === undefined
        ? durations.length === 0 ? undefined : durations.reduce((sum, value) => sum + value, 0)
        : Math.max(0, timing.endTime - timing.startTime),
      steps: displayedSteps, stepCount: new Set(steps.map(step => step.step)).size, anchor: `turn:${turn}`,
    }
  }).filter(group => group.steps.length > 0 || group.artifacts.length > 0)

  const environment = science.environment === null ? undefined : {
    profileId: science.environment.profileId,
    languages: [science.environment.python === undefined ? undefined : 'Python', science.environment.r === undefined ? undefined : 'R']
      .filter((value): value is string => value !== undefined),
    kernels: [...new Set(science.kernels.map(kernel => kernel.kernelEpoch))],
    anchor: `seq:${science.lastScienceEventSeq}` as const,
  }
  const kernelMarkers: ScienceTraceKernelMarker[] = []
  for (const kernel of science.kernels) {
    const marker = (event: ScienceTraceKernelMarker['event'], at: number, reason?: ScienceKernelEndReason): ScienceTraceKernelMarker => ({
      kernelEpoch: kernel.kernelEpoch, language: kernel.language, event, at, reason,
      beforeTurn: turns.find((turn) => {
        const timing = turnTimes.get(turn)
        return timing !== undefined && timing.startTime <= at && at <= (timing.endTime ?? Number.POSITIVE_INFINITY)
      }) ?? turns.find(turn => (turnTimes.get(turn)?.startTime ?? Number.NEGATIVE_INFINITY) > at) ?? lastTurn + 1,
      anchor: `kernel:${kernel.language}:${kernel.kernelEpoch}:${event}`,
    })
    // The projection guarantees startedAt on every exited or interrupted epoch.
    kernelMarkers.push(marker('started', kernel.state === 'started' ? kernel.at : kernel.startedAt as number))
    if (kernel.state === 'exited') kernelMarkers.push(marker('exited', kernel.at, kernel.reason))
    if (kernel.state === 'interrupted') kernelMarkers.push(marker('interrupted', kernel.finishedAt))
  }
  kernelMarkers.sort((a, b) => a.at - b.at)
  return environment === undefined
    ? { turns, dialogues, groups, unassigned, humanEdits, kernelMarkers }
    : { environment, turns, dialogues, groups, unassigned, humanEdits, kernelMarkers }
}
