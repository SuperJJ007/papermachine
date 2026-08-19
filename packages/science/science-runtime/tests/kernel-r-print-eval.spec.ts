/**
 * A1 finding 3 regression coverage: `source()`'s default `print.eval`
 * tracks `echo`, so `echo = FALSE` alone drops the top-level auto-printing
 * `Rscript` and Claude Science both produce for a bare value (`x` prints
 * `[1] 42`, a one-shot process prints nothing). The always-on assertion
 * below reads the shipped driver's own source text, so it fails if the fix
 * ever regresses without needing an R toolchain. The second, opt-in suite
 * exercises the exact `source()` call `kernel_r.R`'s `execute_run` makes
 * against a real R interpreter, self-skipping without one configured — the
 * full kernel driver/FIFO protocol path is K3.3's real-acceptance job, not
 * this unit-level one.
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { KERNEL_ASSETS_ROOT, resolveKernelDriverPath } from '../src/kernel-assets.ts'

const R_PREFIX_ENV = 'DSH_SCIENCE_RUNTIME_R_PREFIX'

/** Resolve a real `Rscript` from the same opt-in env var `real-acceptance.ts` uses; `undefined` skips the behavioral suite below. */
function resolveRscript(): string | undefined {
  const prefix = process.env[R_PREFIX_ENV]
  if (prefix === undefined || prefix.length === 0) return undefined
  const candidate = join(prefix, 'bin', 'Rscript')
  try {
    execFileSync(candidate, ['--version'], { stdio: 'ignore' })
    return candidate
  } catch {
    return undefined
  }
}

describe('kernel_r.R print.eval (A1 finding 3)', () => {
  it('calls source() with print.eval = TRUE, matching Rscript and Claude Science auto-printing', () => {
    const path = resolveKernelDriverPath(KERNEL_ASSETS_ROOT, 'r')
    const content = readFileSync(path, 'utf8')
    expect(content).toMatch(/source\(source_path,\s*local\s*=\s*\.GlobalEnv,\s*echo\s*=\s*FALSE,\s*print\.eval\s*=\s*TRUE\)/)
  })
})

const rscript = resolveRscript()
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Run the exact `source()` call `execute_run` makes over a bare-value file and return captured stdout. */
function runBareValueSource(rscriptPath: string, printEval: boolean): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-science-runtime-r-print-eval-'))
  roots.push(root)
  const sourcePath = join(root, 'bare-value.R')
  writeFileSync(sourcePath, '41 + 1\n')
  const expr = `source(${JSON.stringify(sourcePath)}, local = new.env(), echo = FALSE, print.eval = ${printEval ? 'TRUE' : 'FALSE'})`
  return execFileSync(rscriptPath, ['--vanilla', '--encoding=UTF-8', '-e', expr], { encoding: 'utf8' })
}

describe.skipIf(rscript === undefined)(`kernel_r.R print.eval real-R behavior (opt-in via ${R_PREFIX_ENV})`, () => {
  it('auto-prints a bare top-level value with print.eval = TRUE, matching the fixed driver', () => {
    const stdout = runBareValueSource(rscript as string, true)
    expect(stdout).toContain('[1] 42')
  })

  it('does not auto-print with echo = FALSE alone (print.eval defaults FALSE) — the regression this fix closes', () => {
    const stdout = runBareValueSource(rscript as string, false)
    expect(stdout).not.toContain('[1] 42')
  })
})
