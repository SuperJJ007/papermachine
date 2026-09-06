import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { interpreterLayout, type InterpreterLanguage } from '../src/interpreter-presence.ts'

describe('interpreterLayout', () => {
  it('returns the POSIX path segments for a non-Windows prefix', () => {
    expect(interpreterLayout(false)).toEqual({ python: ['bin', 'python'], r: ['bin', 'Rscript'] })
  })

  it('returns the Windows path segments for a Windows prefix', () => {
    expect(interpreterLayout(true)).toEqual({ python: ['python.exe'], r: ['Scripts', 'Rscript.exe'] })
  })
})

/**
 * `interpreterLayout`'s two tables are a hand-copy of science-runtime's
 * `environment.ts` `POSIX_LAYOUT`/`WINDOWS_LAYOUT` — this application
 * cannot import that package (the Host that owns it runs as a separate
 * process staged into the package) — and this module's own JSDoc says so:
 * "a prefix this application accepts fails to bind in the Host" if the two
 * tables ever disagree. This reads science-runtime's source text directly
 * (no cross-package import) and compares the literal path segments against
 * `interpreterLayout`'s actual return values, so a hand-edit to either
 * table that drifts from the other fails here instead of only on a real
 * conda prefix.
 */
describe('interpreterLayout matches science-runtime EXECUTABLE_LAYOUTS source text', () => {
  const environmentSourcePath = fileURLToPath(
    new URL('../../../packages/science/science-runtime/src/environment.ts', import.meta.url),
  )
  const environmentSource = readFileSync(environmentSourcePath, 'utf8')

  function extractLayoutLiteral(constantName: string): Record<InterpreterLanguage, readonly string[]> {
    const declaration = environmentSource.match(new RegExp(`const ${constantName} = (\\{[^}]*\\}) as const`))
    const literal = declaration?.[1]
    if (literal === undefined) {
      throw new Error(`interpreter-presence.spec: could not find "${constantName}" in ${environmentSourcePath}`)
    }
    const extractSegments = (language: InterpreterLanguage): readonly string[] => {
      const field = literal.match(new RegExp(`${language}:\\s*\\[([^\\]]*)\\]`))
      const segments = field?.[1]
      if (segments === undefined) {
        throw new Error(`interpreter-presence.spec: could not find "${language}" inside ${constantName}: ${literal}`)
      }
      return segments
        .split(',')
        .map(segment => segment.trim().replace(/^['"]|['"]$/g, ''))
        .filter(segment => segment.length > 0)
    }
    return { python: extractSegments('python'), r: extractSegments('r') }
  }

  it('the POSIX table names the same path segments as science-runtime\'s POSIX_LAYOUT', () => {
    expect(interpreterLayout(false)).toEqual(extractLayoutLiteral('POSIX_LAYOUT'))
  })

  it('the Windows table names the same path segments as science-runtime\'s WINDOWS_LAYOUT', () => {
    expect(interpreterLayout(true)).toEqual(extractLayoutLiteral('WINDOWS_LAYOUT'))
  })
})
