/** Pure Science semantic-trace projection over conversation nodes and the browser-safe Science projection. */

import type { ConversationNode } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ScienceArtifactId, ScienceClientArtifactVersion, ScienceClientProjection, ScienceClientRun,
} from '@deepseek-ai/dsh-science-session/types'

/** Stable cross-view anchor vocabulary shared by the trace, trajectory, and artifact viewer. */
export type ScienceTraceAnchor =
  | `turn:${number}` | `call:${string}` | `run:${string}` | `artifact:${string}@${number}` | `seq:${number}`

/** One artifact delta summarized by an intent group. */
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

/** Structured title selected for one intent group. */
export type ScienceTraceGroupTitle =
  | { readonly kind: 'selected-edit'; readonly name: string }
  | { readonly kind: 'edit'; readonly name: string; readonly version: number }
  | { readonly kind: 'generate'; readonly name: string; readonly count: number }
  | { readonly kind: 'curate'; readonly name: string; readonly artifactTitle: string }
  | { readonly kind: 'run'; readonly language: string }
  | { readonly kind: 'browse' }

/** One run row inside an intent group. */
export interface ScienceTraceRunRow {
  readonly run: ScienceClientRun
  readonly callId: string
  readonly durationMs?: number | undefined
  readonly failed: boolean
  readonly anchor: ScienceTraceAnchor
}

/** One turn-sized semantic intent group. */
export interface ScienceTraceGroup {
  readonly turn: number
  readonly title: ScienceTraceGroupTitle
  readonly runs: readonly ScienceTraceRunRow[]
  readonly artifacts: readonly ScienceTraceArtifactDelta[]
  readonly failedCount: number
  readonly durationMs?: number | undefined
  readonly miscToolCount: number
  readonly delegatedCallIds: readonly string[]
  readonly anchor: ScienceTraceAnchor
}

/** One user or agent dialogue node retained around the grouped work. */
export interface ScienceTraceDialogue {
  readonly actor: 'user' | 'agent'
  readonly turn: number
  readonly text: string
  readonly seq: number
  readonly selection: boolean
  readonly anchor: ScienceTraceAnchor
}

/** A direct human artifact edit that must not be attributed to the agent. */
export interface ScienceTraceHumanEdit {
  readonly actor: 'user'
  readonly turn: number
  readonly artifact: ScienceClientArtifactVersion & { readonly origin: 'human-edit' }
  readonly anchor: ScienceTraceAnchor
}

/** Environment and current kernel summary shown once above the intent groups. */
export interface ScienceTraceEnvironment {
  readonly profileId: string
  readonly languages: readonly string[]
  readonly kernels: readonly number[]
  readonly anchor: ScienceTraceAnchor
}

/** Complete semantic-trace model. */
export interface ScienceTraceModel {
  readonly environment?: ScienceTraceEnvironment
  readonly turns: readonly number[]
  /**
   * User/steering entries in sequence order, followed by one agent
   * conclusion per turn in turn order. Agent conclusions are appended after
   * all dialogue entries; the array is not seq-interleaved with
   * conclusions.
   */
  readonly dialogues: readonly ScienceTraceDialogue[]
  readonly groups: readonly ScienceTraceGroup[]
  readonly humanEdits: readonly ScienceTraceHumanEdit[]
}

function textOf(node: Extract<ConversationNode, { kind: 'user' | 'steering' }>): string {
  return node.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n').trim()
}

function sourceKind(source: unknown): string | undefined {
  if (typeof source !== 'object' || source === null || !('kind' in source)) return undefined
  return typeof source.kind === 'string' ? source.kind : undefined
}

