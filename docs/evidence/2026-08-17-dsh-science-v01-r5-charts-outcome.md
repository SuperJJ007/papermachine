# DSH Science v0.1 R5 charts and Outcome closure evidence

English | [中文](2026-08-17-dsh-science-v01-r5-charts-outcome.zh.md)

Investigated on 2026-08-17 on macOS 26.5.2 (Darwin 25.5.0, arm64), Node v24.14.0, pnpm 11.7.0. Scope authority: [DSH Science v0.1 R5 charts and Outcome](../../.agents/notes/implemented/feature/2026-08-16-dsh-science-v01-r5-charts-outcome.md).

## Outcome

R5 product work is accepted at `69045ba510f90380f5ed83ca1acbd955e7178fbf` on branch `codex/science-v01-r3-science-tools-plan`, eight linear commits above the accepted R4 closure head `fb04b0d273a6d4d3a319a4e8243c44953010f930`. The Science preset now exposes five model-facing tools, a committed `science/chart-saved` event alone authorizes its own attachment for reads and export, and the shipped Web composition replays chart and Outcome rows from durable data.

The plan required three independently accepted checkpoint heads (registry, producers, presentation). The implementation landed as one ordered eight-commit series in that dependency order, and every gate below ran on the final combined candidate rather than on three separately accepted heads. That deviation is recorded in the Note and is the one acceptance criterion R5 does not satisfy as written.

Closure repaired two defects the implementation had left open and two stale guarantees earlier rounds introduced. The runnable keyless Science example no longer activated at all, because the Runtime now waits for `attachments`, and it covered none of the new tools; `c6dae9e585` mounts an attachment store in that composition and extends the scripted model through two chart versions and one Outcome. The `knip` failure R4 recorded as pre-existing is fixed rather than carried. The repository unit suite — `NOT-RUN` for R2-R4 — exposed that R4's fail-closed preset metadata made every in-process subagent preset-inheritance case fail to mount, and that the tool-catalog harvest guarantee still listed the roster from before `tool-science` joined it; `305462f43f` and `69045ba510` repair both.

## Exact identities

| Subject | Identity |
|---|---|
| Official RC5 | `deepseek-ai/deepseek-harness@47f943859bef60e4160492346772ded9b24f765a` |
| Accepted R4 closure head (R5 base) | `fb04b0d273a6d4d3a319a4e8243c44953010f930` |
| Commit 1 | `a9a03fcdf2f2259b8de8ad6476f389800f10b839` — `@deepseek-ai/dsh-session-attachment-index` and the two ApiProxy call sites |
| Commit 2 | `ecee9b8127c252eb27edaa1f86d7f4ebfb458cef` — Runtime chart commit, `save_chart`, `publish_outcome`, shared nested-dispatch guard, sanitized chart state, Science extractor |
| Commit 3 | `161d176a313f15ee9a93c663d286111bdd2dda71` — `@deepseek-ai/dsh-client-ui-science` and the generic `loadImage` toolview wiring |
| Commit 4 | `731d3e03c97657728e7551f391da42b366fad38a` — five-tool Science preset and the shipped Web bundle rows |
| Commit 5 | `c6dae9e585fcd2e0224a2d9a912cdf65c4139465` — assembled keyless source scenario, Web preset scenario, browser fixture replay |
| Commit 6 | `174d6b20e82cbc723772b89bf13950c04e908d15` — subsystem, catalog, and package documentation |
| Commit 7 | `305462f43f15854246aef834c6f79c040aa43c63` — shipped metadata for the in-process subagent driver preset fixtures |
| Commit 8 | `69045ba510f90380f5ed83ca1acbd955e7178fbf` — the Science tools in the tool-catalog harvest guarantee |
| R5 product candidate | `69045ba510f90380f5ed83ca1acbd955e7178fbf` |
| Clean acceptance archive | `git archive` of the candidate into `/Users/superjj/ccproj/dshscience-r5-acceptance-archive`, installed with `pnpm install --frozen-lockfile --prefer-offline --ignore-scripts` |
| Isolated DSH homes | `/Users/superjj/ccproj/dshscience-r5-acceptance-dsh-home` and `…-dsh-home-2`, mode `0700`, not under `/tmp` |
| Real Python prefix | `/opt/miniconda3/envs/qwen` (existing Conda, `conda-meta/history`, in-prefix Python 3.13.5) |
| Real R prefix | `/Users/superjj/.conda/envs/dsh-r-acceptance` (existing Conda, `conda-meta/history`, in-prefix Rscript) |
| Downstream source | None; R5 is original RC5-line work with no downstream port or cherry-pick |

