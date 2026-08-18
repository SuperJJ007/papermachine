/**
 * Deterministic fake subprocess/sandbox providers for real `ScienceRuntime`
 * composition without a real Conda prefix, mirroring
 * `packages/science/science-runtime/tests/harness.ts`'s technique.
 */

import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SandboxProvider } from '@deepseek-ai/dsh-sandbox'
import type { ConfinedArgv, SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type {
  SubprocessHandle,
  SubprocessOutputRead,
  SubprocessSpawnSpec,
  SubprocessTerminalHandle,
  SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'

/** Full-enforcement test double that preserves direct argv. */
export class DirectSandbox extends SandboxProvider {
  confine(argv: readonly string[], _policy: SandboxPolicy): ConfinedArgv {
    return { argv: [...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] }
  }
}

function reader(text: string): { readFrom(fromByte: number): SubprocessOutputRead } {
  return { readFrom: () => ({ text, nextOffset: Buffer.byteLength(text), lossy: false, utf8Validity: 'valid' }) }
}

function settledHandle(stdout: string, stderr: string): SubprocessHandle {
  return {
    pid: 4242,
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    collected: { stdout: reader(stdout), stderr: reader(stderr) },
    done: Promise.resolve({ exitCode: 0, signal: null }),
    terminate: () => {},
    waitForExit: async () => true,
  }
}

/** Host-local fake subprocess provider: frozen probes plus a fixed successful run output. */
export class FakeSubprocess extends SubprocessRuntime {
  override executionWorld: 'host-local' | 'remote' = 'host-local'

  override async resolveExecutable(command: string): Promise<string> {
    return command
  }

  override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    const isR = spec.argv[0]?.endsWith('/Rscript') ?? false
    if (spec.argv.includes('--version')) {
      return settledHandle(isR ? 'Fake R 4.5.0\n' : 'Fake Python 3.13.5\n', '')
    }
    if (spec.argv.includes('-m') || spec.argv.some(arg => arg.includes('installed.packages'))) {
      return settledHandle(isR ? 'base\t4.5.0\n' : '[{"name":"pip","version":"24.0"}]', '')
    }
    if (spec.argv.includes('-c') || spec.argv.includes('-e')) return settledHandle('dsh-科学-✓', '')
    return settledHandle(isR ? 'fake R run output\n' : 'fake run output\n', '')
  }

  override async spawnTerminal(_spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    throw new Error('FakeSubprocess does not allocate terminals')
  }
}

/** Write a fake Python Conda prefix with the frozen probe/run outputs `FakeSubprocess` returns. */
export function createFakePythonPrefix(root: string): string {
  const prefix = join(root, 'fake-conda')
  mkdirSync(join(prefix, 'bin'), { recursive: true })
  mkdirSync(join(prefix, 'conda-meta'), { recursive: true })
  writeFileSync(join(prefix, 'conda-meta', 'history'), '==> 2026-08-16 <==\n+python-3.13.5\n')
  const executable = join(prefix, 'bin', 'python')
  writeFileSync(executable, '#!/bin/sh\nprintf \'fake run output\\n\'\n')
  chmodSync(executable, 0o700)
  return prefix
}
