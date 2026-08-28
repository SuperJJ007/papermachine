/** Focused fake-prefix coverage for Science environment binding and probes. */

import { createHash } from 'node:crypto'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { SandboxUnavailableError } from '@deepseek-ai/dsh-sandbox'
import type { ConfinedArgv, SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import { ScienceEnvironmentProfileId, ScienceProjectId } from '@deepseek-ai/dsh-science-session'
import type { ScienceInterpreterBinding } from '@deepseek-ai/dsh-science-session'
import * as ScienceSessionInvariant from '@deepseek-ai/dsh-science-session/invariant'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import ScienceRuntime from '../src/index.ts'
import { MIN_PACKAGES_MAX_BYTES, resolveConfig } from '../src/config.ts'
import { observeProfile, sameObservation } from '../src/environment.ts'
import { ensureSessionScratch, sessionScratchKey } from '../src/scratch.ts'
import {
  ControlledSubprocess,
  createFastRuntimeHarness,
  createFakeRPrefix,
  createFakePythonPrefix,
  createKernelRuntimeHarness,
  createScienceSession,
  authorizePythonRun,
  DirectSandbox,
  kernelAction,
  mountArtifactStore,
} from './harness.ts'

// Several cases here spawn a real kernel subprocess through
// LocalSubprocessRuntime; under full-suite concurrency, spawn and pipe I/O
// contend for the OS scheduler and the default 5s timeout is not enough.
vi.setConfig({ testTimeout: 30_000 })

const staticFsFault = vi.hoisted(() => ({
  history: '', executable: '', nonObject: '', cleanupPath: '',
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...original,
    readFile: async (path: Parameters<typeof original.readFile>[0], options?: Parameters<typeof original.readFile>[1]) => {
      if (path === staticFsFault.history) throw Object.assign(new Error('injected static filesystem failure'), { code: 'EACCES' })
      return original.readFile(path, options as never)
    },
    lstat: async (path: Parameters<typeof original.lstat>[0], options?: Parameters<typeof original.lstat>[1]) => {
      if (path === staticFsFault.executable) throw Object.assign(new Error('injected static path loss'), { code: 'ENOENT' })
      if (path === staticFsFault.nonObject) throw 'injected non-Error static failure'
      return original.lstat(path, options as never)
    },
    rm: async (path: Parameters<typeof original.rm>[0], options?: Parameters<typeof original.rm>[1]) => {
      if (path === staticFsFault.cleanupPath) throw new Error('injected managed cleanup failure')
      return original.rm(path, options)
    },
  }
})

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  Object.assign(staticFsFault, {
    history: '', executable: '', nonObject: '', cleanupPath: '',
  })
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Force both independently owned observations to fail so aggregation keeps their cleanup ordering. */
class EveryProbeFailureSandbox extends DirectSandbox {
  failure: unknown = new Error('injected probe failure')

  override confine(_argv: readonly string[], _policy: SandboxPolicy): ConfinedArgv {
    throw this.failure
  }
}

/** Surface defensive subprocess-provider failures through the public bind operation. */
class BrokenProbeSubprocess extends ControlledSubprocess {
  mode: 'error-rejection' | 'non-error-rejection' | 'no-outcome' | 'unquiescent' | 'missing-output' | 'version-both-streams' | 'version-nul' | 'version-stderr-only' = 'non-error-rejection'
  private broken = false

  override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    const handle = super.spawn(spec)
    if (this.broken || (!spec.argv.includes('--version') && !spec.argv.includes('-c'))) return handle
    this.broken = true
    if (this.mode === 'error-rejection') return { ...handle, done: Promise.reject(new Error('Error subprocess rejection')) }
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- scripts a non-Error spawn rejection.
    if (this.mode === 'non-error-rejection') return { ...handle, done: Promise.reject('non-Error subprocess rejection') }
    if (this.mode === 'no-outcome') return { ...handle, done: Promise.resolve(undefined as never) }
    if (this.mode === 'unquiescent') return { ...handle, waitForExit: async () => false }
    if (this.mode === 'missing-output') {
      const { stdout: _stdout, ...collected } = handle.collected
      return { ...handle, collected }
    }
    if (spec.argv.includes('--version')) {
      const stdout = this.mode === 'version-both-streams' ? 'Fake stdout\n' : this.mode === 'version-stderr-only' ? '' : 'Fake\0Python\n'
      const stderr = this.mode === 'version-both-streams' ? 'Fake stderr\n' : this.mode === 'version-stderr-only' ? 'Fake Python 3.13.5\n' : ''
      const reader = (text: string) => ({ readFrom: () => ({ text, nextOffset: Buffer.byteLength(text), lossy: false, utf8Validity: 'valid' as const }) })
      return { ...handle, collected: { stdout: reader(stdout), stderr: reader(stderr) } }
    }
    return handle
  }
}

/** Changes history after each Unicode probe to prove the bounded unstable-observation result. */
class ChangingHistorySubprocess extends ControlledSubprocess {
  private revision = 0
  history = ''

  override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    const handle = super.spawn(spec)
    if (spec.argv.includes('-c') || spec.argv.includes('-e')) {
      this.revision += 1
      writeFileSync(this.history, `history revision ${String(this.revision)}\n`)
    }
    return handle
  }
}

/** Report partial enforcement only when unstable static facts require a retry wrap. */
class RetryPartialSandbox extends DirectSandbox {
  failRollback = false
  private wraps = 0

  override confine(argv: readonly string[], policy: SandboxPolicy): ConfinedArgv {
    this.wraps += 1
    const confined = super.confine(argv, policy)
    // The first prepareProbeAttempt wraps three probes (version, utf8, packages) fully;
    // only the retry's wraps report partial enforcement.
    if (this.wraps <= 3) return confined
    if (this.failRollback) staticFsFault.cleanupPath = dirname(dirname(policy.workspaceRoot))
    return { ...confined, enforcement: 'partial' }
  }
}

/** Make cleanup fail after a probe has settled, then restore the parent for test teardown. */
class ProbeFailureAndCleanupSandbox extends DirectSandbox {
  override confine(argv: readonly string[], policy: SandboxPolicy): ConfinedArgv {
    staticFsFault.cleanupPath = policy.workspaceRoot
    return super.confine(argv, policy)
  }
}

/** Fail a started probe so its independently injected cleanup failure is aggregated. */
class ProbeFailureAndCleanupSubprocess extends ControlledSubprocess {
  failProbe = true

  override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    if (this.failProbe) throw new Error('injected probe failure before cleanup')
    return super.spawn(spec)
  }
}

/** Delay exactly one already-exited R probe until the test permits whole-tree observation. */
class DelayedRVersionSubprocess extends ControlledSubprocess {
  readonly rVersionStarted = Promise.withResolvers<undefined>()
  private readonly releaseVersion = Promise.withResolvers<undefined>()
  private delaying = true
  failPython = true

  releaseRVersion(): void {
    this.releaseVersion.resolve(undefined)
  }

  override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    if (this.failPython && spec.argv[0]?.endsWith('/python')) throw new Error('injected Python probe failure')
    const handle = super.spawn(spec)
    if (!this.delaying || !spec.argv[0]?.endsWith('/Rscript') || !spec.argv.includes('--version')) return handle
    this.delaying = false
    this.rVersionStarted.resolve(undefined)
    return {
      ...handle,
      done: this.releaseVersion.promise.then(async () => handle.done),
      waitForExit: async (signal?: AbortSignal) => {
        await this.releaseVersion.promise
        return handle.waitForExit(signal)
      },
    }
  }
}

/** Return a non-zero R version outcome while preserving the requested argv. */
class FailingRVersionSubprocess extends ControlledSubprocess {
  override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    const handle = super.spawn(spec)
    if (!spec.argv[0]?.endsWith('/Rscript') || !spec.argv.includes('--version')) return handle
    return { ...handle, done: Promise.resolve({ exitCode: 1, signal: null }) }
  }
}

/** Return a non-zero package-inventory probe outcome while preserving the requested argv. */
class FailingPackagesProbeSubprocess extends ControlledSubprocess {
  override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    const handle = super.spawn(spec)
    if (!spec.argv.includes('-m')) return handle
    return { ...handle, done: Promise.resolve({ exitCode: 1, signal: null }) }
  }
}

