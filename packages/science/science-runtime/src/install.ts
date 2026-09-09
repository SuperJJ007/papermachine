/**
 * Package-install argv, confinement, and subprocess execution for micromamba.
 * Installing writes into the target Conda prefix by design, the opposite of
 * every other Runtime confinement site (probes and kernels require the
 * prefix read-only) — see {@link confineInstallArgv}'s own doc for the
 * resulting divergence from `execution.ts`'s `confineWithEnforcement`.
 */

import { randomUUID } from 'node:crypto'
import { lstat, mkdir, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { ConfinedArgv, SandboxEnforcement, SandboxPolicy, SandboxProvider } from '@deepseek-ai/dsh-sandbox'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { interpreterPathEnv, localeEnvironment, confineRequiringEnforcement } from './execution.ts'
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
 * `execution.ts`'s `confineWithEnforcement`: every other confinement
 * site in this Runtime asserts the interpreter's own prefix stays OUTSIDE
 * every writable root, because a probe or kernel must never write the
 * environment it observes or runs against. An install's entire purpose is
 * writing into that same prefix, so this never calls `assertPrefixReadOnly`
 * — the one deliberate asymmetry against that shared helper. Every other
 * safety property still holds: the shared {@link confineRequiringEnforcement}
 * helper validates the reported enforcement, and an unavailable sandbox maps to the same
 * `CONFINEMENT_UNAVAILABLE` code.
 * @param sandbox - sandbox provider performing the confinement.
 * @param session - exact live Session that owns the confinement policy.
 * @param canonicalPrefix - canonicalized target Conda prefix.
 * @param argv - direct, unconfined argv (see {@link installArgv}).
 * @param minimumEnforcement - lowest enforcement level Science is configured
 *   to accept (`science-runtime`'s configured `minimumEnforcement`,
 *   forwarded the same way `confineInterpreterArgv` in `execution.ts`
 *   receives it).
 * @returns the confined argv.
 * @throws {@link ScienceRuntimeError} (`CONFINEMENT_UNAVAILABLE`) when the
 *   sandbox is unavailable or reports less than `minimumEnforcement`.
 */
export function confineInstallArgv(
  sandbox: SandboxProvider,
  session: Session,
  canonicalPrefix: string,
  argv: readonly string[],
  minimumEnforcement: SandboxEnforcement,
): ConfinedArgv {
  return confineRequiringEnforcement(sandbox, installConfinementPolicy(session, canonicalPrefix), argv, minimumEnforcement)
}


/** Terminal classification and bounded output for one settled installer subprocess. */
export interface InstallOutcome {
  readonly status: InstallScienceEnvironmentPackagesStatus
  readonly stdout: ScienceRunOutput
  readonly stderr: ScienceRunOutput
}

/**
 * Unavailable during P1; P2 owns this implementation.
 * @param _subprocess - Input reserved for P2.
 * @param _confined - Input reserved for P2.
 * @param _env - Input reserved for P2.
 * @param _cwd - Input reserved for P2.
 * @param _control - Input reserved for P2.
 * @throws Always rejects execution while the migration is pending.
 */
export async function runMicromambaInstall(
  _subprocess: SubprocessRuntime,
  _confined: ConfinedArgv,
  _env: NodeJS.ProcessEnv,
  _cwd: string,
  _control: OperationControl,
): Promise<InstallOutcome> {
  // FIXME(replant): P2: isolated installer subprocess.
  throw new Error('Science migration pending — P2: isolated installer subprocess')
}
