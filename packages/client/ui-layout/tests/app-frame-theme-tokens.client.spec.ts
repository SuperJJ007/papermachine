/**
 * Coverage contract for the Science light-workbench override: every
 * `--dsw-*` token whose value differs between design-platform.css's light
 * `body` alias block and its `body[data-ds-dark-theme]` block must be reset
 * to its light value in AppFrame.module.css's `.frame[data-science-session]`
 * rule, or a session running the dark application theme leaks a dark token
 * into the white workbench. The expected token set is scanned out of
 * design-platform.css, so a new differing token added there moves this
 * assertion with it instead of leaving the override to fall silently behind.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** One flattened CSS rule: its comma-separated selector parts and its declarations in source order. */
interface CssRule {
  selectors: string[]
  declarations: [property: string, value: string][]
}

const platformCss = readFileSync(
  fileURLToPath(new URL('../../ui-theme/src/styles/design-platform.css', import.meta.url)),
  'utf8',
)
const frameCss = readFileSync(fileURLToPath(new URL('../src/client/AppFrame.module.css', import.meta.url)), 'utf8')

/** Body attribute selecting the dark palette; ui-layout's ThemePresenter sets it. */
const DARK_ATTRIBUTE = '[data-ds-dark-theme]'
/**
 * Alias/specific tokens under test — the indirection layer the rest of the
 * application reads. The underlying `--dsw-static-*` scale is out of scope:
 * a couple of its raw values differ by a few RGB units between palettes
 * (e.g. `--dsw-static-neutral-bluish-60`), but every alias that reads one
 * declares the identical `var(...)` reference in both blocks, and re-pointing
 * that reference to a fixed static value is a bigger behavior change than
 * this override exists to make.
 */
const TOKEN_PATTERN = /^--dsw-(?:alias|specific)-/

/**
 * Flatten a stylesheet into rules. Whitespace, declaration order, and trailing
 * semicolons are normalized away; nesting and at-rules are not handled, which
 * neither sheet under test uses.
 * @param css - stylesheet text.
 * @returns one entry per rule, in source order.
 */
function parseRules(css: string): CssRule[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const rules: CssRule[] = []
  for (const [, selector = '', body = ''] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations = body
      .split(';')
      .map(part => part.trim())
      .filter(part => part.includes(':'))
      .map((part): [string, string] => {
        const colon = part.indexOf(':')
        return [part.slice(0, colon).trim(), part.slice(colon + 1).trim().replace(/\s+/g, ' ')]
      })
    rules.push({ selectors: selector.split(',').map(part => part.trim()), declarations })
  }
  return rules
}

const platformRules = parseRules(platformCss)
const frameRules = parseRules(frameCss)

/**
 * Every `--dsw-*` token's declared value, from the rules whose selectors carry
 * (or do not carry) the dark palette attribute. Later rules win, matching how
 * design-platform.css layers its static-scale block below the alias block —
 * both declare on plain `body`, so only source order distinguishes them.
 * @param dark - true to scan the dark-attributed blocks, false to scan the plain `body` blocks.
 * @returns declared value per token name.
 */
function declaredTokens(dark: boolean): Map<string, string> {
  const values = new Map<string, string>()
  for (const rule of platformRules) {
    if (rule.selectors.every(selector => selector.includes(DARK_ATTRIBUTE)) !== dark) continue
    for (const [property, value] of rule.declarations) {
      if (TOKEN_PATTERN.test(property)) values.set(property, value)
    }
  }
  return values
}

const light = declaredTokens(false)
const dark = declaredTokens(true)
const allNames = new Set([...light.keys(), ...dark.keys()])

/** Every token whose declared value differs between the light and dark blocks, mapped to its light value. */
const differing = new Map(
  [...allNames]
    .filter(name => light.get(name) !== dark.get(name))
    .map(name => [name, light.get(name)] as const),
)

/** The `.frame[data-science-session]` rule's own custom-property declarations, keyed by token name. */
const scienceOverride = new Map(
  frameRules
    .find(rule => rule.selectors.includes('.frame[data-science-session]'))!
    .declarations.filter(([property]) => TOKEN_PATTERN.test(property)),
)

describe('AppFrame.module.css science override', () => {
  it('finds a non-trivial set of tokens differing between the light and dark palette', () => {
    // Guards the scan itself: a selector-text change in design-platform.css
    // that silently returns zero rows must not make every assertion below
    // vacuously pass.
    expect(differing.size).toBeGreaterThan(50)
  })

  it('resets every differing token to its light value', () => {
    const missing: string[] = []
    const wrong: string[] = []
    for (const [name, lightValue] of differing) {
      const overridden = scienceOverride.get(name)
      if (overridden === undefined) missing.push(name)
      else if (overridden !== lightValue) wrong.push(`${name}: expected ${lightValue}, got ${overridden}`)
    }
    expect(missing, 'tokens missing from .frame[data-science-session]').toEqual([])
    expect(wrong, 'tokens set to a non-light value').toEqual([])
  })
})
