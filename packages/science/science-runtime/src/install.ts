/**
 * Package-install argv, confinement, and subprocess execution for micromamba.
 * Installing writes into the target Conda prefix by design, the opposite of
 * every other Runtime confinement site (probes and kernels require the
 * prefix read-only) — see {@link confineInstallArgv}'s own doc for the
 * resulting divergence from `execution.ts`'s `confineWithFullEnforcement`.
 */

import { randomUUID } from 'node:crypto'
import { lstat, mkdir, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { SandboxUnavailableError } from '@deepseek-ai/dsh-sandbox'
import type { ConfinedArgv, SandboxPolicy, SandboxProvider } from '@deepseek-ai/dsh-sandbox'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SubprocessOutputRead, SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { DESCENDANT_GRACE_MS, interpreterPathEnv, localeEnvironment } from './execution.ts'
import type { OperationControl } from './lifecycle.ts'
import { ScienceRuntimeError } from './types.ts'
import type { InstallScienceEnvironmentPackagesStatus, ScienceRunOutput } from './types.ts'

/** Fixed maximum packages accepted by one install call — a safety backstop on argv size, not a deployment tunable. */
export const MAX_INSTALL_PACKAGES = 50
/** Fixed maximum accepted length for one package spec. */
export const MAX_PACKAGE_SPEC_LENGTH = 128
/** Fixed retained bytes per installer output stream, matching `execution.ts`'s `MAX_OUTPUT_BYTES`. */
export const INSTALL_OUTPUT_MAX_BYTES = 64_000

/**
 * Conda/mamba package-spec grammar: a leading alphanumeric (never `-`, which
 * would parse as a flag against unconfirmed argv) followed by name, version,
 * and build-string characters conda-forge specs use (`numpy`, `numpy=1.26`,
 * `r-dplyr>=1.1,<2`).
 */
const PACKAGE_SPEC = /^[A-Za-z0-9][A-Za-z0-9_.,=<>!~+*-]*$/u

/**
 * Reject an empty, oversized, duplicated, or malformed package-spec list
 * before any process starts.
 * @param packages - caller-supplied package specs.
 * @throws {@link ScienceRuntimeError} (`INVALID_REQUEST`) for any violation.
 */
export function assertValidPackageSpecs(packages: readonly string[]): void {
  if (packages.length === 0) {
    throw new ScienceRuntimeError('INVALID_REQUEST', 'Science package install requires at least one package spec')
  }
  if (packages.length > MAX_INSTALL_PACKAGES) {
    throw new ScienceRuntimeError('INVALID_REQUEST', `Science package install accepts at most ${String(MAX_INSTALL_PACKAGES)} package specs`)
  }
  if (new Set(packages).size !== packages.length) {
    throw new ScienceRuntimeError('INVALID_REQUEST', 'Science package install specs must be unique')
  }
  for (const spec of packages) {
    if (spec.length > MAX_PACKAGE_SPEC_LENGTH || !PACKAGE_SPEC.test(spec)) {
      throw new ScienceRuntimeError('INVALID_REQUEST', `Science package install spec ${JSON.stringify(spec)} is invalid`)
    }
  }
}

const UNIX_EXECUTE_BITS = 0o111

/** Classify only filesystem missing-path errors as installer unavailability, mirroring `environment.ts`'s `missingPathError`. */
function missingPathError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const code = (error as { readonly code?: unknown }).code
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP'
}

/** Convert an ordinary missing path into an honest `INSTALLER_UNAVAILABLE` classification, preserving other I/O failures. */
function unavailableOnMissing(error: unknown, description: string): never {
  if (missingPathError(error)) throw new ScienceRuntimeError('INSTALLER_UNAVAILABLE', description)
  throw error
}

/**
 * Resolve and verify the configured micromamba executable before any child
 * process starts: it must exist, be a regular file, and carry the execute
 * bit on POSIX. `realpath` fully dereferences a symlink chain first, so a
 * configured symlink to a valid executable resolves normally; only the
 * fully resolved target's own file type and permission bits are checked.
 * @param configuredPath - the deployment's configured `micromambaPath`.
 * @returns the canonical resolved executable path.
 * @throws {@link ScienceRuntimeError} (`INSTALLER_UNAVAILABLE`) when the configured path is not a usable executable.
 */
export async function staticMicromamba(configuredPath: string): Promise<string> {
  let executable: string
  try {
    executable = await realpath(configuredPath)
  } catch (error) {
    unavailableOnMissing(error, 'configured micromamba path is absent or cannot be resolved')
  }
  let info: Awaited<ReturnType<typeof lstat>>
  try {
    info = await lstat(executable)
  } catch (error) {
    unavailableOnMissing(error, 'configured micromamba path is absent or cannot be resolved')
  }
  if (!info.isFile() || (process.platform !== 'win32' && (info.mode & UNIX_EXECUTE_BITS) === 0)) {
    throw new ScienceRuntimeError('INSTALLER_UNAVAILABLE', 'configured micromamba path is not a regular executable')
  }
  return executable
}

