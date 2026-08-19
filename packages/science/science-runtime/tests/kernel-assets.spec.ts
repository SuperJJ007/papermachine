/**
 * `resolveKernelDriverPath`: on-disk resolution of the shipped, zero-
 * dependency kernel driver scripts. Driver runtime behavior (spawning,
 * protocol handshake, RUN/DONE frames) is covered by later phase cards, not
 * here — this suite only proves the asset-resolution module itself.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { KERNEL_ASSETS_ROOT, resolveKernelDriverPath } from '../src/kernel-assets.ts'

describe('resolveKernelDriverPath', () => {
  it('resolves the Python driver under the real package assets root', () => {
    const path = resolveKernelDriverPath(KERNEL_ASSETS_ROOT, 'python')
    expect(path).toBe(join(KERNEL_ASSETS_ROOT, 'kernel_python.py'))
  })

  it('resolves the R driver under the real package assets root', () => {
    const path = resolveKernelDriverPath(KERNEL_ASSETS_ROOT, 'r')
    expect(path).toBe(join(KERNEL_ASSETS_ROOT, 'kernel_r.R'))
  })

  it('rejects a language whose driver is missing under the given root, naming the path', () => {
    const missingRoot = join(tmpdir(), 'dsh-science-runtime-kernel-assets-missing-root-df3a1b2c')
    expect(() => resolveKernelDriverPath(missingRoot, 'python')).toThrow(
      `science-runtime: kernel driver asset missing at ${join(missingRoot, 'kernel_python.py')} (language: "python")`,
    )
    expect(() => resolveKernelDriverPath(missingRoot, 'r')).toThrow(
      `science-runtime: kernel driver asset missing at ${join(missingRoot, 'kernel_r.R')} (language: "r")`,
    )
  })

  it('ships a non-empty Python driver starting with its shebang line', () => {
    const path = resolveKernelDriverPath(KERNEL_ASSETS_ROOT, 'python')
    const content = readFileSync(path, 'utf8')
    expect(content.length).toBeGreaterThan(0)
    expect(content.split('\n')[0]).toBe('#!/usr/bin/env python3')
  })

  it('ships a non-empty R driver starting with its header comment', () => {
    const path = resolveKernelDriverPath(KERNEL_ASSETS_ROOT, 'r')
    const content = readFileSync(path, 'utf8')
    expect(content.length).toBeGreaterThan(0)
    expect(content.split('\n')[0]).toBe('# Persistent Science kernel driver for run_r. Executes source in the global')
  })
})