## Verification matrix

| Layer | Command | Result |
|---|---|---|
| Scope and ancestry | `git diff --check fb04b0d273..HEAD`; `CI=true pnpm --silent run change-scope --base fb04b0d273 --head HEAD` | PASS — whitespace exit 0; every changed path maps to an R5 Note row, its owning generator, or the disclosed fixture repair |
| Affected package units | `pnpm exec vitest run packages/science packages/session/session-attachment-index packages/host/apiproxy packages/client/ui-science packages/client/ui-tool` | PASS — 896 passed, 62 files; covers Science fold/projection/invariants, Runtime chart lifecycle and filesystem races, Consumer guards and evidence validation, registry authorization/export, and Client rows |
| Repository unit suite and coverage gate | `pnpm run test:coverage` | PASS at the candidate — 13 761 passed / 109 skipped over 842 files, per-file 100% thresholds met, exit 0. The pre-repair run of the same command failed 7 tests across `preset-inheritance.spec.ts` and `gen-tool-catalog.spec.ts`, plus one load-dependent file-watch timeout in `packages/boot/app-boot/tests/hmr-config.spec.ts` that passes in isolation and in the final run |
| Keyless source snapshots | `pnpm exec vitest run --config vitest.snapshot.config.ts` | PASS for every Science scenario — the re-recorded `science-tools` model view pins all five tool schemas and the guidance section, and its stream pins `science/chart-saved` before each `tool/result`, two contiguous versions, one Outcome, tagged presentation metadata, and no image bytes |
| Web browser lane | `pnpm exec vitest run --config vitest.web.config.ts` | PASS for all keyless files — 258 passed / 7 skipped over 76 files, including the shipped-composition chart/Outcome fixture replay (stored and missing objects, lightbox focus and Escape restoration, reload replay, both Outcome revisions) and the five-tool Web preset scenario driving run, two saves, publication, and sanitized state |
| Web real-key smoke | `pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/smoke-real.e2e.ts` | **FAIL — pre-existing, unrelated.** Its keyless CLI cases pass; the real-key cases cannot reach the composer because the onboarding notice dialog introduced by `9ee5aef98c` intercepts pointer events in a fresh `DSH_HOME`, and `b70a549714` had already removed this file's dismissal step. R5 changes neither the file nor the dialog |
| Static checks | `pnpm run typecheck`; `pnpm run lint:contracts-ready` | PASS — both exit 0 |
| Documentation | `pnpm run doc-sync` | PASS — 28/28 gates |
| Hygiene sub-checks | `knip`; `publint`; `constraints`; `verify-dsh-package-licenses`; `verify-package-invariants`; `verify-built-package-invariants`; `verify-cordis-config`; `verify-node-next-types`; `verify-runtime-closure`; `verify-vendored-links` | PASS — each run individually; `knip` passes for the first time since R3 because the two `examples/headless-agent` Science fixtures are now declared entries |
| Hygiene (`rescope-vendor:check`) | `pnpm exec tsx scripts/rescope-vendor.ts --check` at the candidate and at `fb04b0d273` in a disposable worktree | **FAIL — pre-existing, confirmed identical.** The same 26 problems appear on the R5 base; R5 neither adds to nor fixes them |
| Cross-file duplication | `pnpm run duplication` at the candidate and at `fb04b0d273` in the same disposable worktree | PASS as a comparison — 8 clone pairs at both revisions, set-identical; R5 introduces no new clone |
| Real Python/R run 1 | Clean-archive `test:real-acceptance` at the candidate with the two existing prefixes and the first isolated home | PASS — `python.status=PASS`, `r.status=PASS`, no `prefixManifestDifferences`; both languages passed real PNG artifact creation, chart commit and attachment readback, chart replay, and Outcome publication |
| Real Python/R run 2 | Same command and candidate with the second isolated home | PASS — identical independent Python and R reports |
| Desktop, provider, and release | No command | `NOT-RUN`; R5 creates no carrier, installer, signature, publication, tag, or release evidence |

### Explicitly NOT-RUN

Windows and Linux platform lanes (CI owns the matrix), real-provider e2e with credentials, Desktop and packed installers, signing, notarization, Authenticode, npm publication, Git tag, GitHub release, Git push, and PR creation are `NOT-RUN` for R5.

## Review

The pre-closure state passed its authors' targeted checks but two acceptance obligations were unmet, and one earlier regression was still hidden.

