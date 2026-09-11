import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { paperMachineClientBuildEnvironment, writeClientBuildRecord } from '../../../scripts/client-build-environment.ts'
import { prepareDesktopClientBuild, verifyDesktopClientBuild } from '../scripts/client-build.ts'
import { prepareDesktopPackageTarballs } from '../scripts/prepare-desktop-package-tarballs.ts'
import { packReleaseMember } from '../../../scripts/release/pack.ts'

vi.mock('../../../scripts/release/pack.ts', () => ({ packReleaseMember: vi.fn().mockResolvedValue('example.tgz') }))
const roots: string[] = []
function write(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, value)
}
function fixture(profile = 'papermachine'): string {
  vi.stubEnv('DSH_CLIENT_COMMIT_HASH', '0123456')
  const root = mkdtempSync(join(tmpdir(), 'desktop-client-build-'))
  roots.push(root)
  write(join(root, 'package.json'), JSON.stringify({ version: '0.1.5-rc.1' }))
  write(join(root, 'packages/client/example/package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-example', version: '0.1.5-rc.1' }))
  write(join(root, 'apps/web/dist/index.html'), '<title>fixture</title>')
  write(join(root, 'packages/client/example/lib/client.js'), 'fixture')
  writeClientBuildRecord(root, {
    ...paperMachineClientBuildEnvironment(root), DSH_CLIENT_BUILD_PROFILE: profile,
    DSH_CLIENT_TITLE: profile === 'official' ? 'DeepSeek Harness' : 'PaperMachine',
  })
  return root
}
afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
describe('desktop product build admission', () => {
  it('rejects official artifacts with skip-build without invoking any build', async () => {
    const root = fixture('official')
    const build = vi.fn()
    await expect(prepareDesktopClientBuild(root, true, build)).rejects.toThrow('DSH_CLIENT_BUILD_PROFILE')
    expect(build).not.toHaveBeenCalled()
  })
  it('accepts a matching skipped build and validates the result of a requested build', async () => {
    const root = fixture()
    const build = vi.fn(async () => { writeClientBuildRecord(root, paperMachineClientBuildEnvironment(root)) })
    await prepareDesktopClientBuild(root, true, build)
    expect(build).not.toHaveBeenCalled()
    await prepareDesktopClientBuild(root, false, build)
    expect(build).toHaveBeenCalledOnce()
  })
  it('rejects missing records, mixed artifact bytes, and a different source commit', () => {
    const root = fixture()
    write(join(root, 'packages/client/example/lib/client.js'), 'replaced by another build')
    expect(() => { verifyDesktopClientBuild(root) }).toThrow('artifacts differ')
    writeClientBuildRecord(root, paperMachineClientBuildEnvironment(root))
    vi.stubEnv('DSH_CLIENT_COMMIT_HASH', '7654321')
    expect(() => { verifyDesktopClientBuild(root) }).toThrow('COMMIT_HASH')
    rmSync(join(root, '.dsh-build/client-build-environment.json'))
    expect(() => { verifyDesktopClientBuild(root) }).toThrow('record')
  })
  it('rejects official seed inputs before deleting output or invoking the packer', async () => {
    const root = fixture('official')
    const destination = join(root, 'desktop-tarballs')
    write(join(destination, 'existing'), 'preserve')
    await expect(prepareDesktopPackageTarballs(root, destination, {})).rejects.toThrow('DSH_CLIENT_BUILD_PROFILE')
    expect(readFileSync(join(destination, 'existing'), 'utf8')).toBe('preserve')
    expect(packReleaseMember).not.toHaveBeenCalled()
  })
  it('packs a verified product with explicit subprocess environment and no npm publish-order file', async () => {
    const root = fixture()
    const destination = join(root, 'desktop-tarballs')
    const environment = { npm_execpath: '/fixture/pnpm.cjs' }
    await prepareDesktopPackageTarballs(root, destination, environment)
    expect(packReleaseMember).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'dsh' }), expect.objectContaining({ name: '@deepseek-ai/dsh-example' }),
      destination, { cwd: root, env: environment },
    )
    expect(readdirSync(destination)).toEqual([])
  })
})
