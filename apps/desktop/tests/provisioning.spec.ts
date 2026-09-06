import type { ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { join, win32 as win32Path } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { parseEnvironmentDeclaration } from '../src/environment-declaration.ts'
import {
  buildProvisioningEnv,
  describeWin32MissingCrtExit,
  DesktopEnvironmentProvisioner,
  orderSourcesFrom,
  parseMicromambaProgressLine,
  provisioningScratchTempDir,
  resolvePackageCacheDir,
  runProvisioningProcess,
  stopProcessGroup,
  type ProcessRequest,
} from '../src/provisioning.ts'
import { resolveDisciplineStatus } from '../src/discipline-status.ts'

const SOURCE_A = { id: 'source-a', name: 'Source A', channels: ['https://a.example/conda-forge'] }
const SOURCE_B = { id: 'source-b', name: 'Source B', channels: ['https://b.example/conda-forge'] }
const SOURCE_C = { id: 'source-c', name: 'Source C', channels: ['https://c.example/conda-forge'] }

const declaration = parseEnvironmentDeclaration({
  schemaVersion: 1,
  id: 'test-science',
  revision: '2026.08.1',
  name: 'Test science',
  supportedPlatforms: ['darwin-arm64'],
  sources: [SOURCE_A],
  packages: ['python=3.13', 'r-base=4.5'],
  estimatedDownloadBytes: 100,
  requiredFreeBytes: 200,
  timeoutMs: 1_000,
  healthChecks: [
    { language: 'python', executable: 'python', args: ['-c', 'pass'] },
    { language: 'r', executable: 'Rscript', args: ['-e', 'TRUE'] },
  ],
})

const win32Declaration = parseEnvironmentDeclaration({ ...declaration, supportedPlatforms: ['win32-x64'] })

/** Fakes a successful `create` step by populating the prefix's `bin` directory; skips the health-check steps. */
const createOnly: (request: ProcessRequest) => Promise<void> = async (request) => {
  if (request.args[0] === 'create') {
    const prefix = request.args[request.args.indexOf('--prefix') + 1]!
    await mkdir(join(prefix, 'bin'), { recursive: true })
  }
}

describe('DesktopEnvironmentProvisioner', () => {
  it('publishes only after create and both health checks pass, at the same path throughout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-provision-'))
    const calls: ProcessRequest[] = []
    const provisioner = new DesktopEnvironmentProvisioner({
      root,
      micromambaPath: '/bundled/micromamba',
      platform: 'darwin-arm64',
      now: () => 42,
      freeBytes: async () => 1_000,
      run: async (request) => {
        calls.push(request)
        if (request.args[0] === 'create') {
          const prefix = request.args[request.args.indexOf('--prefix') + 1]
          if (prefix === undefined) throw new Error('missing prefix')
          await mkdir(join(prefix, 'bin'), { recursive: true })
          request.onLine?.('Linking packages')
        }
      },
    })
    const phases: string[] = []
    const sourceIds: (string | undefined)[] = []
    const applied = await provisioner.provision(declaration, new AbortController().signal, (update) => {
      phases.push(update.phase)
      sourceIds.push(update.sourceId)
    })

    const publishedPrefix = join(root, 'environments/test-science/2026.08.1')
    expect(applied.prefix).toBe(publishedPrefix)
    expect(applied.sourceId).toBe(SOURCE_A.id)
    // 'checking' precedes any source attempt; every later phase names the
    // one source this declaration ships.
    expect(sourceIds).toEqual([undefined, SOURCE_A.id, SOURCE_A.id, SOURCE_A.id, SOURCE_A.id, SOURCE_A.id])
    // Health checks (and create) all run against the exact path applied.json
    // ends up pointing at — there is no separate partial or renamed path.
    expect(calls.map(call => call.executable)).toEqual([
      '/bundled/micromamba',
      join(publishedPrefix, 'bin/python'),
      join(publishedPrefix, 'bin/Rscript'),
    ])
    expect(calls[0]!.args).toContain('--no-rc')
    expect(calls[0]!.args).toContain('--override-channels')
    expect(JSON.parse(await readFile(join(root, 'applied.json'), 'utf8'))).toEqual(applied)
    expect(phases).toEqual(['checking', 'solving', 'installing', 'verifying', 'publishing', 'ready'])
  })

  it('never hands a provisioning child a credential-shaped ambient variable, but keeps PATH and proxy vars', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-provision-env-'))
    const originalSecret = process.env.DSH_TEST_PROVISION_SECRET_KEY
    const originalProxy = process.env.HTTPS_PROXY
    process.env.DSH_TEST_PROVISION_SECRET_KEY = 'do-not-leak'
    process.env.HTTPS_PROXY = 'http://proxy.example:8080'
    try {
      const seenEnvs: NodeJS.ProcessEnv[] = []
      const provisioner = new DesktopEnvironmentProvisioner({
        root,
        micromambaPath: '/m',
        platform: 'darwin-arm64',
        freeBytes: async () => 1_000,
        run: async (request) => {
          seenEnvs.push(request.env)
          if (request.args[0] === 'create') {
            const prefix = request.args[request.args.indexOf('--prefix') + 1]!
            await mkdir(join(prefix, 'bin'), { recursive: true })
          }
        },
      })
      await provisioner.provision(declaration, new AbortController().signal)
      expect(seenEnvs.length).toBeGreaterThan(0)
      for (const env of seenEnvs) {
        expect(env.DSH_TEST_PROVISION_SECRET_KEY).toBeUndefined()
        expect(env.PATH).toBe(process.env.PATH)
        expect(env.HTTPS_PROXY).toBe('http://proxy.example:8080')
      }
    } finally {
      if (originalSecret === undefined) delete process.env.DSH_TEST_PROVISION_SECRET_KEY
      else process.env.DSH_TEST_PROVISION_SECRET_KEY = originalSecret
      if (originalProxy === undefined) delete process.env.HTTPS_PROXY
      else process.env.HTTPS_PROXY = originalProxy
    }
  })

  it('preserves the prior pointer when a different revision fails its health check', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-provision-fail-'))
    const other = parseEnvironmentDeclaration({ ...declaration, revision: '2026.08.2' })
    const first = new DesktopEnvironmentProvisioner({
      root, micromambaPath: '/m', platform: 'darwin-arm64', now: () => 1, freeBytes: async () => 1_000,
      run: async (request) => {
        if (request.args[0] === 'create') {
          const prefix = request.args[request.args.indexOf('--prefix') + 1]!
          await mkdir(join(prefix, 'bin'), { recursive: true })
        }
      },
    })
    const original = await first.provision(declaration, new AbortController().signal)
    const retry = new DesktopEnvironmentProvisioner({
      root, micromambaPath: '/m', platform: 'darwin-arm64', now: () => 2, freeBytes: async () => 1_000,
      run: async (request) => {
        if (request.args[0] === 'create') {
          const prefix = request.args[request.args.indexOf('--prefix') + 1]!
          await mkdir(join(prefix, 'bin'), { recursive: true })
          return
        }
        throw new Error('health failed')
      },
    })
    await expect(retry.provision(other, new AbortController().signal)).rejects.toThrow('health failed')
    expect(await retry.applied()).toEqual(original)
  })

  it('cleans a stale, unready prefix before retrying the same revision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-provision-stale-'))
    const prefix = join(root, 'environments/test-science/2026.08.1')
    const staleFile = join(prefix, 'stale-marker')
    const failing = new DesktopEnvironmentProvisioner({
      root, micromambaPath: '/m', platform: 'darwin-arm64', now: () => 1, freeBytes: async () => 1_000,
      run: async (request) => {
        if (request.args[0] === 'create') {
          await mkdir(join(prefix, 'bin'), { recursive: true })
          await writeFile(staleFile, 'leftover')
          return
        }
        throw new Error('health failed')
      },
    })
    await expect(failing.provision(declaration, new AbortController().signal)).rejects.toThrow('health failed')
    expect(await failing.applied()).toBeUndefined()
    await expect(readFile(staleFile, 'utf8')).resolves.toBe('leftover')

    const retry = new DesktopEnvironmentProvisioner({
      root, micromambaPath: '/m', platform: 'darwin-arm64', now: () => 2, freeBytes: async () => 1_000,
      run: async (request) => {
        if (request.args[0] === 'create') {
          // A prefix directory with no matching applied.json entry is not
          // ready: this retry must see a clean prefix, not the marker a
          // previous failed attempt left behind.
          await expect(readFile(staleFile, 'utf8')).rejects.toThrow()
          await mkdir(join(prefix, 'bin'), { recursive: true })
        }
      },
    })
    const applied = await retry.provision(declaration, new AbortController().signal)
    expect(applied.prefix).toBe(prefix)
    expect(await retry.applied()).toEqual(applied)
  })

  it('a same-revision re-provision that fails mid-create clears the pointer instead of leaving a destroyed prefix marked current', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-reprovision-fail-'))
    const first = new DesktopEnvironmentProvisioner({
      root, micromambaPath: '/m', platform: 'darwin-arm64', now: () => 1, freeBytes: async () => 1_000, run: createOnly,
    })
    await first.provision(declaration, new AbortController().signal)

    const retry = new DesktopEnvironmentProvisioner({
      root, micromambaPath: '/m', platform: 'darwin-arm64', now: () => 2, freeBytes: async () => 1_000,
      run: async (request) => {
        if (request.args[0] === 'create') throw new Error('create failed mid-run')
      },
    })
    await expect(retry.provision(declaration, new AbortController().signal)).rejects.toThrow('create failed mid-run')
    expect(await retry.applied()).toBeUndefined()
    expect(resolveDisciplineStatus(await retry.applied(), [declaration]).kind).not.toBe('current')
  })

  it('a successful same-revision re-provision restores the pointer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-reprovision-ok-'))
    const first = new DesktopEnvironmentProvisioner({
      root, micromambaPath: '/m', platform: 'darwin-arm64', now: () => 1, freeBytes: async () => 1_000, run: createOnly,
    })
    const original = await first.provision(declaration, new AbortController().signal)

    const retry = new DesktopEnvironmentProvisioner({
      root, micromambaPath: '/m', platform: 'darwin-arm64', now: () => 2, freeBytes: async () => 1_000, run: createOnly,
    })
    const republished = await retry.provision(declaration, new AbortController().signal)
    expect(republished.prefix).toBe(original.prefix)
    expect(republished.appliedAt).toBe(2)
    expect(await retry.applied()).toEqual(republished)
    expect(resolveDisciplineStatus(await retry.applied(), [declaration]).kind).toBe('current')
  })

  it('rejects before solving when capacity is insufficient', async () => {
    let called = false
    const provisioner = new DesktopEnvironmentProvisioner({
      root: await mkdtemp(join(tmpdir(), 'dsh-desktop-capacity-')),
      micromambaPath: '/m',
      platform: 'darwin-arm64',
      freeBytes: async () => 199,
      run: async () => { called = true },
    })
    await expect(provisioner.provision(declaration, new AbortController().signal)).rejects.toThrow('needs 200 free bytes')
    expect(called).toBe(false)
  })

  it('leaves no applied pointer when cancellation interrupts the solve', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-cancel-'))
    const control = new AbortController()
    const provisioner = new DesktopEnvironmentProvisioner({
      root,
      micromambaPath: '/m',
      platform: 'darwin-arm64',
      freeBytes: async () => 1_000,
      run: async (request) => {
        expect(request.timeoutMs).toBe(declaration.timeoutMs)
        control.abort()
        throw new Error(request.signal.aborted ? 'cancelled' : 'not cancelled')
      },
    })
    await expect(provisioner.provision(declaration, control.signal)).rejects.toThrow('cancelled')
    expect(await provisioner.applied()).toBeUndefined()
  })

  it('passes CONDA_PKGS_DIRS alongside MAMBA_ROOT_PREFIX, resolved from the provisioner root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-pkgs-dirs-'))
    let seenEnv: NodeJS.ProcessEnv | undefined
    const provisioner = new DesktopEnvironmentProvisioner({
      root, micromambaPath: '/m', platform: 'darwin-arm64', freeBytes: async () => 1_000,
      run: async (request) => {
        if (request.args[0] !== 'create') return
        seenEnv = request.env
        const prefix = request.args[request.args.indexOf('--prefix') + 1]!
        await mkdir(join(prefix, 'bin'), { recursive: true })
      },
    })
    await provisioner.provision(declaration, new AbortController().signal)

    expect(seenEnv?.CONDA_PKGS_DIRS).toBe(resolvePackageCacheDir({ platform: 'darwin-arm64', root }))
    expect(seenEnv?.CONDA_PKGS_DIRS).toBe(join(root, 'micromamba', 'pkgs'))
  })

  it('creates the package cache directory before the first create attempt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-pkgs-mkdir-'))
    const provisioner = new DesktopEnvironmentProvisioner({
      root, micromambaPath: '/m', platform: 'darwin-arm64', freeBytes: async () => 1_000, run: createOnly,
    })
    await provisioner.provision(declaration, new AbortController().signal)

    const stats = await stat(resolvePackageCacheDir({ platform: 'darwin-arm64', root }))
    expect(stats.isDirectory()).toBe(true)
  })

  it('fails loud, naming the path, when the package cache directory cannot be created', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-pkgs-mkdir-fail-'))
    // A file sitting where the cache directory's parent must go forces
    // mkdir(..., { recursive: true }) to fail (ENOTDIR), simulating any
    // reason the directory cannot be created without depending on a
    // platform-specific unwritable path.
    await writeFile(join(root, 'micromamba'), 'not a directory')
    const provisioner = new DesktopEnvironmentProvisioner({
      root, micromambaPath: '/m', platform: 'darwin-arm64', freeBytes: async () => 1_000,
      run: async () => { throw new Error('must not run: cache directory creation should fail first') },
    })

    const cacheDir = resolvePackageCacheDir({ platform: 'darwin-arm64', root })
    await expect(provisioner.provision(declaration, new AbortController().signal)).rejects.toThrow(
      `desktop provisioning: could not create package cache directory ${cacheDir}`,
    )
  })

  it('resolves win32 health-check executables to their platform layout, not the POSIX bin/ layout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-win32-health-'))
    const calls: string[] = []
    const provisioner = new DesktopEnvironmentProvisioner({
      root, micromambaPath: '/m', platform: 'win32-x64', freeBytes: async () => 1_000,
      run: async (request) => {
        calls.push(request.executable)
        if (request.args[0] === 'create') {
          const prefix = request.args[request.args.indexOf('--prefix') + 1]!
          await mkdir(prefix, { recursive: true })
        }
      },
    })
    const applied = await provisioner.provision(win32Declaration, new AbortController().signal)

    expect(calls).toEqual([
      '/m',
      join(applied.prefix, 'python.exe'),
      join(applied.prefix, 'Scripts', 'Rscript.exe'),
    ])
  })

  it('gives a win32 health check the same PATH shape the persistent kernel itself runs interpreters under, not the create child\'s PATH', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-win32-health-path-'))
    const envsByExecutable = new Map<string, NodeJS.ProcessEnv>()
    const provisioner = new DesktopEnvironmentProvisioner({
      root, micromambaPath: '/m', platform: 'win32-x64', freeBytes: async () => 1_000,
      run: async (request) => {
        envsByExecutable.set(request.executable, request.env)
        if (request.args[0] === 'create') {
          const prefix = request.args[request.args.indexOf('--prefix') + 1]!
          await mkdir(prefix, { recursive: true })
        }
      },
    })
    const applied = await provisioner.provision(win32Declaration, new AbortController().signal)
    const prefix = applied.prefix

    // The micromamba create child installs into, rather than runs
    // interpreters from, the prefix — its PATH carries no prefix subdirectories.
    expect(envsByExecutable.get('/m')!.PATH).not.toContain(prefix)

    for (const executable of [join(prefix, 'python.exe'), join(prefix, 'Scripts', 'Rscript.exe')]) {
      const path = envsByExecutable.get(executable)!.PATH!
      const segments = path.split(';')
      // win32Path.join, not manual backslash concatenation: it is what the
      // production code itself uses to build a literal win32 PATH string
      // regardless of the host OS, and normalizes a POSIX-shaped test
      // prefix (this test runs cross-platform) the same way.
      expect(segments.slice(0, 6)).toEqual([
        prefix,
        win32Path.join(prefix, 'Library\\mingw-w64\\bin'),
        win32Path.join(prefix, 'Library\\usr\\bin'),
        win32Path.join(prefix, 'Library\\bin'),
        win32Path.join(prefix, 'Scripts'),
        win32Path.join(prefix, 'bin'),
      ])
    }
  })

  describe('ordered source fallback', () => {
    const multiSource = parseEnvironmentDeclaration({ ...declaration, sources: [SOURCE_A, SOURCE_B, SOURCE_C] })

    it('falls back to the next source as a whole retried attempt when the first source fails', async () => {
      const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-fallback-'))
      const attemptedChannels: (readonly string[])[] = []
      const phases: string[] = []
      const provisioner = new DesktopEnvironmentProvisioner({
        root, micromambaPath: '/m', platform: 'darwin-arm64', freeBytes: async () => 1_000,
        run: async (request) => {
          if (request.args[0] !== 'create') return
          const channelArgs = request.args.filter((_, index) => request.args[index - 1] === '--channel')
          attemptedChannels.push(channelArgs)
          const prefix = request.args[request.args.indexOf('--prefix') + 1]!
          if (channelArgs[0] === SOURCE_A.channels[0]) throw new Error('source A unreachable')
          await mkdir(join(prefix, 'bin'), { recursive: true })
        },
      })
      const applied = await provisioner.provision(multiSource, new AbortController().signal, (update) => {
        phases.push(`${update.phase}:${update.message}`)
      })

      // Every source is a whole, independent attempt: source A's channel
      // never appears alongside source B's in one args array.
      expect(attemptedChannels).toEqual([[SOURCE_A.channels[0]], [SOURCE_B.channels[0]]])
      expect(applied.id).toBe(multiSource.id)
      expect(phases.some(entry => entry.includes(SOURCE_B.name))).toBe(true)
      // The published sourceId names the source that actually succeeded
      // (source-b), not the one first tried (source-a) — telemetry's
      // `environment.installed.sourceId` depends on this.
      expect(applied.sourceId).toBe(SOURCE_B.id)
    })

    it('tries every source and surfaces the last error when all sources fail', async () => {
      const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-fallback-all-fail-'))
      const attempts: string[] = []
      const provisioner = new DesktopEnvironmentProvisioner({
        root, micromambaPath: '/m', platform: 'darwin-arm64', freeBytes: async () => 1_000,
        run: async (request) => {
          if (request.args[0] !== 'create') return
          const channelArgs = request.args.filter((_, index) => request.args[index - 1] === '--channel')
          const source = [SOURCE_A, SOURCE_B, SOURCE_C].find(candidate => candidate.channels[0] === channelArgs[0])!
          attempts.push(source.id)
          throw new Error(`${source.id} failed`)
        },
      })

      await expect(provisioner.provision(multiSource, new AbortController().signal)).rejects.toThrow('source-c failed')
      expect(attempts).toEqual(['source-a', 'source-b', 'source-c'])
      expect(await provisioner.applied()).toBeUndefined()
    })

    it('reuses the shared micromamba cache root across every source attempt', async () => {
      const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-fallback-cache-'))
      const cacheRoots = new Set<string>()
      const provisioner = new DesktopEnvironmentProvisioner({
        root, micromambaPath: '/m', platform: 'darwin-arm64', freeBytes: async () => 1_000,
        run: async (request) => {
          if (request.args[0] !== 'create') return
          cacheRoots.add(request.env.MAMBA_ROOT_PREFIX ?? '')
          const channelArgs = request.args.filter((_, index) => request.args[index - 1] === '--channel')
          if (channelArgs[0] === SOURCE_A.channels[0]) throw new Error('source A unreachable')
          const prefix = request.args[request.args.indexOf('--prefix') + 1]!
          await mkdir(join(prefix, 'bin'), { recursive: true })
        },
      })
      await provisioner.provision(multiSource, new AbortController().signal)

      expect(cacheRoots.size).toBe(1)
    })

    it('does not try a later source once cancellation interrupts an earlier attempt', async () => {
      const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-fallback-cancel-'))
      const control = new AbortController()
      const attempts: string[] = []
      const provisioner = new DesktopEnvironmentProvisioner({
        root, micromambaPath: '/m', platform: 'darwin-arm64', freeBytes: async () => 1_000,
        run: async (request) => {
          if (request.args[0] !== 'create') return
          const channelArgs = request.args.filter((_, index) => request.args[index - 1] === '--channel')
          const source = [SOURCE_A, SOURCE_B, SOURCE_C].find(candidate => candidate.channels[0] === channelArgs[0])!
          attempts.push(source.id)
          control.abort()
          throw new Error('cancelled')
        },
      })

      await expect(provisioner.provision(multiSource, control.signal)).rejects.toThrow('cancelled')
      expect(attempts).toEqual(['source-a'])
    })

    it('starts from a preferred source id, keeping the rest in their declared order', async () => {
      const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-fallback-preferred-'))
      const attempts: string[] = []
      const provisioner = new DesktopEnvironmentProvisioner({
        root, micromambaPath: '/m', platform: 'darwin-arm64', freeBytes: async () => 1_000,
        run: async (request) => {
          if (request.args[0] !== 'create') return
          const channelArgs = request.args.filter((_, index) => request.args[index - 1] === '--channel')
          const source = [SOURCE_A, SOURCE_B, SOURCE_C].find(candidate => candidate.channels[0] === channelArgs[0])!
          attempts.push(source.id)
          throw new Error(`${source.id} failed`)
        },
      })

      await expect(provisioner.provision(multiSource, new AbortController().signal, undefined, 'source-c')).rejects.toThrow()
      expect(attempts).toEqual(['source-c', 'source-a', 'source-b'])
    })
  })
})

