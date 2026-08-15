/**
 * `@deepseek-ai/dsh-tool-fs/read-only`: independent plugin identity, shared
 * `Config` schema/read-cap validation, the read-only tool roster, and
 * disposal.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import * as FsPolicy from '@deepseek-ai/dsh-fs-observation-policy'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import * as ToolFsReadOnly from '@deepseek-ai/dsh-tool-fs/read-only'

let dir: string
let home: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-tool-fs-read-only-'))
  home = await mkdtemp(join(tmpdir(), 'dsh-tool-fs-read-only-home-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
  await rm(home, { recursive: true, force: true })
})

interface SetupOptions {
  attachments?: boolean
}

async function setup(options: SetupOptions = {}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalFileSystem, { cwd: dir })
  await ctx.plugin(FsPolicy)
  if (options.attachments !== false) {
    await ctx.plugin(LocalAttachmentStore, { dshHome: home })
  }
  return ctx
}

const testToolSignal = new AbortController().signal
let callCounter = 0
function call(ctx: Context, name: string, args: unknown) {
  return ctx.tools.execute({ signal: testToolSignal, callId: CallId(`call-${++callCounter}`), name, arguments: args })
}

describe('shared Config identity', () => {
  it('re-exports the exact root Config schema value, not a copy', () => {
    expect(ToolFsReadOnly.Config).toBe(ToolFs.Config)
  })
})

describe('read-only tool roster', () => {
  it('registers read and read_image but never write or edit', async () => {
    const ctx = await setup()
    const fiber = await ctx.plugin(ToolFsReadOnly)
    const names = ctx.tools.schemas().map(schema => schema.name)
    expect(names).toContain('read')
    expect(names).toContain('read_image')
    expect(names).not.toContain('write')
    expect(names).not.toContain('edit')
    await fiber.dispose()
  })

  it('registers only read when no attachment service is mounted', async () => {
    const ctx = await setup({ attachments: false })
    await ctx.plugin(ToolFsReadOnly)
    const names = ctx.tools.schemas().map(schema => schema.name)
    expect(names).toContain('read')
    expect(names).not.toContain('read_image')
    expect(names).not.toContain('write')
    expect(names).not.toContain('edit')
  })

  it('reads a real file through the local provider', async () => {
    await writeFile(join(dir, 'a.txt'), 'hello read-only\n')
    const ctx = await setup()
    await ctx.plugin(ToolFsReadOnly)
    const result = await call(ctx, 'read', { file_path: 'a.txt' })
    expect(result.isError).toBe(false)
    expect(result.content.some(block => block.type === 'text' && block.text.includes('hello read-only'))).toBe(true)
  })

  it('HMR-safety: disposing the plugin fiber removes every registration', async () => {
    const ctx = await setup()
    const fiber = await ctx.plugin(ToolFsReadOnly)
    expect(ctx.tools.schemas().map(schema => schema.name)).toContain('read')
    await fiber.dispose()
    expect(ctx.tools.schemas().map(schema => schema.name)).not.toContain('read')
    expect(ctx.tools.schemas().map(schema => schema.name)).not.toContain('read_image')
  })
})

describe('shared read-cap validation', () => {
  it('rejects a non-positive readLimit identically to the root entry', async () => {
    const ctx = await setup()
    await expect(ctx.plugin(ToolFsReadOnly, { readLimit: 0 })).rejects.toThrow('readLimit must be a positive integer')
  })
})
