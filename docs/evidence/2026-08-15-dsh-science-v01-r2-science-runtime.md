# DSH Science v0.1 R2 Science Runtime closure evidence

English | [中文](2026-08-15-dsh-science-v01-r2-science-runtime.zh.md)

Investigated on 2026-08-16 on macOS 26.5.2 (Darwin 25.5.0, arm64), Node v24.14.0, pnpm 11.7.0. Scope authority: [DSH Science v0.1 R2 Science Runtime on RC5](../../.agents/notes/implemented/feature/2026-08-15-dsh-science-v01-r2-science-runtime.md).

## Outcome

R2 product work is accepted at `4c3c814f7a51d7e48717afef91ba4369d05ab3e6` on branch `grok/science-v01-r2-runtime`, five linear commits above the R2 plan base `a1c9ba2a48c9ccc6895f821456a4d2942c6ebe2c`. `git merge-base --is-ancestor 7e11de7e4beaf17dd87cf19368cfc930837dc77c HEAD` and `git merge-base --is-ancestor a1c9ba2a48c9ccc6895f821456a4d2942c6ebe2c HEAD` both succeed. No merge or cherry-pick parent from `e5e8b29…` / `bf4be8…` / `2386ad5…` / `390fbde…` / `b15f1ef…` is present. The implementation worktree is otherwise clean after this evidence triplet and the implemented Note move.

## Exact identities

| Subject | Identity |
|---|---|
| Official RC5 | `deepseek-ai/deepseek-harness@47f943859bef60e4160492346772ded9b24f765a` |
| Accepted R1 head | `7e11de7e4beaf17dd87cf19368cfc930837dc77c` |
| R2 plan base | `a1c9ba2a48c9ccc6895f821456a4d2942c6ebe2c` on `codex/science-v01-r2-runtime-plan` |
| R2 product candidate | `4c3c814f7a51d7e48717afef91ba4369d05ab3e6`, tree `c797c9c77a3eccc8351dae5bda9a1630d3f909f5` |
| Commit 1 | `a5bf92c0a0` — required `environmentBase`, `executionWorld`, and `utf8Validity` |
| Commit 2 | `f9d3ee7ab3` — one sandbox classifier owner |
| Commit 3 | `eabee7a343` — RC5-aligned `@deepseek-ai/dsh-science-runtime` |
| Commit 4 | `95669a4f6a` — standalone `Rscript --version` |
| Commit 5 | `4c3c814f7a` — catalog/generator integration |
| Downstream Runtime source | `omdsh-dev/dsh-science@e5e8b29b435f67e0a5dde5e2132580966e78b27b`, `packages/science/science-runtime/**` |
| Isolated DSH home | `/Users/superjj/ccproj/dshscience-r2-acceptance-dsh-home`, mode `0700`, not under `/tmp` |
| Real Python prefix | `/opt/miniconda3/envs/qwen` (existing Conda, `conda-meta/history`, in-prefix Python 3.13.5) |
| Real R prefix | `/Users/superjj/.conda/envs/dsh-r-acceptance` (existing Conda, `conda-meta/history`, in-prefix Rscript 4.5.3) |

## Verification matrix

| Layer | Command | Result |
|---|---|---|
| Scope and ancestry | `git merge-base --is-ancestor 7e11de7e4b HEAD`; `git merge-base --is-ancestor a1c9ba2a48 HEAD`; `pnpm --silent run change-scope --base a1c9ba2a48 --head HEAD`; `git diff --check a1c9ba2a48..HEAD` | PASS — both ancestries hold; every committed path maps to the R2 Note or an owning generator; whitespace check exit 0 |
| Generic subprocess behavior | Focused Vitest over `packages/subprocess/subprocess/tests`, `packages/subprocess/subprocess-local/tests`, `packages/e2b/subprocess-e2b/tests`, and every changed Consumer test directory | PASS — 758 passed / 27 skipped, 34 files |
| Sandbox classification | Focused Vitest over `packages/sandbox/sandbox/tests`, `packages/shell/bash-sandbox/tests`, and `packages/shell/pwsh-sandbox/tests` | PASS — 111 passed / 13 skipped, 7 files |
| Runtime behavior | `pnpm exec vitest run packages/science/science-runtime/tests packages/science/science-session/tests` | PASS — 128 passed, 17 files |
| Focused per-file coverage | Targeted Vitest coverage over `packages/science/science-runtime/src/**` and every R2-changed generic source file, under canonical `types.ts` and other repo exclusions | PASS — 43 files, 886 passed / 40 skipped; all included files 100% statements/branches/functions/lines |
| Static and package artifacts | `pnpm run typecheck`; `pnpm run check:ci:artifacts` | PASS — typecheck exit 0; check:ci:artifacts 5/5 (build, publint, node-next-types, built-package-invariants, built-bin smoke) |
| Hygiene remaining subchecks | `knip`, `constraints`, `verify-dsh-package-licenses`, `verify-package-invariants`, `verify-built-package-invariants`, `verify-cordis-config`, `verify-node-next-types`, `verify-runtime-closure`, `verify-vendored-links` | PASS, each run after the known `rescope-vendor:check` short-circuit |
| Hygiene (`rescope-vendor:check`) | `pnpm run rescope-vendor:check` compared to `a1c9ba2a48` | **FAIL — pre-existing, confirmed unchanged.** Identical 26-problem list on the R2 plan base and the product candidate; disclosed, not called PASS |
| Documentation | Named pairing re-records; `pnpm run doc-sync`; `pnpm run lint` | PASS — doc-sync 28/28; lint exit 0 |
| Real Python/R run 1 | Opt-in `test:real-acceptance` at `4c3c814f7a` with the isolated mode-`0700` home and the two existing prefixes above | PASS — `python.status=PASS`, `r.status=PASS`, no `prefixManifestDifferences` |
| Real Python/R run 2 | Same command, same candidate, same prefixes, same home | PASS — `python.status=PASS`, `r.status=PASS`, no `prefixManifestDifferences` |
| Exact candidate review | Fresh subagent review of only changed generic contracts and Runtime lifecycle/security at `4c3c814f7a51d7e48717afef91ba4369d05ab3e6` | PASS — no blockers; traced environment base, execution world, UTF-8 validity, classifier precedence, exact-Session lease, start-before-spawn, quiescence, remote reject, prefix/credential/event confinement |

