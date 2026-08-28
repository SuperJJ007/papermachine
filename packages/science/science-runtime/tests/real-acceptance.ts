/** Opt-in real Conda acceptance with independent Python/R PASS, FAIL, or NOT-RUN reports. */

import { execFile as execFileCallback } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { CallId } from '@deepseek-ai/dsh-llm'
import { replayScience, ScienceEnvironmentProfileId } from '@deepseek-ai/dsh-science-session'
import type { ScienceEnvironmentBinding, ScienceKernelState, ScienceLanguage, ScienceOutcomePublication } from '@deepseek-ai/dsh-science-session'
import * as ScienceSessionInvariant from '@deepseek-ai/dsh-science-session/invariant'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import LocalSandboxProvider from '@deepseek-ai/dsh-sandbox-local'
import ScienceArtifactStore from '@deepseek-ai/dsh-science-artifact-store'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { MIN_KERNEL_IDLE_TIMEOUT_MS } from '../src/config.ts'
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
/** Generous upper bound for the idle-expiry poll; the kernel is expected around {@link MIN_KERNEL_IDLE_TIMEOUT_MS}. */
const IDLE_POLL_TIMEOUT_MS = 120_000
const IDLE_POLL_INTERVAL_MS = 2_000
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const PNG = new Uint8Array(Buffer.from(PNG_BASE64, 'base64'))
const execFile = promisify(execFileCallback)
/** Stable marker both the Python wheel and R source-tarball fixtures print once imported, proving the exact installed fixture ran. */
const INLINE_INSTALL_PROBE_MARKER = 'dsh-science-acceptance-probe-marker'
const PYTHON_PROBE_MODULE = 'dsh_science_acceptance_probe'
const R_PROBE_PACKAGE = 'dshscienceprobe'

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
  readonly kind: 'dsh-science-runtime-real-acceptance-v3'
  /** Exact clean-archive source candidate supplied by the operator. */
  readonly candidateSha: string | null
  /** Python outcome, never inferred from R. */
  readonly python: LanguageReport
  /** R outcome, never inferred from Python. */
  readonly r: LanguageReport
  /** Both languages' persistent kernels coexisting in one session, independent of either language's own report. */
  readonly coexistence: LanguageReport
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
function authorize(session: Session, name: string, turn: number) {
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
      // Reserved but not always materialized (only created when a run requests inputs), so only its presence is checked here.
      "assert os.environ.get('SCIENCE_INPUT_DIR', '') != ''",
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
    // Reserved but not always materialized (only created when a run requests inputs), so only its presence is checked here.
    'stopifnot(nzchar(Sys.getenv("SCIENCE_INPUT_DIR")))',
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

/** Source that assigns one integer to a session-persistent variable name. */
function assignSource(language: ScienceLanguage, name: string, value: number): string {
  return language === 'python' ? `${name} = ${String(value)}\n` : `${name} <- ${String(value)}\n`
}

/** Source that prints a previously assigned variable's value alone to stdout. */
function printSource(language: ScienceLanguage, name: string): string {
  return language === 'python' ? `print(${name})\n` : `cat(${name}, "\\n")\n`
}

/** Source that sleeps well past the run's own operation deadline, then swallows the interrupt and finishes normally. */
function taintingSleepSource(language: ScienceLanguage): string {
  return language === 'python'
    ? [
      'import time',
      'try:',
      '    time.sleep(30)',
      'except KeyboardInterrupt:',
      '    time.sleep(0.3)',
      'print("finished despite interrupt")',
      '',
    ].join('\n')
    : [
      'tryCatch({',
      '  Sys.sleep(30)',
      '}, interrupt = function(e) {',
      '  Sys.sleep(0.3)',
      '})',
      'cat("finished despite interrupt\\n")',
      '',
    ].join('\n')
}

/** R source that leaves a bare top-level value for auto-printing, unreachable in Python's script semantics. */
const R_BARE_VALUE_SOURCE = '41 + 1\n'

/**
 * Build one trivial, dependency-free, network-free Python wheel: a
 * single-module package whose only content is a `MARKER` string. Built by
 * the target prefix's own interpreter through stdlib `zipfile`/`hashlib`
 * alone (no build backend, no `pip wheel`), so it needs nothing beyond what
 * every configured Python prefix already provides. Proves inline
 * `pip install --no-index` visibility for the K?.? real-acceptance check.
 * @param pythonExecutable - the target prefix's canonical `python` executable.
 * @param scratchDir - test-owned directory (outside the Runtime's own scratch tree) to build under.
 * @returns absolute path of the built `.whl` file.
 */
async function buildTrivialPythonWheel(pythonExecutable: string, scratchDir: string): Promise<string> {
  await mkdir(scratchDir, { recursive: true })
  const buildScript = join(scratchDir, 'build_probe_wheel.py')
  const wheelPath = join(scratchDir, `${PYTHON_PROBE_MODULE}-0.0.1-py3-none-any.whl`)
  await writeFile(buildScript, [
    'import base64, hashlib, sys, zipfile',
    '',
    'wheel_path, marker = sys.argv[1], sys.argv[2]',
    'module_source = "MARKER = " + repr(marker) + "\\n"',
    'metadata = "Metadata-Version: 2.1\\nName: dsh-science-acceptance-probe\\nVersion: 0.0.1\\n"',
    'wheel_metadata = (',
    '    "Wheel-Version: 1.0\\nGenerator: dsh-science-runtime-real-acceptance\\n"',
    '    "Root-Is-Purelib: true\\nTag: py3-none-any\\n"',
    ')',
    'entries = {',
    '    "dsh_science_acceptance_probe.py": module_source,',
    '    "dsh_science_acceptance_probe-0.0.1.dist-info/METADATA": metadata,',
    '    "dsh_science_acceptance_probe-0.0.1.dist-info/WHEEL": wheel_metadata,',
    '}',
    'record_lines = []',
    'with zipfile.ZipFile(wheel_path, "w", zipfile.ZIP_DEFLATED) as archive:',
    '    for name, content in entries.items():',
    '        data = content.encode("utf-8")',
    '        archive.writestr(name, data)',
    '        digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode("ascii")',
    '        record_lines.append(name + ",sha256=" + digest + "," + str(len(data)))',
    '    record_lines.append("dsh_science_acceptance_probe-0.0.1.dist-info/RECORD,,")',
    '    archive.writestr(',
    '        "dsh_science_acceptance_probe-0.0.1.dist-info/RECORD",',
    '        "\\n".join(record_lines) + "\\n",',
    '    )',
    '',
  ].join('\n'), 'utf8')
  await execFile(pythonExecutable, [buildScript, wheelPath, INLINE_INSTALL_PROBE_MARKER])
  return wheelPath
}

/** Python source that pip-installs the built wheel with no network and no external index, inside the confined kernel. */
function pipInstallSource(wheelPath: string): string {
  return [
    'import subprocess, sys',
    'subprocess.run(',
    '    [sys.executable, "-m", "pip", "install", "--no-index", "--no-deps", "--disable-pip-version-check", ' + JSON.stringify(wheelPath) + '],',
    '    check=True,',
    ')',
    '',
  ].join('\n')
}

/** Imports the probe module and prints its marker; fails `ModuleNotFoundError` once the install did not survive a restart. */
const PYTHON_PROBE_IMPORT_SOURCE = [
  `import ${PYTHON_PROBE_MODULE}`,
  `print(${PYTHON_PROBE_MODULE}.MARKER)`,
  '',
].join('\n')

/**
 * Build one trivial, dependency-free, network-free R source-package tarball:
 * a single exported function returning a marker string. Built by the target
 * prefix's own `Rscript` through base `utils::tar()` alone (`tar = "internal"`,
 * a pure-R implementation — no system `tar` binary, no CRAN, no compiler
 * toolchain since the package has no compiled code). Proves inline
 * `install.packages()` visibility for the K?.? real-acceptance check.
 * @param rscriptExecutable - the target prefix's canonical `Rscript` executable.
 * @param scratchDir - test-owned directory (outside the Runtime's own scratch tree) to build under.
 * @returns absolute path of the built `.tar.gz` source package.
 */
async function buildTrivialRSourceTarball(rscriptExecutable: string, scratchDir: string): Promise<string> {
  const pkgDir = join(scratchDir, R_PROBE_PACKAGE)
  await mkdir(join(pkgDir, 'R'), { recursive: true })
  await writeFile(join(pkgDir, 'DESCRIPTION'), [
    `Package: ${R_PROBE_PACKAGE}`,
    'Version: 0.0.1',
    'Title: DSH Science real-acceptance probe',
    'Description: Trivial local source package built only to prove inline install.packages() visibility.',
    'License: MIT',
    '',
  ].join('\n'), 'utf8')
  await writeFile(join(pkgDir, 'NAMESPACE'), 'export(dsh_probe_marker)\n', 'utf8')
  await writeFile(
    join(pkgDir, 'R', 'probe.R'),
    `dsh_probe_marker <- function() ${JSON.stringify(INLINE_INSTALL_PROBE_MARKER)}\n`,
    'utf8',
  )
  const buildScript = join(scratchDir, 'build_probe_package.R')
  const tarballPath = join(scratchDir, `${R_PROBE_PACKAGE}_0.0.1.tar.gz`)
  await writeFile(buildScript, [
    'args <- commandArgs(trailingOnly = TRUE)',
    'pkgDir <- args[[1]]',
    'tarballPath <- args[[2]]',
    'oldwd <- setwd(dirname(pkgDir))',
    'on.exit(setwd(oldwd))',
    'utils::tar(tarfile = tarballPath, files = basename(pkgDir), compression = "gzip", tar = "internal")',
    '',
  ].join('\n'), 'utf8')
  await execFile(rscriptExecutable, [buildScript, pkgDir, tarballPath])
  return tarballPath
}

/** R source that non-interactively installs the built local source tarball, no network, no CRAN mirror. */
function installPackagesSource(tarballPath: string): string {
  return `install.packages(${JSON.stringify(tarballPath)}, repos = NULL, type = "source", quiet = TRUE)\n`
}

/** Loads the probe package and prints its marker; fails R's "there is no package called" once the install did not survive a restart. */
const R_PROBE_LIBRARY_SOURCE = [
  `library(${R_PROBE_PACKAGE})`,
  'cat(dsh_probe_marker(), "\\n")',
  '',
].join('\n')

/** Require one terminal value to carry the expected post-start classification. */
function expectTerminal(result: ScienceRunResult, status: string, failureCode?: string): void {
  if (result.terminal.status !== status || result.terminal.failureCode !== failureCode) {
    throw new Error(`expected ${status}/${failureCode ?? 'none'}, got ${result.terminal.status}/${result.terminal.failureCode ?? 'none'}`)
  }
}

/** {@link expectTerminal}, returning `result` so a caller can chain an `expectEpoch` check. */
function expectTerminalReturning(result: ScienceRunResult, status: string, failureCode?: string): ScienceRunResult {
  expectTerminal(result, status, failureCode)
  return result
}

/** Require one just-finished run's terminal to carry the exact expected `kernelEpoch`. */
function expectEpoch(result: ScienceRunResult, epoch: number): void {
  if (result.terminal.kernelEpoch !== epoch) {
    throw new Error(`expected kernelEpoch ${String(epoch)}, got ${String(result.terminal.kernelEpoch)}`)
  }
}

/** Resolve until a wall-clock delay elapses; used only for the real idle-expiry poll below. */
function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

/** Find `language`'s `exited` kernel-state fact for exactly `epoch` in the session's replayed projection, `undefined` before it exists. */
function findExitedKernel(
  session: Session,
  language: ScienceLanguage,
  epoch: number,
): ScienceKernelState | undefined {
  for (const kernel of replayScience(session.events)?.kernels ?? []) {
    if (kernel.language === language && kernel.kernelEpoch === epoch && kernel.state === 'exited') return kernel
  }
  return undefined
}

/**
 * Poll the session's replayed projection until `language`'s `kernelEpoch`
 * closed with an `exited` fact carrying exactly `reason`, or fail after
 * {@link IDLE_POLL_TIMEOUT_MS}. Used only for the idle-expiry scenario: every
 * other kernel-end path this suite exercises is synchronously observable
 * through its causing run's own settled `done`.
 */
async function waitForKernelExit(session: Session, language: ScienceLanguage, epoch: number, reason: string): Promise<void> {
  const deadline = Date.now() + IDLE_POLL_TIMEOUT_MS
  for (;;) {
    const kernel = findExitedKernel(session, language, epoch)
    if (kernel !== undefined) {
      if (kernel.reason !== reason) throw new Error(`kernel epoch ${String(epoch)} for ${language} exited with reason "${kernel.reason}", expected "${reason}"`)
      return
    }
    if (Date.now() >= deadline) throw new Error(`kernel epoch ${String(epoch)} for ${language} did not exit with reason "${reason}" within ${String(IDLE_POLL_TIMEOUT_MS)}ms`)
    await sleepMs(IDLE_POLL_INTERVAL_MS)
  }
}

/** Require the session's replayed projection to show `language`'s `kernelEpoch` closed with exactly `reason`. */
function expectKernelExited(session: Session, language: ScienceLanguage, epoch: number, reason: string): void {
  const kernel = findExitedKernel(session, language, epoch)
  if (kernel === undefined) throw new Error(`kernel epoch ${String(epoch)} for ${language} has no exited fact`)
  if (kernel.reason !== reason) throw new Error(`kernel epoch ${String(epoch)} for ${language} exited with reason "${kernel.reason}", expected "${reason}"`)
}

/** Render one unexpected operational error for a machine-readable language report. */
function failureDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Latches the first failure an operation-plus-cleanup sequence records, folding any later one into an `AggregateError`. */
class FailureLatch {
  failed = false
  failure: unknown

  /** Record `error`; the first call latches it, every later call folds it into the running `AggregateError`. */
  record = (error: unknown): void => {
    if (!this.failed) {
      this.failed = true
      this.failure = error
      return
    }
    this.failure = new AggregateError([this.failure, error], 'science-runtime: real acceptance operation and cleanup both failed')
  }
}

/** Run one real language through binding, successful output, cancellation, timeout, and denied prefix write. */
async function runLanguage(language: ScienceLanguage, prefix: string, dshHome: string): Promise<LanguageReport> {
  const checks: string[] = []
  const context = new Context()
  let before: ReadonlyMap<string, PrefixManifestEntry> | undefined
  let differences: readonly string[] | undefined
  const failureLatch = new FailureLatch()
  const originalSentinel = process.env[AMBIENT_SENTINEL]
  try {
    before = await capturePrefixManifest(prefix)
    process.env[AMBIENT_SENTINEL] = `must-not-reach-${randomUUID()}`
    await context.plugin(SessionStore)
    await context.plugin(InvariantRegistry, { enabled: true })
    await context.plugin(ScienceSessionInvariant)
    await context.plugin(ScienceArtifactStore, { dshHome })
    await context.plugin(LocalSubprocessRuntime)
    await context.plugin(LocalSandboxProvider)
    await context.plugin(ScienceRuntime, {
      dshHome,
      timeoutMs: TIMEOUT_MS,
      // The shortest legal idle deadline, so the idle-expiry check below
      // proves the configured field takes effect without waiting anywhere
      // near the 30-minute default; every other check in this sequence
      // settles well within it.
      kernelIdleTimeoutMs: MIN_KERNEL_IDLE_TIMEOUT_MS,
      profiles: {
        real: language === 'python' ? { pythonPrefix: prefix } : { rPrefix: prefix },
      },
    })
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-real-acceptance-'))
    const session = context.sessions.create(SessionId(`science-real-${language}-${randomUUID()}`), {
      meta: { agentPreset: 'science', cwd: workspace },
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
      rasterArtifacts: ['real-chart.png'],
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
    // Kernel runs have no per-run exit code or signal to classify a denied
    // write against; the driver reports the resulting exception like any
    // other, so it settles as EXECUTION_FAILED — SANDBOX_RUNNER_FAILED
    // and SANDBOX_DENIED are one-shot-only codes the kernel model retired
    // (failures.spec.ts's own header documents the retirement).
    expectTerminal(await denied.done, 'failed', 'EXECUTION_FAILED')
    checks.push('configured-prefix write denial')

    const capturedChart = successResult.capture?.captured.find(candidate => candidate.logicalName === 'real-chart.png')
    if (capturedChart === undefined) throw new Error('auto-capture did not produce the real PNG artifact')
    if (capturedChart.mediaType !== 'image/png') throw new Error('auto-capture returned a non-image artifact for a PNG file')
    checks.push('real PNG artifact auto-capture')

    const annotateAuthorization = authorize(session, 'annotate_artifact', 5)
    const chart = await context.scienceRuntime.annotateArtifact({
      session,
      logicalName: 'real-chart.png',
      title: `${language} real acceptance chart`,
      ...annotateAuthorization,
      signal: new AbortController().signal,
    })
    if (chart.mediaType !== 'image/png') throw new Error('annotateArtifact returned a non-image artifact')
    const stored = await context.scienceArtifactStore.readBlob(chart.projectId, chart.sha256)
    if (!Buffer.from(stored).equals(Buffer.from(PNG))) {
      throw new Error('curated chart artifact did not read back with the exact generated PNG bytes')
    }
    checks.push('chart curation and artifact-store readback')

    const chartProjection = replayScience(session.events)
    const replayedChart = chartProjection?.artifacts.find(candidate =>
      candidate.artifactId === chart.artifactId && candidate.version === chart.version)
    if (replayedChart === undefined || replayedChart.versionId !== chart.versionId) {
      throw new Error('chart event did not replay to the exact committed version')
    }
    checks.push('chart replay')

    const outcomeAuthorization = authorize(session, 'publish_outcome', 6)
    const outcome: ScienceOutcomePublication = {
      revision: 1,
      title: `${language} real acceptance outcome`,
      summaryMarkdown: 'The real interpreter produced and saved the cited chart.',
      evidence: [
        { kind: 'run', runId: success.runId },
        { kind: 'chart', chartId: chart.artifactId, version: chart.version },
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

    // Persistent-kernel lifecycle: one variable, `x`, is chained
    // across four successive kernel epochs of the same language's kernel —
    // state persistence and interrupt survival on epoch 1, then a fresh
    // epoch each time timeout escalation, environment-rebound, and idle
    // expiry replace it, losing `x` every time.
    const toolName = language === 'python' ? 'run_python' : 'run_r'
    const epoch1 = successResult.terminal.kernelEpoch

    if (language === 'r') {
      const bareValue = await context.scienceRuntime.startRun({
        session, language, code: R_BARE_VALUE_SOURCE,
        ...authorize(session, toolName, 7),
        signal: new AbortController().signal,
      })
      const bareValueResult = await bareValue.done
      expectTerminal(bareValueResult, 'success')
      if (!bareValueResult.stdout.text.includes('[1] 42')) {
        throw new Error('a bare top-level value did not auto-print to stdout')
      }
      checks.push('R bare top-level value auto-prints')
    }

    const assignX = await context.scienceRuntime.startRun({
      session, language, code: assignSource(language, 'x', 1),
      ...authorize(session, toolName, 8),
      signal: new AbortController().signal,
    })
    expectTerminal(await assignX.done, 'success')

    const printX1 = await context.scienceRuntime.startRun({
      session, language, code: printSource(language, 'x'),
      ...authorize(session, toolName, 9),
      signal: new AbortController().signal,
    })
    const printX1Result = await printX1.done
    expectTerminal(printX1Result, 'success')
    expectEpoch(printX1Result, epoch1)
    if (!printX1Result.stdout.text.includes('1')) throw new Error('state did not persist across two runs on the same kernel')
    checks.push('state persistence across two runs on the same kernel')

    const interrupted = await context.scienceRuntime.startRun({
      session, language, code: waitingSource(language),
      ...authorize(session, toolName, 10),
      signal: new AbortController().signal,
    })
    setTimeout(() => { interrupted.cancel() }, 100)
    expectEpoch(expectTerminalReturning(await interrupted.done, 'cancelled', 'CANCELLED'), epoch1)

    const printX2 = await context.scienceRuntime.startRun({
      session, language, code: printSource(language, 'x'),
      ...authorize(session, toolName, 11),
      signal: new AbortController().signal,
    })
    const printX2Result = await printX2.done
    expectTerminal(printX2Result, 'success')
    expectEpoch(printX2Result, epoch1)
    if (!printX2Result.stdout.text.includes('1')) throw new Error('kernel did not survive an interrupted run')
    checks.push('interrupt during sleep cancels the run but the kernel survives')

    const escalated = await context.scienceRuntime.startRun({
      session, language, code: taintingSleepSource(language),
      ...authorize(session, toolName, 12),
      signal: new AbortController().signal,
    })
    expectEpoch(expectTerminalReturning(await escalated.done, 'timed-out', 'TIMEOUT'), epoch1)

    const printXAfterEscalation = await context.scienceRuntime.startRun({
      session, language, code: printSource(language, 'x'),
      ...authorize(session, toolName, 13),
      signal: new AbortController().signal,
    })
    const printXAfterEscalationResult = await printXAfterEscalation.done
    expectTerminal(printXAfterEscalationResult, 'failed', 'EXECUTION_FAILED')
    const epoch2 = printXAfterEscalationResult.terminal.kernelEpoch
    if (epoch2 <= epoch1) throw new Error('run timeout escalation did not replace the kernel with a fresh epoch')
    expectKernelExited(session, language, epoch1, 'run-escalation')
    checks.push('run timeout escalation retires the kernel and starts a fresh epoch')

    const assignXAgain = await context.scienceRuntime.startRun({
      session, language, code: assignSource(language, 'x', 42),
      ...authorize(session, toolName, 14),
      signal: new AbortController().signal,
    })
    expectEpoch(expectTerminalReturning(await assignXAgain.done, 'success'), epoch2)

    const reboundEnvironment: ScienceEnvironmentBinding = {
      ...environment,
      revision: environment.revision + 1,
      configuredAt: Date.now(),
      validatedAt: Date.now(),
    }
    session.append('science/environment-bound', { version: 1, environment: reboundEnvironment })

    const printXAfterRebind = await context.scienceRuntime.startRun({
      session, language, code: printSource(language, 'x'),
      ...authorize(session, toolName, 15),
      signal: new AbortController().signal,
    })
    const printXAfterRebindResult = await printXAfterRebind.done
    expectTerminal(printXAfterRebindResult, 'failed', 'EXECUTION_FAILED')
    const epoch3 = printXAfterRebindResult.terminal.kernelEpoch
    if (epoch3 <= epoch2) throw new Error('environment rebind did not replace the kernel with a fresh epoch')
    expectKernelExited(session, language, epoch2, 'environment-rebound')
    checks.push('environment-rebound restart starts a fresh epoch')

    const assignXForIdle = await context.scienceRuntime.startRun({
      session, language, code: assignSource(language, 'x', 7),
      ...authorize(session, toolName, 16),
      signal: new AbortController().signal,
    })
    expectEpoch(expectTerminalReturning(await assignXForIdle.done, 'success'), epoch3)

    await waitForKernelExit(session, language, epoch3, 'idle')

    const printXAfterIdle = await context.scienceRuntime.startRun({
      session, language, code: printSource(language, 'x'),
      ...authorize(session, toolName, 17),
      signal: new AbortController().signal,
    })
    const printXAfterIdleResult = await printXAfterIdle.done
    expectTerminal(printXAfterIdleResult, 'failed', 'EXECUTION_FAILED')
    if (printXAfterIdleResult.terminal.kernelEpoch <= epoch3) throw new Error('idle expiry did not replace the kernel with a fresh epoch')
    checks.push(`idle expiry (kernelIdleTimeoutMs=${String(MIN_KERNEL_IDLE_TIMEOUT_MS)}) starts a fresh epoch`)

    // Inline-install visibility (the defect this fix closes): a same-kernel
    // pip install/install.packages() must be importable in the same kernel
    // and gone after the next fresh kernel — proving the install landed
    // under the kernel-scoped PYTHONUSERBASE/R_LIBS_USER, not carried by the
    // session or the environment.
    const installEpoch = printXAfterIdleResult.terminal.kernelEpoch
    const fixtureRoot = join(dshHome, 'real-acceptance-fixtures', language)
    const installSource = language === 'python'
      ? pipInstallSource(await buildTrivialPythonWheel(executable, fixtureRoot))
      : installPackagesSource(await buildTrivialRSourceTarball(executable, fixtureRoot))

    const install = await context.scienceRuntime.startRun({
      session, language, code: installSource,
      ...authorize(session, toolName, 18),
      signal: new AbortController().signal,
    })
    expectEpoch(expectTerminalReturning(await install.done, 'success'), installEpoch)
    checks.push('inline install (no network, no external index) succeeds against the kernel-scoped user-install base')

    const importSource = language === 'python' ? PYTHON_PROBE_IMPORT_SOURCE : R_PROBE_LIBRARY_SOURCE
    const importSameKernel = await context.scienceRuntime.startRun({
      session, language, code: importSource,
      ...authorize(session, toolName, 19),
      signal: new AbortController().signal,
    })
    const importSameKernelResult = await importSameKernel.done
    expectTerminal(importSameKernelResult, 'success')
    expectEpoch(importSameKernelResult, installEpoch)
    if (!importSameKernelResult.stdout.text.includes(INLINE_INSTALL_PROBE_MARKER)) {
      throw new Error('inline install was not importable within the same kernel that installed it')
    }
    checks.push('inline install is importable within the same kernel that installed it')

    const restartedEnvironment: ScienceEnvironmentBinding = {
      ...environment,
      revision: environment.revision + 2,
      configuredAt: Date.now(),
      validatedAt: Date.now(),
    }
    session.append('science/environment-bound', { version: 1, environment: restartedEnvironment })

    const importAfterRestart = await context.scienceRuntime.startRun({
      session, language, code: importSource,
      ...authorize(session, toolName, 20),
      signal: new AbortController().signal,
    })
    const importAfterRestartResult = await importAfterRestart.done
    expectTerminal(importAfterRestartResult, 'failed', 'EXECUTION_FAILED')
    if (importAfterRestartResult.terminal.kernelEpoch <= installEpoch) {
      throw new Error('environment-rebound did not replace the kernel before the post-restart import check')
    }
    const expectedRestartError = language === 'python' ? 'ModuleNotFoundError' : 'there is no package called'
    if (!importAfterRestartResult.stderr.text.includes(expectedRestartError)) {
      throw new Error(`inline install survived a fresh kernel: expected ${JSON.stringify(expectedRestartError)} in stderr, got ${JSON.stringify(importAfterRestartResult.stderr.text)}`)
    }
    checks.push('inline install does not survive a fresh kernel: kernel-scoped, not session- or environment-scoped')
  } catch (error) {
    failureLatch.record(error)
  } finally {
    if (originalSentinel === undefined) Reflect.deleteProperty(process.env, AMBIENT_SENTINEL)
    else process.env[AMBIENT_SENTINEL] = originalSentinel
    try {
      await context.fiber.dispose()
    } catch (error) {
      failureLatch.record(error)
    }
    if (before !== undefined) {
      try {
        const after = await capturePrefixManifest(prefix)
        differences = diffPrefixManifest(before, after).map(difference => difference.path)
      } catch (error) {
        failureLatch.record(error)
      }
    }
  }
  if (failureLatch.failed) {
    return {
      status: 'FAIL',
      detail: failureDetail(failureLatch.failure),
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

/**
 * Bind one environment naming both interpreters and run one Python then one
 * R kernel in the same session (f), confirming both stay simultaneously
 * live with independent epochs and independent in-memory state.
 */
async function runCoexistence(pythonPrefix: string, rPrefix: string, dshHome: string): Promise<LanguageReport> {
  const checks: string[] = []
  const context = new Context()
  let beforePython: ReadonlyMap<string, PrefixManifestEntry> | undefined
  let beforeR: ReadonlyMap<string, PrefixManifestEntry> | undefined
  let differences: readonly string[] | undefined
  const failureLatch = new FailureLatch()
  try {
    beforePython = await capturePrefixManifest(pythonPrefix)
    beforeR = await capturePrefixManifest(rPrefix)
    await context.plugin(SessionStore)
    await context.plugin(InvariantRegistry, { enabled: true })
    await context.plugin(ScienceSessionInvariant)
    await context.plugin(ScienceArtifactStore, { dshHome })
    await context.plugin(LocalSubprocessRuntime)
    await context.plugin(LocalSandboxProvider)
    await context.plugin(ScienceRuntime, {
      dshHome,
      timeoutMs: TIMEOUT_MS,
      profiles: { real: { pythonPrefix, rPrefix } },
    })
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-science-real-acceptance-'))
    const session = context.sessions.create(SessionId(`science-real-coexistence-${randomUUID()}`), {
      meta: { agentPreset: 'science', cwd: workspace },
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
    if (environment.status !== 'applied' || environment.python?.capability !== 'available' || environment.r?.capability !== 'available') {
      throw new Error('binding was not applied with both interpreters available')
    }
    checks.push('single environment binds both interpreters')

    const assignPythonX = await context.scienceRuntime.startRun({
      session, language: 'python', code: assignSource('python', 'x', 1),
      ...authorize(session, 'run_python', 1),
      signal: new AbortController().signal,
    })
    const pythonEpoch = expectTerminalReturning(await assignPythonX.done, 'success').terminal.kernelEpoch

    const assignRY = await context.scienceRuntime.startRun({
      session, language: 'r', code: assignSource('r', 'y', 2),
      ...authorize(session, 'run_r', 2),
      signal: new AbortController().signal,
    })
    const rEpoch = expectTerminalReturning(await assignRY.done, 'success').terminal.kernelEpoch
    if (rEpoch === pythonEpoch) throw new Error('python and R kernels shared an epoch instead of coexisting independently')
    checks.push('python and R kernels hold independent epochs')

    const bothLive = replayScience(session.events)
    const livePython = bothLive?.kernels.find(kernel => kernel.language === 'python' && kernel.kernelEpoch === pythonEpoch)
    const liveR = bothLive?.kernels.find(kernel => kernel.language === 'r' && kernel.kernelEpoch === rEpoch)
    if (livePython?.state !== 'started' || liveR?.state !== 'started') {
      throw new Error('python and R kernels were not both live at once')
    }
    checks.push('python and R kernels are both live at once')

    const printPythonX = await context.scienceRuntime.startRun({
      session, language: 'python', code: printSource('python', 'x'),
      ...authorize(session, 'run_python', 3),
      signal: new AbortController().signal,
    })
    const printPythonXResult = await printPythonX.done
    expectTerminal(printPythonXResult, 'success')
    expectEpoch(printPythonXResult, pythonEpoch)
    if (!printPythonXResult.stdout.text.includes('1')) throw new Error('python state did not survive the R kernel starting alongside it')

    const printRY = await context.scienceRuntime.startRun({
      session, language: 'r', code: printSource('r', 'y'),
      ...authorize(session, 'run_r', 4),
      signal: new AbortController().signal,
    })
    const printRYResult = await printRY.done
    expectTerminal(printRYResult, 'success')
    expectEpoch(printRYResult, rEpoch)
    if (!printRYResult.stdout.text.includes('2')) throw new Error('R state did not survive interleaving with the python kernel')
    checks.push('each kernel keeps its own state independent of the other language')
  } catch (error) {
    failureLatch.record(error)
  } finally {
    try {
      await context.fiber.dispose()
    } catch (error) {
      failureLatch.record(error)
    }
    if (beforePython !== undefined && beforeR !== undefined) {
      try {
        const afterPython = await capturePrefixManifest(pythonPrefix)
        const afterR = await capturePrefixManifest(rPrefix)
        differences = [
          ...diffPrefixManifest(beforePython, afterPython).map(difference => `python:${difference.path}`),
          ...diffPrefixManifest(beforeR, afterR).map(difference => `r:${difference.path}`),
        ]
      } catch (error) {
        failureLatch.record(error)
      }
    }
  }
  if (failureLatch.failed) {
    return {
      status: 'FAIL',
      detail: failureDetail(failureLatch.failure),
      checks,
      ...(differences === undefined || differences.length === 0 ? {} : { prefixManifestDifferences: differences }),
    }
  }
  if (differences !== undefined && differences.length > 0) {
    return { status: 'FAIL', detail: 'configured prefix changed during real acceptance', checks, prefixManifestDifferences: differences }
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
    return {
      kind: 'dsh-science-runtime-real-acceptance-v3',
      candidateSha: null,
      python: notRun(detail),
      r: notRun(detail),
      coexistence: notRun(detail),
    }
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
  const coexistence = await (async (): Promise<LanguageReport> => {
    if (candidateDetail !== undefined) return notRun(candidateDetail)
    if (nodeDetail !== undefined) return notRun(nodeDetail)
    if (homeDetail !== undefined) return notRun(homeDetail)
    const pythonPrefix = process.env[PYTHON_PREFIX]
    const rPrefix = process.env[R_PREFIX]
    if (pythonPrefix === undefined || !isAbsolute(pythonPrefix) || rPrefix === undefined || !isAbsolute(rPrefix)) {
      return notRun(`set absolute ${PYTHON_PREFIX} and ${R_PREFIX} for real coexistence acceptance`)
    }
    try {
      return await runCoexistence(pythonPrefix, rPrefix, dshHome!)
    } catch (error) {
      return { status: 'FAIL', detail: failureDetail(error), checks: [] }
    }
  })()
  return {
    kind: 'dsh-science-runtime-real-acceptance-v3',
    candidateSha: candidateSha ?? null,
    python,
    r,
    coexistence,
  }
}

const result = await report()
console.log(JSON.stringify(result, null, 2))
if (result.python.status === 'FAIL' || result.r.status === 'FAIL' || result.coexistence.status === 'FAIL') process.exitCode = 1
