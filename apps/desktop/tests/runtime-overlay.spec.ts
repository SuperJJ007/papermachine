import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { renderDesktopRuntimeOverlay } from '../src/runtime-overlay.ts'

/** The base bundle's Loader entries the desktop overlay patches by id. */
const basePatchPath = join(import.meta.dirname, '../../../packages/bundle/web-app/cordis.patch.yml')

/**
 * A `!!js` Loader expression parses as opaque data: the overlay assertions
 * below only need entry ids, never the expression bodies.
 */
const jsExprType = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: data => typeof data === 'string',
  construct: (data: unknown) => {
    if (typeof data !== 'string') throw new Error('desktop runtime-overlay test: !!js tag expected a string scalar')
    return { __jsExpr: data }
  },
})
const cordisSchema = yaml.JSON_SCHEMA.extend(jsExprType)

interface CordisEntry {
  readonly id?: string
  readonly config?: Record<string, unknown>
  readonly disabled?: boolean
  readonly insert?: readonly CordisEntry[]
}

/** Collect every `id` a Loader config declares, including ids nested under `insert` groups. */
function collectIds(entries: readonly CordisEntry[]): Set<string> {
  const ids = new Set<string>()
  for (const entry of entries) {
    if (entry.id !== undefined) ids.add(entry.id)
    if (entry.insert !== undefined) for (const id of collectIds(entry.insert)) ids.add(id)
  }
  return ids
}

describe('desktop Runtime overlay', () => {
  it('binds both interpreters and removes product-mode selection', () => {
    const parsed = yaml.load(renderDesktopRuntimeOverlay({
      pythonPrefix: '/Applications Support/Science/env',
      rPrefix: '/Applications Support/Science/env',
    })) as CordisEntry[]
    const byId = new Map(parsed.map(entry => [entry.id, entry]))

    expect(byId.get('science-runtime')?.config).toMatchObject({
      profiles: {
        science: {
          pythonPrefix: '/Applications Support/Science/env',
          rPrefix: '/Applications Support/Science/env',
        },
      },
    })
    expect(byId.get('agent-presets')?.config).toEqual({ default: 'science' })
    expect(byId.get('ui-agent-preset')?.disabled).toBe(true)
    expect(byId.get('ui-science')?.config).toEqual({ toggleScope: 'global' })
    expect(byId.get('hmr')?.disabled).toBe(true)
  })

  it('renders only the fields present when the prefixes come from different environments', () => {
    const parsed = yaml.load(renderDesktopRuntimeOverlay({ pythonPrefix: '/py/prefix' })) as CordisEntry[]
    const byId = new Map(parsed.map(entry => [entry.id, entry]))

    expect(byId.get('science-runtime')?.config).toEqual({
      profiles: { science: { pythonPrefix: '/py/prefix' } },
    })
  })

  it('rejects a call with neither prefix', () => {
    expect(() => renderDesktopRuntimeOverlay({})).toThrow(/requires pythonPrefix or rPrefix/)
  })

  it('patches ids the base web-app bundle actually declares', async () => {
    const base = yaml.load(await readFile(basePatchPath, 'utf8'), { schema: cordisSchema }) as CordisEntry[]
    const baseIds = collectIds(base)
    const overlay = yaml.load(renderDesktopRuntimeOverlay({ pythonPrefix: '/prefix', rPrefix: '/prefix' })) as CordisEntry[]

    for (const entry of overlay) {
      expect(baseIds.has(entry.id ?? ''), `overlay entry ${JSON.stringify(entry.id)} has no matching base row`).toBe(true)
    }
  })
})
