# DSH Science v0.1 R1 Science Session closure evidence

English | [中文](2026-08-15-dsh-science-v01-r1-science-session.zh.md)

Investigated on 2026-08-15 on macOS 26.5.2 (Darwin 25.5.0, arm64), Node v24.14.0, pnpm 11.7.0. Scope authority: [DSH Science v0.1 R1 Science Session on RC5](../../.agents/notes/implemented/feature/2026-08-15-dsh-science-v01-r1-science-session.md).

## Outcome

R1 is accepted at `741ec08af3163475f55ffda3fb6188a801e3ff1a` on branch `codex/science-v01-r1-science-session`, two commits above the accepted R1 plan base `8880834c06b64ae91d5d750ea7d7e8b6d4f9c910`, which itself descends directly from the accepted R0B closure `f9bb7b4a91afe1cf69568184ff093fa9a8bd52f9` with only documentation/governance paths between them. `git merge-base --is-ancestor 47f943859bef60e4160492346772ded9b24f765a HEAD` and `git merge-base --is-ancestor f9bb7b4a91afe1cf69568184ff093fa9a8bd52f9 HEAD` both succeed. The worktree is clean.

## Exact identities

| Subject | Identity |
|---|---|
| R1 plan base | `8880834c06b64ae91d5d750ea7d7e8b6d4f9c910` (archives the R0 scope record, adds the R1 scope note) |
| R1 candidate head | `741ec08af3163475f55ffda3fb6188a801e3ff1a`, tree `59d1554ca8b6384215c7c5590a22c26bfc2b3ecb` |
| Commit 1 | `eb55f54138` — adds optional `checkpointStateSchema`, `checkpointStateSeq`, `viewChanged` to RC5's `ProjectionDefinition` in `packages/session/session-projection/src/index.ts` |
| Commit 2 | `741ec08af3` — ports `packages/science/science-session` onto RC5; fixes a watermark-admission gap in commit 1 caught by this package's own ported tests |
| Science source snapshot | `omdsh-dev/dsh-science@e5e8b29b435f67e0a5dde5e2132580966e78b27b`, `packages/science/science-session/**` |
| Official RC5 | `deepseek-ai/deepseek-harness@47f943859bef60e4160492346772ded9b24f765a`, unchanged; no product/package/lockfile path outside the one new package's own manifest and the mechanical integration rows below |

## Verification matrix

| Layer | Command | Result |
|---|---|---|
| Scope and ancestry | `git merge-base --is-ancestor <R0B> HEAD`; `git merge-base --is-ancestor <RC5> HEAD`; `pnpm run change-scope --base 8880834c06 --head HEAD` | PASS — both ancestries hold; every changed path traces to the scope note's Expected Impact table or an owning generator (full inventory in the commit message) |
| Science and registry behavior | `pnpm exec vitest run packages/science/science-session/tests packages/session/session-projection/tests` | PASS — 70/70 (27 session-projection + 43 science-session) |
| Focused per-file coverage | `pnpm exec vitest run --coverage --coverage.include='packages/science/science-session/src/**' --coverage.include='packages/session/session-projection/src/**' packages/science/science-session/tests packages/session/session-projection/tests` | PASS — 100% statements (546/546), branches (488/488), functions (122/122), lines (469/469) |
| Existing durability consumers | `pnpm exec vitest run packages/session/session-projection-cache/tests packages/session/session-persistence-jsonl/tests packages/session/session-persistence-sqlite/tests packages/session-query/session-query/tests packages/session-query/session-query-sqlite/tests` | PASS — 497/497, no regression |
| Static and package checks | `pnpm run typecheck`; `pnpm run check:ci:artifacts` | PASS — typecheck exit 0; check:ci:artifacts 5/5 (build, publint, node-next-types, built-package-invariants, built-bin smoke) |
| Hygiene (individual sub-checks) | `knip`, `constraints`, `verify-dsh-package-licenses`, `verify-package-invariants`, `verify-cordis-config`, `verify-node-next-types`, `verify-runtime-closure`, `verify-vendored-links` | PASS, each run individually |
| Hygiene (`rescope-vendor:check`) | `pnpm run rescope-vendor:check` | **FAIL — pre-existing, confirmed unrelated.** Identical 26-problem list reproduces on the unmodified plan-base tree (`git stash` before rerunning), across `packages/extensions/*`, `docs/subsystems/extensions.*`, and other paths this change never touches. `hygiene`'s compound script short-circuits on this first sub-check via `&&`, so every subsequent sub-check was run individually above to get real signal |
| Documentation | `pnpm run doc-sync`; `pnpm run lint` | PASS — doc-sync 28/28 gates; lint exit 0 |
| Exact candidate review | Fresh `sonnet` review at `741ec08af3163475f55ffda3fb6188a801e3ff1a`, given the scope note, exact diff, and independent-rerun instructions | PASS — independently reran the test, coverage, regression, typecheck, doc-sync, hygiene, and rescope-vendor commands and reproduced their recorded outcomes; blob-hash comparison confirmed the 17 copied source and 11 test files; manual tracing found no defect in watermark admission. An exact detached checkout was required because the source worktree held an untracked incomplete copy of this evidence record, which did not affect `741ec08af3`. The review also identified the RC5-derived `tsconfig.json` references as the second adaptation recorded below. The source line-count correction follows this table |

