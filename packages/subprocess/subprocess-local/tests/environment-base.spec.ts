import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindManagedProcess, childEnv, spawnSubprocess } from '../src/spawn.ts'
import { runnerEnvironment, targetEnvironment } from '../src/runner-launch.ts'
import { launchWindowsJob } from '../src/windows-job.ts'

vi.mock('@deepseek-ai/dsh-http-proxy', () => ({
  proxyEnvironmentForChild: () => ({ HTTP_PROXY: 'http://proxy.invalid:7890', NODE_USE_ENV_PROXY: '1' }),
}))

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('target environment base', () => {
  it('keeps normalized proxies on the scrubbed base and permits overrides and tombstones', () => {
    vi.stubEnv('P2_AMBIENT', 'ambient')
    expect(childEnv()).toMatchObject({ P2_AMBIENT: 'ambient', HTTP_PROXY: 'http://proxy.invalid:7890', NODE_USE_ENV_PROXY: '1' })
    expect(childEnv({ HTTP_PROXY: 'http://explicit.invalid', P2_AMBIENT: undefined })).toMatchObject({ HTTP_PROXY: 'http://explicit.invalid', P2_AMBIENT: undefined })
  })

  it('omits ambient values and automatic proxies from supported empty target launches', async () => {
    vi.stubEnv('P2_AMBIENT', 'ambient')
    // Windows Node needs SystemRoot for its cryptographic initialization.
    const env = process.platform === 'win32'
      ? { ONLY: 'explicit', SystemRoot: process.env.SystemRoot! }
      : { ONLY: 'explicit' }
    const spec = {
      environmentBase: 'empty' as const,
      argv: [process.execPath, '-e', 'process.stdout.write(JSON.stringify(process.env))'],
      cwd: process.cwd(),
      stdio: { stdin: 'ignore' as const, stdout: { maxBytes: 8192 }, stderr: { maxBytes: 8192 } },
      graceMs: 1000,
      env,
    }
    expect(targetEnvironment(spec)).toEqual(env)
    expect(runnerEnvironment('windows')).toMatchObject({ P2_AMBIENT: 'ambient', HTTP_PROXY: 'http://proxy.invalid:7890' })
    const handle = process.platform === 'win32'
      ? bindManagedProcess(spec, launchWindowsJob(spec, targetEnvironment(spec)))
      : spawnSubprocess(spec)
    try {
      await expect(handle.done).resolves.toMatchObject({ exitCode: 0 })
      const observed = JSON.parse(handle.collected.stdout!.readFrom(0).text) as Record<string, string>
      expect(observed.ONLY).toBe('explicit')
      if (process.platform === 'win32') expect(observed).toEqual(env)
      for (const name of ['P2_AMBIENT', 'HTTP_PROXY', 'NODE_USE_ENV_PROXY', 'PATH', 'HOME']) {
        expect(observed[name]).toBeUndefined()
      }
    } finally {
      handle.terminate()
      await handle.waitForExit()
    }
  })

  it('rejects an empty Windows fallback before starting a target', () => {
    const spawn = vi.fn()
    expect(() => spawnSubprocess({
      environmentBase: 'empty',
      argv: [process.execPath, '-e', ''],
      cwd: process.cwd(),
      stdio: { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' },
      graceMs: 1000,
    }, { platform: 'win32', spawn })).toThrow('an empty Windows environment requires the native Win32 Job runner')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('keeps deliberately supplied proxies in empty targets', () => {
    expect(childEnv({ HTTP_PROXY: 'http://explicit.invalid', NODE_USE_ENV_PROXY: '1' }, 'empty'))
      .toEqual({ HTTP_PROXY: 'http://explicit.invalid', NODE_USE_ENV_PROXY: '1' })
  })

  it('applies Windows names case-insensitively for overrides and tombstones', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    expect(childEnv({ http_proxy: undefined }).HTTP_PROXY).toBeUndefined()
    expect(childEnv({ Path: 'first', PATH: 'last' }, 'empty')).toEqual({ PATH: 'last' })
  })
})
