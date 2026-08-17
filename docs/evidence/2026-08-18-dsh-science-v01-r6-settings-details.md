# DSH Science v0.1 R6 settings and Details closure evidence

English | [中文](2026-08-18-dsh-science-v01-r6-settings-details.zh.md)

Investigated on 2026-08-18 on macOS 26.5.2 (Darwin 25.5.0, arm64), Node v24.14.0, pnpm 11.7.0. Scope authority: [DSH Science v0.1 R6 settings and Details](../../.agents/notes/implemented/feature/2026-08-17-dsh-science-v01-r6-settings-details.md).

## Outcome

R6 closes `SCI-SETTINGS-SIDEBAR` on branch `codex/science-v01-rc7-rebaseline`, final head `e125ce00327e4ffce9cc01f371b9068fd142dfcc`. R6a and R6b were already accepted on the pre-rebaseline tree; R6c's base is the [rc.7 rebaseline](2026-08-17-dsh-science-v01-rc7-rebaseline.md) head `66344a2774feaad7ebd27e80f11e6386d8255317` (itself descended from `24971d5f14c8b9dc692658a0bb1cab599a4ed526`, the accepted post-rebaseline head, through documentation-only R6c planning commits and R6c-0). Four commits carry R6c-0b through the final head on the branch's actual ancestry: `6a994ef4cbca968e15b4ef3d63f0f8e1bb2613e1` (R6c-0b), `ef645eff0e3a1ab7c416202fe0b023a308ab6f8f` (settings card + default Web Runtime row + R4/R5 amendments), `57af4a3702956b15875769bf2f5c774e59d68a74` (header action + Details entry), and `e125ce00327e4ffce9cc01f371b9068fd142dfcc` (assembled browser/snapshot coverage + goldens, plus card chrome on shared primitives). `8558a65d77ab44f522039bf2624af93f241b7efa` is **not** an ancestor of the final head: `git branch --all --contains 8558a65d77` returns no branch, and the reflog records it as `commit (amend)` — `e125ce0032` amended `8558a65d77` in place rather than building on top of it, so both share the same parent `57af4a3702`. That SHA carries no unique evidence: the full Web lane and the keyless snapshot lane below were both rerun directly at the final head. Source-pass gates are green at the final head; the attended pass adds a real-server GIF, two independent real Python/R acceptance runs, and packed Web verification, with one GIF coverage gap disclosed rather than hidden.

## Exact identities

| Subject | Identity |
|---|---|
| R6c base | `66344a2774feaad7ebd27e80f11e6386d8255317` |
| Final head | `e125ce00327e4ffce9cc01f371b9068fd142dfcc` |
| R6c-0b — secret-slot presence on the settings scope | `6a994ef4cbca968e15b4ef3d63f0f8e1bb2613e1` |
| R6c settings card + default Web Runtime row + R4/R5 amendments | `ef645eff0e3a1ab7c416202fe0b023a308ab6f8f` |
| R6c header action + Details entry | `57af4a3702956b15875769bf2f5c774e59d68a74` |
| Superseded pre-amend SHA (no unique evidence) | `8558a65d77ab44f522039bf2624af93f241b7efa` — not an ancestor of the final head (`git branch --all --contains` returns none; reflog: `commit (amend)`); fully superseded by the row below |
| R6c assembled browser/snapshot coverage + goldens + card chrome on shared primitives | `e125ce00327e4ffce9cc01f371b9068fd142dfcc` |
| Earlier accepted line: R6a + R6b (post-rebaseline identity) | `24971d5f14c8b9dc692658a0bb1cab599a4ed526` |
| Earlier accepted line: R6c-0 (path-addressed `setPath`/`unsetPath`) | `76012736a12b3793e2eba2295fde512ad56ddb2d` |
| Real Python prefix | `/opt/miniconda3/envs/qwen` |
| Real R prefix | `/Users/superjj/.conda/envs/dsh-r-acceptance` |
| Isolated DSH home (real acceptance) | `/Users/superjj/ccproj/dshscience-r6-acceptance-dsh-home`, mode `0700`, not under `/tmp` |
| GIF artifact | `.playwright-mcp/r6c-science-settings-card.gif` |

## Verification matrix

