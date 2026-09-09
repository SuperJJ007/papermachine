import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Keyless built-artifact smoke: plain Node imports `@deepseek-ai/dsh-tool-fs`
 * and `@deepseek-ai/dsh-tool-fs/read-only` by name through their exports map
 * subpaths, over `lib/`. Proves shared `Config` object identity survives the
 * built layout, the read-only roster excludes `write`/`edit`, and the shared
 * read-cap validation rejects an invalid config at the read-only entry too.
 * Unit tests use `src/`; this pins the downstream `lib/` path. Skips when
 * `lib/` is absent; CI runs it after the build.
 */

const pkgDir = fileURLToPath(new URL('..', import.meta.url))
const built = existsSync(join(pkgDir, 'lib/index.js')) && existsSync(join(pkgDir, 'lib/read-only.js'))

let cwd: string

beforeAll(async () => {
  cwd = await realpath(await mkdtemp(join(tmpdir(), 'dsh-tool-fs-built-')))
  await mkdir(cwd, { recursive: true })
  await writeFile(join(cwd, 'a.txt'), 'built read-only smoke\n')
})

afterAll(async () => {
  if (cwd) await rm(cwd, { recursive: true, force: true })
})

describe.skipIf(!built)('built lib real load path (plain node)', () => {
  it('shares Config identity, exposes only the read-only roster, and reads a real file', async () => {
    const script = `
      const root = await import('@deepseek-ai/dsh-tool-fs')
      const readOnly = await import('@deepseek-ai/dsh-tool-fs/read-only')
      const { Context } = await import('@deepseek-ai/cordis')
      const { default: SystemPrompt } = await import('@deepseek-ai/dsh-system-prompt')
      const { default: ToolRuntime } = await import('@deepseek-ai/dsh-tools')
      const { default: LocalFileSystem } = await import('@deepseek-ai/dsh-fs-local')
      const { CallId } = await import('@deepseek-ai/dsh-llm')

      const identity = root.Config === readOnly.Config

      const ctx = new Context()
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(LocalFileSystem, { cwd: ${JSON.stringify(cwd)} })
      await ctx.plugin(readOnly)
      const names = ctx.tools.schemas().map(s => s.name)

      const result = await ctx.tools.execute({
        signal: new AbortController().signal,
        callId: CallId('built-read'),
        name: 'read',
        arguments: { file_path: 'a.txt' },
      })
      const text = result.content.filter(b => b.type === 'text').map(b => b.text).join('')
      await ctx.fiber.dispose()

      let invalidRejected = false
      try {
        const invalidCtx = new Context()
        await invalidCtx.plugin(SystemPrompt)
        await invalidCtx.plugin(ToolRuntime)
        await invalidCtx.plugin(LocalFileSystem, { cwd: ${JSON.stringify(cwd)} })
        await invalidCtx.plugin(readOnly, { readLimit: 0 })
      } catch {
        invalidRejected = true
      }

      console.log(JSON.stringify({ identity, names, text, invalidRejected }))
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
    const result = JSON.parse(lastLine) as { identity: boolean; names: string[]; text: string; invalidRejected: boolean }
    expect(result.identity).toBe(true)
    expect(result.names).toContain('read')
    expect(result.names).not.toContain('write')
    expect(result.names).not.toContain('edit')
    expect(result.text).toContain('built read-only smoke')
    expect(result.invalidRejected).toBe(true)
  }, 35_000)
})
