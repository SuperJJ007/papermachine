/** Shared real-session/fake-prefix assembly for Science Runtime behavior tests. */

import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { CallId } from '@deepseek-ai/dsh-llm'
import LocalSandboxProvider from '@deepseek-ai/dsh-sandbox-local'
import * as ScienceSessionInvariant from '@deepseek-ai/dsh-science-session/invariant'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEventType } from '@deepseek-ai/dsh-session'
import SandboxProvider from '@deepseek-ai/dsh-sandbox'
import type { ConfinedArgv, SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type {
  SubprocessHandle,
  SubprocessOutcome,
  SubprocessOutputRead,
  SubprocessSpawnSpec,
  SubprocessTerminalHandle,
  SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import ScienceArtifactStore from '@deepseek-ai/dsh-science-artifact-store'
import ScienceRuntime from '../src/index.ts'
import type { Config } from '../src/config.ts'
import { KernelSet } from '../src/kernel-set.ts'
import type { ScienceKernelEndedFact, ScienceKernelStartedFact } from '../src/kernel-set.ts'

/** Full-featured fake kernel-wire-protocol driver pair (sleep/trapSigint included) named for `resolveKernelDriverPath`. */
const KERNEL_ASSETS_FULL_ROOT = fileURLToPath(new URL('./fixtures/kernel-set-assets-full/', import.meta.url))
/** Fake driver pair that never sends READY, for spawn/READY-deadline failure coverage. */
export const KERNEL_ASSETS_NO_READY_ROOT = fileURLToPath(new URL('./fixtures/kernel-set-assets-no-ready/', import.meta.url))
/** Fake driver pair that delays READY, for spawn-in-flight coverage (see `kernel-set.spec.ts`'s own use of the same fixture). */
export const KERNEL_ASSETS_DELAYED_READY_ROOT = fileURLToPath(new URL('./fixtures/kernel-set-assets-delayed-ready/', import.meta.url))

/**
 * Mount a real project artifact store at the same Harness home a test's
 * `ScienceRuntime` uses, satisfying the required `scienceArtifactStore`
 * injection.
 * @param ctx - the test context that will also mount `ScienceRuntime`.
 * @param root - the same temp root passed to `ScienceRuntime`'s `dshHome`.
 */
export async function mountArtifactStore(ctx: Context, root: string): Promise<void> {
  await ctx.plugin(ScienceArtifactStore, { dshHome: join(root, 'dsh-home') })
}

/** Full-enforcement test double that preserves direct argv for fake interpreters. */
export class DirectSandbox extends SandboxProvider {
  /** Every requested fixed policy. */
  readonly policies: SandboxPolicy[] = []
  /** Test-owned wrapper prefix; an empty list leaves the direct argv intact. */
  argvPrefix: readonly string[] = []
  /** Exact backend denial dialect used by a focused classification test. */
  denialSignatures: readonly string[] = []
  /** Exact backend runner-failure evidence used by a focused classification test. */
  runnerFailureRules: readonly import('@deepseek-ai/dsh-sandbox').RunnerFailureRule[] = []
  /** Test-selected complete or partial enforcement result. */
  enforcement: 'full' | 'partial' = 'full'

  confine(argv: readonly string[], policy: SandboxPolicy): ConfinedArgv {
    this.policies.push(policy)
    return {
      argv: [...this.argvPrefix, ...argv],
      enforcement: this.enforcement,
      denialSignatures: this.denialSignatures,
      runnerFailureRules: this.runnerFailureRules,
    }
  }
}

/** One fully controlled managed handle for lifecycle paths a real host cannot force deterministically. */
export class ControlledRun {
  private readonly completion = Promise.withResolvers<SubprocessOutcome>()
  private readonly eventual = Promise.withResolvers<boolean>()
  /** Calls to the one public tree-termination verb. */
  terminations = 0
  /** Whole-tree observations requested by the Runtime. */
  waits = 0
  /** Public subprocess handle with bounded collected output. */
  readonly handle: SubprocessHandle

  /**
   * @param mode - Whether every tree observation immediately proves exit or the first two do not.
   * @param output - Exact retained output facts made visible after settlement.
   */
  constructor(
    private readonly mode: 'immediate' | 'deferred',
    output: ControlledOutput = {},
  ) {
    this.handle = {
      pid: 41,
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      collected: {
        stdout: reader(output.stdout ?? 'running\n', output.stdoutBytes, output.stdoutLossy),
        stderr: reader(output.stderr ?? '', output.stderrBytes, output.stderrLossy),
      },
      done: this.completion.promise,
      terminate: () => {
        this.terminations += 1
        this.completion.resolve({ exitCode: 0, signal: null })
      },
      interrupt: () => {},
      waitForExit: async () => {
        this.waits += 1
        if (this.waits === 1) this.onFirstWait?.()
        if (this.mode === 'immediate' || this.waits > 2) return this.eventual.promise
        return false
      },
    }
    if (mode === 'immediate') this.eventual.resolve(true)
  }

  /** Test-only observation made exactly before the first tree-exit answer. */
  onFirstWait: (() => void) | undefined

  /** Let a deferred whole-tree observer finally prove its tree is gone. */
  proveQuiescence(): void {
    this.eventual.resolve(true)
  }

  /** Resolve the direct-process outcome without asking the Runtime to cancel it. */
  complete(outcome: SubprocessOutcome): void {
    this.completion.resolve(outcome)
  }

  /** Omit stdout from a published handle to model a malformed subprocess provider. */
  omitStdout(): void {
    const { stdout: _stdout, ...collected } = this.handle.collected
    Object.defineProperty(this.handle, 'collected', { value: collected })
  }

  /** Resolve the published handle with a malformed non-outcome for failure classification coverage. */
  resolveMalformedOutcome(): void {
    Object.defineProperty(this.handle, 'done', { value: Promise.resolve(undefined) })
  }

  /** Reject the published completion before normal settlement. */
  rejectCompletion(error: unknown): void {
    // The test scripts a provider that rejects with a non-Error value.
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors
    Object.defineProperty(this.handle, 'done', { value: Promise.reject(error) })
  }
}

/** Make exactly one test-owned Session append type fail before delegating every other event unchanged. */
export function rejectSessionAppend(session: Session, rejectedType: SessionEventType, error: Error, beforeReject?: () => void): void {
  const append = session.append.bind(session)
  const intercept: typeof session.append = (type, data, ...opts) => {
    if (type === rejectedType) {
      beforeReject?.()
      throw error
    }
    return append(type, data, ...opts)
  }
  Object.defineProperty(session, 'append', { value: intercept })
}

/** Exact retained collector facts for one controlled source process. */
export interface ControlledOutput {
  /** Standard output text retained by the provider. */
  readonly stdout?: string
  /** Standard error text retained by the provider. */
  readonly stderr?: string
  /** Total stdout bytes before retention truncation. */
  readonly stdoutBytes?: number
  /** Total stderr bytes before retention truncation. */
  readonly stderrBytes?: number
  /** Whether stdout omitted an earlier byte range. */
  readonly stdoutLossy?: boolean
  /** Whether stderr omitted an earlier byte range. */
  readonly stderrLossy?: boolean
}

/** Host-local fake subprocess provider for non-time-based lifecycle assertions. */
export class ControlledSubprocess extends SubprocessRuntime {
  override executionWorld: 'host-local' | 'remote' = 'host-local'
  /** Every fully resolved request issued by the Runtime. */
  readonly specs: SubprocessSpawnSpec[] = []
  /** Controlled requested-source runs in start order. */
  readonly runs: ControlledRun[] = []
  /** Every spawn before the returned handle becomes observable to the Runtime. */
  onSpawn: ((spec: SubprocessSpawnSpec) => void) | undefined
  /** Retained UTF-8 fact returned for fixed Unicode probes. */
  utf8Probe: FakeUtf8Probe = 'valid'
  /** Fake package-inventory probe stdout for Python and R, overridable per test. */
  packagesOutput: { readonly python: string; readonly r: string } = {
    python: '[{"name":"pip","version":"24.0"},{"name":"numpy","version":"1.26.4"}]',
    r: 'base\t4.5.0\nutils\t4.5.0\n',
  }
  private readonly queuedRuns: ControlledRun[] = []
  /** One injected source-spawn throw, consumed after probe requests complete. */
  spawnFailure: Error | undefined

  /** Queue the next requested-source run while probe requests stay immediate. */
  queueRun(mode: 'immediate' | 'deferred', output?: ControlledOutput): ControlledRun {
    const run = new ControlledRun(mode, output)
    this.queuedRuns.push(run)
    return run
  }

  override async resolveExecutable(command: string): Promise<string> {
    return command
  }

  override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    this.specs.push(spec)
    this.onSpawn?.(spec)
    const r = spec.argv[0]?.endsWith('/Rscript') ?? false
    if (spec.argv.includes('--version')) return settledHandle(r ? 'Fake R 4.5.0\n' : 'Fake Python 3.13.5\n', '')
    if (spec.argv.includes('-m') || spec.argv.some(arg => arg.includes('installed.packages'))) {
      return settledHandle(r ? this.packagesOutput.r : this.packagesOutput.python, '')
    }
    if (spec.argv.includes('-c') || spec.argv.includes('-e')) {
      return settledHandle(this.utf8Probe === 'valid' ? 'dsh-科学-✓' : '�', '', this.utf8Probe)
    }
    if (this.spawnFailure !== undefined) {
      const error = this.spawnFailure
      this.spawnFailure = undefined
      throw error
    }
    const run = this.queuedRuns.shift()
    if (run === undefined) return settledHandle(r ? 'fake R run output\n' : 'fake run output\n', '')
    this.runs.push(run)
    return run.handle
  }

  override async spawnTerminal(_spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    throw new Error('ControlledSubprocess does not allocate terminals')
  }
}

/** Build one retained output reader from exact test facts. */
function reader(text: string, bytes = Buffer.byteLength(text), lossy = false, utf8Validity: FakeUtf8Probe = 'valid'): {
  readFrom(fromByte: number): SubprocessOutputRead
} {
  return {
    readFrom(_fromByte: number): SubprocessOutputRead {
      return { text, nextOffset: bytes, lossy, utf8Validity }
    },
  }
}

/** Return a probe handle that already reached process and whole-tree settlement. */
function settledHandle(stdout: string, stderr: string, utf8Validity: FakeUtf8Probe = 'valid'): SubprocessHandle {
  return {
    pid: 42,
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    collected: { stdout: reader(stdout, undefined, false, utf8Validity), stderr: reader(stderr, undefined, false, utf8Validity) },
    done: Promise.resolve({ exitCode: 0, signal: null }),
    terminate: () => {},
    interrupt: () => {},
    waitForExit: async () => true,
  }
}

/** Fake interpreter probe behavior that exercises lossless UTF-8 acceptance. */
export type FakeUtf8Probe = 'valid' | 'invalid'

/**
 * Return a fake Python prefix whose executable implements frozen probes
 * (`bindEnvironment`'s `--version`/`-c`/`-m`) and, for every other invocation
 * shape, discards every leading hardening flag `interpreterArgv` prepends
 * and `exec`s this Node process against the trailing driver-path/fifo-path
 * pair (`KernelProcess`'s own confined kernel spawn) — the same forwarding
 * `kernel-process.spec.ts`'s `createFakeInterpreterPrefix` uses, folded into
 * one prefix so `bindEnvironment` and a persistent-kernel `startRun` can both
 * run against it.
 */
export function createFakePythonPrefix(root: string, utf8Probe: FakeUtf8Probe = 'valid'): string {
  const prefix = join(root, 'fake-conda')
  mkdirSync(join(prefix, 'bin'), { recursive: true })
  mkdirSync(join(prefix, 'conda-meta'), { recursive: true })
  writeFileSync(join(prefix, 'conda-meta', 'history'), '==> 2026-08-13 <==\n+python-3.13.5\n')
  const executable = join(prefix, 'bin', 'python')
  const utf8Output = utf8Probe === 'valid' ? "printf 'dsh-科学-✓'" : "printf '\\377'"
  writeFileSync(executable, `#!/bin/sh
if [ -n "\${SCIENCE_RUNTIME_LEAK-}" ]; then
  printf 'ambient environment leaked\\n' >&2
  exit 91
fi
case " $* " in
  *" --version "*) printf 'Fake Python 3.13.5\\n' ;;
  *" -m "*) printf '[{"name":"pip","version":"24.0"},{"name":"numpy","version":"1.26.4"}]' ;;
  *" -c "*) ${utf8Output} ;;
  *)
    while [ "$#" -gt 2 ]; do shift; done
    exec "${process.execPath}" "$1" "$2"
    ;;
esac
`)
  chmodSync(executable, 0o700)
  return prefix
}

/**
 * Return a fake R Conda prefix whose executable implements frozen probes
 * (`bindEnvironment`'s `--version`/package-inventory/`-e`) and, for every
 * other invocation shape, forwards to this Node process the same way
 * {@link createFakePythonPrefix} does — see that function's own doc.
 */
export function createFakeRPrefix(root: string, prefix = join(root, 'fake-r-conda')): string {
  mkdirSync(join(prefix, 'bin'), { recursive: true })
  mkdirSync(join(prefix, 'conda-meta'), { recursive: true })
  writeFileSync(join(prefix, 'conda-meta', 'history'), '==> 2026-08-13 <==\n+r-base-4.5.0\n')
  const executable = join(prefix, 'bin', 'Rscript')
  writeFileSync(executable, `#!/bin/sh
case " $* " in
  *" --version "*) printf 'Fake R 4.5.0\\n' ;;
  *"installed.packages"*) printf 'base\\t4.5.0\\nutils\\t4.5.0\\n' ;;
  *" -e "*) printf 'dsh-科学-✓' ;;
  *)
    while [ "$#" -gt 2 ]; do shift; done
    exec "${process.execPath}" "$1" "$2"
    ;;
esac
`)
  chmodSync(executable, 0o755)
  return prefix
}

/** Return a bwrap-compatible no-policy test runner for real LocalSandboxProvider composition. */
export function createFakeSandboxRunner(root: string): string {
  const runner = join(root, 'fake-sandbox-runner')
  writeFileSync(runner, `#!/bin/sh
while [ "$#" -gt 0 ]; do
  if [ "$1" = '--' ]; then
    shift
    exec "$@"
  fi
  shift
done
printf 'science-runtime fake runner did not receive a command separator\\n' >&2
exit 127
`)
  chmodSync(runner, 0o755)
  return runner
}

/** Assemble the Runtime with deterministic host-local subprocess observations. */
export async function createControlledRuntimeHarness(
  root: string,
  profiles: Config['profiles'],
  timeoutMs = 10_000,
  /** Override the mounted `scienceArtifactStore` service with a test double. */
  storeOverride?: (ctx: Context) => void,
  /** Additional `ScienceRuntime` Config fields (e.g. the `capture*` bounds), merged over the harness's own defaults. */
  configOverrides?: Partial<Config>,
): Promise<{
  readonly ctx: Context
  readonly runtime: ScienceRuntime
  readonly subprocess: ControlledSubprocess
  readonly sandbox: DirectSandbox
  readonly runtimeFiber: Awaited<ReturnType<Context['plugin']>>
}> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(ScienceSessionInvariant)
  await ctx.plugin(ControlledSubprocess)
  await ctx.plugin(DirectSandbox)
  if (storeOverride === undefined) {
    await mountArtifactStore(ctx, root)
  } else {
    storeOverride(ctx)
  }
  const runtimeFiber = await ctx.plugin(ScienceRuntime, {
    dshHome: join(root, 'dsh-home'),
    profiles,
    timeoutMs,
    ...configOverrides,
  })
  return {
    ctx,
    runtime: ctx.scienceRuntime,
    subprocess: ctx.subprocess as ControlledSubprocess,
    sandbox: ctx.sandbox as DirectSandbox,
    runtimeFiber,
  }
}