| Layer | Command / scope | Result |
|---|---|---|
| Focused `ui-science` | Vitest, `packages/client/ui-science/tests` | PASS — 8 files / 103 tests, per-file coverage 100% statements/branches/functions/lines on every changed src file |
| Focused `ui-settings` scope spec | Vitest, `packages/client/ui-settings/tests/settings-scope.client.spec.ts` at `6a994ef4cb` | PASS — 25 tests |
| Typecheck | `pnpm run typecheck` | PASS — exit 0 |
| Lint | `pnpm run lint` | PASS — exit 0 |
| Documentation | `pnpm run doc-sync` | PASS — 29/29 gates |
| Cordis config | `pnpm run verify-cordis-config` | PASS — 124 config files |
| Package invariants | `pnpm run verify-package-invariants` | PASS — 224 companions |
| Whitespace | `git diff --cached --check` | PASS — clean |
| Web lane, final head | `plugin-config.e2e.ts` | PASS — 9/9 |
| Web lane, final head | `science-chart-outcome.e2e.ts` | PASS — 2/2 |
| Web lane, final head | `science-preset.snapshot.ts` | PASS — 1/1 |
| Full Web lane, final head | `pnpm run test:web` (fresh `build` then `test:web:built`) | 1 file failed / 76 passed / 1 skipped (78 files); 5 tests failed / 262 passed / 7 skipped (274 tests) — all 5 failures in `smoke-real.e2e.ts`, no flake — see Disclosed inherited failures |
| Keyless snapshots, final head | `pnpm run test:snapshot` | 1 file failed / 11 passed (12 files); 2 tests failed / 117 passed / 1 skipped (120 tests) — both failures in `goal.snapshot.ts` — see Disclosed inherited failures |
| Packaged artifacts | `pnpm run check:ci:artifacts` | PASS — 5/5 (build, publint, node-next types, built-package-invariants, built-bin smoke) |
| Packed payload | `@deepseek-ai/dsh-client-ui-science` | PASS — 20 entries, including `lib/client.js` and declarations for all five new modules; no source leakage |
| Real Python/R run 1 | `test:real-acceptance` at `e125ce0032`, isolated home, both prefixes | PASS — `python.status=PASS`, `r.status=PASS`, no `prefixManifestDifferences` |
| Real Python/R run 2 | Same command, same candidate, same prefixes, same home | PASS — `python.status=PASS`, `r.status=PASS`, no `prefixManifestDifferences` |
| GIF | `.playwright-mcp/r6c-science-settings-card.gif` | Recorded — see GIF evidence below for scope and disclosed limitation |

### Explicitly NOT-RUN

Repository-wide `test:coverage` (scoped per-file coverage verified instead in the table above); `release:verify-packed-install` and packed installers (need registry access this environment cannot reach at ~18 KB/s); Desktop, signing, notarization, Authenticode, npm publication, Git tag, GitHub release, Git push, PR creation; Windows and Linux platform lanes (CI owns the matrix).

## GIF evidence

`.playwright-mcp/r6c-science-settings-card.gif` — 1200×750, 10.2 s, 168413 bytes, 4 source frames. Recorded at the final head from a real server booted off the built tree (`apps/cli/lib/bin.js --profile web --port 3099`) with a fresh `DSH_HOME`/`DSH_AGENTS_HOME`/workspace and the **default** Web composition (no overlay), driven by headless Chromium via the repository-declared Playwright 1.61.1, with zero page errors. It demonstrates the settings card end to end: collapsed among its siblings, expanded/unconfigured, both prefixes typed, saved with both fields reading "Configured", inputs empty on reload (no echo of a stored path), and restart-required. The Host settings document received exactly the two-segment write this evidence's Verification matrix and the implemented Note both name (`science-runtime:\n  science:\n    pythonPrefix: …\n    rPrefix: …`).

**Disclosed limitation.** This GIF contains no real model round and does not show the session-header action or the Details entry. The composer that would produce a real model round is gated behind workspace selection, whose shipped `directory-picker-auto` row resolves to the native macOS folder dialog on a machine with a display — undrivable headlessly, and the `-browse` variant changes the tested entry points rather than driving the shipped ones. The header action and Details entry are instead covered in a real browser by `science-chart-outcome.e2e.ts` (2/2, in the Verification matrix above). The GUI-change rule's real-model-round GIF requirement for those two surfaces remains owed to a future pass. This blocker is distinct from `smoke-real.e2e.ts`'s onboarding-notice interception below: this recording's own script dismisses the welcome notice before touching the workspace picker, and its probe confirmed the notice was absent at that point, so the notice never entered the picture here — the native folder dialog is the sole cause of this GIF's gap.

## Disclosed inherited failures

Recorded as FAIL/inherited, never as PASS:

