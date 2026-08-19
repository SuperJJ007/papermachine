/**
 * Real-provider fixtures for tool-science tests: re-exports
 * `@deepseek-ai/dsh-science-runtime`'s own test harness pieces so
 * `run_python`/`run_r` exercise the real persistent-kernel pipeline against
 * its fake D2-protocol driver fixture instead of a real Conda interpreter —
 * the same technique `../../science-runtime/tests/loader-composition.spec.ts`
 * uses for its own Loader-composed kernel coverage.
 */

export {
  createFakePythonPrefix,
  createFakeSandboxRunner,
  installTestKernelSet,
  kernelAction,
} from '../../science-runtime/tests/harness.ts'