/** Assemble a fast behavior harness; real provider composition stays in its dedicated Loader test. */
export async function createFastRuntimeHarness(
  root: string,
  profiles: Config['profiles'],
  timeoutMs = 10_000,
): ReturnType<typeof createControlledRuntimeHarness> {
  return createControlledRuntimeHarness(root, profiles, timeoutMs)
}

/** Create one live Science session with its required durable mode fact and a private workspace directory as its cwd. */
export function createScienceSession(ctx: Context, id: string, cwd = mkdtempSync(join(tmpdir(), 'science-workspace-'))): Session {
  const session = ctx.sessions.create(SessionId(id), { meta: { agentPreset: 'science', cwd } })
  session.append('science/mode-bound', {
    version: 1,
    mode: { modeId: 'science', presetId: 'science', modeRevision: 'phase-2-test' },
  })
  return session
}

/** Attach a Science Session manually so a focused lifecycle test can dispose exactly that lifecycle. */
export function attachScienceSession(ctx: Context, id: string, seed?: readonly import('@deepseek-ai/dsh-session').SessionEvent[]): {
  readonly session: Session
  readonly detach: () => void
} {
  const session = ctx.sessions.prepare(SessionId(id), {
    ...(seed === undefined ? {} : { seed: [...seed] }),
    meta: { agentPreset: 'science', cwd: mkdtempSync(join(tmpdir(), 'science-workspace-')) },
  })
  const detach = ctx.sessions.enter(session)
  ctx.sessions.announce(session)
  if (seed === undefined) {
    session.append('science/mode-bound', {
      version: 1,
      mode: { modeId: 'science', presetId: 'science', modeRevision: 'phase-2-test' },
    })
  }
  return { session, detach }
}