The runnable keyless example was the larger gap. `@deepseek-ai/dsh-science-runtime` now injects `attachments`, so `examples/headless-agent/science-tools.cordis.snapshot.yml` — which mounts no attachment store — failed to activate with `science-runtime: pending (waiting for service: attachments)`. The scenario had also not been extended to the new tools, so no runnable example exercised `save_chart` or `publish_outcome` and no snapshot pinned their model-facing schemas. Commit 5 mounts `@deepseek-ai/dsh-attachment-local` beside the Runtime, writes a deterministic PNG from the fake subprocess into each run's own `SCIENCE_ARTIFACT_DIR`, and scripts the model through state, run, two saves, publication, and a final sanitized state read. Recording that scenario also exposed two normalizer defects: chart identities collapsed into the run-id token, and the model-facing `environmentFingerprintPreview` was not normalized even though the fingerprint it previews moves with the temporary prefix, which would have made the expectation flaky.

The repository unit suite had been `NOT-RUN` since R2. Running it at the candidate showed two stale guarantees. R4's fail-closed preset policy (`cda69a9e5f`) broke every case in `packages/subagent/subagent-in-process-driver/tests/preset-inheritance.spec.ts`, because those fixtures are mounted from a `trust: 'system'` root and carry no `preset.yml`, which that commit made mandatory; commit 7 adds the same minimal metadata the agent-presets system fixtures use, and the driver's four files pass 58/58. `packages/core/tools/tests/gen-tool-catalog.spec.ts` still expected the harvested roster from before `tool-science` joined `TOOL_PACKAGES` in R3, so R5's two additions widened an existing three-name drift to five; commit 8 restores the guarantee.

The remaining checks confirmed the implementation as designed: text-only model results with no attachment handle, durable event order with the Science event before its tool result, sanitized state entries, session-authorized browser replay including a visibly failed object, and prefix-unchanged real Conda runs for both languages.

## Overlay inventory update

| `delta_id` | Prior status | R5 status |
|---|---|---|
| `SCI-CHARTS-OUTCOME` | `deferred` (open since R0) | `verified` at product candidate `69045ba510` |
| `SCI-SETTINGS-SIDEBAR` | `deferred` | unchanged: `deferred` |
| `DESKTOP-CARRIER` | `deferred` | unchanged: `deferred` |
| Remaining overlay rows | as recorded in the [R4 closure evidence](2026-08-16-dsh-science-v01-r4-science-preset.md) | unchanged |

## Protected-state preservation

No worktree outside `/Users/superjj/ccproj/DSHscience` (branch `codex/science-v01-r3-science-tools-plan`) was staged, cleaned, reset, checked out, or repointed. One disposable detached worktree at `fb04b0d273` was created under the session scratch directory to confirm the pre-existing `rescope-vendor:check` and duplication results, and the clean acceptance archive and its two mode-`0700` homes live outside the repository. No push, tag, PR, publish, release, environment mutation, or Conda prefix change was performed; both real-acceptance runs report an unchanged prefix manifest.

## Risks, unknowns, and deferred product decisions

- R5 landed as one ordered series instead of three independently accepted checkpoint heads, so no intermediate commit in the range was gated on its own tree; the acceptance claim rests on the final candidate.
- `rescope-vendor:check`'s pre-existing 26-problem gap remains open, and the pre-existing 8-clone `duplication` gap remains open with no R5 file in any pair.
- `apps/web/tests/smoke-real.e2e.ts` remains red locally for the onboarding-dialog reason above. It self-skips without `DEEPSEEK_API_KEY`, so CI does not see it; whoever owns that dialog change should restore the dismissal step.
- The `examples/acp-agent/tests/goal.snapshot.ts` scenarios assert empty stderr while running without `--disable-warning=ExperimentalWarning`, so Node 24.14's `node:sqlite` experimental warning fails them locally. The headless and JSON-RPC snapshot scenarios already pass that flag.
- `packages/boot/app-boot/tests/hmr-config.spec.ts` waits up to ten seconds for a filesystem watch event and timed out once under full-suite load while passing in isolation and in the final run. It is a load-sensitive timing assertion, not an R5 behavior.
- A deployment that mounts `@deepseek-ai/dsh-science-runtime` without an attachment store now leaves the Runtime pending on `attachments` instead of failing at first use; the diagnostic is a Loader activation message, not a Science-specific one.
- Real Python/R acceptance proves interpreter-to-artifact integration on this machine's two prefixes only. Plotting-library availability, quota and garbage collection for retained scratch and attachments, the settings/sidebar surface, Desktop, and release remain open work for later slices.