/**
 * Direct, unconfined argv for one non-interactive micromamba install into an
 * existing prefix: pinned to exactly the one configured `channelUrl` for
 * this attempt (`--override-channels` excludes every other channel, so
 * `.condarc`, an ambient default, or any other configured channel URL from
 * this deployment's own `installChannels` list can never widen the solve
 * this attempt performs), and `--no-rc` so no ambient `.condarc` (user,
 * system, or otherwise) can widen or narrow channel selection either. A
 * conda-forge-family channel is the deciding factor for R, whose CRAN
 * source builds need a toolchain most researchers do not have.
 * @param executable - canonical micromamba executable.
 * @param canonicalPrefix - canonicalized target Conda prefix.
 * @param packages - validated package specs.
 * @param channelUrl - the exact configured channel URL this attempt searches.
 * @returns the complete direct argv, unconfined.
 */
export function installArgv(executable: string, canonicalPrefix: string, packages: readonly string[], channelUrl: string): string[] {
  return [
    executable, 'install', '--yes', '--no-rc',
    '--prefix', canonicalPrefix,
    '--override-channels', '--channel', channelUrl,
    ...packages,
  ]
}

/**
 * Private scratch this install's own subprocess uses for HOME/TMPDIR/cwd,
 * rooted inside the target prefix (see {@link confineInstallArgv}).
 */
export interface InstallScratch {
  readonly directory: string
  readonly home: string
  readonly tmp: string
}

/**
 * Plan one unique private install-scratch tree under the target prefix.
 * Rooted at the prefix (not the Session scratch tree probes use) because the
 * confinement policy below grants exactly one writable root, and every path
 * the installer touches — its own HOME/TMPDIR and the packages it writes —
 * must fall under it.
 * @param canonicalPrefix - canonicalized target Conda prefix.
 * @returns future private install-scratch paths.
 */
export function planInstallScratch(canonicalPrefix: string): InstallScratch {
  const directory = join(canonicalPrefix, '.dsh-science-install', randomUUID())
  return { directory, home: join(directory, 'home'), tmp: join(directory, 'tmp') }
}

/**
 * Create one planned install-scratch tree.
 * @param scratch - the planned paths to create (see {@link planInstallScratch}).
 */
export async function createInstallScratch(scratch: InstallScratch): Promise<void> {
  await mkdir(scratch.home, { recursive: true, mode: 0o700 })
  await mkdir(scratch.tmp, { recursive: true, mode: 0o700 })
}

/**
 * Remove one install-scratch tree; safe to call even if creation never completed.
 * @param scratch - the scratch paths to remove (see {@link planInstallScratch}).
 */
export async function removeInstallScratch(scratch: InstallScratch): Promise<void> {
  await rm(scratch.directory, { recursive: true, force: true })
}

/**
 * Exact child environment for the installer: HOME/TMPDIR isolated to this
 * install's own scratch, `MAMBA_ROOT_PREFIX` pointed at the target prefix
 * itself so its package cache lands under the one writable root, and the
 * fixed locale allowlist every confined Runtime child uses.
 * @param canonicalPrefix - canonicalized target Conda prefix.
 * @param scratch - this install's own private scratch paths.
 * @returns the exact environment entries for the installer child.
 */
export function installEnvironment(canonicalPrefix: string, scratch: InstallScratch): NodeJS.ProcessEnv {
  return {
    HOME: scratch.home,
    TMPDIR: scratch.tmp,
    PATH: interpreterPathEnv(canonicalPrefix),
    MAMBA_ROOT_PREFIX: canonicalPrefix,
    ...localeEnvironment(),
  }
}

/** `workspace-write` policy rooted at the target prefix itself, not the Session scratch tree. */
function installConfinementPolicy(session: Session, canonicalPrefix: string): SandboxPolicy {
  return { mode: 'workspace-write', workspaceRoot: canonicalPrefix, sessionId: session.id }
}

/**
 * Sandbox-confine the install argv under a policy that grants exactly the
 * target prefix as its writable root. This is the mirror image of
 * `execution.ts`'s `confineWithFullEnforcement`: every other confinement
 * site in this Runtime asserts the interpreter's own prefix stays OUTSIDE
 * every writable root, because a probe or kernel must never write the
 * environment it observes or runs against. An install's entire purpose is
 * writing into that same prefix, so this never calls `assertPrefixReadOnly`
 * — the one deliberate asymmetry against that shared helper. Every other
 * safety property still holds: full enforcement is required, and an
 * unavailable sandbox maps to the same `CONFINEMENT_UNAVAILABLE` code.
 * @param sandbox - sandbox provider performing the confinement.
 * @param session - exact live Session that owns the confinement policy.
 * @param canonicalPrefix - canonicalized target Conda prefix.
 * @param argv - direct, unconfined argv (see {@link installArgv}).
 * @returns the confined argv.
 * @throws {@link ScienceRuntimeError} (`CONFINEMENT_UNAVAILABLE`) when the sandbox is unavailable or reports less than full enforcement.
 */
