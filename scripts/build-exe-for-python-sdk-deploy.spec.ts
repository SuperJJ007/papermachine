import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { deployRuntimeClosure } from './build-exe-for-python-sdk.ts'

// Use the repository's pinned pnpm dependency, never a PATH shim that may select
// another version or install tools in the shared workspace.
const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const pnpmManifest = require.resolve('pnpm')
const pnpmVersion = (JSON.parse(readFileSync(pnpmManifest, 'utf8')) as { version: string }).version
const pnpm = join(dirname(pnpmManifest), 'bin/pnpm.mjs')
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function runPnpm(root: string, args: string[]): void {
  // pnpm injects this override into script children; the fixture owns its run policy.
  const env = Object.fromEntries(Object.entries(process.env)
    .filter(([name]) => name.toLowerCase() !== 'pnpm_config_verify_deps_before_run'))
  const result = spawnSync(process.execPath, [pnpm, '--config.manage-package-manager-versions=false', '--config.offline=true', '--config.store-dir=' + join(root, 'store'), ...args], {
    cwd: root,
    env: { ...env, CI: 'true' },
    encoding: 'utf8',
    timeout: 20_000,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stdout + result.stderr)
}

function fixture(policy: 'allow' | 'deny' | 'unknown' = 'allow'): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-python-deploy-test-')))
  roots.push(root)
  function manifest(path: string, value: object): void {
    mkdirSync(join(root, path), { recursive: true })
    writeFileSync(join(root, path, 'package.json'), JSON.stringify(value))
  }
  manifest('.', { name: 'deploy-test', private: true, packageManager: `pnpm@${pnpmVersion}`, scripts: { 'verify-runtime-closure': 'node preflight.mjs' } })
  writeFileSync(join(root, 'preflight.mjs'), "import { existsSync } from 'node:fs'; if (existsSync('reject-preflight')) throw new Error('fixture closure rejected'); console.log('fixture closure checked')\n")
  writeFileSync(join(root, 'pnpm-workspace.yaml'), `packages:
  - packages/*
  - python/sdk-runtime
linkWorkspacePackages: true
storeDir: ./store
verifyDepsBeforeRun: install
forceLegacyDeploy: true
overrides:
  '@repro/core': 'link:packages/core'
${policy === 'unknown' ? '' : `allowBuilds:\n  '@repro/plugin@file:packages/plugin': ${policy === 'allow'}\n`}`)
  manifest('packages/core', { name: '@repro/core', version: '1.0.0', type: 'module', exports: './index.js', bin: { core: 'bin.js' } })
  writeFileSync(join(root, 'packages/core/index.js'), 'export const singleton = {}\n')
  writeFileSync(join(root, 'packages/core/bin.js'), '#!/usr/bin/env node\nconsole.log(\"fixture core\")\n')
  manifest('packages/plugin', {
    name: '@repro/plugin', version: '1.0.0', type: 'module', exports: './index.js',
    peerDependencies: { '@repro/core': '^1.0.0' },
    devDependencies: { '@repro/core': 'workspace:^' },
    scripts: { postinstall: 'node postinstall.js' },
  })
  writeFileSync(join(root, 'packages/plugin/index.js'), "export { singleton } from '@repro/core'\n")
  writeFileSync(join(root, 'packages/plugin/postinstall.js'),
    "import { writeFileSync } from 'node:fs'; writeFileSync('built-marker', 'built in deployment')\n")
  manifest('packages/cli', {
    name: '@repro/cli', version: '1.0.0', type: 'module', exports: './index.js',
    dependencies: { '@repro/core': 'workspace:^', '@repro/plugin': 'workspace:^' },
  })
  writeFileSync(join(root, 'packages/cli/index.js'), "export { singleton } from '@repro/core'\n")
  manifest('python/sdk-runtime', {
    name: 'dsh-python-runtime-closure', version: '1.0.0', private: true,
    dependencies: { '@repro/core': 'workspace:^', '@repro/plugin': 'workspace:^', '@repro/cli': 'workspace:^' },
  })
  runPnpm(root, ['install', '--ignore-scripts'])
  writeFileSync(join(root, 'packages/plugin/node_modules/source-marker'), 'must stay in source')
  return root
}

// Record identities as well as content so moving then recreating a directory is
// not accepted as preserving source dependencies. Never traverse package links.
function sourceState(root: string): Record<string, unknown> {
  const state: Record<string, unknown> = {}
  function visit(path: string): void {
    const absolute = join(root, path)
    let stat: ReturnType<typeof lstatSync>
    try { stat = lstatSync(absolute) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      state[path] = 'missing'
      return
    }
    if (stat.isSymbolicLink()) {
      state[path] = { ino: stat.ino, link: readlinkSync(absolute) }
    } else if (stat.isDirectory()) {
      state[path] = { ino: stat.ino, mode: stat.mode }
      for (const name of readdirSync(absolute).sort()) visit(join(path, name))
    } else {
      state[path] = { ino: stat.ino, hash: createHash('sha256').update(readFileSync(absolute)).digest('hex') }
    }
  }
  for (const path of ['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', 'node_modules',
    'packages/core/node_modules', 'packages/plugin/node_modules', 'packages/cli/node_modules',
    'python/sdk-runtime/node_modules']) visit(path)
  return state
}

