# DSH Science v0.1 R3 model-facing Science tools closure evidence

English | [中文](2026-08-16-dsh-science-v01-r3-science-tools.zh.md)

Investigated on 2026-08-16 on macOS 26.5.2 (Darwin 25.5.0, arm64), Node v24.14.0, pnpm 11.7.0. Scope authority: [DSH Science v0.1 R3 model-facing Science tools on RC5](../../.agents/notes/implemented/feature/2026-08-16-dsh-science-v01-r3-science-tools.md).

## Outcome

The original R3 product candidate `50d5b413e59a3425c8936717e2ee369341324774` and closure head `d1dc9f3d23cdb67f60d530db003a653fa4196194` did not pass the subsequent deep review. The repaired worktree remains based on the accepted R2 head `dba4c1cdaaed209c8996e1a1bebca9b38c62d8aa` and is pending a local commit plus final exact-SHA acceptance. This record does not promote the uncommitted repair.

## Exact identities

| Subject | Identity |
|---|---|
| Official RC5 | `deepseek-ai/deepseek-harness@47f943859bef60e4160492346772ded9b24f765a` |
| Accepted R2 head | `dba4c1cdaaed209c8996e1a1bebca9b38c62d8aa` |
| Original R3 product candidate | `50d5b413e59a3425c8936717e2ee369341324774`, three commits above the R2 head; superseded for promotion by review repairs |
| Reviewed closure head | `d1dc9f3d23cdb67f60d530db003a653fa4196194`; review failed and repairs remain uncommitted |
| Commit 1 | `1cf4ef0ddd` — generic runtime-context restoration in `packages/core/agent-loop` |
| Commit 2 | `35ae6b5399` — `@deepseek-ai/dsh-tool-fs/read-only` subpath entry |
| Commit 3 | `50d5b413e5` — `@deepseek-ai/dsh-tool-science` Consumer package |
| Downstream provenance | `omdsh-dev/dsh-science@0a940733e80d57c70245134bf260012f9be29114` (runtime-context, test corrections `e5e8b29b435f`), `@8c7d5e01e3876b0c645f13f20ada8cf7add0c356` (read-only, loader correction `0073f6e0a11c`), `@27c96d8e8b2431814fe70a2e94fe8feeaf207b63` (Science Consumer) |
| Rejected whole-range candidate | `omdsh-dev/dsh-science@fae091e1080e830bed8ad0456e4cbced29101b01` — negative scope evidence only |

## Verification matrix