/**
 * The next fresh turn number for one more {@link authorizeToolCall} in this
 * session: one past however many `step/start` facts already exist, the only
 * source of `step/start` in this harness (`authorizeRunInTurn`-style helpers
 * that stay inside an already-open turn append `tool/call` alone).
 */
function nextFreshTurn(session: Session): number {
  return session.events.filter(event => event.type === 'step/start').length + 1
}

/** Append the request/header and a named tool-call fact that authorizes one direct Science mutation, opening a fresh turn every call. */
function authorizeToolCall(session: Session, name: string, id: string): {
  readonly toolCallId: ReturnType<typeof CallId>
  readonly requestHeaderSeq: number
} {
  const turn = nextFreshTurn(session)
  session.append('step/start', { turn, step: 1 })
  const header = session.append('request/header', {
    header: { config: { provider: 'test', model: 'test-model' } },
    reason: 'initial',
  })
  const toolCallId = CallId(id)
  session.append('tool/call', {
    turn,
    step: 1,
    callId: toolCallId,
    name,
    arguments: '{}',
  })
  return { toolCallId, requestHeaderSeq: header.seq }
}

/** Append the request/header and language-matched tool-call facts that authorize one run. */
export function authorizeRun(session: Session, language: 'python' | 'r', id = 'science-runtime-run-call'): {
  readonly toolCallId: ReturnType<typeof CallId>
  readonly requestHeaderSeq: number
} {
  return authorizeToolCall(session, language === 'python' ? 'run_python' : 'run_r', id)
}