| Check | Signature | Attribution |
|---|---|---|
| `rescope-vendor:check` | 26 problems | Identical to the same check at upstream rc.7; pre-existing, not introduced by this range |
| `verify-client-domain-graph` | 34 findings | All in `ui-input-trigger`/`ui-workspace`; zero changed files of this range appear. Lives in the `check-all` group, not `doc-sync` |
| `examples/acp-agent/tests/goal.snapshot.ts` | `expect(result.stderr).toBe('')` receives Node v24.14.0's `ExperimentalWarning: SQLite is an experimental feature` | The test is unchanged since the rc.5 merge-base `47f943859b`, and the only `examples/acp-agent/cordis.yml` change across the whole range is comment-only, so the cause is environmental (Node's own experimental-feature warning), not a product regression |
| `apps/web/tests/smoke-real.e2e.ts` | Playwright resolves `getByRole('textbox', { name: 'Choose workspace' })` to the composer's readonly `<textarea aria-haspopup="menu" data-phase="inert">`; the click on it is swallowed by `<div class="BdGIFa_copy">` (the onboarding surface's welcome-notice copy block) inside `<div role="presentation">` | `packages/client/ui-primitives/src/OnboardingSurface.tsx` and its `.module.css` are byte-identical to the rc.5 merge-base `47f943859b`, so the surface is inherited, not introduced by R6. The test itself contains no dismissal of the welcome notice anywhere (`Continue`/`notice` do not appear in it) and its scaffold starts from a fresh Harness home every run, so the notice is always up when the test clicks. **Remedy owed to its own change, deliberately not folded into R6**: the test must dismiss the welcome notice before touching the workspace picker, exactly as this closure's own GIF script does; R6 does not fix it because it is an inherited rc.5-line test defect belonging to its own candidate with its own evidence |
| `subagent-interrupt-ui.e2e.ts` | One single-test flake, observed once during the pre-amend evidence pass | Non-reproducible then: passed standalone and in the other full run at that time. Did not recur when the full lane reran at the final head |
| `background-job-list.e2e.ts` | One single-test flake, observed once during the pre-amend evidence pass | Non-reproducible then: passed standalone and in the other full run at that time. Did not recur when the full lane reran at the final head |

### Base-comparison attribution

The rebaseline's deferred base-comparison item is closed at the source-attribution level rather than by execution: a detached base worktree at the rc.5 merge-base was not run because 276 lockfile insertions separate `47f943859b` from the final head, so a same-tree checkout would run rc.5 source code against rc.7-resolved dependencies — not a valid comparison — and this environment's registry access (~18 KB/s) cannot install a genuinely separate base tree in bounded time. `goal.snapshot.ts` is instead attributed by file-identity argument: the exact touched file is unchanged since the rc.5 merge-base with no R6-range edit reaching it. `smoke-real.e2e.ts` is attributed by a combined file-identity and interaction-mechanism argument: `OnboardingSurface.tsx` and its stylesheet are byte-identical to the rc.5 merge-base, and the failing interaction — an undismissed welcome notice swallowing a click meant for the workspace picker — traces to the test's own absent dismissal step, which no R6-range edit touches. Both are the strongest attribution this environment can produce without a runnable comparison tree.

## Review

Every disclosed failure above traces to one of three causes unrelated to this range: a pre-existing signature already confirmed set-identical to upstream rc.7 (`rescope-vendor:check`), a file-identity or interaction-mechanism argument tracing the exact cause to the rc.5 line with zero R6-range edits reaching it (`goal.snapshot.ts`, `smoke-real.e2e.ts`), or a single-test flake observed once during the pre-amend evidence pass that did not reproduce standalone or in a second full run at that time, and did not recur when the full lane reran at the final head (`subagent-interrupt-ui.e2e.ts`, `background-job-list.e2e.ts`). `verify-client-domain-graph`'s 34 findings sit entirely outside every file this range touches. No fixture was hand-edited and no expectation was loosened to reach a clean run.

The six corrections the R6 implemented Note makes to the proposed note's plan — the write-path coordinates, the R6c-0b checkpoint, card chrome ownership, Details-entry thumbnail loading, Runtime row-id ownership, and the R4/R5 cross-link retargeting — are each independently confirmed against the shipped source in this pass: `packages/science/science-runtime/src/settings.ts`'s `base: config.profiles`, `packages/settings/settings/src/redact.ts`'s section-root-rooted walk, `packages/client/ui-science/src/client/ScienceSettingsCard.tsx`'s primitives-based chrome and hand-rolled disclosure header, `packages/client/ui-science/src/client/science-attachment-loader.ts`'s `ISession.readAttachment`-based stateless loader, and `vendor/include/src/index.ts`'s `applyEntryPatches` name-mismatch skip.

