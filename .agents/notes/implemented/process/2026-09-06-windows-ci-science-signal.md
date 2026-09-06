# Agent Note: A real Windows CI signal for Science

Status: implemented

English | [中文](2026-09-06-windows-ci-science-signal.zh.md)

## Problem

The `windows-native` job in [ci.yml](../../../../.github/workflows/ci.yml) had no value for Science. The runner carried no Python or R, so `kernel-transport-real.spec.ts` self-skipped both its cases every run. `science-runtime`, `tool-science`, and `sandbox-windows-acl` also carry POSIX-only test fixtures — `#!/bin/sh` fake interpreters, `chmodSync(…, 0o000)` permission simulation, a hardcoded `/usr/bin/env` — that fail wholesale on win32 for reasons unrelated to the product code they exercise, burying any genuine Windows-specific defect in fixture noise. A pull request could break Science on Windows with no CI signal saying so.

## Decision

**Test side** (`packages/science/science-runtime`, `packages/science/tool-science`, `packages/sandbox/sandbox-windows-acl`): every POSIX-only fixture is skipped on win32 with `it.skipIf(process.platform === 'win32')` or `describe.skipIf(...)`, each site carrying a one-line reason. No fixture was ported to Windows and no assertion was loosened — see [Skip inventory](#skip-inventory) below for the complete list.

`kernel-transport-real.spec.ts` gains `DSH_SCIENCE_REAL_PREFIX`, checked before the desktop app's own `~/.papermachine/environment-binding.json` and before a bare PATH lookup, so CI can point it at a provisioned Conda prefix directly instead of guessing. It is a deliberately distinct name from `chart-kernels.real.spec.ts`'s `DSH_SCIENCE_RUNTIME_PYTHON_PREFIX`/`_R_PREFIX` pair: that pair also gates real matplotlib/ggplot2 chart-driver runs, which the CI environment's bare `python=3.13 r-base=4.5` install cannot satisfy. Leaving `DSH_SCIENCE_REAL_PREFIX` unset preserves the existing self-skip behavior locally.

Four failures surfaced only on the real-Windows verification run (absent from local macOS runs) and were fixed as genuine cross-platform bugs rather than skipped:
- `reconcile-trigger.spec.ts` hardcoded an absolute POSIX `cwd` literal that never matched production's `resolve(header.cwd)` comparison on win32, where `resolve()` is not a no-op on an already-absolute path. Fixed by wrapping the fixture's literal in the same `resolve()`.
- `kernel-process.spec.ts`'s `NUMBER_OF_PROCESSORS` ambient-environment assertion: confirmed on the real box (a direct `node -e` probe) that `process.env.NUMBER_OF_PROCESSORS = '8'` does not take effect there — Node/libuv resolve this one key from the live OS processor count on every read rather than the process's own environment block. The exact-value check is narrowed to a presence check for this one key only; every other ambient key in the same loop keeps its exact-value assertion.
- `artifact-file.spec.ts`'s hard-cap walk test flaked twice under full-suite concurrency once the rest of this change made far more of the suite actually execute on win32: first the test body's own 30-second timeout (14s isolated vs. an observed >30s run under contention; doubled to 60s), then its file-scoped `afterEach` cleanup — removing the >10,000 files that test leaves — which vitest bounds with a separate default `hookTimeout` the test's own timeout override does not touch. That hook now carries its own 60-second timeout too; no assertion changed.
- `prefix-manifest.spec.ts` hardcoded a POSIX-separator symlink-target literal (`'../outside'`). `capturePrefixManifest` retains `readlink`'s raw string unresolved by design, and win32's `CreateSymbolicLinkW` normalizes a relative target to `\` regardless of the `/` passed to `symlinkSync`. Both the fixture's `symlinkSync` call and the assertion now go through `join('..', 'outside')`, tracking whatever separator the host's symlink layer actually reports.

`sandbox-windows-acl/tests/runner.spec.ts`'s `pwshAvailable()` probed via `resolvePwshPath()`, which falls back to legacy Windows PowerShell 5.1 (`powershell.exe`) when no real pwsh 7 exists. On the verification box that produced a false "pwsh available" positive — the runner tests themselves spawn the bare `pwsh` command (PATH-only resolution) — so all 6 confined-child cases genuinely failed instead of self-skipping. The probe now spawns the literal `pwsh` command and additionally checks `$PSVersionTable.PSEdition === 'Core'`, rejecting the legacy Desktop-edition fallback.

**Workflow side**: the `windows-native` job gains, after `pnpm install`:
1. "Fetch pinned micromamba (win32-x64)" — `pnpm --filter @deepseek-ai/dsh-desktop run fetch:micromamba win32-x64`, reusing the same checksum-verified asset `desktop-release.yml` already fetches for packaging, rather than a second micromamba source.
2. "Restore cached Science env" / "Create Science env (python + r-base)" — `actions/cache@v4` keyed on `hashFiles('apps/desktop/resources/micromamba.json')` plus the literal package spec, then `micromamba create -y -p $env:RUNNER_TEMP\science -c conda-forge python=3.13 r-base=4.5` on a cache miss. Only these two packages: this step exists for the three packages' real-interpreter tests, not desktop packaging parity, so `environments/general.json`'s full family is unneeded weight and slower cache warms.
3. "Science on real Windows" — sets `DSH_SCIENCE_REAL_PREFIX` to that prefix and runs the same three-package vitest invocation verified above. Placed before "Run complete native Windows gate inventory" with `if: always()` on both steps: a failure in either step never masks the other, and this job already stays outside `all-checks-passed.needs` (unchanged) — the existing job-level exclusion, not `continue-on-error` on the step, is this repository's sanctioned non-blocking mechanism (see [Alternatives considered](#alternatives-considered)).

## Skip inventory

Every skip below is `it.skipIf(process.platform === 'win32')` or `describe.skipIf(...)`, verified against the real-Windows run's skip count in [Cloud verification](#cloud-verification).

| File | Skipped | Reason |
|---|--:|---|
| `science-runtime/tests/kernel-process.spec.ts` | 49 | `createFakeInterpreterPrefix` lays down `<prefix>/bin/python`/`Rscript`, a POSIX-shaped path win32's executable-layout lookup never finds |
| `science-runtime/tests/kernel-set.spec.ts` | 36 | same `createFakeInterpreterPrefix` fixture-shape gap |
| `science-runtime/tests/environment.spec.ts` | 57 | mixed: `createFakePythonPrefix`/`createFakeRPrefix`'s POSIX `bin/` layout, plus cases whose install path can only reach an `'applied'`/version-mismatch outcome through that same fixture |
| `science-runtime/tests/run.spec.ts` | 40 | `createFakePythonPrefix`/`createFakeRPrefix` fixture-shape gap, reached through `bindFakePython`/`readyPythonHarness` |
| `science-runtime/tests/capture.spec.ts` | 29 | `createFakePythonPrefix` fixture-shape gap |
| `science-runtime/tests/chart-edit.spec.ts` | 26 | `createFakePythonPrefix` fixture-shape gap |
| `tool-science/tests/tool-science.spec.ts` | 26 | `createFakePythonPrefix` fixture-shape gap |
| `science-runtime/tests/annotate.spec.ts` | 17 | `createFakePythonPrefix` fixture-shape gap (direct and via `captureFiles`) |
| `science-runtime/tests/failures.spec.ts` | 9 | `createFakePythonPrefix` fixture-shape gap |
| `science-runtime/tests/save-as.spec.ts` | 8 | `createFakePythonPrefix` fixture-shape gap (via `captureFiles`) |
| `science-runtime/tests/lifecycle.spec.ts` | 5 | `createFakePythonPrefix` fixture-shape gap (via `bindEnvironment`/`readyKernelHarness`) |
| `science-runtime/tests/loader-composition.spec.ts` | 5 | 4× `createFakePythonPrefix` fixture-shape gap; 1× `/usr/bin/env` is a hardcoded POSIX absolute path with no win32 equivalent |
| `science-runtime/tests/execution.spec.ts` | 2 | 1× a `process.platform` mock cannot redirect `node:path`'s host-fixed `join()`; 1× Windows has no POSIX SIGTERM delivery (`TerminateProcess` ignores any handler) |
| `science-runtime/tests/scratch.spec.ts` | 2 | `chmodSync`-based permission-denial simulation — Windows does not enforce POSIX mode bits the same way |
| `science-runtime/tests/settings.spec.ts` | 2 | `createFakePythonPrefix` fixture-shape gap |
| `science-runtime/tests/prefix-manifest.spec.ts` | 1 | `createFakePythonPrefix` fixture-shape gap |
| `tool-science/tests/loader-composition.spec.ts` | 1 | `createFakePythonPrefix` fixture-shape gap (via `boot()`) |

`sandbox-windows-acl/tests/runner.spec.ts` carries no win32 skip: its 14 pwsh-dependent cases self-skip on any host without a real pwsh 7 (a pre-existing, cross-platform check, not new here) and ran and passed on the verification box once pwsh 7 was installed there.

## Cloud verification

Real Windows box (`ssh pmwin`), worktree `C:\pm\wt-win-ci-verify` off `C:\pm\papermachine`, branch `ci/windows-science-signal` at `a3a64f7860` (test-side acceptance below is this final revision; the workflow-step reproduction predates it by one `artifact-file.spec.ts` fix, noted there).

- **Test-side acceptance** (log `C:\pm\logs\T7-step1.json` / `T7-step1-raw.log`, UTF-16): `pnpm exec vitest run packages/science/science-runtime packages/science/tool-science packages/sandbox/sandbox-windows-acl` → **0 failed, 506 passed, 338 skipped** (844 total). `kernel-transport-real.spec.ts`'s Python and R cases both ran (not skipped) and passed against `DSH_SCIENCE_REAL_PREFIX=C:\pm\envs\science`. pwsh 7.5.4 (Core) was installed at `C:\pm\pwsh7\extracted\pwsh.exe`; with it on PATH, all 14 `runner.spec.ts` cases ran and passed rather than self-skipping.
- **Workflow-step reproduction** (log `C:\pm\logs\T7-step2.json` / `T7-step2-raw.log`): the three new PowerShell steps ran as-is. "Fetch pinned micromamba (win32-x64)" succeeded (sha256 verified against the manifest). "Create Science env" failed: the fetched `micromamba.exe` crashes with `STATUS_STACK_BUFFER_OVERRUN` inside `ucrtbase.dll` on this specific verification box, reproducibly, even on a bare `--version` with no environment-creation arguments — ruling out anything about the `create` command's own arguments. The checksum-verified binary, an installed matching VC++ runtime, and identical crashes from a second independently-fetched copy of the same file rule out a corrupted download; this is most plausibly an artifact of this one verification VM (its zh-CN locale and code page were a recurring source of encoding friction throughout this task) rather than a defect in the new step, especially since `desktop-release.yml` already fetches and runs this exact pinned binary successfully in real GitHub Actions CI. Root cause was not confirmed (no comparable en-US Windows box was available to test against) and is left as a follow-up if it recurs on an actual `windows-native` run. With no interpreter at the target prefix, "Science on real Windows" then ran with `DSH_SCIENCE_REAL_PREFIX` pointed at a nonexistent path — `kernel-transport-real.spec.ts` self-skipped as designed, and the rest of the three-package suite reproduced the same [skip inventory](#skip-inventory) as commit 1's verification. This particular run predates the `afterEach` hook-timeout fix above and reproduced that one now-fixed `artifact-file.spec.ts` flake; it was not re-run after that fix, since the blocking issue for this step is the environment-creation crash, not the test suite.

## Alternatives considered

**`continue-on-error: true` on the new "Science on real Windows" step.** Rejected: it makes the step report success even after a genuine failure, which is exactly the masking this repository's own [native-Windows-CI Agent Note](2026-08-08-native-windows-pull-request-ci.md) rejected for the job as a whole. The job's existing absence from `all-checks-passed.needs` is the sanctioned non-blocking mechanism; `if: always()` chaining keeps every step's own conclusion honest while still letting the following step run.

**Install `environments/general.json`'s full desktop package family.** Rejected: these three packages' real-interpreter tests need one reachable Python and R executable, not desktop parity. The narrower `python=3.13 r-base=4.5` spec keeps the cache small and the environment-creation step fast on a cache miss.

**Escalate this job into `all-checks-passed.needs` now.** Not done: this task book does not authorize deciding whether Science-on-Windows should block merges, and the existing native-Windows job (which this Science step lives inside) is deliberately non-blocking for reasons a separate decision, not this change, should revisit.

**Port the `#!/bin/sh` fake-interpreter fixtures to Windows now.** Rejected as out of scope for this change: it would let every skipped case above run for real, but redesigning `tests/harness.ts`'s fixture layer to also lay down a win32-shaped fake interpreter is a substantially larger investment than making the existing suite give an honest signal.

## Consequences

Windows CI now runs real Python and R kernels through `science-runtime`, `tool-science`, and `sandbox-windows-acl`'s actual test suites, independently visible before `check:ci:windows-complete`, rather than reporting nothing. The skip list above is real cost: 338 cases carry no Windows signal until their fixtures are ported, and a defect reachable only through `createFakePythonPrefix`/`createFakeRPrefix` on win32 stays invisible until then. Whether to make this step block merges remains an open, later decision — this change only makes the signal exist and be honest.

The environment-creation crash under [Cloud verification](#cloud-verification) means this change's own cloud verification could not observe a fully successful "Create Science env" step; it is carried as a follow-up to confirm on an actual `windows-native` run (or a second, differently-configured Windows box) before treating a future failure of that step as a genuine regression rather than a repeat of this same host artifact.