describe('resolvePackageCacheDir', () => {
  it('resolves darwin to the pre-existing implicit default under the provisioner root', () => {
    expect(resolvePackageCacheDir({ platform: 'darwin-arm64', root: '/Users/test/.papermachine/desktop-environments' }))
      .toBe(join('/Users/test/.papermachine/desktop-environments', 'micromamba', 'pkgs'))
    expect(resolvePackageCacheDir({ platform: 'darwin-x64', root: '/root' })).toBe(join('/root', 'micromamba', 'pkgs'))
  })

  it('resolves win32-x64 to a short path directly under the given system drive, ignoring the provisioner root', () => {
    expect(resolvePackageCacheDir({
      platform: 'win32-x64',
      root: 'C:\\Users\\test\\.papermachine\\desktop-environments',
      systemDrive: 'D:',
    })).toBe('D:\\pm\\pkgs')
  })

  it('falls back to C: when SystemDrive is not given', () => {
    expect(resolvePackageCacheDir({ platform: 'win32-x64', root: 'C:\\anything' })).toBe('C:\\pm\\pkgs')
  })

  it('falls back to C: when SystemDrive is the empty string', () => {
    expect(resolvePackageCacheDir({ platform: 'win32-x64', root: 'C:\\anything', systemDrive: '' })).toBe('C:\\pm\\pkgs')
  })

  it('keeps the resolved win32 cache root short enough that the longest known layered relative path stays under MAX_PATH', () => {
    // The longest relative path micromamba 2.x's layered package cache
    // produces for the shipped `general` declaration's slowest mirror
    // (TUNA) is about 245 characters
    // (https://github.com/SuperJJ007/papermachine/issues/4); win32's
    // MAX_PATH is 260.
    const cacheDir = resolvePackageCacheDir({ platform: 'win32-x64', root: 'C:\\Users\\test\\.papermachine\\desktop-environments' })
    const LONGEST_KNOWN_RELATIVE_CACHE_PATH_LENGTH = 245
    const WIN32_MAX_PATH = 260
    expect(cacheDir.length + LONGEST_KNOWN_RELATIVE_CACHE_PATH_LENGTH).toBeLessThan(WIN32_MAX_PATH)
  })
})