### Explicitly NOT-RUN

Repository-wide unit suite, model snapshots, browser suites, provider e2e, Desktop, packed installer, signing, publication, tag, release, Git push, PR, Runtime Context, filesystem read-only, `tool-science`, Science preset, and Client UI are `NOT-RUN` for R2. Those layers are outside this slice; CI owns the exhaustive matrix. Historical downstream PASS is not R2 evidence.

## Domain port provenance

The Runtime package is re-derived against RC5 from `omdsh-dev/dsh-science@e5e8b29` `packages/science/science-runtime/**`, then the isolated `b15f1ef…` `Rscript --version` correction. Package metadata, TypeScript references, READMEs, and generator integration are RC5-adapted (`0.1.0-rc.5`, public, MIT) and do not copy downstream `0.0.1-rc.2` / restricted / BSD metadata or a `vendor/cosmokit` reference.

Generic subprocess facts and the sandbox classifier are new RC5 patches, not cherry-picks of `bf4be8…` / `2386ad5…` / `390fbde…`. Existing Consumers name `'scrubbed-parent'` explicitly. Science is the only `'empty'` caller and rejects `'remote'` before owner markers, scratch, or Session events.

## Overlay inventory update

| `delta_id` | Prior status | R2 status |
|---|---|---|
| `GEN-SUBPROCESS-RUNTIME-FACTS` | absent from the R0 inventory as a named row | `verified` at `a5bf92c0a0` / `4c3c814f7a` |
| `GEN-SANDBOX-CLASSIFICATION` | absent from the R0 inventory as a named row | `verified` at `f9d3ee7ab3` / `4c3c814f7a` |
| `SCI-RUNTIME` | `deferred` until `SCI-SESSION` is accepted | `verified` at `4c3c814f7a51d7e48717afef91ba4369d05ab3e6` |
| `SCI-R-PROBE` | `deferred`; separate evidence identity | `verified` at `95669a4f6a` on the same candidate |
| `SCI-SESSION` / `GEN-SESSION-REGISTRY` | `verified` in R1 | unchanged |
| Remaining overlay rows | as recorded in the [R0 closure evidence](2026-08-15-dsh-science-v01-r0-rc5-baseline-closure.md) and [R1 evidence](2026-08-15-dsh-science-v01-r1-science-session.md) | unchanged: `GEN-RUNTIME-CONTEXT`, `FS-READONLY`, `FS-READONLY-LOAD-FIX`, `SCI-TOOLS`, `SCI-PRESET`, `SCI-CHARTS-OUTCOME`, `SCI-SETTINGS-SIDEBAR`, `DESKTOP-CARRIER` |

## Protected-state preservation

Every pre-existing worktree recorded at entry was left unedited: `/Users/superjj/ccproj/DSHscience` (`e5e8b29b435f67e0a5dde5e2132580966e78b27b`, `main`), the R2 plan worktree (`a1c9ba2a48`, clean), the R1 worktree (`7e11de7e4b`, clean), the R0A/R0B worktrees, the R-probe worktree (`b15f1ef42e`), the dirty governance worktree, and the other detached Codex/Grok worktrees. No protected worktree was staged, cleaned, reset, checked out, or repointed. No push, tag, PR, or publish occurred.

## Risks, unknowns, and deferred product decisions

- `rescope-vendor:check`'s pre-existing 26-problem gap remains open; R2 neither fixes nor extends it and takes no position on when it should be addressed.
- File-write confinement is not confidentiality. Real acceptance proves prefix write denial and environment scrubbing; it does not prove file-read, network, syscall, or scientific-result isolation.
- Runtime Context, filesystem read-only, `tool-science`, preset, Client UI, and Desktop remain exactly as recorded in the R0/R1 overlay inventory.
