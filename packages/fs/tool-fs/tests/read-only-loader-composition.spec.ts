/**
 * Proves `@deepseek-ai/dsh-tool-fs/read-only` is an independently loadable
 * Cordis plugin identity from source: a real `cordis.yml` booted through the
 * Loader resolves the bare subpath specifier, registers only the read-only
 * roster, and an unrelated/misspelled subpath fails to resolve rather than
 * silently falling back to the root or another entry.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import * as ToolFsReadOnly from '@deepseek-ai/dsh-tool-fs/read-only'

let root: string | undefined
let context: Context | undefined
let cwd: string | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  if (cwd !== undefined) await rm(cwd, { recursive: true, force: true })
  cwd = undefined
})

/**
 * Boot a `cordis.yml` naming `pluginName` as the tool-fs entry under test.
 * @param pluginName - the bare Loader specifier under test.
 * @param modules - specifier -> module map the fake Loader internal serves.
 * @returns the booted context.
 */
async function boot(pluginName: string, modules: ReadonlyMap<string, unknown>): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-tool-fs-read-only-loader-'))
  cwd = await mkdtemp(join(tmpdir(), 'dsh-tool-fs-read-only-loader-cwd-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-fs-local'",
    `  config:\n    cwd: ${JSON.stringify(cwd)}`,
    `- name: '${pluginName}'`,
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return ctx
}

const READ_ONLY_MODULES = new Map<string, unknown>([
  ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
  ['@deepseek-ai/dsh-tools', ToolRuntime],
  ['@deepseek-ai/dsh-fs-local', LocalFileSystem],
  ['@deepseek-ai/dsh-tool-fs/read-only', ToolFsReadOnly],
])

const ROOT_MODULES = new Map<string, unknown>([
  ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
  ['@deepseek-ai/dsh-tools', ToolRuntime],
  ['@deepseek-ai/dsh-fs-local', LocalFileSystem],
  ['@deepseek-ai/dsh-tool-fs', ToolFs],
])

describe('tool-fs read-only real Loader composition through cordis.yml', () => {
  it('resolves the bare subpath specifier and registers only the read-only roster', async () => {
    const ctx = await boot('@deepseek-ai/dsh-tool-fs/read-only', READ_ONLY_MODULES)
    const names = ctx.tools.schemas().map(schema => schema.name)
    expect(names).toContain('read')
    expect(names).not.toContain('write')
    expect(names).not.toContain('edit')
  })

  it('the root specifier independently resolves the full roster in a separate composition', async () => {
    const ctx = await boot('@deepseek-ai/dsh-tool-fs', ROOT_MODULES)
    const names = ctx.tools.schemas().map(schema => schema.name)
    expect(names).toContain('read')
    expect(names).toContain('write')
    expect(names).toContain('edit')
  })

  it('rejects an unrelated subpath instead of silently resolving another entry', async () => {
    await expect(boot('@deepseek-ai/dsh-tool-fs/does-not-exist', READ_ONLY_MODULES))
      .rejects.toThrow(/unexpected Loader import: @deepseek-ai\/dsh-tool-fs\/does-not-exist/)
  })
})
