/** Config catalog coverage for imported schemas and global collection types. */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectConfigCatalog } from './gen-config-catalog.ts'

const roots: string[] = []

function fixture(schema: string, type = 'ReadonlyMap<string, string>'): string {
  const root = mkdtempSync(join(tmpdir(), 'config-catalog-'))
  roots.push(root)
  const pkg = join(root, 'packages/probe/probe')
  mkdirSync(join(pkg, 'src'), { recursive: true })
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-probe' }))
  writeFileSync(join(pkg, 'src/config.ts'), `
import z from '@deepseek-ai/schemastery'
export interface Config {
  /** Values supplied by the caller. */
  values: ${type}
}
export const configSchema = ${schema}
`)
  writeFileSync(join(pkg, 'src/index.ts'), `
import { configSchema as schema } from './config.ts'
import type { Config } from './config.ts'
export default class Probe {
  static Config = schema
  constructor(ctx: unknown, config: Config) {}
}
`)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('config catalog imported schemas', () => {
  it('catalogues aliased schema constants and global readonly maps', () => {
    expect(collectConfigCatalog(fixture('z.object({ values: z.any() })'))[0]?.schemaKeys).toEqual(['values'])
  })

  it('rejects an imported schema key absent from the declared config', () => {
    expect(() => collectConfigCatalog(fixture('z.object({ missing: z.string() })'))).toThrow(/missing/)
  })

  it('rejects unresolved collection types', () => {
    expect(() => collectConfigCatalog(fixture('z.object({ values: z.any() })', 'MissingMap<string, string>'))).toThrow(/MissingMap/)
  })

  it('rejects computed and cyclic schema declarations', () => {
    expect(() => collectConfigCatalog(fixture('makeSchema()'))).toThrow(/statically walkable/)
    expect(() => collectConfigCatalog(fixture('configSchema'))).toThrow(/statically walkable/)
  })
})