describe('orderSourcesFrom', () => {
  it('leaves the order unchanged when no preferred id is given', () => {
    expect(orderSourcesFrom([SOURCE_A, SOURCE_B], undefined)).toEqual([SOURCE_A, SOURCE_B])
  })

  it('leaves the order unchanged when the preferred id is not in the list', () => {
    expect(orderSourcesFrom([SOURCE_A, SOURCE_B], 'not-a-source')).toEqual([SOURCE_A, SOURCE_B])
  })

  it('moves the preferred source to the front, keeping the rest in order', () => {
    expect(orderSourcesFrom([SOURCE_A, SOURCE_B, SOURCE_C], 'source-c')).toEqual([SOURCE_C, SOURCE_A, SOURCE_B])
  })

  it('leaves a list already starting with the preferred source unchanged', () => {
    expect(orderSourcesFrom([SOURCE_A, SOURCE_B], 'source-a')).toEqual([SOURCE_A, SOURCE_B])
  })
})

describe('buildProvisioningEnv', () => {
  it('keeps the allowlist and drops everything credential-shaped on darwin, untouched by the win32 additions', () => {
    const env = buildProvisioningEnv({ platform: 'darwin-arm64', root: '/Users/test/.papermachine/desktop-environments' }, {
      PATH: '/usr/bin',
      HOME: '/Users/test',
      TMPDIR: '/tmp',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      HTTPS_PROXY: 'http://proxy:8080',
      no_proxy: 'localhost',
      DEEPSEEK_API_KEY: 'sk-secret',
      GITHUB_TOKEN: 'ghp-secret',
      SOME_PASSWORD: 'hunter2',
      RANDOM_UNRELATED_VAR: 'noise',
      SystemRoot: 'C:\\Windows',
    })
    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME: '/Users/test',
      TMPDIR: '/tmp',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      HTTPS_PROXY: 'http://proxy:8080',
      no_proxy: 'localhost',
    })
  })

  it('on win32, carries through the ambient system keys and points TEMP/TMP at its own scratch directory', () => {
    const root = 'C:\\Users\\test\\.papermachine\\desktop-environments'
    const env = buildProvisioningEnv({ platform: 'win32-x64', root }, {
      PATH: 'C:\\Windows\\System32',
      HOME: 'C:\\Users\\test',
      LANG: 'en_US.UTF-8',
      SystemRoot: 'C:\\Windows',
      windir: 'C:\\Windows',
      SystemDrive: 'C:',
      ComSpec: 'C:\\Windows\\System32\\cmd.exe',
      PATHEXT: '.COM;.EXE',
      USERPROFILE: 'C:\\Users\\test',
      APPDATA: 'C:\\Users\\test\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
      PROGRAMDATA: 'C:\\ProgramData',
      NUMBER_OF_PROCESSORS: '8',
      PROCESSOR_ARCHITECTURE: 'AMD64',
      DEEPSEEK_API_KEY: 'sk-secret',
    })
    expect(env).toMatchObject({
      SystemRoot: 'C:\\Windows',
      windir: 'C:\\Windows',
      SystemDrive: 'C:',
      ComSpec: 'C:\\Windows\\System32\\cmd.exe',
      PATHEXT: '.COM;.EXE',
      USERPROFILE: 'C:\\Users\\test',
      APPDATA: 'C:\\Users\\test\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
      PROGRAMDATA: 'C:\\ProgramData',
      NUMBER_OF_PROCESSORS: '8',
      PROCESSOR_ARCHITECTURE: 'AMD64',
    })
    expect(env.TEMP).toBe(provisioningScratchTempDir(root))
    expect(env.TMP).toBe(provisioningScratchTempDir(root))
    expect(env.PATH).toBe('C:\\Windows\\System32')
    expect(env.DEEPSEEK_API_KEY).toBeUndefined()
  })

  it('on win32, an ambient key absent from the source is not fabricated', () => {
    const env = buildProvisioningEnv({ platform: 'win32-x64', root: 'C:\\pm\\desktop-environments' }, { PATH: 'C:\\Windows\\System32' })
    expect(env.SystemRoot).toBeUndefined()
    expect(env.USERPROFILE).toBeUndefined()
  })

  it('on win32, finds PATH under its real casing (Path) rather than discarding the system PATH entirely', () => {
    // Node preserves whatever case a real Windows host's environment block
    // used for each key; the system variable is conventionally `Path`, not
    // POSIX's uniform `PATH`. An exact `key === 'PATH'` match against this
    // finds nothing, which previously discarded System32 and everything
    // else the host's own PATH carries.
    const root = 'C:\\Users\\test\\.papermachine\\desktop-environments'
    const env = buildProvisioningEnv({ platform: 'win32-x64', root }, { Path: 'C:\\Windows\\System32;C:\\Windows' })
    expect(env.PATH).toBe('C:\\Windows\\System32;C:\\Windows')
    // The output always normalizes to the single uppercase key, never the
    // source's own casing — Windows treats an environment block
    // case-insensitively, so a second `Path` entry would be redundant, not
    // additive.
    expect((env as Record<string, unknown>).Path).toBeUndefined()
  })

  it('for a health-check child, prepends the prefix\'s own win32 Conda subdirectories before the ambient PATH', () => {
    const root = 'C:\\Users\\test\\.papermachine\\desktop-environments'
    const prefix = 'C:\\Users\\test\\.papermachine\\desktop-environments\\environments\\general\\2026.09.1'
    const env = buildProvisioningEnv(
      { platform: 'win32-x64', root, win32HealthCheckPrefix: prefix },
      { Path: 'C:\\Windows\\System32' },
    )
    expect(env.PATH).toBe([
      prefix,
      `${prefix}\\Library\\mingw-w64\\bin`,
      `${prefix}\\Library\\usr\\bin`,
      `${prefix}\\Library\\bin`,
      `${prefix}\\Scripts`,
      `${prefix}\\bin`,
      'C:\\Windows\\System32',
    ].join(';'))
  })

  it('for the micromamba create child (no win32HealthCheckPrefix), PATH is the ambient PATH unchanged', () => {
    const root = 'C:\\Users\\test\\.papermachine\\desktop-environments'
    const env = buildProvisioningEnv({ platform: 'win32-x64', root }, { Path: 'C:\\Windows\\System32' })
    expect(env.PATH).toBe('C:\\Windows\\System32')
  })
})