### Correction

The exact-candidate review confirmed the command results and blob identities but did not correctly re-derive the source line total. The corrected tree inventory below supersedes only that count; the candidate SHA, byte-identity result, adaptations, and verification outcomes are unchanged.

### Explicitly NOT-RUN

Real provider/model calls, key-required e2e or snapshot recording, real Python/R, browser or Desktop acceptance, packed installer, signing, publication, and release are `NOT-RUN` for R1: this slice adds no model-facing Consumer and no assembled Science composition, so none of those layers apply yet.

## Domain port provenance

Correction to the original record: the tree contains 18 `packages/science/science-session/src/*.ts` files (2098 lines). Excluding the adapted `src/index.ts` leaves 17 source files (2032 lines) that are byte-identical to `omdsh-dev/dsh-science@e5e8b29`; all 11 `tests/*.ts` files (2683 lines) are also byte-identical, for 4715 byte-identical lines and 4781 source-plus-test lines overall. None of the 17 copied source files or 11 tests reference the downstream session-projection refactor's excluded concerns (`definitionToken`, owner-aware HMR takeover, callback containment, prototype-key hardening, the file split, or persistence/query/lifecycle changes). Two adaptations exist outside those 17+11 identical files: `src/index.ts` drops the `definitionToken` field from `ctx.sessionProjections.register(...)`, because RC5's simpler `ProjectionDefinition` does not declare it; and `tsconfig.json` uses RC5-derived TypeScript project `references`, dropping `vendor/cosmokit` and pointing at RC5's package layout. `package.json` and both READMEs were rewritten from RC5 sibling templates, not copied.

`packages/session/session-projection/src/index.ts` was extended, not replaced: RC5's existing single-file `SessionProjectionRegistry` (428 lines: `register`, `onChanged`, `snapshot`, `checkpoint`, `restoreFloor`, `viewCheckpoint`, `restore`, `drive`) gained three optional `ProjectionDefinition` members and their application at exactly the five integration points the R1 scope note names (checkpoint creation, zero-I/O checkpoint view, restore-floor selection, cold restore, live notification) — re-derived against RC5's own code and conventions, not copied from the downstream's split-file, HMR-aware, six-file registry implementation.

## Overlay inventory update

| `delta_id` | Prior status | R1 status |
|---|---|---|
| `GEN-SESSION-REGISTRY` | `mapping` in R1 only | `verified` — `checkpointStateSchema`, `checkpointStateSeq`, `viewChanged` added and covered; no other downstream registry capability ported |
| `SCI-SESSION` | `not-started`; sole R1 product slice | `verified` — ported and covered at `741ec08af3163475f55ffda3fb6188a801e3ff1a`; every other overlay row (`GEN-RUNTIME-CONTEXT`, `SCI-RUNTIME`, `SCI-R-PROBE`, `FS-READONLY`, `FS-READONLY-LOAD-FIX`, `SCI-TOOLS`, `SCI-PRESET`, `SCI-CHARTS-OUTCOME`, `SCI-SETTINGS-SIDEBAR`, `DESKTOP-CARRIER`) remains exactly as recorded in the [R0 closure evidence](2026-08-15-dsh-science-v01-r0-rc5-baseline-closure.md); none was touched by R1 |

## Protected-state preservation

Every pre-existing worktree and ref this task was forbidden from touching was re-recorded identical to its entry snapshot after `741ec08af3` landed: `main` (`e5e8b29b435f67e0a5dde5e2132580966e78b27b`, clean), `origin/main`, the dirty governance worktree, the R-probe branch, the Phase 3 candidate, the two other detached task worktrees, the dirty Grok worktree, `codex/science-v01-r0a-governance-closure` (`73c0e9c004`, clean), `codex/science-v01-rc5-baseline` (`f9bb7b4a91af`, clean), and the R1 plan worktree (`8880834c06`, clean). No protected worktree was staged, cleaned, reset, checked out, or repointed. No push, tag, PR, or publish occurred.

## Risks, unknowns, and deferred product decisions

- The `packages/extensions/tool-cordis/src/api-catalog.ts` change is a mechanical `gen-cordis-catalog` regeneration reflecting the new `ProjectionDefinition` shape in the Cordis catalog; it is not a hand-authored change and was not separately reviewed line-by-line beyond confirming it is generator output.
- `rescope-vendor:check`'s pre-existing 26-problem gap remains open; R1 neither fixes nor extends it and takes no position on when it should be addressed.
- Science Runtime, tools, preset, charts/Outcome, settings/sidebar, Client UI, and Desktop remain exactly as recorded in the R0 closure overlay inventory — `not-started` or `deferred`, unaffected by R1.