describe('ScienceRuntime.bindEnvironment', () => {
  it('accepts a blank session recomposed from the default preset into Science', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-recomposed-session-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createFastRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = harness.ctx.sessions.create(SessionId('science-recomposed-session'), {
      meta: { agentPreset: 'standard', cwd: mkdtempSync(join(root, 'workspace-')) },
    })
    session.append('agent-preset/selected', { agentPreset: 'science' })
    session.append('science/mode-bound', {
      version: 1,
      mode: { modeId: 'science', presetId: 'science', modeRevision: 'phase-2-test' },
    })

    await expect(harness.runtime.bindEnvironment({
      session,
      profileId: ScienceEnvironmentProfileId('fake'),
      signal: new AbortController().signal,
    })).resolves.toMatchObject({ status: 'applied' })
  })

  it.each(['error-rejection', 'non-error-rejection', 'no-outcome', 'unquiescent', 'missing-output', 'version-both-streams', 'version-nul', 'version-stderr-only'] as const)('fails loudly when a probe provider is %s', async (mode) => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-broken-probe-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(ScienceSessionInvariant)
    await ctx.plugin(BrokenProbeSubprocess)
    await ctx.plugin(DirectSandbox)
    await mountArtifactStore(ctx, root)
    await ctx.plugin(ScienceRuntime, { dshHome: join(root, 'dsh-home'), profiles: { fake: { pythonPrefix: prefix } } })
    ;(ctx.subprocess as BrokenProbeSubprocess).mode = mode
    const session = createScienceSession(ctx, `science-broken-probe-${mode}`)
    const binding = ctx.scienceRuntime.bindEnvironment({
      session, profileId: ScienceEnvironmentProfileId('fake'), signal: new AbortController().signal,
    })
    if (mode === 'missing-output' || mode === 'version-both-streams' || mode === 'version-nul' || mode === 'version-stderr-only') {
      await expect(binding).resolves.toMatchObject({ status: mode === 'version-stderr-only' ? 'applied' : 'invalid' })
      expect(session.events.map(event => event.type)).toEqual(['science/mode-bound', 'science/environment-bound'])
    } else {
      await expect(binding).rejects.toMatchObject({ code: mode === 'unquiescent' ? 'QUIESCENCE_UNPROVEN' : 'INFRASTRUCTURE_FAILURE' })
      expect(session.events.map(event => event.type)).toEqual(['science/mode-bound'])
    }
  })

  it('uses the Darwin locale allowlist for a host-local direct probe', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-darwin-locale-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createFastRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-darwin-locale')
    const original = Object.getOwnPropertyDescriptor(process, 'platform')
    if (original === undefined) throw new Error('process.platform descriptor is unavailable')
    Object.defineProperty(process, 'platform', { ...original, value: 'darwin' })
    try {
      await expect(harness.runtime.bindEnvironment({
        session, profileId: ScienceEnvironmentProfileId('fake'), signal: new AbortController().signal,
      })).resolves.toMatchObject({ status: 'applied' })
      expect(harness.subprocess.specs.every(spec => spec.env?.LANG === 'en_US.UTF-8' && spec.env.LC_ALL === 'en_US.UTF-8')).toBe(true)
    } finally {
      Object.defineProperty(process, 'platform', original)
    }
  })

  it('records three empty-base, fully confined probes and commits one applied revision', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science runtime-environment-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    expect(lstatSync(join(prefix, 'bin', 'python')).mode & 0o777).toBe(0o700)
    const harness = await createFastRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const { ctx, runtime, sandbox, subprocess } = harness
    const session = createScienceSession(ctx, 'science-bind-fake')
    const environment = await runtime.bindEnvironment({
      session,
      profileId: ScienceEnvironmentProfileId('fake'),
      signal: new AbortController().signal,
    })

    expect(environment).toMatchObject({
      revision: 1,
      profileId: 'fake',
      status: 'applied',
      python: {
        capability: 'available',
        language: 'python',
        canonicalPrefix: prefix,
        executable: join(prefix, 'bin', 'python'),
        languageVersion: 'Fake Python 3.13.5',
        packages: [{ name: 'numpy', version: '1.26.4' }, { name: 'pip', version: '24.0' }],
        packagesTruncated: false,
      },
    })
    expect(session.events.map(event => event.type)).toEqual([
      'science/mode-bound',
      'science/environment-bound',
    ])
    expect(subprocess.specs).toHaveLength(3)
    for (const spec of subprocess.specs) {
      expect(spec.environmentBase).toBe('empty')
      expect(Object.keys(spec.env ?? {}).sort()).toEqual(['HOME', 'LANG', 'LC_ALL', 'PATH', 'TMPDIR', 'TZ'])
      expect(spec.cwd).toContain('/probes/')
    }
    const [versionSpec, utf8Spec, packagesSpec] = subprocess.specs
    for (const spec of [versionSpec, utf8Spec]) {
      expect(spec?.stdio).toEqual({
        stdin: 'ignore',
        stdout: { maxBytes: 1_024 },
        stderr: { maxBytes: 1_024 },
      })
    }
    expect(packagesSpec?.stdio).toEqual({
      stdin: 'ignore',
      stdout: { maxBytes: 8 * 1024 * 1024 },
      stderr: { maxBytes: 8 * 1024 * 1024 },
    })
    expect(packagesSpec?.argv).toEqual([join(prefix, 'bin', 'python'), '-I', '-B', '-X', 'utf8', '-m', 'pip', 'list', '--format=json'])
    expect(sandbox.policies).toHaveLength(3)
    expect(sandbox.policies.every(policy => policy.mode === 'workspace-write')).toBe(true)
    expect(sandbox.policies.every(policy => policy.workspaceRoot.includes('/probes/'))).toBe(true)
  })

  it('uses a standalone R version argv and preserves strict flags on the UTF-8 probe', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-r-argv-'))
    roots.push(root)
    const prefix = createFakeRPrefix(root)
    const harness = await createFastRuntimeHarness(root, { r: { rPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-bind-r-argv')

    await expect(harness.runtime.bindEnvironment({
      session,
      profileId: ScienceEnvironmentProfileId('r'),
      signal: new AbortController().signal,
    })).resolves.toMatchObject({
      status: 'applied',
      r: {
        capability: 'available',
        languageVersion: 'Fake R 4.5.0',
        packages: [{ name: 'base', version: '4.5.0' }, { name: 'utils', version: '4.5.0' }],
      },
    })
    const executable = join(prefix, 'bin', 'Rscript')
    expect(harness.subprocess.specs.map(spec => spec.argv)).toEqual([
      [executable, '--version'],
      [executable, '--vanilla', '--encoding=UTF-8', '-e', 'cat(enc2utf8("dsh-科学-✓"),sep="")'],
      [executable, '--vanilla', '--encoding=UTF-8', '-e',
        "m <- installed.packages()[, c('Package', 'Version'), drop = FALSE]; "
          + "write.table(m, file = stdout(), sep = '\\t', quote = FALSE, row.names = FALSE, col.names = FALSE)"],
    ])
  })

  it('records a non-zero R version probe as an invalid environment observation', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-r-version-failure-'))
    roots.push(root)
    const prefix = createFakeRPrefix(root)
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(ScienceSessionInvariant)
    await ctx.plugin(FailingRVersionSubprocess)
    await ctx.plugin(DirectSandbox)
    await mountArtifactStore(ctx, root)
    await ctx.plugin(ScienceRuntime, { dshHome: join(root, 'dsh-home'), profiles: { r: { rPrefix: prefix } } })
    const session = createScienceSession(ctx, 'science-bind-r-version-failure')

    await expect(ctx.scienceRuntime.bindEnvironment({
      session,
      profileId: ScienceEnvironmentProfileId('r'),
      signal: new AbortController().signal,
    })).resolves.toMatchObject({
      status: 'invalid',
      r: {
        capability: 'invalid',
        reason: 'interpreter probes did not produce the required lossless output',
      },
    })
    expect(session.events.map(event => event.type)).toEqual([
      'science/mode-bound',
      'science/environment-bound',
    ])
  })

  it('rejects a configured prefix that overlaps the future writable Science root before it creates any scratch', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-overlap-'))
    roots.push(root)
    const dshHome = join(root, 'dsh-home')
    const prefix = join(dshHome, 'science')
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(ScienceSessionInvariant)
    await ctx.plugin(ControlledSubprocess)
    await ctx.plugin(DirectSandbox)
    await mountArtifactStore(ctx, root)
    await ctx.plugin(ScienceRuntime, { dshHome, profiles: { overlap: { pythonPrefix: prefix } } })
    const session = ctx.sessions.create(SessionId('science-bind-overlap'), {
      meta: { agentPreset: 'science', cwd: mkdtempSync(join(root, 'workspace-')) },
    })
    session.append('science/mode-bound', {
      version: 1,
      mode: { modeId: 'science', presetId: 'science', modeRevision: 'phase-2-test' },
    })

    await expect(ctx.scienceRuntime.bindEnvironment({
      session,
      profileId: ScienceEnvironmentProfileId('overlap'),
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'CONFINEMENT_UNAVAILABLE' })
    expect(session.events.map(event => event.type)).toEqual(['science/mode-bound'])
    expect(existsSync(join(dshHome, 'science'))).toBe(false)
  })

  it('rejects remote execution or partial enforcement before publishing an environment revision', async () => {
    const remoteRoot = mkdtempSync(join(process.cwd(), '.science-runtime-remote-'))
    const partialRoot = mkdtempSync(join(process.cwd(), '.science-runtime-partial-'))
    roots.push(remoteRoot, partialRoot)
    const remotePrefix = createFakePythonPrefix(remoteRoot)
    const remote = await createFastRuntimeHarness(remoteRoot, { fake: { pythonPrefix: remotePrefix } })
    contexts.push(remote.ctx)
    ;(remote.subprocess as unknown as { executionWorld: 'host-local' | 'remote' }).executionWorld = 'remote'
    const remoteSession = createScienceSession(remote.ctx, 'science-remote-world')
    await expect(remote.runtime.bindEnvironment({
      session: remoteSession,
      profileId: ScienceEnvironmentProfileId('fake'),
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'CONFINEMENT_UNAVAILABLE' })
    expect(remote.subprocess.specs).toEqual([])
    expect(existsSync(join(remoteRoot, 'dsh-home', 'science'))).toBe(false)

    const partialPrefix = createFakePythonPrefix(partialRoot)
    const partial = await createFastRuntimeHarness(partialRoot, { fake: { pythonPrefix: partialPrefix } })
    contexts.push(partial.ctx)
    partial.sandbox.enforcement = 'partial'
    const partialSession = createScienceSession(partial.ctx, 'science-partial-enforcement')
    await expect(partial.runtime.bindEnvironment({
      session: partialSession,
      profileId: ScienceEnvironmentProfileId('fake'),
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'CONFINEMENT_UNAVAILABLE' })
    expect(partialSession.events.map(event => event.type)).toEqual(['science/mode-bound'])
    expect(existsSync(join(partialRoot, 'dsh-home', 'science'))).toBe(false)

    const unavailableRoot = mkdtempSync(join(process.cwd(), '.science-runtime-unavailable-'))
    roots.push(unavailableRoot)
    const unavailablePrefix = createFakePythonPrefix(unavailableRoot)
    const unavailable = await createFastRuntimeHarness(unavailableRoot, { fake: { pythonPrefix: unavailablePrefix } })
    contexts.push(unavailable.ctx)
    vi.spyOn(unavailable.sandbox, 'confine').mockImplementation(() => {
      throw new SandboxUnavailableError('workspace-write')
    })
    const unavailableSession = createScienceSession(unavailable.ctx, 'science-unavailable-enforcement')
    await expect(unavailable.runtime.bindEnvironment({
      session: unavailableSession,
      profileId: ScienceEnvironmentProfileId('fake'),
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'CONFINEMENT_UNAVAILABLE' })
    expect(existsSync(join(unavailableRoot, 'dsh-home', 'science'))).toBe(false)
  })

  it('records an invalid revision for a missing prefix or invalid retained UTF-8 without spawning user source', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-invalid-'))
    roots.push(root)
    const invalidPrefix = createFakePythonPrefix(root, 'invalid')
    const missingPrefix = join(root, 'missing-conda')
    const harness = await createFastRuntimeHarness(root, {
      invalid: { pythonPrefix: invalidPrefix },
      missing: { pythonPrefix: missingPrefix },
    })
    contexts.push(harness.ctx)
    harness.subprocess.utf8Probe = 'invalid'
    const { ctx, runtime, subprocess } = harness
    const invalidSession = createScienceSession(ctx, 'science-bind-invalid-utf8')
    const invalid = await runtime.bindEnvironment({
      session: invalidSession,
      profileId: ScienceEnvironmentProfileId('invalid'),
      signal: new AbortController().signal,
    })
    const missingSession = createScienceSession(ctx, 'science-bind-missing')
    const beforeMissing = subprocess.specs.length
    const missing = await runtime.bindEnvironment({
      session: missingSession,
      profileId: ScienceEnvironmentProfileId('missing'),
      signal: new AbortController().signal,
    })

    expect(invalid).toMatchObject({
      status: 'invalid',
      python: { capability: 'invalid', canonicalPrefix: invalidPrefix, executable: join(invalidPrefix, 'bin', 'python') },
    })
    expect(missing).toMatchObject({
      status: 'invalid',
      python: { capability: 'invalid', configuredPrefix: missingPrefix },
    })
    expect(subprocess.specs).toHaveLength(beforeMissing)
  })

  it('observes a shared Python/R prefix, while an R TMPDIR under a space-containing scratch path fails before a probe starts', async () => {
    const sharedRoot = mkdtempSync(join(process.cwd(), '.science-runtime-shared-'))
    const spaceRoot = mkdtempSync(join(process.cwd(), '.science runtime-r-space-'))
    roots.push(sharedRoot, spaceRoot)
    const sharedPrefix = createFakePythonPrefix(sharedRoot)
    createFakeRPrefix(sharedRoot, sharedPrefix)
    const shared = await createFastRuntimeHarness(sharedRoot, { both: { pythonPrefix: sharedPrefix, rPrefix: sharedPrefix } })
    contexts.push(shared.ctx)
    const sharedSession = createScienceSession(shared.ctx, 'science-bind-shared')
    const environment = await shared.runtime.bindEnvironment({
      session: sharedSession,
      profileId: ScienceEnvironmentProfileId('both'),
      signal: new AbortController().signal,
    })
    expect(environment).toMatchObject({
      status: 'applied',
      python: { capability: 'available', languageVersion: 'Fake Python 3.13.5' },
      r: { capability: 'available', languageVersion: 'Fake R 4.5.0' },
    })
    const rOnlyScratch = await ensureSessionScratch(join(sharedRoot, 'r-only-home'), sharedSession)
    await expect(observeProfile({
      subprocess: shared.subprocess,
      sandbox: shared.sandbox,
      sessionScratch: rOnlyScratch,
      sessionId: sharedSession.id,
      signal: new AbortController().signal,
      packagesMaxEntries: 2_000,
      packagesMaxBytes: 65_536,
    }, { id: ScienceEnvironmentProfileId('r-only'), rPrefix: sharedPrefix })).resolves.toMatchObject({ r: { binding: { capability: 'available' } } })

    const rPrefix = createFakeRPrefix(spaceRoot)
    const spaced = await createFastRuntimeHarness(spaceRoot, { r: { rPrefix } })
    contexts.push(spaced.ctx)
    const spacedSession = createScienceSession(spaced.ctx, 'science-bind-r-space')
    await expect(spaced.runtime.bindEnvironment({
      session: spacedSession,
      profileId: ScienceEnvironmentProfileId('r'),
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'CONFINEMENT_UNAVAILABLE' })
    expect(spaced.subprocess.specs).toEqual([])

    spacedSession.append('science/environment-bound', {
      version: 1,
      environment: {
        revision: 1,
        profileId: ScienceEnvironmentProfileId('r'),
        configuredAt: 1,
        validatedAt: 1,
        status: 'applied',
        r: {
          language: 'r',
          configuredPrefix: rPrefix,
          canonicalPrefix: rPrefix,
          executable: join(rPrefix, 'bin', 'Rscript'),
          executableIdentity: 'test-identity',
          languageVersion: 'Fake R 4.5.0',
          condaHistorySha256: 'a'.repeat(64),
          bindingFingerprint: 'b'.repeat(64),
          packages: [{ name: 'base', version: '4.5.0' }],
          packagesSha256: 'f'.repeat(64),
          packagesTruncated: false,
          capability: 'available',
        },
      },
    })
    await expect(spaced.runtime.startRun({
      session: spacedSession,
      language: 'r',
      code: 'print("must not spawn")',
      ...authorizePythonRun(spacedSession, 'science-run-r-space'),
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'CONFINEMENT_UNAVAILABLE' })
    expect(spacedSession.events.some(event => event.type === 'science/run-started')).toBe(false)
    expect(spaced.subprocess.specs).toEqual([])
  })

  it('keeps distinct configured Python and R prefixes distinct, and records an escaping executable as invalid without a probe', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-distinct-'))
    const escapingRoot = mkdtempSync(join(process.cwd(), '.science-runtime-escaping-'))
    roots.push(root, escapingRoot)
    const pythonPrefix = createFakePythonPrefix(root)
    const rPrefix = createFakeRPrefix(root)
    const distinct = await createFastRuntimeHarness(root, { both: { pythonPrefix, rPrefix } })
    contexts.push(distinct.ctx)
    const distinctSession = createScienceSession(distinct.ctx, 'science-bind-distinct')
    const environment = await distinct.runtime.bindEnvironment({
      session: distinctSession,
      profileId: ScienceEnvironmentProfileId('both'),
      signal: new AbortController().signal,
    })
    expect(environment).toMatchObject({
      status: 'applied',
      python: { canonicalPrefix: pythonPrefix },
      r: { canonicalPrefix: rPrefix },
    })
    expect(environment.python?.canonicalPrefix).not.toBe(environment.r?.canonicalPrefix)

    const escapingPrefix = createFakePythonPrefix(escapingRoot)
    const candidate = join(escapingPrefix, 'bin', 'python')
    unlinkSync(candidate)
    symlinkSync('/bin/sh', candidate)
    const escaping = await createFastRuntimeHarness(escapingRoot, { escaping: { pythonPrefix: escapingPrefix } })
    contexts.push(escaping.ctx)
    const escapingSession = createScienceSession(escaping.ctx, 'science-bind-escaping')
    const before = escaping.subprocess.specs.length
    const invalid = await escaping.runtime.bindEnvironment({
      session: escapingSession,
      profileId: ScienceEnvironmentProfileId('escaping'),
      signal: new AbortController().signal,
    })
    expect(invalid).toMatchObject({ status: 'invalid', python: { capability: 'invalid' } })
    expect(escaping.subprocess.specs).toHaveLength(before)
  })

  it('holds the exact Session lease until a sibling probe quiesces after an earlier probe failure', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-probe-cleanup-'))
    roots.push(root)
    const pythonPrefix = createFakePythonPrefix(root)
    const rPrefix = createFakeRPrefix(root)
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(ScienceSessionInvariant)
    await ctx.plugin(DelayedRVersionSubprocess)
    await ctx.plugin(DirectSandbox)
    await mountArtifactStore(ctx, root)
    await ctx.plugin(ScienceRuntime, {
      dshHome: join(root, 'dsh-home'),
      profiles: { both: { pythonPrefix, rPrefix } },
    })
    const runtime = ctx.scienceRuntime
    const subprocess = ctx.subprocess as DelayedRVersionSubprocess
    const session = createScienceSession(ctx, 'science-probe-cleanup')
    const request = {
      session,
      profileId: ScienceEnvironmentProfileId('both'),
      signal: new AbortController().signal,
    }

    const binding = runtime.bindEnvironment(request)
    await subprocess.rVersionStarted.promise
    await expect(runtime.bindEnvironment(request)).rejects.toMatchObject({ code: 'RUNTIME_BUSY' })

    subprocess.releaseRVersion()
    await expect(binding).rejects.toMatchObject({
      code: 'INFRASTRUCTURE_FAILURE',
      cause: { message: 'injected Python probe failure' },
    })

    subprocess.failPython = false
    await expect(runtime.bindEnvironment(request)).resolves.toMatchObject({ status: 'applied' })
  })

  it('rejects unknown profiles, rebinds after a run, and pre-aborted binds without publishing facts', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-bind-guards-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const spawnSpy = vi.spyOn(harness.ctx.subprocess, 'spawn')
    const session = createScienceSession(harness.ctx, 'science-bind-guards')
    await expect(harness.runtime.bindEnvironment({
      session, profileId: ScienceEnvironmentProfileId('unknown'), signal: new AbortController().signal,
    })).rejects.toMatchObject({
      code: 'PROFILE_NOT_CONFIGURED',
      message: 'no Conda prefix is configured for the Science environment profile "unknown" — '
        + 'open Settings → Plugins → Science to configure one, then restart the Host',
    })
    const aborted = new AbortController()
    aborted.abort()
    await expect(harness.runtime.bindEnvironment({
      session, profileId: ScienceEnvironmentProfileId('fake'), signal: aborted.signal,
    })).rejects.toMatchObject({ code: 'OPERATION_CANCELLED' })
    expect(spawnSpy).not.toHaveBeenCalled()
    await harness.runtime.bindEnvironment({
      session, profileId: ScienceEnvironmentProfileId('fake'), signal: new AbortController().signal,
    })
    const handle = await harness.runtime.startRun({
      session, language: 'python', code: kernelAction({ status: 'ok' }), ...authorizePythonRun(session), signal: new AbortController().signal,
    })
    await handle.done
    await expect(harness.runtime.bindEnvironment({
      session, profileId: ScienceEnvironmentProfileId('fake'), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'ENVIRONMENT_NOT_READY' })
  })

  it('requires a workspace cwd and retries project resolution after an open failure', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-project-resolution-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    let opens = 0
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } }, 10_000, 1_800_000, (ctx) => {
      ctx.provide('scienceArtifactStore', {
        openProject: async (workspacePath: string) => {
          opens += 1
          if (opens === 1) throw new Error('injected project open failure')
          return { projectId: ScienceProjectId('project-retry'), storeRoot: workspacePath, workspacePath, outcome: 'created' }
        },
      } as never)
    })
    contexts.push(harness.ctx)

    const noWorkspace = harness.ctx.sessions.create(SessionId('science-project-no-cwd'), { meta: { agentPreset: 'science' } })
    noWorkspace.append('science/mode-bound', {
      version: 1, mode: { modeId: 'science', presetId: 'science', modeRevision: 'phase-2-test' },
    })
    await expect(harness.runtime.bindEnvironment({
      session: noWorkspace, profileId: ScienceEnvironmentProfileId('fake'), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'PROJECT_UNAVAILABLE' })

    const retry = createScienceSession(harness.ctx, 'science-project-retry')
    await expect(harness.runtime.bindEnvironment({
      session: retry, profileId: ScienceEnvironmentProfileId('fake'), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'INFRASTRUCTURE_FAILURE' })
    await expect(harness.runtime.bindEnvironment({
      session: retry, profileId: ScienceEnvironmentProfileId('fake'), signal: new AbortController().signal,
    })).resolves.toMatchObject({ status: 'applied' })
    expect(opens).toBe(2)
  })

  it('records static invalid observations without probing malformed history or interpreter entries', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-static-invalid-'))
    roots.push(root)
    const historyDirectory = createFakePythonPrefix(join(root, 'history-directory'))
    rmSync(join(historyDirectory, 'conda-meta', 'history'))
    mkdirSync(join(historyDirectory, 'conda-meta', 'history'))
    const missingExecutable = createFakePythonPrefix(join(root, 'missing-executable'))
    unlinkSync(join(missingExecutable, 'bin', 'python'))
    const nonExecutable = createFakePythonPrefix(join(root, 'non-executable'))
    chmodSync(join(nonExecutable, 'bin', 'python'), 0o600)
    const nonDirectoryPrefix = join(root, 'prefix-file')
    writeFileSync(nonDirectoryPrefix, 'not a prefix')
    const loopingPrefix = join(root, 'looping-prefix')
    symlinkSync('looping-prefix', loopingPrefix)
    const harness = await createFastRuntimeHarness(root, {
      history: { pythonPrefix: historyDirectory },
      executable: { pythonPrefix: missingExecutable },
      nonExecutable: { pythonPrefix: nonExecutable },
      file: { pythonPrefix: nonDirectoryPrefix },
      loop: { pythonPrefix: loopingPrefix },
    })
    contexts.push(harness.ctx)
    const historySession = createScienceSession(harness.ctx, 'science-static-history')
    const executableSession = createScienceSession(harness.ctx, 'science-static-executable')
    const history = await harness.runtime.bindEnvironment({
      session: historySession, profileId: ScienceEnvironmentProfileId('history'), signal: new AbortController().signal,
    })
    const executable = await harness.runtime.bindEnvironment({
      session: executableSession, profileId: ScienceEnvironmentProfileId('executable'), signal: new AbortController().signal,
    })
    const nonExecutableSession = createScienceSession(harness.ctx, 'science-static-non-executable')
    const nonExecutableResult = await harness.runtime.bindEnvironment({
      session: nonExecutableSession, profileId: ScienceEnvironmentProfileId('nonExecutable'), signal: new AbortController().signal,
    })
    const fileSession = createScienceSession(harness.ctx, 'science-static-prefix-file')
    const file = await harness.runtime.bindEnvironment({
      session: fileSession, profileId: ScienceEnvironmentProfileId('file'), signal: new AbortController().signal,
    })
    await expect(harness.runtime.bindEnvironment({
      session: createScienceSession(harness.ctx, 'science-static-prefix-loop'), profileId: ScienceEnvironmentProfileId('loop'), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'INFRASTRUCTURE_FAILURE' })
    expect(history.python).toMatchObject({ capability: 'invalid' })
    expect(history.python?.reason).toMatch(/history/)
    expect(executable.python).toMatchObject({ capability: 'invalid' })
    expect(executable.python?.reason).toMatch(/interpreter/)
    expect(nonExecutableResult.python).toMatchObject({ capability: 'invalid' })
    expect(nonExecutableResult.python?.reason).toMatch(/regular executable/)
    expect(file.python).toMatchObject({ capability: 'invalid' })
    expect(file.python?.reason).toMatch(/conda-meta\/history/)
    expect(harness.subprocess.specs).toEqual([])
  })

  it('preserves non-missing static filesystem failures while retaining only missing paths as invalid observations', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-static-fs-errors-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createFastRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const history = join(prefix, 'conda-meta', 'history')
    const executable = join(prefix, 'bin', 'python')
    try {
      staticFsFault.history = history
      await expect(harness.runtime.bindEnvironment({
        session: createScienceSession(harness.ctx, 'science-static-read-error'), profileId: ScienceEnvironmentProfileId('fake'), signal: new AbortController().signal,
      })).rejects.toMatchObject({ code: 'INFRASTRUCTURE_FAILURE' })
      staticFsFault.history = ''
      staticFsFault.executable = executable
      const binding = await harness.runtime.bindEnvironment({
        session: createScienceSession(harness.ctx, 'science-static-lstat-loss'), profileId: ScienceEnvironmentProfileId('fake'), signal: new AbortController().signal,
      })
      expect(binding.python).toMatchObject({ capability: 'invalid' })
      expect(binding.python?.reason).toMatch(/interpreter/)
      staticFsFault.executable = ''
      staticFsFault.nonObject = executable
      await expect(harness.runtime.bindEnvironment({
        session: createScienceSession(harness.ctx, 'science-static-non-error'), profileId: ScienceEnvironmentProfileId('fake'), signal: new AbortController().signal,
      })).rejects.toMatchObject({ code: 'INFRASTRUCTURE_FAILURE' })
    } finally {
      staticFsFault.history = ''
      staticFsFault.executable = ''
    }
  })

  it('aggregates probe and cleanup failures, and preserves static observation races without publishing a binding', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-observation-failures-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const cleanupContext = new Context()
    contexts.push(cleanupContext)
    await cleanupContext.plugin(SessionStore)
    await cleanupContext.plugin(InvariantRegistry, { enabled: true })
    await cleanupContext.plugin(ScienceSessionInvariant)
    await cleanupContext.plugin(ProbeFailureAndCleanupSubprocess)
    await cleanupContext.plugin(ProbeFailureAndCleanupSandbox)
    await mountArtifactStore(cleanupContext, root)
    await cleanupContext.plugin(ScienceRuntime, { dshHome: join(root, 'dsh-home'), profiles: { fake: { pythonPrefix: prefix } } })
    const cleanupSession = createScienceSession(cleanupContext, 'science-probe-cleanup-failure')
    const cleanup = cleanupContext.scienceRuntime.bindEnvironment({
      session: cleanupSession, profileId: ScienceEnvironmentProfileId('fake'), signal: new AbortController().signal,
    })
    await expect(cleanup).rejects.toMatchObject({
      code: 'INFRASTRUCTURE_FAILURE',
      cause: { errors: [expect.any(Error), expect.any(Error)] },
    })
    staticFsFault.cleanupPath = ''
    expect(cleanupSession.events.map(event => event.type)).toEqual(['science/mode-bound'])

    ;(cleanupContext.subprocess as ProbeFailureAndCleanupSubprocess).failProbe = false
    await expect(cleanupContext.scienceRuntime.bindEnvironment({
      session: createScienceSession(cleanupContext, 'science-probe-cleanup-only-failure'), profileId: ScienceEnvironmentProfileId('fake'), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'INFRASTRUCTURE_FAILURE', cause: { message: 'injected managed cleanup failure' } })
    staticFsFault.cleanupPath = ''

    const raceRoot = mkdtempSync(join(process.cwd(), '.science-runtime-static-race-'))
    roots.push(raceRoot)
    const racePrefix = createFakePythonPrefix(raceRoot)
    const harness = await createFastRuntimeHarness(raceRoot, { fake: { pythonPrefix: racePrefix } })
    contexts.push(harness.ctx)
    harness.subprocess.onSpawn = (spec) => {
      if (spec.argv.includes('-c')) unlinkSync(join(racePrefix, 'bin', 'python'))
    }
    const raceSession = createScienceSession(harness.ctx, 'science-static-race')
    await expect(harness.runtime.bindEnvironment({
      session: raceSession, profileId: ScienceEnvironmentProfileId('fake'), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'INFRASTRUCTURE_FAILURE' })
  })

  it('waits for both failed observations before reporting their aggregate failure', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-observe-aggregate-'))
    roots.push(root)
    const pythonPrefix = createFakePythonPrefix(root)
    const rPrefix = createFakeRPrefix(root)
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin(ControlledSubprocess)
    await ctx.plugin(EveryProbeFailureSandbox)
    const session = ctx.sessions.create(SessionId('science-observe-aggregate'))
    const scratch = await ensureSessionScratch(join(root, 'dsh-home'), session)
    await expect(observeProfile({
      subprocess: ctx.subprocess,
      sandbox: ctx.sandbox,
      sessionScratch: scratch,
      sessionId: session.id,
      signal: new AbortController().signal,
      packagesMaxEntries: 2_000,
      packagesMaxBytes: 65_536,
    }, {
      id: ScienceEnvironmentProfileId('both'), pythonPrefix, rPrefix,
    })).rejects.toThrow(/observations failed after all probe cleanup settled/)
    expect(existsSync(scratch.probes)).toBe(true)
    expect(readdirSync(scratch.probes)).toEqual([])
    ;(ctx.subprocess as ControlledSubprocess).executionWorld = 'remote'
    await expect(observeProfile({
      subprocess: ctx.subprocess,
      sandbox: ctx.sandbox,
      sessionScratch: scratch,
      sessionId: session.id,
      signal: new AbortController().signal,
      packagesMaxEntries: 2_000,
      packagesMaxBytes: 65_536,
    }, {
      id: ScienceEnvironmentProfileId('both'), pythonPrefix, rPrefix,
    })).rejects.toMatchObject({ code: 'CONFINEMENT_UNAVAILABLE' })
    ;(ctx.subprocess as ControlledSubprocess).executionWorld = 'host-local'
    ;(ctx.sandbox as EveryProbeFailureSandbox).failure = 'injected non-Error observation failure'
    await expect(observeProfile({
      subprocess: ctx.subprocess,
      sandbox: ctx.sandbox,
      sessionScratch: scratch,
      sessionId: session.id,
      signal: new AbortController().signal,
      packagesMaxEntries: 2_000,
      packagesMaxBytes: 65_536,
    }, {
      id: ScienceEnvironmentProfileId('both'), pythonPrefix, rPrefix,
    })).rejects.toMatchObject({ errors: [expect.any(Error), 'injected non-Error observation failure'] })
  })

  it('records a bounded invalid observation when the prefix changes during both attempts', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-observe-drift-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const history = join(prefix, 'conda-meta', 'history')
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(ScienceSessionInvariant)
    await ctx.plugin(ChangingHistorySubprocess)
    await ctx.plugin(DirectSandbox)
    await mountArtifactStore(ctx, root)
    await ctx.plugin(ScienceRuntime, { dshHome: join(root, 'dsh-home'), profiles: { fake: { pythonPrefix: prefix } } })
    ;(ctx.subprocess as ChangingHistorySubprocess).history = history
    const session = createScienceSession(ctx, 'science-observe-drift')
    await expect(ctx.scienceRuntime.bindEnvironment({
      session, profileId: ScienceEnvironmentProfileId('fake'), signal: new AbortController().signal,
    })).resolves.toMatchObject({ status: 'invalid', python: { reason: 'environment changed during observation' } })
  })

  it('rolls back newly owned Session scratch when a retry cannot obtain full confinement', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-retry-confinement-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const history = join(prefix, 'conda-meta', 'history')
    const dshHome = join(root, 'dsh-home')
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(ScienceSessionInvariant)
    await ctx.plugin(ChangingHistorySubprocess)
    await ctx.plugin(RetryPartialSandbox)
    await mountArtifactStore(ctx, root)
    await ctx.plugin(ScienceRuntime, { dshHome, profiles: { fake: { pythonPrefix: prefix } } })
    ;(ctx.subprocess as ChangingHistorySubprocess).history = history
    const session = createScienceSession(ctx, 'science-retry-confinement')
    await expect(ctx.scienceRuntime.bindEnvironment({
      session, profileId: ScienceEnvironmentProfileId('fake'), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'CONFINEMENT_UNAVAILABLE' })
    const key = sessionScratchKey(session)
    expect(existsSync(join(dshHome, 'science', 'v1', 'sessions', key))).toBe(false)
    expect(existsSync(join(dshHome, 'science', 'v1', 'owners', `${key}.json`))).toBe(false)
    expect(session.events.map(event => event.type)).toEqual(['science/mode-bound'])
  })

  it('aggregates a failed retry with failure to roll back newly owned Session scratch', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-retry-rollback-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const history = join(prefix, 'conda-meta', 'history')
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(ScienceSessionInvariant)
    await ctx.plugin(ChangingHistorySubprocess)
    await ctx.plugin(RetryPartialSandbox)
    await mountArtifactStore(ctx, root)
    await ctx.plugin(ScienceRuntime, { dshHome: join(root, 'dsh-home'), profiles: { fake: { pythonPrefix: prefix } } })
    ;(ctx.subprocess as ChangingHistorySubprocess).history = history
    ;(ctx.sandbox as RetryPartialSandbox).failRollback = true
    const session = createScienceSession(ctx, 'science-retry-rollback')
    await expect(ctx.scienceRuntime.bindEnvironment({
      session, profileId: ScienceEnvironmentProfileId('fake'), signal: new AbortController().signal,
    })).rejects.toMatchObject({
      code: 'INFRASTRUCTURE_FAILURE',
      cause: { message: 'science-runtime: pre-publication Session scratch rollback failed' },
    })
    expect(session.events.map(event => event.type)).toEqual(['science/mode-bound'])
  })

  it('aggregates a vetoed run start with failure to roll back the unpublished run scratch', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-run-rollback-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createKernelRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-run-rollback')
    await harness.runtime.bindEnvironment({
      session, profileId: ScienceEnvironmentProfileId('fake'), signal: new AbortController().signal,
    })
    const sessionRoot = join(root, 'dsh-home', 'science', 'v1', 'sessions', sessionScratchKey(session))
    const stop = harness.ctx.on('internal/dispatch', (_mode, eventName, args) => {
      if (eventName !== 'session/event') return
      const [, event] = args as [unknown, { readonly type?: string; readonly data?: { readonly run?: { readonly runId?: string } } }]
      if (event?.type !== 'science/run-started') return
      // Faulting the exact run directory makes removeUnpublishedRunScratch
      // fail during the veto's cleanup, reaching the aggregated
      // unpublished-run rollback classification.
      staticFsFault.cleanupPath = join(sessionRoot, 'runs', String(event.data?.run?.runId))
      throw new Error('injected start append failure')
    }, { global: true })
    try {
      await expect(harness.runtime.startRun({
        session,
        language: 'python',
        code: kernelAction({ status: 'ok' }),
        ...authorizePythonRun(session, 'science-run-rollback-call'),
        signal: new AbortController().signal,
      })).rejects.toMatchObject({
        message: 'science-runtime: unpublished run rollback failed',
        errors: [
          { message: 'injected start append failure' },
          { message: 'injected managed cleanup failure' },
        ],
      })
    } finally {
      stop()
    }
  })

  it('selects Windows executable candidates and refuses host probes before a partial Windows boundary can run', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-windows-probe-'))
    roots.push(root)
    const prefix = join(root, 'windows-prefix')
    mkdirSync(join(prefix, 'conda-meta'), { recursive: true })
    mkdirSync(join(prefix, 'Scripts'), { recursive: true })
    writeFileSync(join(prefix, 'conda-meta', 'history'), 'windows history\n')
    writeFileSync(join(prefix, 'python.exe'), 'fake')
    chmodSync(join(prefix, 'python.exe'), 0o700)
    const harness = await createFastRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const session = createScienceSession(harness.ctx, 'science-windows-probe')
    const original = Object.getOwnPropertyDescriptor(process, 'platform')
    if (original === undefined) throw new Error('process.platform descriptor is unavailable')
    Object.defineProperty(process, 'platform', { ...original, value: 'win32' })
    try {
      await expect(harness.runtime.bindEnvironment({
        session, profileId: ScienceEnvironmentProfileId('fake'), signal: new AbortController().signal,
      })).rejects.toMatchObject({ code: 'CONFINEMENT_UNAVAILABLE' })
      expect(harness.subprocess.specs).toEqual([])
    } finally {
      Object.defineProperty(process, 'platform', original)
    }
  })

  it.each([
    ['JSON.parse throws', 'not valid json'],
    ['top-level value is not an array', '{}'],
    ['an entry is not an object', '[42]'],
    ['an entry is null', '[null]'],
    ['name is not a string', '[{"name":1,"version":"1"}]'],
    ['version is not a string', '[{"name":"pip","version":1}]'],
    ['name is empty', '[{"name":"","version":"1"}]'],
    ['version is empty', '[{"name":"pip","version":""}]'],
  ] as const)('records an invalid Python observation when the package-inventory probe output is malformed: %s', async (_label, output) => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-packages-py-malformed-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createFastRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    harness.subprocess.packagesOutput = { ...harness.subprocess.packagesOutput, python: output }
    const session = createScienceSession(harness.ctx, 'science-packages-py-malformed')
    await expect(harness.runtime.bindEnvironment({
      session, profileId: ScienceEnvironmentProfileId('fake'), signal: new AbortController().signal,
    })).resolves.toMatchObject({
      status: 'invalid',
      python: { capability: 'invalid', reason: 'package inventory probe did not produce parseable output' },
    })
  })

  it.each([
    ['no tab separator', 'base'],
    ['leading tab (empty name)', '\t4.5.0'],
    ['more than one tab', 'base\t4.5.0\textra'],
    ['trailing tab (empty version)', 'base\t'],
  ] as const)('records an invalid R observation when the package-inventory probe output is malformed: %s', async (_label, output) => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-packages-r-malformed-'))
    roots.push(root)
    const prefix = createFakeRPrefix(root)
    const harness = await createFastRuntimeHarness(root, { r: { rPrefix: prefix } })
    contexts.push(harness.ctx)
    harness.subprocess.packagesOutput = { ...harness.subprocess.packagesOutput, r: output }
    const session = createScienceSession(harness.ctx, 'science-packages-r-malformed')
    await expect(harness.runtime.bindEnvironment({
      session, profileId: ScienceEnvironmentProfileId('r'), signal: new AbortController().signal,
    })).resolves.toMatchObject({
      status: 'invalid',
      r: { capability: 'invalid', reason: 'package inventory probe did not produce parseable output' },
    })
  })

  it('records an invalid observation when the package-inventory probe itself fails', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-packages-probe-failure-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(ScienceSessionInvariant)
    await ctx.plugin(FailingPackagesProbeSubprocess)
    await ctx.plugin(DirectSandbox)
    await mountArtifactStore(ctx, root)
    await ctx.plugin(ScienceRuntime, { dshHome: join(root, 'dsh-home'), profiles: { fake: { pythonPrefix: prefix } } })
    const session = createScienceSession(ctx, 'science-packages-probe-failure')
    await expect(ctx.scienceRuntime.bindEnvironment({
      session, profileId: ScienceEnvironmentProfileId('fake'), signal: new AbortController().signal,
    })).resolves.toMatchObject({
      status: 'invalid',
      python: { capability: 'invalid', reason: 'package inventory probe did not produce parseable output' },
    })
  })

  it('truncates by exact UTF-8 byte length rather than by string character count', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-packages-multibyte-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(ScienceSessionInvariant)
    await ctx.plugin(ControlledSubprocess)
    await ctx.plugin(DirectSandbox)
    await mountArtifactStore(ctx, root)
    // Each "中" is one UTF-16 code unit but three UTF-8 bytes: 341 of them
    // plus "v1" cost 1,025 true UTF-8 bytes but only 343 JS string "length"
    // units. The byte cap (the lowest allowed value) sits between the two,
    // so a character-count implementation would wrongly retain this entry.
    const name = '中'.repeat(341)
    await ctx.plugin(ScienceRuntime, {
      dshHome: join(root, 'dsh-home'),
      profiles: { fake: { pythonPrefix: prefix } },
      packagesMaxBytes: MIN_PACKAGES_MAX_BYTES,
    })
    const subprocess = ctx.subprocess as ControlledSubprocess
    subprocess.packagesOutput = { ...subprocess.packagesOutput, python: JSON.stringify([{ name, version: 'v1' }]) }
    const session = createScienceSession(ctx, 'science-packages-multibyte')
    const environment = await ctx.scienceRuntime.bindEnvironment({
      session, profileId: ScienceEnvironmentProfileId('fake'), signal: new AbortController().signal,
    })
    if (environment.python?.capability !== 'available') throw new Error('fixture binding did not become available')
    expect(environment.python.packages).toEqual([])
    expect(environment.python.packagesTruncated).toBe(true)
  })

  it('sorts a package inventory with a repeated name by version', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-packages-sort-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createFastRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    harness.subprocess.packagesOutput = {
      ...harness.subprocess.packagesOutput,
      python: '[{"name":"pip","version":"24.0"},{"name":"pip","version":"1.0"}]',
    }
    const session = createScienceSession(harness.ctx, 'science-packages-sort')
    await expect(harness.runtime.bindEnvironment({
      session, profileId: ScienceEnvironmentProfileId('fake'), signal: new AbortController().signal,
    })).resolves.toMatchObject({
      status: 'applied',
      python: {
        packages: [{ name: 'pip', version: '1.0' }, { name: 'pip', version: '24.0' }],
      },
    })
  })

  it('truncates a package inventory exceeding the configured entry cap while digesting the complete sorted value', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-packages-truncate-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(ScienceSessionInvariant)
    await ctx.plugin(ControlledSubprocess)
    await ctx.plugin(DirectSandbox)
    await mountArtifactStore(ctx, root)
    await ctx.plugin(ScienceRuntime, {
      dshHome: join(root, 'dsh-home'),
      profiles: { fake: { pythonPrefix: prefix } },
      packagesMaxEntries: 1,
    })
    const subprocess = ctx.subprocess as ControlledSubprocess
    subprocess.packagesOutput = {
      ...subprocess.packagesOutput,
      python: '[{"name":"pip","version":"24.0"},{"name":"numpy","version":"1.26.4"}]',
    }
    const session = createScienceSession(ctx, 'science-packages-truncate')
    const environment = await ctx.scienceRuntime.bindEnvironment({
      session, profileId: ScienceEnvironmentProfileId('fake'), signal: new AbortController().signal,
    })
    if (environment.python?.capability !== 'available') throw new Error('fixture binding did not become available')
    expect(environment.python.packages).toEqual([{ name: 'numpy', version: '1.26.4' }])
    expect(environment.python.packagesTruncated).toBe(true)
    const completeDigest = createHash('sha256')
      .update('dsh-science-packages-v1\u0000numpy\u00001.26.4\npip\u000024.0')
      .digest('hex')
    expect(environment.python.packagesSha256).toBe(completeDigest)
  })

  it('retains a package inventory whose entries exactly fill the configured byte cap', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-packages-exact-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(ScienceSessionInvariant)
    await ctx.plugin(ControlledSubprocess)
    await ctx.plugin(DirectSandbox)
    await mountArtifactStore(ctx, root)
    // Two entries at the durable per-field 512-byte name cap, each costing
    // exactly MIN_PACKAGES_MAX_BYTES / 2, sum to exactly MIN_PACKAGES_MAX_BYTES.
    const first = { name: 'a'.repeat(500), version: '1'.repeat(12) }
    const second = { name: 'b'.repeat(500), version: '2'.repeat(12) }
    await ctx.plugin(ScienceRuntime, {
      dshHome: join(root, 'dsh-home'),
      profiles: { fake: { pythonPrefix: prefix } },
      packagesMaxBytes: MIN_PACKAGES_MAX_BYTES,
    })
    const subprocess = ctx.subprocess as ControlledSubprocess
    subprocess.packagesOutput = { ...subprocess.packagesOutput, python: JSON.stringify([second, first]) }
    const session = createScienceSession(ctx, 'science-packages-exact')
    const environment = await ctx.scienceRuntime.bindEnvironment({
      session, profileId: ScienceEnvironmentProfileId('fake'), signal: new AbortController().signal,
    })
    if (environment.python?.capability !== 'available') throw new Error('fixture binding did not become available')
    expect(environment.python.packages).toEqual([first, second])
    expect(environment.python.packagesTruncated).toBe(false)
  })

  it('truncates a package inventory whose single oversized entry exceeds the configured byte cap', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-packages-truncate-bytes-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(ScienceSessionInvariant)
    await ctx.plugin(ControlledSubprocess)
    await ctx.plugin(DirectSandbox)
    await mountArtifactStore(ctx, root)
    await ctx.plugin(ScienceRuntime, {
      dshHome: join(root, 'dsh-home'),
      profiles: { fake: { pythonPrefix: prefix } },
      packagesMaxBytes: 1_024,
    })
    const subprocess = ctx.subprocess as ControlledSubprocess
    const oversizedName = 'x'.repeat(1_050)
    subprocess.packagesOutput = {
      ...subprocess.packagesOutput,
      python: JSON.stringify([{ name: oversizedName, version: '1.0' }]),
    }
    const session = createScienceSession(ctx, 'science-packages-truncate-bytes')
    const environment = await ctx.scienceRuntime.bindEnvironment({
      session, profileId: ScienceEnvironmentProfileId('fake'), signal: new AbortController().signal,
    })
    if (environment.python?.capability !== 'available') throw new Error('fixture binding did not become available')
    expect(environment.python.packages).toEqual([])
    expect(environment.python.packagesTruncated).toBe(true)
    const completeDigest = createHash('sha256')
      .update(`dsh-science-packages-v1\0${oversizedName}\u00001.0`)
      .digest('hex')
    expect(environment.python.packagesSha256).toBe(completeDigest)
  })

  it('keeps bindingFingerprint independent of the package inventory', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-fingerprint-stable-'))
    roots.push(root)
    const prefix = createFakePythonPrefix(root)
    const harness = await createFastRuntimeHarness(root, { fake: { pythonPrefix: prefix } })
    contexts.push(harness.ctx)
    const first = await harness.runtime.bindEnvironment({
      session: createScienceSession(harness.ctx, 'science-fingerprint-stable-first'),
      profileId: ScienceEnvironmentProfileId('fake'),
      signal: new AbortController().signal,
    })
    harness.subprocess.packagesOutput = {
      ...harness.subprocess.packagesOutput,
      python: '[{"name":"an-entirely-different-package","version":"9.9.9"}]',
    }
    const second = await harness.runtime.bindEnvironment({
      session: createScienceSession(harness.ctx, 'science-fingerprint-stable-second'),
      profileId: ScienceEnvironmentProfileId('fake'),
      signal: new AbortController().signal,
    })
    if (first.python?.capability !== 'available' || second.python?.capability !== 'available') {
      throw new Error('fixture bindings did not become available')
    }
    expect(second.python.packagesSha256).not.toBe(first.python.packagesSha256)
    expect(second.python.bindingFingerprint).toBe(first.python.bindingFingerprint)

    // The formula is exactly the six identity fields below, joined with the
    // NUL domain separator — packagesSha256 is not one of them.
    const expectedFingerprint = createHash('sha256')
      .update([
        'dsh-science-binding-v1', 'python', first.python.canonicalPrefix, first.python.executable,
        first.python.executableIdentity, first.python.languageVersion, first.python.condaHistorySha256,
      ].join('\0'))
      .digest('hex')
    expect(first.python.bindingFingerprint).toBe(expectedFingerprint)
  })
})

