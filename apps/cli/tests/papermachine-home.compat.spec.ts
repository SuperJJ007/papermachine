/** Source-entry checks for independently installed PaperMachine and official DSH data. */
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const tsxLoader = import.meta.resolve('tsx/esm')
const sourceEntry = join(repoRoot, 'apps/cli/src/bin.ts')

describe('PaperMachine source profile isolation', () => {
  it('composes Science without reading official user patches or an executable from PATH', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pm-source-home-'))
    try {
      const official = join(root, '.dsh')
      const product = join(root, 'PaperMachine 测试')
      await mkdir(official)
      const poison = 'this is not a patch list\n'
      await writeFile(join(official, 'cordis.patch.yml'), poison)
      const result = await execa(process.execPath, [
        '--import', tsxLoader, sourceEntry, '--profile', 'science', '--dump-config',
      ], {
        cwd: repoRoot,
        env: { HOME: root, USERPROFILE: root, DSH_HOME: official, PAPERMACHINE_HOME: product, PATH: '' },
        input: '', timeout: 30_000, reject: false,
      })
      expect(result.timedOut).toBe(false)
      expect(result.signal).toBeUndefined()
      expect(result.exitCode, result.stderr).toBe(0)
      expect(result.stdout).toContain('ui-science')
      expect(result.stdout).toContain('science-runtime')
      expect(await readdir(official)).toEqual(['cordis.patch.yml'])
      expect(await readFile(join(official, 'cordis.patch.yml'), 'utf8')).toBe(poison)
      const manifest: unknown = JSON.parse(await readFile(join(product, 'profiles/science/package.json'), 'utf8'))
      expect(manifest).toHaveProperty('dsh.profile.bundles', [
        '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-science-app',
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 40_000)

  it('rejects an explicit product home inside official data before initialization', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pm-source-refusal-'))
    try {
      const official = join(root, '.dsh')
      await mkdir(official)
      const result = await execa(process.execPath, [
        '--import', tsxLoader, sourceEntry, '--profile', 'science-headless', '--dump-config',
      ], {
        cwd: repoRoot,
        env: { HOME: root, USERPROFILE: root, DSH_HOME: official, PAPERMACHINE_HOME: join(official, 'nested') },
        input: '', timeout: 30_000, reject: false,
      })
      expect(result.timedOut).toBe(false)
      expect(result.signal).toBeUndefined()
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('must not overlap')
      expect(await readdir(official)).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 40_000)
})