describe('runProvisioningProcess', () => {
  it('cancellation kills the whole process group, not just the direct child', async () => {
    const control = new AbortController()
    const lines: string[] = []
    // A real grandchild spawned by the direct child, in the same POSIX
    // process group: only a negative-pid (group) signal reaches it.
    const source = `
      const { spawn } = require('node:child_process')
      const grandchild = spawn(process.execPath, ['--eval', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
      console.log('grandchild-pid ' + grandchild.pid)
      setInterval(() => {}, 1000)
    `
    const run = runProvisioningProcess({
      executable: process.execPath,
      args: ['--eval', source],
      env: { ...process.env },
      signal: control.signal,
      timeoutMs: 5_000,
      onLine: (line) => { lines.push(line) },
    })
    await vi.waitFor(() => { expect(lines.some(line => line.startsWith('grandchild-pid '))).toBe(true) })
    const grandchildPid = Number(lines.find(line => line.startsWith('grandchild-pid '))!.slice('grandchild-pid '.length))

    control.abort()
    await expect(run).rejects.toThrow('cancelled')
    await vi.waitFor(() => { expect(() => process.kill(grandchildPid, 0)).toThrow() })
  })

  it.runIf(process.platform !== 'win32')('rejects on timeout and still stops the process group', async () => {
    const lines: string[] = []
    const source = `
      const { spawn } = require('node:child_process')
      const grandchild = spawn(process.execPath, ['--eval', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
      console.log('grandchild-pid ' + grandchild.pid)
      setInterval(() => {}, 1000)
    `
    const run = runProvisioningProcess({
      executable: process.execPath,
      args: ['--eval', source],
      env: { ...process.env },
      signal: new AbortController().signal,
      timeoutMs: 300,
      onLine: (line) => { lines.push(line) },
    })
    await expect(run).rejects.toThrow('timed out')
    const grandchildPid = Number(lines.find(line => line.startsWith('grandchild-pid '))!.slice('grandchild-pid '.length))
    await vi.waitFor(() => { expect(() => process.kill(grandchildPid, 0)).toThrow() })
  })

  it.runIf(process.platform !== 'win32')('escalates to a group SIGKILL when a grandchild ignores SIGTERM after the direct child exits, and does not settle rejection before the grandchild is confirmed dead', async () => {
    // The direct child exits cleanly on SIGTERM (mirroring a solve process
    // that disposes itself) while its grandchild ignores it: only a
    // group-aware escalation collects the grandchild, mirroring
    // host-process.spec.ts's own escalation test.
    const lines: string[] = []
    const source = `
      const { spawn } = require('node:child_process')
      const grandchild = spawn(process.execPath, ['--eval', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: 'ignore' })
      console.log('grandchild-pid ' + grandchild.pid)
      process.on('SIGTERM', () => process.exit(0))
      setInterval(() => {}, 1000)
    `
    const run = runProvisioningProcess({
      executable: process.execPath,
      args: ['--eval', source],
      env: { ...process.env },
      signal: new AbortController().signal,
      timeoutMs: 300,
      onLine: (line) => { lines.push(line) },
    })
    await expect(run).rejects.toThrow('timed out')
    const grandchildPid = Number(lines.find(line => line.startsWith('grandchild-pid '))!.slice('grandchild-pid '.length))
    // The rejection contract is that an awaited rejection means the whole
    // group is gone: the grandchild outlived the direct child's own exit
    // (only the grace-period escalation to a group SIGKILL collects it), so
    // it must already be dead by the time `run` rejects, with no further
    // wait needed.
    expect(() => process.kill(grandchildPid, 0)).toThrow()
  }, 10_000)
})