function artifactTurn(
  artifact: ScienceClientArtifactVersion,
  callTurns: ReadonlyMap<string, number>,
  turnTimes: ReadonlyMap<number, { readonly startTime: number; readonly endTime?: number }>,
  lastTurn: number,
): number {
  if (artifact.origin !== 'human-edit') return callTurns.get(artifact.toolCallId) ?? lastTurn
  for (const [turn, timing] of turnTimes) {
    if (artifact.createdAt >= timing.startTime && artifact.createdAt <= (timing.endTime ?? Number.POSITIVE_INFINITY)) return turn
  }
  return lastTurn
}

function runDuration(run: ScienceClientRun): number | undefined {
  return run.status === 'running' ? undefined : Math.max(0, run.finishedAt - run.startedAt)
}

/**
 * Build the trace's turn groups without parsing model prose, source code, or shell text.
 * @param nodes - assembled conversation nodes.
 * @param science - current browser-safe Science projection.
 * @param turnTimes - authoritative turn timing map.
 * @returns semantic trace grouped by turn.
 */
export function buildScienceTraceModel(
  nodes: readonly ConversationNode[],
  science: ScienceClientProjection,
  turnTimes: ReadonlyMap<number, { readonly startTime: number; readonly endTime?: number }>,
): ScienceTraceModel {
  const callTurns = new Map<string, number>()
  const calls = new Map<string, { readonly name: string; readonly turn: number }>()
  const dialogues: ScienceTraceDialogue[] = []
  const conclusions = new Map<number, ScienceTraceDialogue>()
  let inferredTurn = 0
  for (const node of nodes) {
    if (node.kind === 'user') {
      const text = textOf(node)
      if (text === '') continue
      inferredTurn += 1
      dialogues.push({ actor: 'user', turn: inferredTurn, text, seq: node.seq,
        selection: sourceKind(node.source) === 'science-edit', anchor: `seq:${node.seq}` })
      continue
    }
    if (node.kind === 'steering') {
      const text = textOf(node)
      if (text !== '') dialogues.push({ actor: 'user', turn: Math.max(1, inferredTurn), text, seq: node.seq,
        selection: sourceKind(node.source) === 'science-edit', anchor: `seq:${node.seq}` })
      continue
    }
    if (node.kind !== 'assistant') continue
    inferredTurn = Math.max(inferredTurn, node.turn)
    for (const block of node.blocks) {
      if (block.kind === 'tool-call') {
        callTurns.set(block.callId, node.turn)
        calls.set(block.callId, { name: block.name, turn: node.turn })
      }
    }
    const answer = [...node.blocks].reverse().find(block => block.kind === 'text' && block.text.trim() !== '')
    if (answer?.kind === 'text') conclusions.set(node.turn, {
      actor: 'agent', turn: node.turn, text: answer.text.trim(), seq: node.seq,
      selection: false, anchor: `seq:${node.seq}`,
    })
  }
  dialogues.push(...conclusions.values())

  const lastTurn = Math.max(1, inferredTurn)
  const artifactsByTurn = new Map<number, ScienceClientArtifactVersion[]>()
  const humanEdits: ScienceTraceHumanEdit[] = []
  const seenVersions = new Set<string>()
  for (const artifact of science.artifacts) {
    const turn = artifactTurn(artifact, callTurns, turnTimes, lastTurn)
    if (artifact.origin === 'human-edit') {
      humanEdits.push({ actor: 'user', turn, artifact, anchor: `artifact:${artifact.artifactId}@${artifact.version}` })
      continue
    }
    const list = artifactsByTurn.get(turn) ?? []
    list.push(artifact)
    artifactsByTurn.set(turn, list)
  }

  const runsByTurn = new Map<number, ScienceClientRun[]>()
  for (const run of science.runs) {
    const turn = callTurns.get(run.toolCallId) ?? lastTurn
    const list = runsByTurn.get(turn) ?? []
    list.push(run)
    runsByTurn.set(turn, list)
  }

  const turns = [...new Set([
    ...dialogues.map(item => item.turn), ...runsByTurn.keys(), ...artifactsByTurn.keys(), ...humanEdits.map(item => item.turn),
  ])].sort((a, b) => a - b)
  const selectionTurns = new Set(dialogues.filter(item => item.selection).map(item => item.turn))
  const groups = turns.map((turn): ScienceTraceGroup => {
    const runRows = (runsByTurn.get(turn) ?? []).map((run): ScienceTraceRunRow => ({
      run, callId: run.toolCallId, durationMs: runDuration(run), failed: run.status !== 'running' && run.status !== 'success',
      anchor: `run:${run.runId}`,
    }))
    const artifacts = (artifactsByTurn.get(turn) ?? []).map((artifact): ScienceTraceArtifactDelta => {
      const key = `${artifact.artifactId}@${artifact.version}`
      const curated = seenVersions.has(key)
      seenVersions.add(key)
      const base = {
        artifactId: artifact.artifactId, logicalName: artifact.logicalName, title: artifact.title,
        version: artifact.version,
        anchor: `artifact:${artifact.artifactId}@${artifact.version}` as const,
      } satisfies ScienceTraceArtifactDeltaBase
      if (curated) return { ...base, action: 'curated' }
      if (artifact.parent === undefined) return { ...base, action: 'created' }
      return { ...base, action: 'advanced', parentVersion: artifact.parent.version }
    })
    const turnCalls = [...calls.entries()].filter(([, call]) => call.turn === turn)
    const runCallIds = new Set(runRows.map(row => row.callId))
    const delegatedCallIds = turnCalls.filter(([, call]) => call.name.startsWith('subagent')).map(([callId]) => callId)
    const miscToolCount = turnCalls.filter(([callId, call]) => !runCallIds.has(callId) && !call.name.startsWith('subagent')).length
    const firstAdvanced = artifacts.find((item): item is ScienceTraceArtifactDelta & { readonly action: 'advanced' } =>
      item.action === 'advanced')
    const firstCreated = artifacts.find(item => item.action === 'created')
    const firstCurated = artifacts.find(item => item.action === 'curated')
    const firstRun = runRows[0]
    let title: ScienceTraceGroup['title']
    if (firstAdvanced !== undefined) {
      title = selectionTurns.has(turn)
        ? { kind: 'selected-edit', name: firstAdvanced.logicalName }
        : { kind: 'edit', name: firstAdvanced.logicalName, version: firstAdvanced.parentVersion }
    } else if (firstCreated !== undefined) {
      title = { kind: 'generate', name: firstCreated.logicalName, count: artifacts.length }
    } else if (firstCurated !== undefined) {
      title = { kind: 'curate', name: firstCurated.logicalName, artifactTitle: firstCurated.title }
    } else {
      title = firstRun === undefined ? { kind: 'browse' } : { kind: 'run', language: firstRun.run.language }
    }
    const durations = runRows.flatMap(row => row.durationMs === undefined ? [] : [row.durationMs])
    return {
      turn, title, runs: runRows, artifacts, failedCount: runRows.filter(row => row.failed).length,
      durationMs: durations.length === 0 ? undefined : durations.reduce((sum, value) => sum + value, 0),
      miscToolCount, delegatedCallIds, anchor: `turn:${turn}`,
    }
  }).filter(group => group.runs.length > 0 || group.artifacts.length > 0
    || group.miscToolCount > 0 || group.delegatedCallIds.length > 0)

  const environment = science.environment === null ? undefined : {
    profileId: science.environment.profileId,
    languages: [science.environment.python === undefined ? undefined : 'Python', science.environment.r === undefined ? undefined : 'R']
      .filter((value): value is string => value !== undefined),
    kernels: [...new Set(science.kernels.map(kernel => kernel.kernelEpoch))],
    anchor: `seq:${science.lastScienceEventSeq}` as const,
  }
  return environment === undefined
    ? { turns, dialogues, groups, humanEdits }
    : { environment, turns, dialogues, groups, humanEdits }
}
