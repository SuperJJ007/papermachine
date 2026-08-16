# DSH Science v0.1 R4 built-in Science preset closure evidence

English | [中文](2026-08-16-dsh-science-v01-r4-science-preset.zh.md)

Investigated on 2026-08-16 on macOS 26.5.2 (Darwin 25.5.0, arm64), Node v24.14.0, pnpm 11.7.0. Scope authority: [DSH Science v0.1 R4 built-in Science preset on RC5](../../.agents/notes/implemented/feature/2026-08-16-dsh-science-v01-r4-science-preset.md).

## Outcome

The R4 product candidate landed as seven linear commits above the accepted R3 documentation-closure head `92ee890e8da762ba789e74610551b4fd3351ed27`. An independent clean-context review of the full range found no `BLOCK` or `HIGH` finding; one documentation-accuracy nit (a stale generated line-number reference in `docs/config-catalog.zh.md`, not itself an R4-added fact but disturbed by the `AgentPreset.copyable` regeneration) was repaired in a seventh commit. This record promotes the exact repaired range at head `ac57329b7a2a6912734dee84774ea67b84859007`.

## Exact identities

| Subject | Identity |
|---|---|
| Official RC5 | `deepseek-ai/deepseek-harness@47f943859bef60e4160492346772ded9b24f765a` |
| Accepted R3 documentation-closure head (R4 plan base) | `92ee890e8da762ba789e74610551b4fd3351ed27` |
| Commit 1 | `e0e932bd5e` — generic `copyable` preset-metadata field: `dsh-agent-presets` discovery/authoring/index, `dsh-host-apiproxy` wire (`agent-preset-not-copyable`), `dsh-client-ui-agent-preset` disabled copy action |
| Commit 2 | `d2f39675e4` — the built-in `science` agent preset (`apps/cli/config/agent-presets/science/{agent.cordis.yml,preset.yml}`), the `dsh-tool-science` app dependency, and Science coverage in `apps/cli/tests/web-agent-presets.e2e.ts` |
| Commit 3 | `5cf7f8ae11` — updated shipped-root ARIA goldens for the fifth preset |
| Commit 4 | `33f7275e59` — `apps/web/tests/science-preset.snapshot.ts` and its committed replay fixture |
| Commit 5 | `49b38da347` — documentation for the shipped composition (`docs/subsystems/science.md`, `tool-science`/`ui-agent-preset` READMEs, regenerated `config-catalog.md`/`api-catalog.ts`) |
| Commit 6 | `9d2be4bd3d` — route `science-preset.snapshot.ts` through the host `tsc` program alongside `minimal-preset.snapshot.ts` |
| Review repair | `ac57329b7a` — fix the stale `docs/config-catalog.zh.md` source line number found by independent review |
| Accepted R4 candidate (this record's head) | `ac57329b7a2a6912734dee84774ea67b84859007`, seven commits above the R3 documentation-closure head |
| Downstream preset provenance | `omdsh-dev/dsh-science@fae091e1080e830bed8ad0456e4cbced29101b01` — read-only roster/locale/test-input reference only, per the Note's [Exact identities](../../.agents/notes/implemented/feature/2026-08-16-dsh-science-v01-r4-science-preset.md#exact-identities) table; no line of R4 is a cherry-pick from it |

## Verification matrix

| Layer | Command | Result |
|---|---|---|
| Scope and ancestry | `git merge-base --is-ancestor 92ee890e8d ac57329b7a`; `CI=true pnpm --silent run change-scope --base 92ee890e8d --head ac57329b7a`; `git diff --check 92ee890e8d..ac57329b7a` | PASS — merge base is the R3 documentation-closure head; the reported path list matches exactly the Note's [Scope](../../.agents/notes/implemented/feature/2026-08-16-dsh-science-v01-r4-science-preset.md#scope) IN rows (preset directory, `apps/cli/package.json`+lockfile, `dsh-agent-presets`/`dsh-host-apiproxy`/`dsh-client-ui-agent-preset` copyability wiring, the two browser e2e files and their goldens, the Web snapshot and its fixture, the CLI e2e file, README/subsystem/generated docs, and the two tsconfig routing files); no OUT-of-scope path (`packages/bundle/web-app/cordis.patch.yml`, `examples/headless-agent/**`, any `*/invariant` companion, a Host `dsh-science-session` or `science-runtime` row) appears; no whitespace violation |
| Copyability, API, and client units | `CI=true pnpm exec vitest run packages/preset/agent-presets/tests packages/host/apiproxy/tests/api-proxy-agent-preset.spec.ts packages/host/apiproxy/tests/rpc-schemas.spec.ts packages/client/ui-agent-preset/tests` | PASS — 372 passed, 17 files |
| CLI preset composition | `CI=true pnpm exec vitest run --config vitest.e2e.config.ts apps/cli/tests/web-agent-presets.e2e.ts` | PASS — 35 passed, 1 file; includes the exact Science model tool roster, `standard`/`science` isolation, fail-loud with no Science Runtime mounted, copy refusal naming the source, and a successful environment bind through a fake-backed (real `dsh-science-runtime`, fake subprocess/sandbox) Runtime isolated via `ctx.isolate('subprocess').isolate('sandbox')` |
| Web browser and keyless request | `CI=true pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/agent-preset-selection.e2e.ts apps/web/tests/agent-preset-authoring.e2e.ts apps/web/tests/science-preset.snapshot.ts` | PASS — 14 passed, 3 files; updates and asserts the real shipped-root ARIA goldens (fifth preset, localized copy, disabled Science copy action) and drives one real keyless request through the shipped Web scaffold, `ctx.agentPresets.mount(agentCtx, 'science')` included |
| Built application resolution | `CI=true pnpm run build`; `DSH_EXAMPLE_MODE=lib CI=true pnpm exec vitest run --config vitest.snapshot.config.ts apps/web/tests/science-preset.snapshot.ts`; `CI=true pnpm run check:ci:artifacts` | PASS — full build exit 0; lib-mode snapshot 1 passed (proves the `apps/web/tsconfig.json`/`tsconfig.host.json` routing fix and built-artifact resolution); `check:ci:artifacts` 5/5 (build, publint, node-next-types, built-package-invariants, built-bin smoke) |
| Configuration and hygiene | `CI=true pnpm run verify-cordis-config`; `CI=true pnpm run hygiene` | `verify-cordis-config` PASS — 122 config files. `hygiene` composite: every sub-check PASS except `rescope-vendor:check` and `knip`, both **pre-existing, confirmed unchanged** — see below |
| Hygiene (`rescope-vendor:check`) | `pnpm exec tsx scripts/rescope-vendor.ts --check` | **FAIL — pre-existing, confirmed identical on the R4 plan base.** Same 26-problem list (Markdown fences, docs prose, code specifiers across `docs/event-producer-consumer*`, `docs/subsystems/extensions*`, `packages/api/remotes`, `packages/extensions/cordis-*`, `packages/extensions/ui-cordis`, `packages/extensions/tool-cordis/src/api-catalog.ts`, `scripts/gen-cordis-catalog.ts`) run at head `92ee890e8d` via a disposable worktree; R4 neither adds to nor fixes it |
| Hygiene (`knip`) | `pnpm exec knip --treat-config-hints-as-errors` | **FAIL — pre-existing, confirmed identical on the R4 plan base.** Same 2 unused files (`examples/headless-agent/tests/fixtures/science-{mock-llm,runtime-fixture}.ts`, last touched by the R3 review-repair commit `be46f69b6e`), confirmed via the same disposable worktree; R4 touches neither file |
| Hygiene remaining sub-checks | `publint`; `constraints`; `verify-dsh-package-licenses`; `verify-package-invariants`; `verify-built-package-invariants`; `verify-node-next-types`; `verify-runtime-closure`; `verify-vendored-links` | PASS — 225 packages declare MIT; 222 hand-owned and 222 compiled invariant companions conform; 231 declaration APIs compile under NodeNext; 109 packages form a closed runtime graph; 9 vendored names resolve |
| Documentation | `CI=true pnpm run verify-agent-note-format`; `CI=true pnpm run verify-translation-pairing`; `CI=true pnpm run doc-sync`; `CI=true pnpm run lint`; `git diff --check` | PASS — 545 Agent Notes conform; 950 bilingual pairs consistent (after the line-number repair); doc-sync 28/28 gates; lint exit 0; no whitespace violation |
| Cross-file duplication | `CI=true pnpm run duplication` | **FAIL — pre-existing, unrelated.** 8 clone pairs, identical set to the one recorded in the R3 evidence record (`goal/goal`↔`science-session` invariants, `science-runtime` internals, `bash-sandbox`↔`pwsh-sandbox`, `gen-config-catalog.ts` self-clone); none touch an R4-added or R4-changed file |
| Independent review | Clean-context semantic and diff review of `92ee890e8d..9d2be4bd3d` (the six-commit range before the line-number repair) plus this verification matrix | **ACCEPT WITH NITS** — no `BLOCK`/`HIGH` finding; the reviewer independently re-ran the copyability/CLI unit suites (372 and 35 tests respectively, both green) and traced every Note claim (exact preset roster/config/metadata, the `copyable` mechanism end to end, Host/Runtime non-ownership, ARIA goldens, `ctx.isolate()` correctness, tsconfig routing) against the actual source; the one actionable nit (stale `config-catalog.zh.md` line number) is closed by commit `ac57329b7a`; three remaining nits are by-design R1/R3-inherited sanitization scope, a fixture-hygiene wart in an untemplated Host scratch path that correctly never reaches model-visible text, and test-double duplication that follows existing repo precedent — none require a code change |
| Real Python/R and provider | Not authorized for this session | `NOT-RUN`, as declared in the Note; separate from source, fake-Runtime, built, Web, Desktop, and release acceptance |
| Desktop and release | No command | `NOT-RUN`; R4 creates no carrier, installer, signature, publication, tag, or release evidence |

### Explicitly NOT-RUN

Repository-wide unit suite (CI owns the exhaustive matrix), real Python/R Science Runtime acceptance against explicitly authorized existing Conda prefixes, Desktop, provider credentials, signing, publication, tag, release, Git push, and PR are `NOT-RUN` for R4. Those layers are outside this slice.

## Review

The independent review confirmed every claim in the Note's [Preset identity, metadata, and roster](../../.agents/notes/implemented/feature/2026-08-16-dsh-science-v01-r4-science-preset.md#preset-identity-metadata-and-roster) section against the committed `apps/cli/config/agent-presets/science/{agent.cordis.yml,preset.yml}` byte-for-byte (id, order `5`, Chinese `preset.yml` strings, `copyable: false`, `profileId: science`, `modeRevision: science-v1`, `stateHistoryLimit: 8`, the exact composed plugin list, and the exact model tool roster asserted in `apps/cli/tests/web-agent-presets.e2e.ts`), confirmed the generic `copyable` mechanism is enforced consistently at metadata default, `copyComposition()`, the Host wire (`agent-preset-not-copyable`, carrying `agentPreset`/`source`/`reason`), and the Web management section's disabled duplicate action, and confirmed the [Host, Session, and Runtime ownership](../../.agents/notes/implemented/feature/2026-08-16-dsh-science-v01-r4-science-preset.md#host-session-and-runtime-ownership) section's negative claims by `git diff --stat` (no `dsh-invariants`, `dsh-science-session`, or Runtime row anywhere in the range, and `packages/science/tool-science/src/**` untouched — only its README changed). It independently re-ran the copyability/API/client unit suite and the CLI e2e file directly through `vitest run` (both green), and reviewed `apps/web/tests/science-preset.snapshot.ts` and its committed fixture by direct inspection rather than executing `pnpm run test:web`, which requires a full prior build outside the review's practical time budget; this record's own Verification matrix supplies that missing execution.

The reviewer's one closed finding was a stale generated cross-reference the `AgentPreset.copyable` field addition disturbed on only one side of a bilingual pair (`docs/config-catalog.zh.md` still read the English side's pre-regeneration line number); `verify-translation-pairing`'s structural hash check does not catch a drifted line number inside an already-hash-matching block, so the gap survived doc-sync until the review's direct comparison found it. It is repaired in commit `ac57329b7a` and reconfirmed via `verify-translation-pairing`, `verify-config-catalog`, and `doc-sync`.

## Domain port provenance

R4 is original composition work, not a port. The built-in `science` preset's roster, config values, and Chinese metadata are decided directly by the Note rather than copied from `omdsh-dev/dsh-science@fae091e1080e830bed8ad0456e4cbced29101b01`; that commit is read-only reference for what a downstream roster/locale looked like, named explicitly in the Note's alternatives as rejected provenance (failed whole-range candidate, missing R3's `stateHistoryLimit`, a direct-assembly snapshot instead of a real request). The generic `copyable` preset-metadata mechanism has no downstream analog and is R4-original, designed to close the specific hazard R1/R3 created by binding `ScienceModeRef.presetId` to the literal `science` id.

## Overlay inventory update

| `delta_id` | Prior status | R4 status |
|---|---|---|
| `SCI-PRESET` | `deferred` (open since R0) | `verified` at accepted candidate `ac57329b7a` |
| `SCI-CHARTS-OUTCOME` | `deferred` | unchanged: `deferred` |
| `SCI-SETTINGS-SIDEBAR` | `deferred` | unchanged: `deferred` |
| `DESKTOP-CARRIER` | `deferred` | unchanged: `deferred` |
| Remaining overlay rows | as recorded in the [R3 closure evidence](2026-08-16-dsh-science-v01-r3-science-tools.md) | unchanged |

## Protected-state preservation

No protected worktree outside `/Users/superjj/ccproj/DSHscience` (branch `codex/science-v01-r3-science-tools-plan`) was staged, cleaned, reset, checked out, or repointed; the one disposable worktree used to confirm `rescope-vendor:check`/`knip`/`goal.snapshot.ts` pre-existing behavior against the R4 plan base was created under `/tmp` and removed with `git worktree remove --force` in the same session. No push, tag, PR, or publish occurred. `pnpm run clean` plus a targeted `git clean -fdx` over `packages/boot`, `packages/science`, `packages/session/session-persistence-jsonl`, `packages/subprocess/subprocess`, `packages/test-support`, `packages/util/launch-environment`, `vendor/group`, and `vendor/hmr` were run once during this work to remove stray `tsc -b tsconfig.host.json` build residue (`.js`/`.d.ts` files emitted beside `src/` in packages this change did not touch); a full `pnpm run build` was rerun immediately afterward to restore `lib/` before re-verifying the CLI e2e suite.

## Risks, unknowns, and deferred product decisions

- `rescope-vendor:check`'s pre-existing 26-problem gap remains open; R4 neither fixes nor extends it.
- The pre-existing 8-clone `duplication` gap remains open; R4 neither fixes nor extends it, and no R4-added file appears in the reported clone pairs.
- `knip`'s pre-existing 2-unused-file report (`examples/headless-agent` Science test fixtures from R3) remains open; R4 does not touch either file.
- The preset is discoverable and selectable on any Host that configures no `dsh-science-runtime` row, including the shipped Web Host as of this record; the first real Science request on such a Host fails loudly (`no Science Runtime is mounted (ctx.scienceRuntime)`), confirmed in `apps/cli/tests/web-agent-presets.e2e.ts`, but no settings/sidebar surface tells a user this in advance — `SCI-SETTINGS-SIDEBAR` remains the open row that would add that.
- Real Python and R Science Runtime acceptance, chart/Outcome publication, the settings/sidebar surface, and Desktop remain exactly as recorded in the R0–R3 overlay inventory: open work for later slices.