## Overlay inventory update

| `delta_id` | Prior status | R6 status |
|---|---|---|
| `SCI-SETTINGS-SIDEBAR` | `deferred` | `verified` at `e125ce00327e4ffce9cc01f371b9068fd142dfcc` |
| Remaining overlay rows | as recorded in the [rc.7 rebaseline evidence](2026-08-17-dsh-science-v01-rc7-rebaseline.md) | unchanged |

## Protected-state preservation

No worktree outside `/Users/superjj/ccproj/DSHscience` (branch `codex/science-v01-rc7-rebaseline`) was staged, cleaned, reset, checked out, or repointed. The isolated real-acceptance DSH home (`/Users/superjj/ccproj/dshscience-r6-acceptance-dsh-home`) is a fresh mode-`0700` directory outside `/tmp`, used only by the two real Python/R acceptance runs. No push, tag, PR, publish, or release action was performed.

## Risks, unknowns, and deferred product decisions

- The session-header action and the Details entry carry no real-model-round GIF; `science-chart-outcome.e2e.ts` covers their behavior in a real browser instead, and the GIF gap is owed to a future pass, not silently closed.
- `apps/web/tests/smoke-real.e2e.ts`'s onboarding-notice interception is an inherited rc.5-line test defect: the test dismisses no welcome notice anywhere and its scaffold starts from a fresh Harness home every run. Its remedy is deliberately not folded into R6 and is owed to its own change with its own evidence.
- `rescope-vendor:check`'s 26-problem gap and `verify-client-domain-graph`'s 34 findings remain open and unrelated to this range; neither is R6's to fix.
- Real Python/R acceptance proves the configured interpreters and Runtime lifecycle, not plotting-library availability, scientific correctness, Desktop packaging, installer behavior, signing, notarization, or release readiness.
- Desktop, packed installers, signing, notarization, publication, tag, push, and PR creation carry no R6 evidence and remain `NOT-RUN`.

## Independent review follow-up

Independent review of this checkpoint at head `8c7ad720a8ba25949343af82cad340c8b56e5b31` (the head that closed the Verification matrix above) found a correctness defect in `ScienceSettingsCardController.save()` (`packages/client/ui-science/src/client/settings-card-controller.ts`): a save with two dirty fields judged landing as one all-or-nothing boolean across two independent `setPath` calls, so a Host that accepted one field's write and rejected the other left the accepted field's already-landed draft still staged, reported `restartRequired: false` despite a durable accepted change, and rendered `settings.saveFailed` copy claiming neither value was accepted. The fix — committed immediately after that head on `codex/science-v01-rc7-rebaseline` — tracks landing per field: only a landed field's staged draft clears, `restartRequired` is set when any field lands, `failed` is set when any field does not land, and the two are now allowed to be true together; the `settings.saveFailed` copy (English and Chinese) no longer claims every changed value was rejected.

| Layer | Command / scope | Result |
|---|---|---|
| Focused `ui-science` | `pnpm exec vitest run packages/client/ui-science` | PASS — 8 files / 106 tests |
| Scoped per-file coverage | `pnpm exec vitest run packages/client/ui-science/tests --coverage --coverage.include='packages/client/ui-science/src/**/*.ts' --coverage.include='packages/client/ui-science/src/**/*.tsx'` | PASS — 8 files / 106 tests; 100% statements/branches/functions/lines |
| Typecheck | `pnpm run typecheck` | PASS — exit 0 |
| Lint | `pnpm run lint` | PASS — exit 0 |
| Documentation | `pnpm run doc-sync` | PASS — 29/29 gates |
| Whitespace | `git diff --cached --check` | PASS — clean |
| Web lane, fix commit | `npx vitest run --config vitest.web.config.ts apps/web/tests/plugin-config.e2e.ts` (after `pnpm run build`) | PASS — 1 file / 9 tests |

The ARIA golden `apps/web/tests/snapshots/plugin-config/section.expected.md` needed no refresh: it captures the Science card collapsed after a listing pass, never the `settings.saveFailed` text, and `plugin-config.e2e.ts` asserts no other string this fix changed. Not run for this follow-up, matching the reviewing task's scope: the full `test:web` and `test:snapshot` lanes, `test:e2e`, real Conda acceptance, and `pnpm install`.
