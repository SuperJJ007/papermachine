/** Focused coverage for index.ts's standalone `settleKernelExecution` export, independent of the full ScienceRuntime pipeline. */

import { describe, expect, it } from 'vitest'
import { ScienceRunId } from '@deepseek-ai/dsh-science-session'
import { settleKernelExecution } from '../src/index.ts'
import type { KernelDoneFrame, KernelExecuteRequest, KernelProcess } from '../src/kernel-process.ts'
import { OperationControl } from '../src/lifecycle.ts'

/** A host-minted request shape; its exact paths are irrelevant since the fake kernel below never reads them. */
function fakeRequest(): KernelExecuteRequest {
  return {
    runId: ScienceRunId('run-1'),
    sourcePath: '/run/action.json',
    cwd: '/run',
    stdoutPath: '/run/stdout.txt',
    stderrPath: '/run/stderr.txt',
    artifactDir: '/run/artifacts',
    inputDir: '/run/inputs',
  }
}

describe('settleKernelExecution', () => {
  it('still interrupts and classifies first-cause when the signal is already aborted at the moment settlement begins', async () => {
    const controller = new AbortController()
    controller.abort()
    const control = new OperationControl(controller.signal, 10_000)
    let interrupted = false
    // A cooperative fake kernel: execute() resolves quickly with interrupted,
    // as if the driver caught the SIGINT settleKernelExecution's interrupt-first path sends.
    const kernel = {
      execute: () => Promise.resolve<KernelDoneFrame>({
        runId: ScienceRunId('run-1'), status: 'interrupted', detail: '', captureDegraded: false,
      }),
      interrupt: () => { interrupted = true },
    } as unknown as KernelProcess
    const outcome = await settleKernelExecution(control, kernel, fakeRequest())
    expect(interrupted).toBe(true)
    expect(outcome).toEqual({ status: 'cancelled', failureCode: 'CANCELLED', outputDegraded: false, retireKernel: false })
  })
})