/** Append the request/header and run_python tool-call facts that authorize one Python run. */
export function authorizePythonRun(session: Session, id = 'science-runtime-run-call') {
  return authorizeRun(session, 'python', id)
}

/**
 * Append the two `tool/call` facts one assistant step's `run_python` +
 * `run_r` calls would carry — one shared `step/start`/`request/header`, one
 * `tool/call` per language — matching the real model output that reaches
 * `startRun` for each: {@link authorizeRun}'s own per-call fresh turn/header
 * only fits a call issued alone.
 * @param session - session to append the shared turn's facts to.
 * @param ids - per-language `toolCallId` values; defaults distinguish the two calls.
 * @returns the shared `requestHeaderSeq` plus each language's own `toolCallId`.
 */
export function authorizeConcurrentRuns(
  session: Session,
  ids: { readonly python?: string; readonly r?: string } = {},
): {
  readonly requestHeaderSeq: number
  readonly python: ReturnType<typeof CallId>
  readonly r: ReturnType<typeof CallId>
} {
  const turn = nextFreshTurn(session)
  session.append('step/start', { turn, step: 1 })
  const header = session.append('request/header', {
    header: { config: { provider: 'test', model: 'test-model' } },
    reason: 'initial',
  })
  const python = CallId(ids.python ?? 'science-runtime-run-call-python')
  session.append('tool/call', { turn, step: 1, callId: python, name: 'run_python', arguments: '{}' })
  const r = CallId(ids.r ?? 'science-runtime-run-call-r')
  session.append('tool/call', { turn, step: 1, callId: r, name: 'run_r', arguments: '{}' })
  return { requestHeaderSeq: header.seq, python, r }
}