| Layer | Command | Result |
|---|---|---|
| Scope and ancestry | `git merge-base --is-ancestor dba4c1cdaa HEAD`; `pnpm --silent run change-scope --base dba4c1cdaa --head HEAD`; `git diff --cached --check` | PASS — ancestry holds; every committed path across the three commits maps to the R3 Note's declared packages, tests, documentation, generators, or metadata; whitespace check exit 0 |
| Generic agent-loop behavior | `pnpm exec vitest run packages/core/agent-loop/tests` | PASS — 333 passed, 18 files (includes 4 new retry-restoration tests) |
| Filesystem read-only entry | `pnpm exec vitest run packages/fs/tool-fs/tests` | PASS — 181 passed, 7 files (includes 3 new read-only test files) |
| Science Consumer behavior | `pnpm exec vitest run packages/science/tool-science/tests` | PASS — 35 passed, 2 files, including the required real Loader+agent-loop composition (`loader-composition.spec.ts`) |
| Combined focused suite | `pnpm exec vitest run packages/core/agent-loop/tests packages/fs/tool-fs/tests packages/science/tool-science/tests packages/science/science-runtime/tests packages/science/science-session/tests` | PASS — 680 passed, 45 files |
| Focused per-file coverage | Targeted Vitest coverage over `packages/core/agent-loop/src/**`, `packages/fs/tool-fs/src/**`, `packages/science/tool-science/src/**` | PASS — every changed/new file 100% statements/branches/functions/lines, except one pre-existing, untouched line (`packages/core/agent-loop/src/agent.ts:143`, the `runMaintenance` reentrancy guard) that many other packages' suites exercise in the full workspace `test:coverage` run; confirmed unrelated to this change |
| Built lib subpath smoke | `pnpm exec vitest run --config vitest.e2e.config.ts packages/fs/tool-fs/tests/built-lib.e2e.ts` (after `pnpm run build:lib:host`) | PASS — shared `Config` identity, read-only roster, and a real file read all confirmed against built `lib/` |
| Static and package artifacts | `pnpm run typecheck`; `pnpm run check:ci:artifacts` | PASS — typecheck exit 0; check:ci:artifacts 5/5 (build, publint, node-next-types, built-package-invariants, built-bin smoke) |
| Hygiene remaining subchecks | `knip`, `constraints`, `verify-dsh-package-licenses`, `verify-package-invariants`, `verify-built-package-invariants`, `verify-cordis-config`, `verify-node-next-types`, `verify-runtime-closure`, `verify-vendored-links` | PASS, each run after the known `rescope-vendor:check` short-circuit |
| Hygiene (`rescope-vendor:check`) | `pnpm run rescope-vendor:check` | **FAIL — pre-existing, confirmed unchanged.** Identical 26-problem list to the one recorded in the R2 evidence record; disclosed, not called PASS |
| Cross-file duplication | `pnpm run duplication` | **FAIL — pre-existing, confirmed unrelated.** 8 clone pairs reported, all among files this change did not touch (`goal/goal`, `science-session`/`science-runtime` internals, `bash-sandbox`/`pwsh-sandbox`, `gen-config-catalog.ts`); every new `invariant.ts` this change adds carries the established `jscpd:ignore` markers and reports zero clones |
| Documentation | `pnpm run doc-sync` (28 gates); `pnpm run lint` | PASS — doc-sync 28/28 including bilingual pairing for every touched document (agent-loop README, tool-fs/fs READMEs, science/tool-science READMEs, architecture.md, and the config/tool/event/module-graph catalogs); lint exit 0 |
| Agent Note lifecycle | `pnpm run verify-agent-note-format`; `pnpm run verify-agent-note-classification` | PASS — 544 Agent Notes checked both times |
| Exact candidate review | Fresh subagent review (GPT-5.6 sol, high effort) of the R3 range through closure head `d1dc9f3d23cdb67f60d530db003a653fa4196194` | FAIL — see [Review](#review) below |
| Review repair checks | Focused agent-loop and Science Consumer Vitest; selected keyless Science snapshot; `pnpm run typecheck` | PASS — 14 agent-loop tests, 48 Science Consumer tests, one selected runnable snapshot, and typecheck exit 0 on the uncommitted repair worktree |

### Explicitly NOT-RUN

Repository-wide unit suite (CI owns the exhaustive matrix), real Python and R Consumer acceptance against explicitly authorized existing Conda prefixes, Science preset, Web, browser, Desktop, provider credentials, signing, publication, tag, release, Git push, and PR are `NOT-RUN` for R3. Those layers are outside this slice.

## Review

The review rejected the recorded candidate because retry restoration could override the authoritative final `agent/pre-step` Enter batch, `get_science_state` returned uncapped histories and raw Host environment fields, model-facing free text could carry Host paths, and no runnable keyless snapshot covered the new schemas and results or the filesystem read-only roster. The repair captures an exact retained fallback before pre-step pressure replacement, selects the final retained value after the Enter batch for the first request and retries, restores by message id, requires and tests a per-history state limit, sanitizes model-facing environment/run/version data, and adds a real Loader/headless snapshot that exercises `get_science_state` followed by `run_python`. Final independent review and exact committed-SHA gates remain pending.

## Domain port provenance

Runtime-context restoration in `packages/core/agent-loop` is a fresh RC5 patch informed by the read-only behavior and test corrections at the recorded downstream SHAs, not a cherry-pick: its authoritative final-Enter selection, exact retained fallback for pre-request pressure compaction, and frozen first-request retry target do not exist in the accepted R2 tree or downstream provenance commit. The `@deepseek-ai/dsh-tool-fs/read-only` entry and its loader-resolution behavior are re-derived against the RC5 `tool-fs` package rather than copied from the downstream prerelease; package metadata, exports, and TypeScript project wiring follow the RC5 sibling-package template (version `0.1.0-rc.5`, public, MIT). `@deepseek-ai/dsh-tool-science` reproduces the downstream Science Consumer provenance's behavior and test input on the accepted R1/R2 tree; its generated output and the downstream Phase 3 range's failed whole-range acceptance are excluded, and the real-composition test, schema-derived tool values, sanitized bounded state view, waterfall-result-based context replacement, and runnable-example snapshot are R3-original rather than ported.

## Overlay inventory update

| `delta_id` | Prior status | R3 status |
|---|---|---|
| `GEN-RUNTIME-CONTEXT` | absent from the R0/R1/R2 inventory as a named row | repair pending final exact-SHA verification |
| `FS-READONLY` | `deferred` | implementation retained; assembled snapshot verification pending final exact-SHA acceptance |
| `FS-READONLY-LOAD-FIX` | `deferred` | implementation retained; pending final exact-SHA acceptance |
| `SCI-TOOLS` | `deferred` until Runtime Context and filesystem read-only were accepted | repair pending final exact-SHA verification |
| `SCI-SESSION` / `SCI-RUNTIME` / `GEN-SESSION-REGISTRY` / `GEN-SUBPROCESS-RUNTIME-FACTS` / `GEN-SANDBOX-CLASSIFICATION` / `SCI-R-PROBE` | `verified` in R1/R2 | unchanged |
| Remaining overlay rows | as recorded in the [R0 closure evidence](2026-08-15-dsh-science-v01-r0-rc5-baseline-closure.md) | unchanged: `SCI-PRESET`, `SCI-CHARTS-OUTCOME`, `SCI-SETTINGS-SIDEBAR`, `DESKTOP-CARRIER` |

## Protected-state preservation

No protected worktree outside `/Users/superjj/ccproj/DSHscience` (branch `codex/science-v01-r3-science-tools-plan`) was staged, cleaned, reset, checked out, or repointed. No push, tag, PR, or publish occurred. `pnpm run clean` was run once during this work to remove pre-existing build residue unrelated to this change (a stale `packages/session-query/session-log-download` directory that blocked `pnpm run constraints`); it removed only build outputs and confirmed-deleted-package residue, not source.

## Risks, unknowns, and deferred product decisions

- `rescope-vendor:check`'s pre-existing 26-problem gap remains open; R3 neither fixes nor extends it and takes no position on when it should be addressed.
- The pre-existing 8-clone `duplication` gap remains open; R3 neither fixes nor extends it, and every file R3 adds is confirmed clone-free or properly `jscpd`-ignored.
- Tool schema visibility is not preset-scoped: `get_science_state`/`run_python`/`run_r` register globally once `@deepseek-ai/dsh-tool-science` is composed into any Host tree, visible to every session regardless of `agentPreset`. Only the durable mode/environment binding and the `science:environment` context text are gated on `agentPreset === 'science'`. A later preset slice owns restricting schema visibility itself if that is required.
- Real Python and R Consumer acceptance, Science preset, Client UI, and Desktop remain exactly as recorded in the R0/R1/R2 overlay inventory.