describe('sameObservation', () => {
  const available = (fingerprint: string): ScienceInterpreterBinding => ({
    language: 'python',
    configuredPrefix: '/prefix',
    canonicalPrefix: '/prefix',
    executable: '/prefix/bin/python',
    executableIdentity: 'identity',
    languageVersion: '3.13.5',
    condaHistorySha256: 'a'.repeat(64),
    bindingFingerprint: fingerprint,
    packages: [],
    packagesSha256: 'b'.repeat(64),
    packagesTruncated: false,
    capability: 'available',
  })
  const unavailable: ScienceInterpreterBinding = {
    language: 'python',
    configuredPrefix: '/prefix',
    capability: 'unavailable',
    reason: 'not found',
  }

  it('treats two absent bindings as the same observation', () => {
    expect(sameObservation(undefined, undefined)).toBe(true)
  })

  it('treats an absent binding paired with a present one as different, in either position', () => {
    expect(sameObservation(undefined, available('f'.repeat(64)))).toBe(false)
    expect(sameObservation(available('f'.repeat(64)), undefined)).toBe(false)
  })

  it('compares two available bindings by fingerprint alone', () => {
    expect(sameObservation(available('c'.repeat(64)), available('c'.repeat(64)))).toBe(true)
    expect(sameObservation(available('c'.repeat(64)), available('d'.repeat(64)))).toBe(false)
  })

  it('never treats an unavailable binding as matching, even against an identical unavailable binding', () => {
    expect(sameObservation(unavailable, unavailable)).toBe(false)
    expect(sameObservation(unavailable, available('c'.repeat(64)))).toBe(false)
  })
})

