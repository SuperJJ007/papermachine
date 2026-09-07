# Agent Note: environment health checks use the declaration's own timeout instead of a hidden 120-second cap

Status: implemented

English | [中文](2026-09-08-health-check-timeout-follows-declaration.zh.md)

## Problem

B3 (`.agents/tmp/2026-09-07-win32-crt/B3-mac-x64-rosetta-smoke.md`) ran the packaged `0.1.1` x64 `.app` under Rosetta on Apple Silicon: the `general` environment's 323 packages all downloaded and linked successfully (TUNA failed and USTC completed the install), then the "Verifying Python and R" phase failed with `desktop provisioning: timed out`. `applied.json` was never written and onboarding was stuck on the error page with no route forward except retrying the whole install. The provisioned environment itself was not broken — its Python and R interpreters and packages were intact on disk.

`apps/desktop/src/provisioning.ts:971` gave every health check `Math.min(declaration.timeoutMs, 120_000)` regardless of what `declaration.timeoutMs` actually said, while the `create` step a few lines above used `declaration.timeoutMs` directly. `general.json`'s health checks are `import numpy,scipy,pandas,matplotlib,seaborn,statsmodels,sklearn,pyarrow,openpyxl,pyreadstat,PIL` (Python) and `library(tidyverse);library(haven);library(lme4);library(survey);library(data.table)` (R) — a real workload, not the trivial `python -c pass` a lighter fixture uses elsewhere in the codebase.

## Measurements

On the x64 environment B3's run left provisioned and intact (Rosetta, Apple Silicon), running each health check's exact command twice back to back:

| Check | First run | Second run |
| --- | --- | --- |
| Python (`import numpy,scipy,pandas,matplotlib,seaborn,statsmodels,sklearn,pyarrow,openpyxl,pyreadstat,PIL`) | `3:49.96` total | `1.98s` |
| R (`library(tidyverse);library(haven);library(lme4);library(survey);library(data.table)`) | `20.1s` | `1.4s` |

The first run's cost is x86_64 native extensions' one-time ahead-of-time translation under Rosetta; once translated, the same process is two orders of magnitude faster. A real Intel machine has no Rosetta translation step, but a cold disk, an older machine, or a Windows Defender real-time scan walking thousands of freshly written `.pyd`/`.dll` files can hold a first import past two minutes for the same underlying reason — none of that is declared or configurable anywhere in `resources/environments/*.json`, so a deployment has no way to size a health check timeout that fits its actual first-import cost.

## Decision

Health checks use `declaration.timeoutMs`, the same field the `create` step already uses, instead of `Math.min(declaration.timeoutMs, 120_000)`. `EnvironmentDeclaration.timeoutMs`'s JSDoc (`apps/desktop/src/environment-declaration.ts`) now states it bounds both stages. `abortController`-driven cancellation is unaffected: a caller can still cancel a stuck health check at any point rather than waiting out `timeoutMs`, so the practical worst case for a genuinely hung interpreter is an explicit cancel, not a multi-hour wait.

## Alternatives considered

- **A new required `healthCheckTimeoutMs` field on `EnvironmentDeclaration`.** Rejected: every declaration is parsed by the same `environment-declaration.ts` parser a user's persisted `<dshHome>/desktop-environments/custom.json` also goes through, and a new required field would fail parsing every existing custom declaration on disk instead of only changing behavior for newly authored ones.
- **A longer fixed constant (e.g. 10 minutes) in place of 120 seconds.** Rejected: it is still a hidden cap nothing in `resources/environments/*.json` declares, and it does not fix the underlying problem — a health check on a slower disk or a heavier package set can still exceed any fixed number chosen without evidence, which is exactly what `Math.min(declaration.timeoutMs, 120_000)` already got wrong. `general.json` already declares `timeoutMs: 3600000` for the `create` step's own worst case; reusing it for health checks costs nothing extra to configure.

## Consequences

A health check on a slow disk, an untranslated Rosetta binary, or a Windows machine under active antivirus scanning now gets up to `declaration.timeoutMs` (3600000 ms for `general.json`) instead of failing at 120 seconds while the interpreter is still working. `apps/desktop/tests/provisioning.spec.ts` asserts both health checks receive a `timeoutMs` well past the old cap (3,600,000 ms) rather than a shorter one, so a regression back to a fixed cap fails this test.
