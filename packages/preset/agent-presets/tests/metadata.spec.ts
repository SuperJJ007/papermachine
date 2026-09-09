/**
 * Display fields remain permissive, but `copyable` is behavioral policy:
 * present metadata must be readable YAML containing a map, and a declared
 * copy value must be boolean. Identity still comes only from the directory
 * and root.
 */

import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  METADATA_FILE, PresetMetadataError, readPresetMetadata, renderPresetMetadata,
} from '../src/metadata.ts'

/** A preset directory holding exactly the given metadata text. */
async function presetDir(content?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-preset-meta-'))
  await mkdir(dir, { recursive: true })
  if (content !== undefined) await writeFile(join(dir, METADATA_FILE), content)
  return dir
}

describe('reading display metadata', () => {
  it('reads a name and a description', async () => {
    const dir = await presetDir('name: 标准模式\ndescription: 完整的编码 agent。\n')

    expect(await readPresetMetadata(dir)).toEqual({ name: '标准模式', description: '完整的编码 agent。' })
  })

  it('treats an absent file as no metadata', async () => {
    // The common case: every preset authored by duplicating another starts
    // without one, and a picker simply falls back to the id.
    expect(await readPresetMetadata(await presetDir())).toEqual({})
  })

  it('requires metadata for a shipped preset', async () => {
    await expect(readPresetMetadata(await presetDir(), { required: true }))
      .rejects.toThrow(/preset\.yml is required for shipped presets/)
  })

  it('rejects malformed YAML', async () => {
    const dir = await presetDir('name: [unclosed\n')

    await expect(readPresetMetadata(dir)).rejects.toThrow(PresetMetadataError)
    await expect(readPresetMetadata(dir)).rejects.toThrow(/preset\.yml is not valid YAML/)
  })

  it.each([
    ['a list', '- name: x\n'],
    ['a scalar', 'just a string\n'],
    ['an empty document', ''],
  ])('rejects %s because metadata must be a map', async (_label, content) => {
    await expect(readPresetMetadata(await presetDir(content))).rejects.toThrow(/must be a map/)
  })

  it('ignores fields that are not text', async () => {
    const dir = await presetDir('name: 42\ndescription:\n  nested: true\n')

    expect(await readPresetMetadata(dir)).toEqual({})
  })

  it('ignores blank text rather than showing an empty name', async () => {
    const dir = await presetDir('name: "   "\ndescription: ""\n')

    expect(await readPresetMetadata(dir)).toEqual({})
  })

  it('trims surrounding whitespace', async () => {
    const dir = await presetDir('name: "  极简模式  "\n')

    expect(await readPresetMetadata(dir)).toEqual({ name: '极简模式' })
  })

  it('reads a declared order', async () => {
    const dir = await presetDir('name: 标准模式\norder: 1\n')

    expect(await readPresetMetadata(dir)).toEqual({ name: '标准模式', order: 1 })
  })

  it('ignores an order that is not a finite number', async () => {
    expect(await readPresetMetadata(await presetDir('order: first\n'))).toEqual({})
    expect(await readPresetMetadata(await presetDir('order: .inf\n'))).toEqual({})
  })

  it('reads a declared copyable: false', async () => {
    const dir = await presetDir('name: Science 模式\ncopyable: false\n')

    expect(await readPresetMetadata(dir)).toEqual({ name: 'Science 模式', copyable: false })
  })

  it('reads a declared copyable: true explicitly, same as absent', async () => {
    expect(await readPresetMetadata(await presetDir('copyable: true\n'))).toEqual({ copyable: true })
  })

  it('rejects a copyable value that is not a boolean', async () => {
    await expect(readPresetMetadata(await presetDir('copyable: "no"\n')))
      .rejects.toThrow(/copyable.*must be a boolean/)
    await expect(readPresetMetadata(await presetDir('copyable: 0\n')))
      .rejects.toThrow(/copyable.*must be a boolean/)
  })

  it('cannot carry identity or trust', async () => {
    const dir = await presetDir('name: mine\nid: standard\ntrust: system\n')

    // A locally authored preset writing `trust: system` must not become a
    // shipped one; identity comes from the directory and the root it sits in.
    expect(await readPresetMetadata(dir)).toEqual({ name: 'mine' })
  })
})

describe('rendering display metadata', () => {
  it('round-trips through a read', async () => {
    const rendered = renderPresetMetadata({ name: '创造模式', description: '可以改自己的组装。' })
    const dir = await presetDir(rendered)

    expect(await readPresetMetadata(dir)).toEqual({ name: '创造模式', description: '可以改自己的组装。' })
  })

  it('stores a declared order', () => {
    expect(renderPresetMetadata({ name: '标准模式', order: 1 })).toBe('name: 标准模式\norder: 1\n')
  })

  it('stores a declared copyable: false', () => {
    expect(renderPresetMetadata({ name: 'Science 模式', copyable: false }))
      .toBe('name: Science 模式\ncopyable: false\n')
  })

  it('treats copyable: false alone as something to store, not nothing', () => {
    // false is a meaningful, falsy value — the emptiness check must not
    // mistake it for an absent field the way it would treat "".
    expect(renderPresetMetadata({ copyable: false })).toBe('copyable: false\n')
  })

  it('omits an absent field rather than writing it blank', () => {
    expect(renderPresetMetadata({ name: '极简模式' })).toBe('name: 极简模式\n')
    // Description without a name is legal too: the picker falls back to the id.
    expect(renderPresetMetadata({ description: '只做检索。' })).toBe('description: 只做检索。\n')
  })

  it('renders nothing when there is nothing to store', () => {
    // Clearing both fields removes the file; an empty document would read as
    // an intentional blank name.
    expect(renderPresetMetadata({})).toBeUndefined()
    expect(renderPresetMetadata({ name: '  ', description: '' })).toBeUndefined()
  })
})
