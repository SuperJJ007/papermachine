/**
 * The custom package set's declaration: token validation borrowed from the
 * shipped parser, a revision that tracks the set's content, and the
 * round-trip that keeps a custom install resolvable on the next launch.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CUSTOM_ENVIRONMENT_ID, buildCustomDeclaration, readCustomDeclaration, writeCustomDeclaration,
} from '../src/custom-environment.ts'

const roots: string[] = []

async function root(): Promise<string> {
  const created = await mkdtemp(join(tmpdir(), 'dsh-custom-env-'))
  roots.push(created)
  return created
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async path => rm(path, { recursive: true, force: true })))
})

describe('buildCustomDeclaration', () => {
  it('publishes the set under the custom id with the requested packages', () => {
    const declaration = buildCustomDeclaration(['python=3.13', 'scipy'], ['darwin-arm64'], ['conda-forge'])

    expect(declaration.id).toBe(CUSTOM_ENVIRONMENT_ID)
    expect(declaration.packages).toEqual(['python=3.13', 'scipy'])
    expect(declaration.healthChecks.map(check => check.language)).toEqual(['python', 'r'])
  })

  it('gives the same package set the same revision regardless of the order it was listed in', () => {
    const one = buildCustomDeclaration(['scipy', 'python=3.13'], ['darwin-arm64'], ['conda-forge'])
    const other = buildCustomDeclaration(['python=3.13', 'scipy'], ['darwin-arm64'], ['conda-forge'])

    expect(one.revision).toBe(other.revision)
  })

  it('gives a changed package set a different revision, so it provisions into its own prefix', () => {
    const before = buildCustomDeclaration(['python=3.13'], ['darwin-arm64'], ['conda-forge'])
    const after = buildCustomDeclaration(['python=3.13', 'scipy'], ['darwin-arm64'], ['conda-forge'])

    expect(before.revision).not.toBe(after.revision)
  })

  it('rejects a token that would reach the solver argv as something other than a package spec', () => {
    expect(() => buildCustomDeclaration(['--prefix /tmp/evil'], ['darwin-arm64'], ['conda-forge']))
      .toThrow(/invalid channel or package token/)
    expect(() => buildCustomDeclaration(['scipy; rm -rf /'], ['darwin-arm64'], ['conda-forge']))
      .toThrow(/invalid channel or package token/)
  })

  it('rejects an empty package set', () => {
    expect(() => buildCustomDeclaration([], ['darwin-arm64'], ['conda-forge']))
      .toThrow(/packages must be a non-empty string array/)
  })
})

describe('custom declaration persistence', () => {
  it('round-trips the declaration the next launch resolves the applied environment against', async () => {
    const directory = await root()
    const declaration = buildCustomDeclaration(['python=3.13', 'r-base=4.5'], ['darwin-arm64'], ['conda-forge'])

    await writeCustomDeclaration(directory, declaration)

    expect(await readCustomDeclaration(directory)).toEqual(declaration)
  })

  it('reports no custom environment before the user has authored one', async () => {
    expect(await readCustomDeclaration(await root())).toBeUndefined()
  })

  it('fails loudly on a corrupt file rather than silently dropping a working environment', async () => {
    const directory = await root()
    const declaration = buildCustomDeclaration(['python=3.13'], ['darwin-arm64'], ['conda-forge'])
    await writeCustomDeclaration(directory, declaration)
    const path = join(directory, 'custom.json')
    const damaged = (await readFile(path, 'utf8')).replace('"packages"', '"pkgs"')
    await writeCustomDeclaration(directory, JSON.parse(damaged) as never)

    await expect(readCustomDeclaration(directory)).rejects.toThrow(/unknown field pkgs/)
  })
})