export function confineInstallArgv(
  sandbox: SandboxProvider,
  session: Session,
  canonicalPrefix: string,
  argv: readonly string[],
): ConfinedArgv {
  let confined: ConfinedArgv
  try {
    confined = sandbox.confine(argv, installConfinementPolicy(session, canonicalPrefix))
  } catch (error) {
    if (error instanceof SandboxUnavailableError) {
      throw new ScienceRuntimeError('CONFINEMENT_UNAVAILABLE', 'Science requires an available full sandbox', { cause: error })
    }
    throw error
  }
  if (confined.enforcement !== 'full') {
    throw new ScienceRuntimeError('CONFINEMENT_UNAVAILABLE', 'Science requires full sandbox enforcement')
  }
  return confined
}

/** Convert a batch (`readFrom(0)` after settlement) subprocess output read into the durable `ScienceRunOutput` shape. */
function toRunOutput(read: SubprocessOutputRead | undefined): ScienceRunOutput {
  if (read === undefined) return { text: '', bytes: 0, truncated: false }
  return { text: read.text, bytes: read.nextOffset, truncated: read.lossy }
}

/** Terminal classification and bounded output for one settled installer subprocess. */
export interface InstallOutcome {
  readonly status: InstallScienceEnvironmentPackagesStatus
  readonly stdout: ScienceRunOutput
  readonly stderr: ScienceRunOutput
}

/**
 * Run one confined micromamba install to completion, classifying the
 * settled subprocess outcome ahead of `control`'s own first cause: a
 * process that exits `0` with no signal is `'success'` even when `control`
 * separately latched a cause (a solve that finishes inside the bounded
 * SIGTERM grace after its deadline fired is a real, on-disk install, not a
 * failed one). Only a process that did not complete successfully falls back
 * to `control.cause` for `'timed-out'`/`'cancelled'`, else `'failed'`. Never
 * throws for a completed or aborted attempt; only an unproven quiescence or
 * a subprocess-provider failure (never observed as an abort) throws, since
 * neither can be expressed as a durable install status.
 * @param subprocess - subprocess seam performing the spawn.
 * @param confined - confined installer argv.
 * @param env - exact child environment (see {@link installEnvironment}).
 * @param cwd - the installer's own scratch directory.
 * @param control - this operation's fused cancellation/timeout signal and first-cause record.
 * @returns the install's terminal classification and bounded output tails.
 */
export async function runMicromambaInstall(
  subprocess: SubprocessRuntime,
  confined: ConfinedArgv,
  env: NodeJS.ProcessEnv,
  cwd: string,
  control: OperationControl,
): Promise<InstallOutcome> {
  const handle = subprocess.spawn({
    argv: confined.argv,
    cwd,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: INSTALL_OUTPUT_MAX_BYTES },
      stderr: { maxBytes: INSTALL_OUTPUT_MAX_BYTES },
    },
    graceMs: DESCENDANT_GRACE_MS,
    environmentBase: 'empty',
    env,
    signal: control.signal,
  })
  let outcome: Awaited<typeof handle.done> | undefined
  let completionError: unknown
  try {
    outcome = await handle.done
  } catch (error) {
    completionError = error
  }
  // Caller cancellation already asks the shared subprocess provider to
  // terminate; this waits without the caller signal so the scratch
  // directory is never removed while a managed tree still owns it.
  const quiescent = await handle.waitForExit()
  const stdout = toRunOutput(handle.collected.stdout?.readFrom(0))
  const stderr = toRunOutput(handle.collected.stderr?.readFrom(0))
  // Success is checked ahead of control.cause: a micromamba that exits 0
  // inside the bounded SIGTERM grace after the deadline fired already wrote
  // its target environment, and reporting that as 'timed-out' misleads the
  // caller into a redundant retry (the retry then observes an unchanged
  // inventory and appends no revision — see installPackages — but only
  // after wrongly restarting the kernel epoch on the first, misreported run).
  if (quiescent && completionError === undefined && outcome !== undefined && outcome.exitCode === 0 && outcome.signal === null) {
    return { status: 'success', stdout, stderr }
  }
  if (control.cause !== undefined) {
    return { status: control.cause === 'timeout' ? 'timed-out' : 'cancelled', stdout, stderr }
  }
  if (!quiescent) throw new ScienceRuntimeError('QUIESCENCE_UNPROVEN', 'package installer did not reach whole-tree quiescence')
  if (completionError !== undefined) {
    throw completionError instanceof Error ? completionError : new Error('science-runtime: package installer failed without an Error object')
  }
  if (outcome === undefined) throw new Error('science-runtime: package installer settled without a subprocess outcome')
  return { status: 'failed', stdout, stderr }
}
