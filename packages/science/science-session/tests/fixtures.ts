import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { CallId, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import {
  ScienceChartId,
  ScienceEnvironmentProfileId,
  ScienceRunId,
  ScienceScratchKey,
} from '../src/index.ts'
import type {
  ScienceChartVersion,
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
const CODE_SHA = 'c'.repeat(64)
const SCRATCH_KEY = ScienceScratchKey('d'.repeat(64))
export const RUN_ID = ScienceRunId('run-1')
export const CHART_ID = ScienceChartId('chart-1')
export const RUN_CALL_ID = CallId('call-run')
export const CHART_CALL_ID = CallId('call-chart')
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

export const chart = (
  overrides: Partial<ScienceChartVersion> = {},
): ScienceChartVersion => ({
  chartId: CHART_ID,
  logicalName: 'trend',
  version: 1,
  title: 'Trend',
  attachment: {
    attachmentId: AttachmentId('attachment-1'),
    mediaType: 'image/png',
    bytes: 128,
    width: 16,
    height: 9,
    name: 'trend.png',
  },
  runId: RUN_ID,
  toolCallId: CHART_CALL_ID,
  requestHeaderSeq: 2,
  environmentRevision: 1,
  environmentFingerprint: FINGERPRINT,
  createdAt: 169,
  ...overrides,
})

export const outcome = (
  overrides: Partial<ScienceOutcomePublication> = {},
): ScienceOutcomePublication => ({
  revision: 1,
  title: 'Result',
  summaryMarkdown: 'The trend is stable.',
  evidence: [{ kind: 'chart', chartId: CHART_ID, version: 1 }],
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
    toolCall(6, 160, CHART_CALL_ID, 'save_chart'),
    event('science/chart-saved', 7, 170, { version: 1, chart: chart() }),
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
  const chartCall = session.append('tool/call', {
    turn: 1,
    step: 1,
    callId: CHART_CALL_ID,
    name: 'save_chart',
    arguments: '{}',
  })
  if (events.length === 7) return
  const chartSaved = session.append('science/chart-saved', {
    version: 1,
    chart: chart({
      requestHeaderSeq: request.seq,
      createdAt: Math.max(runFinish.time, chartCall.time),
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
      publishedAt: Math.max(chartSaved.time, outcomeCall.time),
    }),
  })
}
