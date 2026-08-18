import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { CallId, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import {
  ScienceArtifactId,
  ScienceEnvironmentProfileId,
  ScienceRunId,
  ScienceScratchKey,
} from '../src/index.ts'
import type {
  ScienceArtifactVersion,
  ScienceEnvironmentBinding,
  ScienceInterpreterAvailableBinding,
  ScienceInterpreterUnavailableBinding,
  ScienceModeRef,
  ScienceOutcomePublication,
  ScienceRunStarted,
  ScienceRunTerminal,
} from '../src/index.ts'

const HISTORY_SHA = 'a'.repeat(64)
export const FINGERPRINT = 'b'.repeat(64)
export const PACKAGES_SHA = 'f'.repeat(64)
const CODE_SHA = 'c'.repeat(64)
const SCRATCH_KEY = ScienceScratchKey('d'.repeat(64))
export const RUN_ID = ScienceRunId('run-1')
export const ARTIFACT_ID = ScienceArtifactId('artifact-1')
export const RUN_CALL_ID = CallId('call-run')
export const ARTIFACT_CALL_ID = CallId('call-chart')
export const OUTCOME_CALL_ID = CallId('call-outcome')

export const interpreter = (
  overrides: Partial<ScienceInterpreterAvailableBinding> = {},
): ScienceInterpreterAvailableBinding => ({
  language: 'python',
  configuredPrefix: '/opt/science',
  canonicalPrefix: '/opt/science',
  executable: '/opt/science/bin/python',
  executableIdentity: 'dev:1-ino:2',
  languageVersion: '3.13.5',
  condaHistorySha256: HISTORY_SHA,
  bindingFingerprint: FINGERPRINT,
  packages: [{ name: 'pip', version: '24.0' }],
  packagesSha256: PACKAGES_SHA,
  packagesTruncated: false,
  capability: 'available',
  ...overrides,
})

export const failedInterpreter = (
  capability: ScienceInterpreterUnavailableBinding['capability'],
  overrides: Partial<ScienceInterpreterUnavailableBinding> = {},
): ScienceInterpreterUnavailableBinding => ({
  language: 'python',
  configuredPrefix: '/opt/science',
  capability,
  reason: `${capability} binding`,
  ...overrides,
})

export const mode = (): ScienceModeRef => ({
  modeId: 'science',
  presetId: 'science',
  modeRevision: 'r3',
})

export const environment = (
  overrides: Partial<ScienceEnvironmentBinding> = {},
): ScienceEnvironmentBinding => ({
  revision: 1,
  profileId: ScienceEnvironmentProfileId('profile-1'),
  configuredAt: 101,
  validatedAt: 109,
  status: 'applied',
  python: interpreter(),
  ...overrides,
})

export const environmentWithoutPython = (
  overrides: Partial<Omit<ScienceEnvironmentBinding, 'python'>> = {},
): ScienceEnvironmentBinding => {
  const { python: _python, ...withoutPython } = environment()
  return { ...withoutPython, ...overrides }
}

export const runStarted = (
  overrides: Partial<ScienceRunStarted> = {},
): ScienceRunStarted => ({
  runId: RUN_ID,
  language: 'python',
  toolCallId: RUN_CALL_ID,
  requestHeaderSeq: 2,
  environmentRevision: 1,
  environmentFingerprint: FINGERPRINT,
  startedAt: 139,
  codeSha256: CODE_SHA,
  scratchKey: SCRATCH_KEY,
  runDirectoryRef: 'runs/run-1/',
  status: 'running',
  ...overrides,
})

export const runTerminal = (
  overrides: Partial<ScienceRunTerminal> = {},
): ScienceRunTerminal => ({
  ...runStarted(),
  status: 'success',
  finishedAt: 149,
  exitCode: 0,
  stdoutBytes: 12,
  stderrBytes: 0,
  stdoutTruncated: false,
  stderrTruncated: false,
  ...overrides,
})

export const artifact = (
  overrides: Partial<ScienceArtifactVersion> = {},
): ScienceArtifactVersion => ({
  artifactId: ARTIFACT_ID,
  logicalName: 'trend',
  version: 1,
  title: 'Trend',
  origin: 'model',
  attachment: {
    attachmentId: AttachmentId('attachment-1'),
    mediaType: 'image/png',
    bytes: 128,
    width: 16,
    height: 9,
    name: 'trend.png',
  },
  runId: RUN_ID,
  toolCallId: ARTIFACT_CALL_ID,
  requestHeaderSeq: 2,
  environmentRevision: 1,
  environmentFingerprint: FINGERPRINT,
  createdAt: 169,
  ...overrides,
})

/** A durable auto-captured artifact version: carries its source run's own toolCallId/requestHeaderSeq, never a curation call's. */
export const autoArtifact = (
  overrides: Partial<ScienceArtifactVersion> = {},
): ScienceArtifactVersion => artifact({
  logicalName: 'summary.csv',
  title: 'summary.csv',
  origin: 'auto',
  attachment: {
    attachmentId: AttachmentId('attachment-2'),
    mediaType: 'text/csv',
    bytes: 32,
    name: 'summary.csv',
  },
  toolCallId: RUN_CALL_ID,
  ...overrides,
})

export const outcome = (
  overrides: Partial<ScienceOutcomePublication> = {},
): ScienceOutcomePublication => ({
  revision: 1,
  title: 'Result',
  summaryMarkdown: 'The trend is stable.',
  evidence: [{ kind: 'chart', chartId: ARTIFACT_ID, version: 1 }],
  publishedAt: 179,
  toolCallId: OUTCOME_CALL_ID,
  requestHeaderSeq: 2,
  environmentRevisions: [1],
  ...overrides,
})

export function event(type: string, seq: number, time: number, data: unknown): SessionEvent {
  return { type, seq, time, data } as unknown as SessionEvent
}

export function toolResult(
  seq: number,
  time: number,
  callId: ReturnType<typeof CallId>,
): SessionEvent {
  return event('tool/result', seq, time, {
    turn: 1,
    step: 1,
    message: createToolResultMessage({
      callId,
      content: [{ type: 'text', text: 'done' }],
      isError: false,
    }),
  })
}

export function toolCall(
  seq: number,
  time: number,
  callId: ReturnType<typeof CallId>,
  name: string,
  coordinates: { readonly turn: number; readonly step: number } = { turn: 1, step: 1 },
): SessionEvent {
  return event('tool/call', seq, time, {
    ...coordinates,
    callId,
    name,
    arguments: '{}',
  })
}

export function legalEvents(): SessionEvent[] {
  return [
    event('science/mode-bound', 0, 100, { version: 1, mode: mode() }),
    event('science/environment-bound', 1, 110, { version: 1, environment: environment() }),
    event('request/header', 2, 120, {
      header: { config: { provider: 'test', model: 'test-model' } },
      reason: 'initial',
    }),
    toolCall(3, 130, RUN_CALL_ID, 'run_python'),
    event('science/run-started', 4, 140, { version: 1, run: runStarted() }),
    event('science/run-finished', 5, 150, { version: 1, run: runTerminal() }),
    toolCall(6, 160, ARTIFACT_CALL_ID, 'annotate_artifact'),
    event('science/artifact-saved', 7, 170, { version: 1, artifact: artifact() }),
    toolCall(8, 175, OUTCOME_CALL_ID, 'publish_outcome'),
    event('science/outcome-published', 9, 180, { version: 1, outcome: outcome() }),
  ]
}

/** Append fixture events through the real Session acceptance path. */
export function appendFixtureEvents(
  session: Session,
  events: readonly SessionEvent[] = legalEvents(),
): void {
  const expected = legalEvents().slice(0, events.length)
  if (events.length > 10 || events.some((candidate, index) => candidate.type !== expected[index]?.type)) {
    throw new Error('appendFixtureEvents accepts only a prefix of legalEvents()')
  }
  if (events.length === 0) return

  const modeBound = session.append('science/mode-bound', { version: 1, mode: mode() })
  if (events.length === 1) return
  session.append('science/environment-bound', {
    version: 1,
    environment: environment({
      configuredAt: modeBound.time,
      validatedAt: modeBound.time,
    }),
  })
  if (events.length === 2) return
  const request = session.append('request/header', {
    header: { config: { provider: 'test', model: 'test-model' } },
    reason: 'initial',
  })
  if (events.length === 3) return
  const runCall = session.append('tool/call', {
    turn: 1,
    step: 1,
    callId: RUN_CALL_ID,
    name: 'run_python',
    arguments: '{}',
  })
  if (events.length === 4) return
  const run = runStarted({
    requestHeaderSeq: request.seq,
    startedAt: runCall.time,
  })
  const runStart = session.append('science/run-started', { version: 1, run })
  if (events.length === 5) return
  const runFinish = session.append('science/run-finished', {
    version: 1,
    run: runTerminal({
      ...run,
      status: 'success',
      finishedAt: runStart.time,
    }),
  })
  if (events.length === 6) return
  const artifactCall = session.append('tool/call', {
    turn: 1,
    step: 1,
    callId: ARTIFACT_CALL_ID,
    name: 'annotate_artifact',
    arguments: '{}',
  })
  if (events.length === 7) return
  const artifactSaved = session.append('science/artifact-saved', {
    version: 1,
    artifact: artifact({
      requestHeaderSeq: request.seq,
      createdAt: Math.max(runFinish.time, artifactCall.time),
    }),
  })
  if (events.length === 8) return
  const outcomeCall = session.append('tool/call', {
    turn: 1,
    step: 1,
    callId: OUTCOME_CALL_ID,
    name: 'publish_outcome',
    arguments: '{}',
  })
  if (events.length === 9) return
  session.append('science/outcome-published', {
    version: 1,
    outcome: outcome({
      requestHeaderSeq: request.seq,
      publishedAt: Math.max(artifactSaved.time, outcomeCall.time),
    }),
  })
}
