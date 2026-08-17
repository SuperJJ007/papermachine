/** Opt-in real Conda acceptance with independent Python/R PASS, FAIL, or NOT-RUN reports. */

import { createHash, randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { CallId } from '@deepseek-ai/dsh-llm'
import { replayScience, ScienceEnvironmentProfileId } from '@deepseek-ai/dsh-science-session'
import type { ScienceLanguage, ScienceOutcomePublication } from '@deepseek-ai/dsh-science-session'
import * as ScienceSessionInvariant from '@deepseek-ai/dsh-science-session/invariant'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import LocalSandboxProvider from '@deepseek-ai/dsh-sandbox-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import ScienceRuntime from '../src/index.ts'
import type { ScienceRunResult } from '../src/types.ts'
import { capturePrefixManifest, diffPrefixManifest } from './prefix-manifest.ts'
import type { PrefixManifestEntry } from './prefix-manifest.ts'

const ENABLE = 'DSH_SCIENCE_RUNTIME_REAL_ACCEPTANCE'
const TEST_OWNED = 'DSH_SCIENCE_RUNTIME_TEST_OWNED'
const DSH_HOME = 'DSH_SCIENCE_RUNTIME_DSH_HOME'
const PYTHON_PREFIX = 'DSH_SCIENCE_RUNTIME_PYTHON_PREFIX'
const R_PREFIX = 'DSH_SCIENCE_RUNTIME_R_PREFIX'
const CANDIDATE_SHA = 'DSH_SCIENCE_RUNTIME_CANDIDATE_SHA'
const AMBIENT_SENTINEL = 'DSH_SCIENCE_RUNTIME_REAL_AMBIENT_SENTINEL'
const TIMEOUT_MS = 5_000
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const PNG = new Uint8Array(Buffer.from(PNG_BASE64, 'base64'))

/** Per-language real acceptance status; fake prefixes never produce this report. */
type RealAcceptanceStatus = 'PASS' | 'FAIL' | 'NOT-RUN'

/** Machine-readable independent language outcome. */
interface LanguageReport {
  /** Terminal status for exactly one requested interpreter language. */
  readonly status: RealAcceptanceStatus
  /** Why the language was not attempted or did not pass. */
  readonly detail: string
  /** Checks that completed before the terminal outcome. */
  readonly checks: readonly string[]
  /** Prefix paths changed according to lstat-only before/after manifests. */
  readonly prefixManifestDifferences?: readonly string[]
}

/** Full real-machine report emitted as one JSON value. */
interface RealAcceptanceReport {
  /** Stable report type for automation. */
  readonly kind: 'dsh-science-runtime-real-acceptance-v2'
  /** Exact clean-archive source candidate supplied by the operator. */
  readonly candidateSha: string | null
  /** Python outcome, never inferred from R. */
  readonly python: LanguageReport
  /** R outcome, never inferred from Python. */
  readonly r: LanguageReport
}

/** Return whether a path is equal to or contained by another canonical-looking path. */
function containsPath(parent: string, child: string): boolean {
  const delta = relative(parent, child)
  return delta === '' || (!delta.startsWith(`..${sep}`) && delta !== '..' && !delta.startsWith(`..${sep}`))
}

/** Refuse a generic temporary-root target before a real run can create scratch there. */
function nonTemporaryHome(path: string): boolean {
  const resolved = resolve(path)
  return !containsPath('/tmp', resolved)
}

/** Convert a bigint stat record to the frozen executable identity string. */
function executableIdentity(info: Awaited<ReturnType<typeof stat>>): string {
  const value = info as Awaited<ReturnType<typeof stat>> & {
    readonly dev: bigint
    readonly ino: bigint
    readonly mode: bigint
    readonly size: bigint
    readonly mtimeNs: bigint
    readonly ctimeNs: bigint
  }
  return `stat-v1\0${process.platform}\0${String(value.dev)}\0${String(value.ino)}\0${String(value.mode)}\0${String(value.size)}\0${String(value.mtimeNs)}\0${String(value.ctimeNs)}`
}

/** Compute the ordinary lowercase SHA-256 for one exact file byte slice. */
function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Add one valid authorization immediately before a real Science mutation. */
function authorize(session: import('@deepseek-ai/dsh-session').Session, name: string, turn: number) {
  session.append('step/start', { turn, step: 1 })
  const header = session.append('request/header', {
    header: { config: { provider: 'real-acceptance', model: 'local-conda' } },
    reason: 'initial',
  })
  const toolCallId = CallId(`science-real-${name}-${String(turn)}-${randomUUID()}`)
  session.append('tool/call', {
    turn,
    step: 1,
    callId: toolCallId,
    name,
    arguments: '{}',
  })
  return { toolCallId, requestHeaderSeq: header.seq }
}

/** Source that proves a direct, scrubbed, owned working environment without printing Host paths. */
function successSource(language: ScienceLanguage, prefix: string): string {
  if (language === 'python') {
    return [
      'import base64',
      'import os',
      'from pathlib import Path',
      `assert os.environ.get(${JSON.stringify(AMBIENT_SENTINEL)}) is None`,
      `assert os.environ['PATH'] == ${JSON.stringify(`${join(prefix, 'bin')}:/usr/bin:/bin`)}`,
      "assert Path.cwd().is_dir() and Path(os.environ['HOME']).is_dir() and Path(os.environ['TMPDIR']).is_dir()",
      "assert Path(os.environ['SCIENCE_STATE_DIR']).is_dir() and Path(os.environ['SCIENCE_ARTIFACT_DIR']).is_dir()",
      `Path(os.environ['SCIENCE_ARTIFACT_DIR'], 'real-chart.png').write_bytes(base64.b64decode(${JSON.stringify(PNG_BASE64)}))`,
      'print("dsh-real-运行-✓")',
      '',
    ].join('\n')
  }
  return [
    `stopifnot(Sys.getenv(${JSON.stringify(AMBIENT_SENTINEL)}) == "")`,
    `stopifnot(Sys.getenv("PATH") == ${JSON.stringify(`${join(prefix, 'bin')}:/usr/bin:/bin`)})`,
    'stopifnot(dir.exists(getwd()), dir.exists(Sys.getenv("HOME")), dir.exists(Sys.getenv("TMPDIR")))',
    'stopifnot(dir.exists(Sys.getenv("SCIENCE_STATE_DIR")), dir.exists(Sys.getenv("SCIENCE_ARTIFACT_DIR")))',
    `writeBin(as.raw(c(${[...PNG].join(',')})), file.path(Sys.getenv("SCIENCE_ARTIFACT_DIR"), "real-chart.png"))`,
    'cat("dsh-real-运行-✓\\n")',
    '',
  ].join('\n')
}

/** Source that waits until explicit caller cancellation or the fixed operation deadline. */
function waitingSource(language: ScienceLanguage): string {
  return language === 'python'
    ? 'import time\nwhile True: time.sleep(0.1)\n'
    : 'repeat { Sys.sleep(0.1) }\n'
}

/** Source that attempts one unique write into the configured prefix. */
function deniedWriteSource(language: ScienceLanguage, target: string): string {
  return language === 'python'
    ? `from pathlib import Path\nPath(${JSON.stringify(target)}).write_text("must be denied", encoding="utf-8")\n`
    : `writeLines("must be denied", ${JSON.stringify(target)}, useBytes = TRUE)\n`
}

/** Require one terminal value to carry the expected post-start classification. */
function expectTerminal(result: ScienceRunResult, status: string, failureCode?: string): void {
  if (result.terminal.status !== status || result.terminal.failureCode !== failureCode) {
    throw new Error(`expected ${status}/${failureCode ?? 'none'}, got ${result.terminal.status}/${result.terminal.failureCode ?? 'none'}`)
  }
}

/** Render one unexpected operational error for a machine-readable language report. */
function failureDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Run one real language through binding, successful output, cancellation, timeout, and denied prefix write. */
async function runLanguage(language: ScienceLanguage, prefix: string, dshHome: string): Promise<LanguageReport> {
  const checks: string[] = []
  const context = new Context()
  let before: ReadonlyMap<string, PrefixManifestEntry> | undefined
  let differences: readonly string[] | undefined
  let failed = false
  let failure: unknown
  const recordFailure = (error: unknown): void => {
    if (!failed) {
      failed = true
      failure = error
      return
    }
    failure = new AggregateError([failure, error], 'science-runtime: real acceptance operation and cleanup both failed')
  }
  const originalSentinel = process.env[AMBIENT_SENTINEL]
  try {
    before = await capturePrefixManifest(prefix)
    process.env[AMBIENT_SENTINEL] = `must-not-reach-${randomUUID()}`
    await context.plugin(SessionStore)
    await context.plugin(InvariantRegistry, { enabled: true })
    await context.plugin(ScienceSessionInvariant)
    await context.plugin(LocalAttachmentStore, { dshHome })
    await context.plugin(LocalSubprocessRuntime)
    await context.plugin(LocalSandboxProvider)
    await context.plugin(ScienceRuntime, {
      dshHome,
      timeoutMs: TIMEOUT_MS,
      profiles: {
        real: language === 'python' ? { pythonPrefix: prefix } : { rPrefix: prefix },
      },
    })
    const session = context.sessions.create(SessionId(`science-real-${language}-${randomUUID()}`), {
      meta: { agentPreset: 'science' },
    })
    session.append('science/mode-bound', {
      version: 1,
      mode: { modeId: 'science', presetId: 'science', modeRevision: 'phase-2-real-acceptance' },
    })
    const environment = await context.scienceRuntime.bindEnvironment({
      session,
      profileId: ScienceEnvironmentProfileId('real'),
      signal: new AbortController().signal,
    })
    const binding = language === 'python' ? environment.python : environment.r
    if (environment.status !== 'applied' || binding?.capability !== 'available') {
      throw new Error('binding was not applied with an available interpreter')
    }
    const canonicalPrefix = await realpath(prefix)
    const executable = await realpath(language === 'python'
      ? join(canonicalPrefix, 'bin', 'python')
      : join(canonicalPrefix, 'bin', 'Rscript'))
    const history = await readFile(join(canonicalPrefix, 'conda-meta', 'history'))
    if (binding.canonicalPrefix !== canonicalPrefix || binding.executable !== executable
      || binding.condaHistorySha256 !== sha256(history)
      || binding.executableIdentity !== executableIdentity(await stat(executable, { bigint: true }))) {
      throw new Error('binding did not retain the canonical executable and prefix identity')
    }
    checks.push('canonical executable/version/history identity', 'full confined binding')

    const success = await context.scienceRuntime.startRun({
      session,
      language,
      code: successSource(language, canonicalPrefix),
      ...authorize(session, language === 'python' ? 'run_python' : 'run_r', 1),
      signal: new AbortController().signal,
    })
    const successResult = await success.done
    expectTerminal(successResult, 'success')
    if (!successResult.stdout.text.includes('dsh-real-运行-✓')) {
      throw new Error('successful direct source did not retain required non-ASCII output')
    }
    checks.push('non-ASCII direct source/output', 'scrubbed environment and owned cwd')

    const cancelled = await context.scienceRuntime.startRun({
      session,
      language,
      code: waitingSource(language),
      ...authorize(session, language === 'python' ? 'run_python' : 'run_r', 2),
      signal: new AbortController().signal,
    })
    setTimeout(() => {
      cancelled.cancel()
    }, 100)
    expectTerminal(await cancelled.done, 'cancelled', 'CANCELLED')
    checks.push('cancellation and managed-tree quiescence')

    const timedOut = await context.scienceRuntime.startRun({
      session,
      language,
      code: waitingSource(language),
      ...authorize(session, language === 'python' ? 'run_python' : 'run_r', 3),
      signal: new AbortController().signal,
    })
    expectTerminal(await timedOut.done, 'timed-out', 'TIMEOUT')
    checks.push('timeout and managed-tree quiescence')

    const deniedTarget = join(canonicalPrefix, `.dsh-science-acceptance-denied-${randomUUID()}`)
    const denied = await context.scienceRuntime.startRun({
      session,
      language,
      code: deniedWriteSource(language, deniedTarget),
      ...authorize(session, language === 'python' ? 'run_python' : 'run_r', 4),
      signal: new AbortController().signal,
    })
    expectTerminal(await denied.done, 'failed', 'SANDBOX_DENIED')
    checks.push('configured-prefix write denial')

    const chartAuthorization = authorize(session, 'save_chart', 5)
    const chart = await context.scienceRuntime.commitChart({
      session,
      runId: success.runId,
      artifactPath: 'real-chart.png',
      logicalName: `${language}-real-chart`,
      title: `${language} real acceptance chart`,
      ...chartAuthorization,
      signal: new AbortController().signal,
    })
    const stored = await context.attachments.readImage(chart.attachment)
    if (String(stored.ref.attachmentId) !== String(chart.attachment.attachmentId)
      || !Buffer.from(stored.data).equals(Buffer.from(PNG))) {
      throw new Error('saved chart attachment did not read back with the exact generated PNG bytes')
    }
    checks.push('real PNG artifact creation', 'chart commit and attachment readback')

    const chartProjection = replayScience(session.events)
    const replayedChart = chartProjection?.charts.find(candidate => candidate.chartId === chart.chartId && candidate.version === 1)
    if (replayedChart === undefined || String(replayedChart.attachment.attachmentId) !== String(chart.attachment.attachmentId)) {
      throw new Error('chart event did not replay to the exact committed attachment')
    }
    checks.push('chart replay')

    const outcomeAuthorization = authorize(session, 'publish_outcome', 6)
    const outcome: ScienceOutcomePublication = {
      revision: 1,
      title: `${language} real acceptance outcome`,
      summaryMarkdown: 'The real interpreter produced and saved the cited chart.',
      evidence: [
        { kind: 'run', runId: success.runId },
        { kind: 'chart', chartId: chart.chartId, version: chart.version },
      ],
      publishedAt: Date.now(),
      ...outcomeAuthorization,
      environmentRevisions: [chart.environmentRevision],
    }
    session.append('science/outcome-published', { version: 1, outcome })
    const outcomeProjection = replayScience(session.events)
    if (outcomeProjection?.outcome?.revision !== 1
      || outcomeProjection.outcome.evidence.length !== 2
      || outcomeProjection.outcome.environmentRevisions[0] !== chart.environmentRevision) {
      throw new Error('Outcome publication did not replay with its run and chart evidence')
    }
    checks.push('Outcome publication and replay')
  } catch (error) {
    recordFailure(error)
  } finally {
    if (originalSentinel === undefined) Reflect.deleteProperty(process.env, AMBIENT_SENTINEL)
    else process.env[AMBIENT_SENTINEL] = originalSentinel
    try {
      await context.fiber.dispose()
    } catch (error) {
      recordFailure(error)
    }
    if (before !== undefined) {
      try {
        const after = await capturePrefixManifest(prefix)
        differences = diffPrefixManifest(before, after).map(difference => difference.path)
      } catch (error) {
        recordFailure(error)
      }
    }
  }
  if (failed) {
    return {
      status: 'FAIL',
      detail: failureDetail(failure),
      checks,
      ...(differences === undefined || differences.length === 0 ? {} : { prefixManifestDifferences: differences }),
    }
  }
  if (differences !== undefined && differences.length > 0) {
    return {
      status: 'FAIL',
      detail: 'configured prefix changed during real acceptance',
      checks,
      prefixManifestDifferences: differences,
    }
  }
  return { status: 'PASS', detail: 'all selected real acceptance checks passed', checks }
}

/** Create an explicit no-side-effect report for a language whose prerequisites are absent. */
function notRun(detail: string): LanguageReport {
  return { status: 'NOT-RUN', detail, checks: [] }
}

/** Run only when an operator explicitly supplies isolated, test-owned real inputs. */
async function report(): Promise<RealAcceptanceReport> {
  const candidateSha = process.env[CANDIDATE_SHA]
  if (process.env[ENABLE] !== '1') {
    const detail = `set ${ENABLE}=1 to opt in to real Conda acceptance`
    return { kind: 'dsh-science-runtime-real-acceptance-v2', candidateSha: null, python: notRun(detail), r: notRun(detail) }
  }
  const dshHome = process.env[DSH_HOME]
  let homeIsPrivate = false
  if (dshHome !== undefined && isAbsolute(dshHome) && nonTemporaryHome(dshHome)) {
    try {
      const info = await stat(dshHome)
      homeIsPrivate = info.isDirectory() && (info.mode & 0o777) === 0o700
    } catch {
      homeIsPrivate = false
    }
  }
  const candidateDetail = candidateSha === undefined || !/^[0-9a-f]{40}$/.test(candidateSha)
    ? `set ${CANDIDATE_SHA} to the exact lowercase 40-hex clean-archive candidate`
    : undefined
  const nodeDetail = Number(process.versions.node.split('.')[0]) < 24
    ? 'run real acceptance with Node 24 or newer'
    : undefined
  const homeDetail = dshHome === undefined || !isAbsolute(dshHome) || !nonTemporaryHome(dshHome) || !homeIsPrivate || process.env[TEST_OWNED] !== '1'
    ? `set absolute non-temporary ${DSH_HOME} and ${TEST_OWNED}=1 for a test-owned Harness home`
    : undefined
  const run = async (language: ScienceLanguage, variable: string): Promise<LanguageReport> => {
    if (candidateDetail !== undefined) return notRun(candidateDetail)
    if (nodeDetail !== undefined) return notRun(nodeDetail)
    if (homeDetail !== undefined) return notRun(homeDetail)
    const prefix = process.env[variable]
    if (prefix === undefined || !isAbsolute(prefix)) return notRun(`set absolute ${variable} for real ${language} acceptance`)
    try {
      return await runLanguage(language, prefix, dshHome!)
    } catch (error) {
      return { status: 'FAIL', detail: failureDetail(error), checks: [] }
    }
  }
  const python = await run('python', PYTHON_PREFIX)
  const r = await run('r', R_PREFIX)
  return {
    kind: 'dsh-science-runtime-real-acceptance-v2',
    candidateSha: candidateSha ?? null,
    python,
    r,
  }
}

const result = await report()
console.log(JSON.stringify(result, null, 2))
if (result.python.status === 'FAIL' || result.r.status === 'FAIL') process.exitCode = 1