describe('describeWin32MissingCrtExit', () => {
  it('names STATUS_DLL_NOT_FOUND (3221225781 / 0xC0000135), the executable, the original code, and the redistributable download link, bilingually', () => {
    const message = describeWin32MissingCrtExit(3221225781, 'micromamba.exe')
    expect(message).toContain('micromamba.exe')
    expect(message).toContain('3221225781')
    expect(message).toContain('0xC0000135')
    expect(message).toContain('https://aka.ms/vc14/vc_redist.x64.exe')
    expect(message).toMatch(/Microsoft Visual C\+\+/u)
    expect(message).toContain(' · ') // Chinese and English joined, matching this codebase's bilingual message convention.
  })

  it('returns undefined for any other exit code, leaving the caller\'s original message unchanged', () => {
    expect(describeWin32MissingCrtExit(1, 'micromamba.exe')).toBeUndefined()
    expect(describeWin32MissingCrtExit(0, 'micromamba.exe')).toBeUndefined()
  })
})

describe('stopProcessGroup', () => {
  it('settles by rejecting, naming the pid, instead of waiting forever when the group can never be confirmed dead', async () => {
    // A fake ChildProcess with a pid nothing real ever runs at: process.kill
    // is stubbed to never throw for it, so isProcessGroupAlive reports it
    // alive across every poll (the same observable outcome an EPERM check
    // would produce), forcing stopProcessGroup through both bounded waits to
    // their deadlines with nothing real ever signalled or leaked. `kill` is
    // the child's own method signalProcessGroup uses on Windows, where there
    // is no process group to signal through `process.kill(-pid)`.
    const fakeChild = { pid: 999_999, kill: () => true } as unknown as ChildProcess
    vi.useFakeTimers()
    try {
      const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true)
      const settled = expect(stopProcessGroup(fakeChild)).rejects.toThrow(
        'desktop provisioning: process group 999999 may still be alive after SIGKILL',
      )
      await vi.runAllTimersAsync()
      await settled
      expect(killSpy).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('parseMicromambaProgressLine', () => {
  it('parses download progress with bytes, speed, ETA, and package name', () => {
    const parsed = parseMicromambaProgressLine('python-3.13.0-xxx    10.0MB / 20.0MB (2.0MB/s)    50%')
    expect(parsed.currentPackage).toBe('python-3.13.0-xxx')
    expect(parsed.bytesDownloaded).toBe(10 * 1024 * 1024)
    expect(parsed.bytesTotal).toBe(20 * 1024 * 1024)
    expect(parsed.speedBytesPerSec).toBe(2 * 1024 * 1024)
    expect(parsed.etaSeconds).toBe(5)
    expect(parsed.percent).toBe(50)
  })

  it('parses package action lines during extraction and linking', () => {
    const extracted = parseMicromambaProgressLine('Extracting python-3.13.0-h123')
    expect(extracted.currentPackage).toBe('python-3.13.0-h123')

    const linked = parseMicromambaProgressLine('Linking r-base-4.5.0-h456')
    expect(linked.currentPackage).toBe('r-base-4.5.0-h456')
  })
})

/**
 * Extract a `const NAME = [...] as const` array literal's string entries
 * from raw TypeScript source text, without importing or evaluating the
 * source — used to compare `provisioning.ts`'s two win32 constants against
 * their science-runtime originals (see the source-text comparison suites
 * below) without a cross-package import.
 * @param source - the file's raw source text.
 * @param constantName - the `const` identifier to find.
 * @returns the array literal's entries, quotes stripped, in declared order.
 */
function extractConstArrayLiteral(source: string, constantName: string): readonly string[] {
  const declaration = source.match(new RegExp(`const ${constantName} = \\[([\\s\\S]*?)\\] as const`))
  const body = declaration?.[1]
  if (body === undefined) throw new Error(`provisioning.spec: could not find "${constantName}" in the given source`)
  return body
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0)
    .map(entry => entry.replace(/^['"]|['"]$/g, ''))
}

const provisioningSource = readFileSync(fileURLToPath(new URL('../src/provisioning.ts', import.meta.url)), 'utf8')

describe('WIN32_AMBIENT_ENVIRONMENT_KEYS matches science-runtime source text', () => {
  it('names the exact same keys as kernel-process.ts\'s WIN32_AMBIENT_ENVIRONMENT_KEYS', () => {
    const kernelProcessSource = readFileSync(
      fileURLToPath(new URL('../../../packages/science/science-runtime/src/kernel-process.ts', import.meta.url)),
      'utf8',
    )
    expect(extractConstArrayLiteral(provisioningSource, 'WIN32_AMBIENT_ENVIRONMENT_KEYS'))
      .toEqual(extractConstArrayLiteral(kernelProcessSource, 'WIN32_AMBIENT_ENVIRONMENT_KEYS'))
  })
})

describe('WIN32_HEALTH_CHECK_PATH_SUBDIRECTORIES matches science-runtime source text', () => {
  it('names the exact same ordered subdirectories as execution.ts\'s WINDOWS_PATH_SUBDIRECTORIES', () => {
    const executionSource = readFileSync(
      fileURLToPath(new URL('../../../packages/science/science-runtime/src/execution.ts', import.meta.url)),
      'utf8',
    )
    expect(extractConstArrayLiteral(provisioningSource, 'WIN32_HEALTH_CHECK_PATH_SUBDIRECTORIES'))
      .toEqual(extractConstArrayLiteral(executionSource, 'WINDOWS_PATH_SUBDIRECTORIES'))
  })
})
