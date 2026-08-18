/** Deterministic providers for the keyless Science tool snapshot. */

import { Buffer } from 'node:buffer'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
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

/** Smallest valid PNG; auto-capture durably saves these exact bytes from the run's artifact directory. */
const PNG = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
))

class DirectSandbox extends SandboxProvider {
  confine(argv: readonly string[], _policy: SandboxPolicy): ConfinedArgv {
    return { argv: [...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] }
  }
}

function reader(text: string): { readFrom(fromByte: number): SubprocessOutputRead } {
  return { readFrom: () => ({ text, nextOffset: Buffer.byteLength(text), lossy: false, utf8Validity: 'valid' }) }
}

function settledHandle(stdout: string): SubprocessHandle {
  return {
    pid: 4242,
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    collected: { stdout: reader(stdout), stderr: reader('') },
    done: Promise.resolve({ exitCode: 0, signal: null }),
    terminate: () => {},
    waitForExit: async () => true,
  }
}

class FakeSubprocess extends SubprocessRuntime {
  override executionWorld = 'host-local' as const

  override async resolveExecutable(command: string): Promise<string> {
    return command
  }

  override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    if (spec.argv.includes('--version')) return settledHandle('Python 3.13.5\n')
    if (spec.argv.includes('-m')) return settledHandle('[{"name":"pip","version":"24.0"}]')
    if (spec.argv.includes('-c')) return settledHandle('dsh-科学-✓')
    const artifacts = spec.env?.SCIENCE_ARTIFACT_DIR
    if (artifacts === undefined) throw new Error('science snapshot fixture: run received no SCIENCE_ARTIFACT_DIR')
    mkdirSync(artifacts, { recursive: true })
    // One file per allowlisted auto-capture media type this snapshot pins —
    // csv, json, md, and png — proving one science/artifact-saved event per file.
    writeFileSync(join(artifacts, 'summary.csv'), 'metric,value\naccuracy,0.97\n')
    writeFileSync(join(artifacts, 'meta.json'), '{"ok":true}\n')
    writeFileSync(join(artifacts, 'notes.md'), '# Notes\n\nDeterministic snapshot run.\n')
    writeFileSync(join(artifacts, 'plot.png'), PNG)
    return settledHandle('science snapshot run output\n')
  }

  override async spawnTerminal(_spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    throw new Error('science snapshot fixture does not allocate terminals')
  }
}

export const name = 'science-runtime-fixture'

/** Mount deterministic implementations behind the real subprocess and sandbox services. */
export function apply(ctx: Context): void {
  ctx.plugin(FakeSubprocess)
  ctx.plugin(DirectSandbox)
}