/** Append the request/header and annotate_artifact tool-call facts that authorize one curated re-save. */
export function authorizeAnnotateArtifact(session: Session, id = 'science-runtime-annotate-artifact-call') {
  return authorizeToolCall(session, 'annotate_artifact', id)
}

/**
 * Replace a live `ScienceRuntime`'s internal `KernelSet`, reaching the
 * private `kernels` field and its `appendKernelStarted`/`appendKernelEnded`/
 * `nextKernelEpoch` methods the same way `lifecycle.spec.ts`'s own tests
 * reach `leases` (TypeScript `readonly` has no runtime effect), so the
 * replacement kernel set still commits durable facts through the exact same
 * code the production one runs — only `assetsRoot`/the timeouts/the
 * subprocess-sandbox pair differ.
 * @param ctx - the context that mounted `runtime`; also the default source of `subprocess`/`sandbox` when `options` omits them.
 * @param runtime - the live `ScienceRuntime` whose kernel set is replaced.
 * @param options - the fake driver assets root, kernel timeouts, and (for a
 *   Loader composition whose own `subprocess` entry cannot spawn a real
 *   kernel process) an explicit real subprocess/sandbox pair for this replacement.
 */
export function installTestKernelSet(
  ctx: Context,
  runtime: ScienceRuntime,
  options: {
    readonly assetsRoot?: string
    readonly kernelIdleTimeoutMs?: number
    readonly kernelStartTimeoutMs?: number
    readonly subprocess?: SubprocessRuntime
    readonly sandbox?: SandboxProvider
  } = {},
): void {
  const internal = runtime as unknown as {
    kernels: KernelSet
    appendKernelStarted(session: Session, fact: ScienceKernelStartedFact): void
    appendKernelEnded(session: Session, fact: ScienceKernelEndedFact): void
    nextKernelEpoch(session: Session): number
  }
  internal.kernels = new KernelSet({
    subprocess: options.subprocess ?? ctx.subprocess,
    sandbox: options.sandbox ?? ctx.sandbox,
    assetsRoot: options.assetsRoot ?? KERNEL_ASSETS_FULL_ROOT,
    kernelIdleTimeoutMs: options.kernelIdleTimeoutMs ?? 1_800_000,
    kernelStartTimeoutMs: options.kernelStartTimeoutMs ?? 5_000,
    nextEpoch: session => internal.nextKernelEpoch(session),
    onKernelStarted: (session, fact) => { internal.appendKernelStarted(session, fact) },
    onKernelEnded: (session, fact) => { internal.appendKernelEnded(session, fact) },
  })
}

