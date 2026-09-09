import { afterEach, describe, expect, it, vi } from 'vitest'
import { childEnv, spawnSubprocess } from '../src/spawn.ts'
import { runnerEnvironment, targetEnvironment } from '../src/runner-launch.ts'

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

  it('omits ambient values and automatic proxies from empty targets on both local launch paths', async () => {
    vi.stubEnv('P2_AMBIENT', 'ambient')
    const spec = {
      environmentBase: 'empty' as const,
      argv: [process.execPath, '-e', 'process.stdout.write(JSON.stringify(process.env))'],
      cwd: process.cwd(),
      stdio: { stdin: 'ignore' as const, stdout: { maxBytes: 8192 }, stderr: { maxBytes: 8192 } },
      graceMs: 1000,
      env: { ONLY: 'explicit' },
    }
    expect(targetEnvironment(spec)).toEqual({ ONLY: 'explicit' })
    expect(runnerEnvironment('windows')).toMatchObject({ P2_AMBIENT: 'ambient', HTTP_PROXY: 'http://proxy.invalid:7890' })
    const handle = spawnSubprocess(spec)
    try {
      await expect(handle.done).resolves.toMatchObject({ exitCode: 0 })
      const observed = JSON.parse(handle.collected.stdout!.readFrom(0).text) as Record<string, string>
      expect(observed.ONLY).toBe('explicit')
      for (const name of ['P2_AMBIENT', 'HTTP_PROXY', 'NODE_USE_ENV_PROXY', 'PATH', 'HOME']) {
        expect(observed[name]).toBeUndefined()
      }
    } finally {
      handle.terminate()
      await handle.waitForExit()
    }
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
