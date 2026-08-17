# DSH Science v0.1 rc.5→rc.7 rebaseline evidence

English | [中文](2026-08-17-dsh-science-v01-rc7-rebaseline.zh.md)

Investigated on 2026-08-17 on macOS 26.5.2 (Darwin 25.5.0, arm64), Node v24.14.0, pnpm 11.7.0. Scope authority: [DSH Science v0.1 rc.7 rebaseline](../../.agents/notes/proposed/process/2026-08-17-dsh-science-v01-rc7-rebaseline.md).

## Outcome

The DSH Science line, previously fixed on official rc.5 (`47f943859bef60e4160492346772ded9b24f765a`) since [R0](../../.agents/notes/archived/process/2026-08-15-dsh-science-v01-r0-release-baseline-scope.md), merges official rc.7 (`99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`, tag `dsh-v0.1.0-rc.7`) on branch `codex/science-v01-rc7-rebaseline`. The merge-base is exactly the rc.5 tag; upstream contributed 111 commits over it, the Science line 48. The merge resolved two mechanical conflicts and required no source repair: every generated artifact both sides touch matched its regenerated output with zero diff, and every check that failed at the merge commit is either a pre-existing failure confirmed set-identical to the rc.5 base, a documented pre-existing environment issue already recorded in the [R5 evidence](2026-08-17-dsh-science-v01-r5-charts-outcome.md), or a load-sensitive flake confirmed non-reproducing in isolation. A separate documentation-only commit proposes the rebaseline's Agent Note, rewrites the proposed R6 note's R6c settings-surface plan to the mechanism rc.7 opened, and corrects two now-false present-tense claims in the R1/R2 implemented notes.

## Exact identities

| Subject | Identity |
|---|---|
| Prior line base (R0) | `deepseek-ai/deepseek-harness@47f943859bef60e4160492346772ded9b24f765a`, tag `dsh-v0.1.0-rc.5` |
| New upstream head | `deepseek-ai/deepseek-harness@99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`, tag `dsh-v0.1.0-rc.7` |
| Merge-base | `47f943859bef60e4160492346772ded9b24f765a` (confirmed via `git merge-base`, identical to the R0 tag) |
| Pre-rebaseline Science tip | `bb911b9c0c` on `codex/science-v01-r3-science-tools-plan` |
| Merge commit (Phase 1 head) | `ecde1b09ff1efee2a68e199025aa37414426331b` |
| Documentation commit (Phase 2 head) | `5c64af5339256c0365b9868d189cd64979cc409b` |
| Rebaselined branch | `codex/science-v01-rc7-rebaseline` (not pushed) |
| Version bumps | `packages/science/science-runtime`, `packages/science/science-session`, `packages/science/tool-science`, `packages/client/ui-science`, `packages/session/session-attachment-index`: `0.1.0-rc.5` → `0.1.0-rc.7` |
| Downstream source | None; this is a source-only merge of two already-published trees, not a port |

## Conflict resolutions

| File | Resolution |
|---|---|
| `packages/host/apiproxy/src/api-proxy.ts` | Kept the Science line's move of `referencedImage`/`imageInEvent`/`imageBlockIn` into `@deepseek-ai/dsh-session-attachment-index` and upstream's deletion of `WEB_SETTINGS_NAMESPACES`/`PRODUCT_SETTINGS_NAMESPACES`/`settings-not-exposed`. Dropped the now-unused `SETTINGS_NAMESPACE as AGENT_PRESET_SETTINGS_NAMESPACE` import; kept `PresetNotCopyableError` |
| `scripts/doc-budgets.manifest.json` | Kept `".agents/AGENTS.md": 160` and took upstream's `"AGENTS.md": 1950` |

## Verification matrix

