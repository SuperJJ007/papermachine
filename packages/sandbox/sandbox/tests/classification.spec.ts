/**
 * Shared runner-spawn, runner-fatal, and denial classification. Bash, Pwsh,
 * and Science consume this one implementation.
 */

import { writeFileSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  classifyDenial,
  classifyRunnerFailure,
  isRunnerSpawnFailure,
  matchesSignature,
} from '@deepseek-ai/dsh-sandbox'
import type { RunnerFailureRule } from '@deepseek-ai/dsh-sandbox'

const workdir = mkdtempSync(join(tmpdir(), 'dsh-sandbox-classification-'))

afterAll(() => {
  rmSync(workdir, { recursive: true, force: true })
})

describe('isRunnerSpawnFailure', () => {
  it.each(['EACCES', 'ENOENT'])(
    'attributes executable-class spawn code %s to argv[0] once cwd ambiguity is eliminated',
    (code) => {
      const runner = join(workdir, 'runner')
      const error = Object.assign(new Error('spawn failed'), { code, syscall: `spawn ${runner}`, path: runner })
      expect(isRunnerSpawnFailure(error, runner, process.cwd())).toBe(true)
    },
  )

  it('rejects unproven codes, missing syscall, unusable cwd, and non-object errors', () => {
    expect(isRunnerSpawnFailure({ code: 'EMFILE', syscall: 'spawn', path: 'node' }, 'node', workdir)).toBe(false)
    expect(isRunnerSpawnFailure({ code: 'ENOENT', path: 'node' }, 'node', workdir)).toBe(false)
    expect(isRunnerSpawnFailure({ code: 'ENOENT', syscall: 'spawn' }, 'node', join(workdir, 'missing'))).toBe(false)
    expect(isRunnerSpawnFailure({ code: 'ENOENT', syscall: 'spawn' }, undefined, workdir)).toBe(false)
    expect(isRunnerSpawnFailure('boom', 'node', workdir)).toBe(false)
    expect(isRunnerSpawnFailure(null, 'node', workdir)).toBe(false)
    const fileWorkdir = join(workdir, 'a-file')
    writeFileSync(fileWorkdir, 'x')
    expect(isRunnerSpawnFailure({ code: 'ENOENT', syscall: 'spawn', path: 'node' }, 'node', fileWorkdir)).toBe(false)
  })

  it('requires an exact spawn syscall when the error omits or mismatches its path', () => {
    const runner = join(workdir, 'runner')
    expect(isRunnerSpawnFailure({ code: 'ENOENT', syscall: `spawn ${runner}` }, runner, workdir)).toBe(true)
    expect(isRunnerSpawnFailure({ code: 'ENOENT', syscall: 'spawn' }, runner, workdir)).toBe(false)
    expect(isRunnerSpawnFailure({ code: 'ENOENT', syscall: 'spawn', path: '' }, runner, workdir)).toBe(false)
    expect(isRunnerSpawnFailure({ code: 'ENOENT', syscall: 'spawn', path: 1 }, runner, workdir)).toBe(false)
    expect(isRunnerSpawnFailure({ code: 'ENOENT', syscall: 'spawn', path: `${runner}-other` }, runner, workdir)).toBe(false)
  })
})

describe('classifyRunnerFailure', () => {
  const rules: readonly RunnerFailureRule[] = [{
    allowedExitCodes: [127],
    fatalSignatures: ['fake-runner: '],
    informationalLines: ['fake-runner: partial enforcement'],
  }]

  it('matches a fatal signature on a gated exit code, skipping informational lines', () => {
    expect(classifyRunnerFailure(127, 'fake-runner: partial enforcement\nfake-runner: profile refused\n', rules))
      .toEqual({ detail: 'fake-runner: profile refused' })
  })

  it('rejects zero/null exits, gate mismatches, and empty signatures', () => {
    expect(classifyRunnerFailure(0, 'fake-runner: x', rules)).toBeUndefined()
    expect(classifyRunnerFailure(null, 'fake-runner: x', rules)).toBeUndefined()
    expect(classifyRunnerFailure(1, 'fake-runner: x', rules)).toBeUndefined()
    expect(classifyRunnerFailure(127, 'clean output', rules)).toBeUndefined()
    expect(classifyRunnerFailure(127, 'fake-runner: x', [{ fatalSignatures: ['  '] }])).toBeUndefined()
  })
})

describe('classifyDenial and matchesSignature', () => {
  it('never classifies a clean exit or a signal death as a denial', () => {
    expect(classifyDenial(0, 'Permission denied', ['permission denied'])).toBe(false)
    expect(classifyDenial(null, 'Permission denied', ['permission denied'])).toBe(false)
    expect(matchesSignature(0, 'access is denied', ['access is denied'])).toBe(false)
    expect(matchesSignature(null, 'access is denied', ['access is denied'])).toBe(false)
  })

  it('matches nonzero exits case-insensitively against the active dialect', () => {
    expect(classifyDenial(1, 'touch: Read-only file system', ['read-only file system'])).toBe(true)
    expect(matchesSignature(1, 'ACCESS IS DENIED.', ['access is denied'])).toBe(true)
    expect(matchesSignature(1, 'clean', ['access is denied'])).toBe(false)
  })

  it('leaves denial matching to callers after a positive runner failure', () => {
    const stderr = 'landlock-run: exec failed: No such file or directory\nPermission denied'
    const runner = classifyRunnerFailure(127, stderr, [{
      allowedExitCodes: [127],
      fatalSignatures: ['landlock-run: exec failed'],
    }])
    expect(runner).toEqual({ detail: 'landlock-run: exec failed: No such file or directory' })
    expect(classifyDenial(127, stderr, ['permission denied'])).toBe(true)
  })
})
