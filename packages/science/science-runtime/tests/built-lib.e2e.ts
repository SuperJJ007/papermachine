import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'

/**
 * Keyless built-artifact smoke: plain Node imports
 * `@deepseek-ai/dsh-science-runtime` by name over `lib/`, proving
 * `resolveKernelDriverPath`'s `import.meta.url`-relative resolution finds
 * the real shipped driver assets from the tsdown-bundled entry, not only
 * from `src/` under vitest's tsconfig-paths override. Unit tests
 * (`kernel-assets.spec.ts`) cover `src/`; this pins the downstream `lib/`
 * path. Skips when `lib/` is absent; CI runs it after the build.
 */

const pkgDir = fileURLToPath(new URL('..', import.meta.url))
const built = existsSync(join(pkgDir, 'lib/index.js'))

describe.skipIf(!built)('built lib kernel driver asset resolution (plain node)', () => {
  it('resolves both kernel drivers to real on-disk files from the bundled entry', async () => {
    const script = `
      const root = await import('@deepseek-ai/dsh-science-runtime')
      const { readFileSync } = await import('node:fs')

      const pythonPath = root.resolveKernelDriverPath(root.KERNEL_ASSETS_ROOT, 'python')
      const rPath = root.resolveKernelDriverPath(root.KERNEL_ASSETS_ROOT, 'r')
      const pythonFirstLine = readFileSync(pythonPath, 'utf8').split('\\n')[0]
      const rFirstLine = readFileSync(rPath, 'utf8').split('\\n')[0]

      console.log(JSON.stringify({
        assetsRoot: root.KERNEL_ASSETS_ROOT,
        pythonPath,
        rPath,
        pythonFirstLine,
        rFirstLine,
      }))
    `
    const { exitCode, stdout, stderr } = await execa(process.execPath, ['--input-type=module', '-e', script], {
      cwd: pkgDir,
      stdin: 'ignore',
      timeout: 30_000,
      killSignal: 'SIGKILL',
      reject: false,
    })

    expect(exitCode, `stderr:\n${stderr}`).toBe(0)
    const lastLine = stdout.trim().split('\n').at(-1) ?? ''
    const result = JSON.parse(lastLine) as {
      assetsRoot: string
      pythonPath: string
      rPath: string
      pythonFirstLine: string
      rFirstLine: string
    }

    // Assets ship at the package root (a sibling of lib/), not nested
    // inside lib/ itself — proves the built entry escaped lib/ correctly
    // rather than resolving into a nonexistent lib/assets/.
    expect(result.assetsRoot).toBe(join(pkgDir, 'assets') + '/')
    expect(result.pythonPath).toBe(join(pkgDir, 'assets/kernel_python.py'))
    expect(result.rPath).toBe(join(pkgDir, 'assets/kernel_r.R'))
    expect(result.pythonFirstLine).toBe('#!/usr/bin/env python3')
    expect(result.rFirstLine).toBe('# Persistent Science kernel driver for run_r. Executes source in the global')
  }, 35_000)
})
