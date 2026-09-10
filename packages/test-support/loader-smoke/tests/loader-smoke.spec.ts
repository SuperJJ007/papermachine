import { existsSync } from 'node:fs'
import { mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const configPath = '/tmp/fixture.cordis.yml'
const tsconfigPath = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))
const fixture = (name: string): string => fileURLToPath(new URL(`./fixtures/${name}.ts`, import.meta.url))
// macOS realpaths temp dirs into /private; TMPDIR may live under /var or /tmp.
const canonicalTempPath = (path: string): string => path.replace(/^\/private(?=\/(?:var|tmp)\/)/, '')

describe('runLoaderSmoke', () => {
  it('isolates the process, closes stdin, captures output, and removes the cwd', async () => {
    const result = await runLoaderSmoke({
      label: 'success fixture',
      tempDirPrefix: 'loader-smoke-success-',
      binScript: fixture('success'),
      configPath,
      tsconfigPath,
      mode: 'src',
      env: { LOADER_SMOKE_MARKER: 'present' },
    })
    const output = JSON.parse(result.stdout) as {
      configPath: string
      args: string[]
      cwd: string
      dshHome: string
      agentsHome: string
      marker: string
      input: string
    }
    expect(output).toMatchObject({
      configPath,
      args: [configPath],
      marker: 'present',
      input: '',
    })
    expect(canonicalTempPath(output.dshHome)).toBe(canonicalTempPath(join(output.cwd, '.dsh')))
    expect(canonicalTempPath(output.agentsHome)).toBe(canonicalTempPath(join(output.cwd, '.agents')))
    expect(result.stderr).toContain('fixture stderr')
    expect(existsSync(output.cwd)).toBe(false)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('passes an arbitrary bin argv and inspects world state before cleanup', async () => {
    let inspected = ''
    let marker = ''
    const result = await runLoaderSmoke({
      label: 'argv fixture',
      tempDirPrefix: 'loader-smoke-argv-',
      binScript: fixture('success'),
      libBinScript: fixture('success'),
      configPath,
      binArgs: ['--config', configPath, '--output-format', 'json', 'task with spaces'],
      tsconfigPath,
      prepare: cwd => writeFile(join(cwd, 'marker.txt'), 'prepared'),
      inspect: async (cwd) => {
        inspected = cwd
        marker = await readFile(join(cwd, 'marker.txt'), 'utf8')
      },
    })
    const output = JSON.parse(result.stdout) as { args: string[]; cwd: string }
    expect(output.args).toEqual(['--config', configPath, '--output-format', 'json', 'task with spaces'])
    expect(canonicalTempPath(inspected)).toBe(canonicalTempPath(output.cwd))
    expect(marker).toBe('prepared')
    expect(existsSync(inspected)).toBe(false)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('rejects a non-zero exit with captured diagnostics', async () => {
    await expect(runLoaderSmoke({
      label: 'failure fixture',
      tempDirPrefix: 'loader-smoke-fail-',
      binScript: fixture('fail'),
      libBinScript: fixture('fail'),
      configPath,
      tsconfigPath,
    })).rejects.toThrow('failure fixture exited 7 (expected 0). stdout:\n\nstderr:\nfixture failed')
  })

  it('accepts a declared expected failure exit and rejects any other outcome', async () => {
    // A scenario pinning a designed failure surface declares its exit code…
    const declared = await runLoaderSmoke({
      label: 'declared failure fixture',
      tempDirPrefix: 'loader-smoke-declared-fail-',
      binScript: fixture('fail'),
      libBinScript: fixture('fail'),
      configPath,
      tsconfigPath,
      expectedExitCode: 7,
    })
    expect(declared.stderr).toBe('fixture failed\n')

    // …and a run that succeeds instead still fails the smoke.
    await expect(runLoaderSmoke({
      label: 'unexpectedly clean fixture',
      tempDirPrefix: 'loader-smoke-clean-',
      binScript: fixture('success'),
      libBinScript: fixture('success'),
      configPath,
      tsconfigPath,
      expectedExitCode: 7,
    })).rejects.toThrow(/exited 0 \(expected 7\)/)
  })

  it('kills a process at its deadline and reports captured output', async () => {
    await expect(runLoaderSmoke({
      label: 'hanging fixture',
      tempDirPrefix: 'loader-smoke-hang-',
      binScript: fixture('hang'),
      libBinScript: fixture('hang'),
      configPath,
      tsconfigPath,
      processTimeoutMs: 100,
    })).rejects.toThrow('hanging fixture did not exit within 0.1s.')
  })
})


describe('isolated profile overlay package provenance', () => {
  it.each([false, true])('checks a package link prepared by the patch materializer (conflict=%s)', async (conflict) => {
    const packages: Record<string, string> = {}
    const run = runLoaderSmoke({
      label: 'prepared overlay', tempDirPrefix: 'loader-overlay-prepared-',
      binScript: fixture('success'), configPath, tsconfigPath, profilePackages: packages,
      prepare: async (cwd) => {
        const directory = join(cwd, 'overlay')
        await mkdir(directory)
        await writeFile(join(directory, 'package.json'), JSON.stringify({ name: '@smoke/overlay', version: '1.0.0' }))
        packages['@smoke/overlay'] = directory
        const parent = join(cwd, '.dsh', 'profiles', 'node_modules', '@smoke')
        await mkdir(parent, { recursive: true })
        await symlink(conflict ? cwd : directory, join(parent, 'overlay'), 'junction')
      },
    })
    if (conflict) await expect(run).rejects.toThrow('resolves to two directories')
    else await expect(run).resolves.toHaveProperty('stdout')
  })

  it.each([false, true])('resolves the real package manifest and removes its links (cwd home=%s)', async (cwdHome) => {
    const packages: Record<string, string> = {}
    const env: NodeJS.ProcessEnv = {}
    let workspace = ''
    await runLoaderSmoke({
      label: 'overlay provenance', tempDirPrefix: 'loader-overlay-',
      binScript: fixture('success'), configPath, tsconfigPath, profilePackages: packages, env,
      prepare: async (cwd) => {
        workspace = cwd
        env.DSH_HOME = cwdHome ? cwd : join(cwd, 'owned-home')
        const directory = join(cwd, 'overlay-package')
        await mkdir(directory)
        await writeFile(join(directory, 'package.json'), JSON.stringify({ name: '@smoke/overlay', version: '1.0.0' }))
        packages['@smoke/overlay'] = directory
      },
      inspect: async () => {
        const require = createRequire(join(env.DSH_HOME!, 'profiles', 'headless', 'cordis.yml'))
        const manifest = require.resolve('@smoke/overlay/package.json')
        expect(await realpath(manifest)).toBe(await realpath(join(workspace, 'overlay-package', 'package.json')))
        expect(JSON.parse(await readFile(manifest, 'utf8'))).toEqual({ name: '@smoke/overlay', version: '1.0.0' })
      },
    })
    expect(existsSync(workspace)).toBe(false)
  })

  it.each([null, 7, {}, { name: 'wrong', version: '1.0.0' }, { name: '@smoke/overlay' },
    { name: '@smoke/overlay', version: 1 }, { name: '@smoke/overlay', version: '' }])(
    'refuses malformed or mismatched package identity %j before launching', async (manifest) => {
      const packages: Record<string, string> = {}
      let workspace = ''
      await expect(runLoaderSmoke({
        label: 'invalid overlay', tempDirPrefix: 'loader-overlay-invalid-',
        binScript: fixture('success'), configPath, tsconfigPath, profilePackages: packages,
        prepare: async (cwd) => {
          workspace = cwd
          packages['@smoke/overlay'] = cwd
          await writeFile(join(cwd, 'package.json'), JSON.stringify(manifest))
        },
      })).rejects.toThrow('requires its matching named and versioned manifest')
      expect(existsSync(workspace)).toBe(false)
    },
  )

  it('rejects a missing package instead of silently omitting its inventory referent', async () => {
    const packages: Record<string, string> = {}
    let workspace = ''
    await expect(runLoaderSmoke({
      label: 'missing overlay', tempDirPrefix: 'loader-overlay-missing-',
      binScript: fixture('success'), configPath, tsconfigPath, profilePackages: packages,
      prepare: (cwd) => { workspace = cwd; packages['@smoke/missing'] = join(cwd, 'missing') },
    })).rejects.toThrow('ENOENT')
    expect(existsSync(workspace)).toBe(false)
  })

  it.each([undefined, '/outside-loader-smoke-home'])('refuses to populate an unowned home %s', async (home) => {
    await expect(runLoaderSmoke({
      label: 'unowned overlay home', tempDirPrefix: 'loader-overlay-home-',
      binScript: fixture('success'), configPath, tsconfigPath,
      profilePackages: {}, env: { DSH_HOME: home },
    })).rejects.toThrow('requires DSH_HOME inside the isolated cwd')
  })
})