describe('Science Runtime configuration', () => {
  it('requires a closed profile map with absolute prefixes and a safe integer timeout, empty allowed', () => {
    expect(() => resolveConfig({ profiles: [] as never })).toThrow(/plain record/)
    expect(resolveConfig({ profiles: {} }).profiles.size).toBe(0)
    expect(() => resolveConfig({
      profiles: { fake: { pythonPrefix: 'relative' } },
    })).toThrow(/absolute/)
    expect(() => resolveConfig({
      profiles: { 'not valid': { pythonPrefix: '/prefix' } },
    })).toThrow(/profile id/)
    expect(() => resolveConfig({
      profiles: { fake: {} },
    })).toThrow(/requires pythonPrefix or rPrefix/)
    expect(() => resolveConfig({
      profiles: { fake: { pythonPrefix: '/prefix', extra: true } as never },
    })).toThrow(/unknown field/)
    expect(() => resolveConfig({
      profiles: { fake: { pythonPrefix: '/prefix' } }, dshHome: 1 as never,
    })).toThrow(/dshHome/)
    expect(() => resolveConfig({
      profiles: { fake: { pythonPrefix: '/prefix' } }, timeoutMs: 1.5,
    })).toThrow(/safe integer/)
    expect(() => resolveConfig({
      profiles: { fake: { pythonPrefix: '/prefix' } }, timeoutMs: 0,
    })).toThrow(/safe integer/)
    expect(() => resolveConfig({
      profiles: { fake: { pythonPrefix: '/prefix' } }, timeoutMs: 600_001,
    })).toThrow(/safe integer/)
    expect(resolveConfig({ profiles: { r: { rPrefix: '/prefix' } } }).profiles.get('r')).toEqual({
      id: 'r', rPrefix: '/prefix',
    })
  })

  it('validates the package-inventory entry and byte bounds, defaulting when omitted', () => {
    expect(() => resolveConfig({
      profiles: { fake: { pythonPrefix: '/prefix' } }, packagesMaxEntries: 0,
    })).toThrow(/packagesMaxEntries/)
    expect(() => resolveConfig({
      profiles: { fake: { pythonPrefix: '/prefix' } }, packagesMaxEntries: 20_001,
    })).toThrow(/packagesMaxEntries/)
    expect(() => resolveConfig({
      profiles: { fake: { pythonPrefix: '/prefix' } }, packagesMaxBytes: 1_023,
    })).toThrow(/packagesMaxBytes/)
    expect(() => resolveConfig({
      profiles: { fake: { pythonPrefix: '/prefix' } }, packagesMaxBytes: 1_048_577,
    })).toThrow(/packagesMaxBytes/)
    const resolved = resolveConfig({ profiles: { fake: { pythonPrefix: '/prefix' } } })
    expect(resolved.packagesMaxEntries).toBe(2_000)
    expect(resolved.packagesMaxBytes).toBe(65_536)
  })

  it('validates the raster-capture policy, defaulting to declared when omitted', () => {
    expect(() => resolveConfig({
      profiles: { fake: { pythonPrefix: '/prefix' } }, rasterCapture: 'sometimes' as never,
    })).toThrow(/rasterCapture/)
    expect(resolveConfig({ profiles: { fake: { pythonPrefix: '/prefix' } } }).rasterCapture).toBe('declared')
    expect(resolveConfig({
      profiles: { fake: { pythonPrefix: '/prefix' } }, rasterCapture: 'always',
    }).rasterCapture).toBe('always')
  })

  it('validates the auto-capture file, per-run, and per-session bounds, defaulting when omitted', () => {
    expect(() => resolveConfig({
      profiles: { fake: { pythonPrefix: '/prefix' } }, captureMaxFileBytes: 1_048_575,
    })).toThrow(/captureMaxFileBytes/)
    expect(() => resolveConfig({
      profiles: { fake: { pythonPrefix: '/prefix' } }, captureMaxFileBytes: 52_428_801,
    })).toThrow(/captureMaxFileBytes/)
    expect(() => resolveConfig({
      profiles: { fake: { pythonPrefix: '/prefix' } }, captureMaxFilesPerRun: 0,
    })).toThrow(/captureMaxFilesPerRun/)
    expect(() => resolveConfig({
      profiles: { fake: { pythonPrefix: '/prefix' } }, captureMaxFilesPerRun: 1_001,
    })).toThrow(/captureMaxFilesPerRun/)
    expect(() => resolveConfig({
      profiles: { fake: { pythonPrefix: '/prefix' } }, captureMaxArtifactVersionsPerSession: 0,
    })).toThrow(/captureMaxArtifactVersionsPerSession/)
    expect(() => resolveConfig({
      profiles: { fake: { pythonPrefix: '/prefix' } }, captureMaxArtifactVersionsPerSession: 10_001,
    })).toThrow(/captureMaxArtifactVersionsPerSession/)
    expect(() => resolveConfig({
      profiles: { fake: { pythonPrefix: '/prefix' } }, unknownField: 1,
    } as never)).toThrow(/unknown field/)
    const resolved = resolveConfig({ profiles: { fake: { pythonPrefix: '/prefix' } } })
    expect(resolved.captureMaxFileBytes).toBe(5 * 1024 * 1024)
    expect(resolved.captureMaxFilesPerRun).toBe(50)
    expect(resolved.captureMaxArtifactVersionsPerSession).toBe(500)
  })

  it('validates artifact-input count and aggregate-byte bounds, defaulting when omitted', () => {
    expect(() => resolveConfig({
      profiles: { fake: { pythonPrefix: '/prefix' } }, inputMaxFilesPerRun: 0,
    })).toThrow(/inputMaxFilesPerRun/)
    expect(() => resolveConfig({
      profiles: { fake: { pythonPrefix: '/prefix' } }, inputMaxFilesPerRun: 1_001,
    })).toThrow(/inputMaxFilesPerRun/)
    expect(() => resolveConfig({
      profiles: { fake: { pythonPrefix: '/prefix' } }, inputMaxBytesPerRun: 0,
    })).toThrow(/inputMaxBytesPerRun/)
    expect(() => resolveConfig({
      profiles: { fake: { pythonPrefix: '/prefix' } }, inputMaxBytesPerRun: 1_073_741_825,
    })).toThrow(/inputMaxBytesPerRun/)
    expect(resolveConfig({
      profiles: { fake: { pythonPrefix: '/prefix' } }, inputMaxFilesPerRun: 1, inputMaxBytesPerRun: 1,
    })).toMatchObject({ inputMaxFilesPerRun: 1, inputMaxBytesPerRun: 1 })
    expect(resolveConfig({
      profiles: { fake: { pythonPrefix: '/prefix' } },
      inputMaxFilesPerRun: 1_000,
      inputMaxBytesPerRun: 1_073_741_824,
    })).toMatchObject({ inputMaxFilesPerRun: 1_000, inputMaxBytesPerRun: 1_073_741_824 })
    const resolved = resolveConfig({ profiles: { fake: { pythonPrefix: '/prefix' } } })
    expect(resolved.inputMaxFilesPerRun).toBe(20)
    expect(resolved.inputMaxBytesPerRun).toBe(50 * 1024 * 1024)
  })

  it('validates the persistent-kernel idle and spawn-to-READY deadline bounds, defaulting when omitted', () => {
    expect(() => resolveConfig({
      profiles: { fake: { pythonPrefix: '/prefix' } }, kernelIdleTimeoutMs: 59_999,
    })).toThrow(/kernelIdleTimeoutMs/)
    expect(() => resolveConfig({
      profiles: { fake: { pythonPrefix: '/prefix' } }, kernelIdleTimeoutMs: 86_400_001,
    })).toThrow(/kernelIdleTimeoutMs/)
    expect(() => resolveConfig({
      profiles: { fake: { pythonPrefix: '/prefix' } }, kernelIdleTimeoutMs: 1.5,
    })).toThrow(/kernelIdleTimeoutMs/)
    expect(resolveConfig({
      profiles: { fake: { pythonPrefix: '/prefix' } }, kernelIdleTimeoutMs: 60_000,
    }).kernelIdleTimeoutMs).toBe(60_000)
    expect(resolveConfig({
      profiles: { fake: { pythonPrefix: '/prefix' } }, kernelIdleTimeoutMs: 86_400_000,
    }).kernelIdleTimeoutMs).toBe(86_400_000)
    expect(() => resolveConfig({
      profiles: { fake: { pythonPrefix: '/prefix' } }, kernelStartTimeoutMs: 999,
    })).toThrow(/kernelStartTimeoutMs/)
    expect(() => resolveConfig({
      profiles: { fake: { pythonPrefix: '/prefix' } }, kernelStartTimeoutMs: 600_001,
    })).toThrow(/kernelStartTimeoutMs/)
    expect(resolveConfig({
      profiles: { fake: { pythonPrefix: '/prefix' } }, kernelStartTimeoutMs: 1_000,
    }).kernelStartTimeoutMs).toBe(1_000)
    expect(resolveConfig({
      profiles: { fake: { pythonPrefix: '/prefix' } }, kernelStartTimeoutMs: 600_000,
    }).kernelStartTimeoutMs).toBe(600_000)
    const resolved = resolveConfig({ profiles: { fake: { pythonPrefix: '/prefix' } } })
    expect(resolved.kernelIdleTimeoutMs).toBe(1_800_000)
    expect(resolved.kernelStartTimeoutMs).toBe(30_000)
  })
})
