/** Minimal real-subprocess assembly for Web fixtures that exercise the Science persistent-kernel protocol. */

import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { SandboxProvider } from '@deepseek-ai/dsh-sandbox'
import type { ConfinedArgv, SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import type { Session } from '@deepseek-ai/dsh-session'
import ScienceRuntime from '@deepseek-ai/dsh-science-runtime'
import {
  KernelSet,
  type ScienceKernelEndedFact,
  type ScienceKernelStartedFact,
} from '../../../packages/science/science-runtime/src/kernel-set.ts'

/** Runtime suite driver assets that speak the production kernel wire protocol. */
const KERNEL_ASSETS = fileURLToPath(new URL('../../../packages/science/science-runtime/tests/fixtures/kernel-set-assets-full/', import.meta.url))

/** Full-enforcement test double that preserves direct argv for the fake interpreter. */
export class DirectSandbox extends SandboxProvider {
  confine(argv: readonly string[], _policy: SandboxPolicy): ConfinedArgv {
    return { argv: [...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] }
  }
}

/** Create the probe-compatible interpreter wrapper that executes the shared fake wire driver under Node. */
export function createFakePythonPrefix(root: string): string {
  const prefix = join(root, 'fake-conda')
  mkdirSync(join(prefix, 'bin'), { recursive: true })
  mkdirSync(join(prefix, 'conda-meta'), { recursive: true })
  writeFileSync(join(prefix, 'conda-meta', 'history'), '==> 2026-08-20 <==\n+python-3.13.5\n')
  const executable = join(prefix, 'bin', 'python')
  writeFileSync(executable, `#!/bin/sh
case " $* " in
  *" --version "*) printf 'Fake Python 3.13.5\\n' ;;
  *" -m "*) printf '[{"name":"pip","version":"24.0"}]' ;;
  *" -c "*) printf 'dsh-科学-✓' ;;
  *)
    while [ "$#" -gt 2 ]; do shift; done
    exec "${process.execPath}" "$1" "$2"
    ;;
esac
`)
  chmodSync(executable, 0o700)
  return prefix
}

/** Replace Runtime's driver assets without importing the Runtime suite's sandbox provider into the Web process. */
export function installTestKernelSet(ctx: Context, runtime: ScienceRuntime): void {
  const internal = runtime as unknown as {
    kernels: KernelSet
    appendKernelStarted: (session: Session, fact: ScienceKernelStartedFact) => void
    appendKernelEnded: (session: Session, fact: ScienceKernelEndedFact) => void
    nextKernelEpoch: (session: Session) => number
  }
  internal.kernels = new KernelSet({
    subprocess: ctx.subprocess,
    sandbox: ctx.sandbox,
    assetsRoot: KERNEL_ASSETS,
    kernelIdleTimeoutMs: 1_800_000,
    kernelStartTimeoutMs: 5_000,
    nextEpoch: session => internal.nextKernelEpoch(session),
    onKernelStarted: (session, fact) => { internal.appendKernelStarted(session, fact) },
    onKernelEnded: (session, fact) => { internal.appendKernelEnded(session, fact) },
  })
}