/**
 * Assemble the Runtime against real `dsh-subprocess-local`/`dsh-sandbox-local`
 * providers (a no-policy fake runner, matching `kernel-process.spec.ts`'s
 * own composition) with its internal `KernelSet` replaced ({@link installTestKernelSet})
 * to resolve driver assets under the fake kernel-wire-protocol driver pair at
 * `kernel-set-assets-full/` instead of the package's real shipped
 * `kernel_python.py`/`kernel_r.R`. `startRun`'s `code` argument becomes the
 * fake driver's own JSON action string (see `fake-kernel-driver.mjs`'s own
 * doc), never real interpreter source. `bindEnvironment` and its probes run
 * unmodified against `createFakePythonPrefix`/`createFakeRPrefix`'s combined
 * probe/kernel-forwarding executables.
 * @param root - private temp root this call owns.
 * @param profiles - Runtime profile configuration.
 * @param timeoutMs - operation deadline forwarded to every `ScienceRuntime` call.
 * @param kernelIdleTimeoutMs - overrides the kernel idle deadline for idle-expiry coverage.
 * @param storeOverride - Override the mounted `scienceArtifactStore` service with a test double.
 * @param configOverrides - Additional `ScienceRuntime` Config fields (e.g. the `capture*` bounds), merged over the harness's own defaults.
 * @returns the assembled context, the live `ScienceRuntime`, and its Cordis fiber.
 */
export async function createKernelRuntimeHarness(
  root: string,
  profiles: Config['profiles'],
  timeoutMs = 10_000,
  kernelIdleTimeoutMs = 1_800_000,
  storeOverride?: (ctx: Context) => void,
  configOverrides?: Partial<Config>,
): Promise<{
  readonly ctx: Context
  readonly runtime: ScienceRuntime
  readonly runtimeFiber: Awaited<ReturnType<Context['plugin']>>
}> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(ScienceSessionInvariant)
  await ctx.plugin(LocalSubprocessRuntime)
  const runner = createFakeSandboxRunner(root)
  await ctx.plugin(LocalSandboxProvider, {
    runnerCommand: [runner],
    runnerFailureSignatures: ['science-runtime fake runner failure'],
  })
  if (storeOverride === undefined) {
    await mountArtifactStore(ctx, root)
  } else {
    storeOverride(ctx)
  }
  const runtimeFiber = await ctx.plugin(ScienceRuntime, {
    dshHome: join(root, 'dsh-home'),
    profiles,
    timeoutMs,
    ...configOverrides,
  })
  const runtime = ctx.scienceRuntime
  installTestKernelSet(ctx, runtime, { assetsRoot: KERNEL_ASSETS_FULL_ROOT, kernelIdleTimeoutMs, kernelStartTimeoutMs: 5_000 })
  return { ctx, runtime, runtimeFiber }
}

/** Build one fake driver action string for `startRun`'s `code` argument (see `fake-kernel-driver.mjs`'s own doc). */
export function kernelAction(action: Record<string, unknown>): string {
  return JSON.stringify(action)
}
