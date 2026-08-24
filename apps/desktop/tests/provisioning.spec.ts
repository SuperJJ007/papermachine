import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { parseEnvironmentDeclaration } from '../src/environment-declaration.ts'
import { buildProvisioningEnv, DesktopEnvironmentProvisioner, runProvisioningProcess, type ProcessRequest } from '../src/provisioning.ts'
import { resolveDisciplineStatus } from '../src/discipline-status.ts'

const declaration = parseEnvironmentDeclaration({
  schemaVersion: 1,
  id: 'test-science',
  revision: '2026.08.1',
  name: 'Test science',
  supportedPlatforms: ['darwin-arm64'],
  channels: ['conda-forge'],
  packages: ['python=3.13', 'r-base=4.5'],
  estimatedDownloadBytes: 100,
  requiredFreeBytes: 200,
  timeoutMs: 1_000,
  healthChecks: [
    { language: 'python', executable: 'python', args: ['-c', 'pass'] },
    { language: 'r', executable: 'Rscript', args: ['-e', 'TRUE'] },
  ],
})

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
    const applied = await provisioner.provision(declaration, new AbortController().signal, (update) => {
      phases.push(update.phase)
    })

    const publishedPrefix = join(root, 'environments/test-science/2026.08.1')
    expect(applied.prefix).toBe(publishedPrefix)
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
})

describe('buildProvisioningEnv', () => {
  it('keeps the allowlist and drops everything credential-shaped', () => {
    const env = buildProvisioningEnv({
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