function staleDependencyState(root: string): void {
  const path = join(root, 'node_modules/.pnpm-workspace-state-v1.json')
  const state = JSON.parse(readFileSync(path, 'utf8')) as { settings: { autoInstallPeers: boolean } }
  state.settings.autoInstallPeers = !state.settings.autoInstallPeers
  writeFileSync(path, JSON.stringify(state))
}

describe('Python closure deployment', () => {
  it('exposes automatic source refresh before an unguarded preflight run', () => {
    const root = fixture('deny')
    staleDependencyState(root)
    const shim = join(root, 'packages/cli/node_modules/.bin/core')
    writeFileSync(shim, readFileSync(shim, 'utf8') + '\n# stale fixture shim\n')
    const before = sourceState(root)
    runPnpm(root, ['run', 'verify-runtime-closure'])
    expect(readFileSync(shim, 'utf8')).not.toContain('# stale fixture shim')
    expect(sourceState(root)).not.toEqual(before)
  }, 30_000)

  it.each([false, true])('keeps source unchanged when the actual preflight arguments run (rejection=%s)', (reject) => {
    const root = fixture('deny')
    staleDependencyState(root)
    if (reject) writeFileSync(join(root, 'reject-preflight'), '')
    const before = sourceState(root)
    // Obtain the arguments from the real builder entrypoint without deploying
    // into the checkout, then execute that preflight in the isolated workspace.
    const dryRun = spawnSync(process.execPath, ['--import', 'tsx/esm',
      fileURLToPath(new URL('./build-exe-for-python-sdk.ts', import.meta.url)),
      '--dry-run', '--skip-build', '--targets=node24-macos-arm64'], {
      cwd: new URL('..', import.meta.url), encoding: 'utf8',
      env: { ...process.env, npm_execpath: 'test-pnpm.mjs' },
    })
    expect(dryRun.status).toBe(0)
    const command = dryRun.stdout.split(/\r?\n/).find(line => line.endsWith(' run verify-runtime-closure'))!
    const args = command.split('test-pnpm.mjs ')[1]!.split(' ')
    if (reject) {
      expect(() => { runPnpm(root, args) }).toThrow('fixture closure rejected')
    } else {
      runPnpm(root, args)
    }
    expect(sourceState(root)).toEqual(before)
  }, 30_000)

  it('exposes source-directory movement in legacy hoisted deployment', () => {
    const root = fixture()
    const before = sourceState(root)
    runPnpm(root, ['--filter', 'dsh-python-runtime-closure', 'deploy', '--legacy', '--prod',
      '--config.node-linker=hoisted', '--config.auto-install-peers=false', '--ignore-scripts', join(root, 'deployed')])
    expect(existsSync(join(root, 'packages/plugin/node_modules'))).toBe(false)
    expect(readFileSync(join(root, 'python/sdk-runtime/node_modules/@repro/plugin/node_modules/source-marker'), 'utf8'))
      .toBe('must stay in source')
    expect(sourceState(root)).not.toEqual(before)
  }, 30_000)

  it.each(['allow', 'deny'] as const)('preserves source dependencies and %s build decisions with a standalone closure', async (policy) => {
    const root = fixture(policy)
    const before = sourceState(root)
    const staging = join(root, 'deployed')
    let hook = ''
    await deployRuntimeClosure(root, staging, async (args) => {
      hook = args.find(arg => arg.startsWith('--config.global-pnpmfile='))!.split('=').slice(1).join('=')
      runPnpm(root, args)
    })
    expect(sourceState(root)).toEqual(before)
    expect(existsSync(hook)).toBe(false)
    expect(existsSync(join(staging, 'node_modules/@repro/plugin/built-marker'))).toBe(policy === 'allow')
    expect(existsSync(join(root, 'packages/plugin/built-marker'))).toBe(false)
    for (const name of ['core', 'plugin', 'cli']) {
      expect(lstatSync(join(staging, 'node_modules/@repro', name)).isSymbolicLink()).toBe(false)
    }
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { singleton as core } from '@repro/core'
      import { singleton as cli } from '@repro/cli'
      import { singleton as plugin } from '@repro/plugin'
      if (core !== cli || core !== plugin) throw new Error('split module instance')
    `], { cwd: staging, encoding: 'utf8' })
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  }, 30_000)

  it('rejects unreviewed build scripts without changing source dependencies', async () => {
    const root = fixture('unknown')
    const before = sourceState(root)
    let hook = ''
    await expect(deployRuntimeClosure(root, join(root, 'deployed'), async (args) => {
      hook = args.find(arg => arg.startsWith('--config.global-pnpmfile='))!.split('=').slice(1).join('=')
      runPnpm(root, args)
    })).rejects.toThrow('IGNORED_BUILDS')
    expect(sourceState(root)).toEqual(before)
    expect(existsSync(hook)).toBe(false)
  }, 30_000)

  it.each(['missing', 'empty', 'unrelated', 'unversioned'] as const)('rejects a %s lockfile before invoking pnpm', async (kind) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-python-deploy-lock-test-')))
    roots.push(root)
    const contents = {
      empty: '',
      unrelated: 'lockfileVersion: \"9.0\"\nimporters: {other: {}}\n',
      unversioned: 'importers: {python/sdk-runtime: {}}\n',
    }
    if (kind !== 'missing') writeFileSync(join(root, 'pnpm-lock.yaml'), contents[kind])
    const run = vi.fn<(_: string[]) => Promise<void>>()
    await expect(deployRuntimeClosure(root, join(root, 'deployed'), run)).rejects.toThrow()
    expect(run).not.toHaveBeenCalled()
  })
})