| Layer | Command | Result |
|---|---|---|
| Generated artifacts | `pnpm run gen-cordis-catalog`, `gen-cordis-api`, `gen-client-catalog`, `gen-tool-catalog`, `gen-config-catalog`, `gen-persistence-catalog`, `gen-module-graph`, `gen-third-party-notices`, then `git status --short` / `git diff --stat` | PASS — every generator ran; zero-byte diff against the merge commit for all eight |
| Typecheck | `pnpm run typecheck` | PASS — exit 0 (`build:lib:host` + `tsc -b tsconfig.client.json`) |
| Lint | `pnpm run lint` | PASS — exit 0 (`build:lib:host` + `oxlint`) |
| Build | `pnpm run build` | PASS — exit 0 |
| Hygiene | `pnpm run hygiene` | **FAIL at `rescope-vendor:check` only, pre-existing.** The remaining 11 sub-checks (`knip`, `publint`, `constraints`, `verify-dsh-package-licenses`, `verify-package-invariants`, `verify-built-package-invariants`, `verify-cordis-config`, `verify-node-next-types`, `verify-optional-dependency-imports`, `verify-runtime-closure`, `verify-vendored-links`) each PASS run individually |
| `rescope-vendor:check` set-identity | `tsx scripts/rescope-vendor.ts --check` at the merge commit and at a disposable detached worktree on the rc.5 merge-base | Both report 26 problems; `diff` of the two sorted residue lists is empty — set-identical, confirming the failure is pre-existing and not introduced by the rebaseline (matches the [R5 evidence](2026-08-17-dsh-science-v01-r5-charts-outcome.md)'s prior confirmation of the same 26 problems) |
| Documentation | `pnpm run doc-sync` (run once on the merge commit, once on the documentation commit after Phase 2 edits) | PASS both times — 29/29 gates, including doc budgets, translation pairing (967 pairs corpus-wide on the final head), module graph, agent-note format/classification |
| Repository unit suite | `pnpm run test` | 3 failed / 13882 passed / 109 skipped (13994) at first run — `packages/hooks/hooks-claude-code/tests/bridge.spec.ts`, `packages/hooks/hooks-claude-code/tests/coverage-edge-paths.spec.ts`, `packages/shell/bash-sandbox/tests/partial-landlock.spec.ts`, all `Test timed out in 5000ms` under full-suite parallel load. Rerun of exactly those 3 files in isolation: 43/43 passed, 0 failures — confirmed load-sensitive, not a regression |
| Keyless snapshots | `pnpm run test:snapshot` | 2 failed / 117 passed / 1 skipped (120) — both failures in `examples/acp-agent/tests/goal.snapshot.ts`, asserting empty stderr while Node 24.14.0 emits an unrelated `node:sqlite` experimental-feature warning; this exact file/cause is already recorded as a pre-existing local-only issue in the [R5 evidence](2026-08-17-dsh-science-v01-r5-charts-outcome.md)'s Risks section |
| Web browser lane | `pnpm run test:web` | 8 failed / 255 passed / 7 skipped (270) at first run. 5 failures in `apps/web/tests/smoke-real.e2e.ts`: identical failure signature to the [R5 evidence](2026-08-17-dsh-science-v01-r5-charts-outcome.md)'s documented pre-existing issue (`<div class="BdGIFa_copy">` onboarding-notice overlay intercepts pointer events on the workspace picker in a fresh `DSH_HOME`). 3 failures in `apps/web/tests/subagent-interrupt-ui.e2e.ts` (2 tests) and `apps/web/tests/background-job-list.e2e.ts` (1 test), all golden/timing mismatches. Rerun of exactly those 2 files in isolation: 6/6 passed, 0 failures — confirmed load-sensitive, not a regression |
| Whitespace | `git diff --check 47f943859b...HEAD` (both the merge commit and the final documentation commit) | PASS — exit 0, no output, both times |
| Real-API e2e | `pnpm run test:e2e` | `NOT-RUN` — no root `.env`, no `DEEPSEEK_API_KEY` in this environment; the suite self-skips without a key by design, so this is a keyless-environment limitation, not a failure |
| Real Python/R Science acceptance | none | `NOT-RUN` — no isolated Conda acceptance environment was set up for this pass; not claimed |
| Desktop, provider, and release | none | `NOT-RUN` — the rebaseline creates no carrier, installer, signature, publication, tag, or release artifact |

### Explicitly NOT-RUN

`test:e2e` (no key), real Python/R Conda acceptance, `test:coverage` (not the requested check for this pass; `test` is), Windows and Linux platform lanes (CI owns the matrix), Desktop and packed installers, signing, notarization, Authenticode, npm publication, Git tag, GitHub release, Git push, and PR creation.

## Review

The merge itself required no source repair. Both conflicts were mechanical (independent edits to the same file/manifest; both sides' changes kept in full), and all eight generators the merge could plausibly have left stale reproduced byte-identical output against the committed tree, so no regeneration commit was needed.

Every test failure observed at the merge commit traces to one of three causes unrelated to the rebaseline: a pre-existing issue already named in the R5 evidence with the identical file and symptom (`rescope-vendor:check`'s 26 problems, `goal.snapshot.ts`'s Node 24.14 SQLite warning, `smoke-real.e2e.ts`'s onboarding-dialog pointer interception), or a timing-sensitive test that failed only under the back-to-back full-suite load this verification pass created and passed cleanly the moment it ran alone (`bridge.spec.ts`, `coverage-edge-paths.spec.ts`, `partial-landlock.spec.ts`, `subagent-interrupt-ui.e2e.ts`, `background-job-list.e2e.ts`). No test needed a hand-edited expectation and no fixture was re-recorded.

Upstream's rc.5→rc.7 changes to `packages/settings` and `packages/client/ui-conversation` were diffed directly (`git diff 47f9438...upstream/master -- packages/settings packages/client/ui-conversation`) before relying on them: the settings seam's read/write API and `ui-conversation`'s Details column are untouched by rc.7 (rc.7 only adds Safari `InputBar` handling), confirming rather than assuming that the pre-rebaseline R6a/R6b commits (`f5bbcf0ff2`, `bb911b9c0c`) needed no adaptation.

## Overlay inventory update

| `delta_id` | Prior status | rc.7 rebaseline status |
|---|---|---|
| `SCI-SETTINGS-SIDEBAR` | `deferred` | unchanged: `deferred` — this pass is a source rebaseline only; R6c is explicitly out of scope |
| Remaining overlay rows | as recorded in the [R5 closure evidence](2026-08-17-dsh-science-v01-r5-charts-outcome.md) | unchanged |

## Protected-state preservation

No worktree outside `/Users/superjj/ccproj/DSHscience` (branch `codex/science-v01-rc7-rebaseline`) was staged, cleaned, reset, checked out, or repointed. One disposable detached worktree at the rc.5 merge-base was created under the session scratch directory solely to confirm `rescope-vendor:check`'s set-identity, symlinked to the main worktree's `node_modules` (read-only use), and removed (`git worktree remove --force`) immediately after. No push, tag, PR, publish, release, or Conda environment mutation was performed.

## Risks, unknowns, and deferred product decisions

- This evidence covers the source rebaseline only. R6a and R6b now sit on a different tree than when their commits (`f5bbcf0ff2`, `bb911b9c0c`) first landed; a future acceptance pass for either checkpoint must review them against this rebaseline's head, not their pre-rebaseline SHAs, per the [rebaseline note](../../.agents/notes/proposed/process/2026-08-17-dsh-science-v01-rc7-rebaseline.md)'s Risks section.
- `rescope-vendor:check`'s pre-existing 26-problem gap remains open and unrelated to this pass.
- `examples/acp-agent/tests/goal.snapshot.ts` and `apps/web/tests/smoke-real.e2e.ts` remain red locally for the same pre-existing, already-documented reasons; neither self-skips in this environment the way `test:e2e` does.
- Real Python/R Conda acceptance and every Desktop/release layer are not exercised by this rebaseline; they carry no rc.7 evidence and must not be read as extended from R2's or R5's rc.5 acceptance runs.
- R6c (Science settings card, header action, Details entry, default Web Runtime row) is not implemented by this pass, per its explicit out-of-scope instruction.
