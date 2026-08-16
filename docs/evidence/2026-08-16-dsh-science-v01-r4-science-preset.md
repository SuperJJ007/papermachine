# DSH Science v0.1 R4 built-in Science preset closure evidence

English | [中文](2026-08-16-dsh-science-v01-r4-science-preset.zh.md)

Investigated and finally re-audited on 2026-08-16 on macOS 26.5.2 (Darwin 25.5.0, arm64). The final repair gates used the Codex workspace runtime, Node v24.19.0 and pnpm 11.19.0. Scope authority: [DSH Science v0.1 R4 built-in Science preset on RC5](../../.agents/notes/implemented/feature/2026-08-16-dsh-science-v01-r4-science-preset.md).

## Outcome

Final acceptance rejected the earlier R4 closure at `b3a7f03a5d0accd899ae7d3067cd70f4c26e5f98`: missing, unreadable, malformed, wrongly shaped, or wrongly typed metadata could erase the Science copy prohibition and make an unusable copy look successfully authored, while the Science tool README still claimed tool schemas were global rather than preset-scoped. Commit `cda69a9e5f6fb729c4699f70e06dc23745f0788f` repairs both blockers. Shipped presets now require valid metadata, every broken preset resolves non-copyable, direct service/API copy rejects it with the discovery reason, the real shipped Science root is tested for missing/malformed/non-boolean policy, and the stale limitation is removed. The repaired behavior candidate passes the focused source, Host artifact, CLI, browser, lib-mode, configuration, documentation, and lint gates recorded below; final semantic and diff re-review found no remaining blocking or high-severity finding in scope.

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
| Prior R4 documentation closure | `b3a7f03a5d0accd899ae7d3067cd70f4c26e5f98` — the head rejected by final acceptance because copy policy still failed open and one limitation was stale |
| Repaired R4 behavior candidate | `cda69a9e5f6fb729c4699f70e06dc23745f0788f`, nine commits above the R3 documentation-closure head |
| Downstream preset provenance | `omdsh-dev/dsh-science@fae091e1080e830bed8ad0456e4cbced29101b01` — read-only roster/locale/test-input reference only, per the Note's [Exact identities](../../.agents/notes/implemented/feature/2026-08-16-dsh-science-v01-r4-science-preset.md#exact-identities) table; no line of R4 is a cherry-pick from it |

## Verification matrix

| Layer | Command | Result |
|---|---|---|
| Scope and ancestry | `git merge-base --is-ancestor 92ee890e8d cda69a9e5f`; `CI=true pnpm --silent run change-scope --base 92ee890e8d --head cda69a9e5f`; `git diff --check 92ee890e8d..cda69a9e5f` | PASS — the plan base remains the merge base; the nine-commit range stays within the Note's IN rows and adds only the fail-closed preset metadata implementation/tests, affected package/application prose, and generated catalogs; no Runtime row, invariant companion, Desktop carrier, environment mutation, provider, release, or publication path is added |
| Copyability, API, and client units | `CI=true pnpm exec vitest run packages/preset/agent-presets/tests packages/host/apiproxy/tests/api-proxy-agent-preset.spec.ts packages/host/apiproxy/tests/rpc-schemas.spec.ts packages/client/ui-agent-preset/tests` | PASS — 378 passed, 17 files |
| CLI preset composition | `CI=true pnpm exec vitest run --config vitest.e2e.config.ts apps/cli/tests/web-agent-presets.e2e.ts` | PASS — 38 passed, 1 file; in addition to the original roster/Runtime behavior, the real shipped root now proves missing, malformed, and non-boolean Science metadata make the row broken/non-copyable and make direct copy fail |
| Web browser and keyless request | `CI=true pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/agent-preset-selection.e2e.ts apps/web/tests/agent-preset-authoring.e2e.ts apps/web/tests/science-preset.snapshot.ts` | PASS — 14 passed, 3 files; updates and asserts the real shipped-root ARIA goldens (fifth preset, localized copy, disabled Science copy action) and drives one real keyless request through the shipped Web scaffold, `ctx.agentPresets.mount(agentCtx, 'science')` included |
| Built application resolution | `CI=true pnpm run build:lib:host`; `DSH_EXAMPLE_MODE=lib CI=true pnpm exec vitest run --config vitest.snapshot.config.ts apps/web/tests/science-preset.snapshot.ts`; `CI=true pnpm run check:ci:artifacts`; the unchanged built-bin command repeated on the Host after sandbox timeout | PASS — Node 24 Host build exit 0; lib-mode snapshot 1/1; the artifact composite's build, publint, NodeNext types, and built-package-invariants passed, while its built-bin lane was sandbox-blocked waiting for a lifecycle marker; the exact 11-file built-bin command passed 30/30 on the Host, so all five artifact checks have positive evidence without hiding the sandbox failure |
| Configuration and lint | `CI=true pnpm run verify-cordis-config`; `CI=true pnpm run lint:contracts-ready` | PASS — 122 configuration files and all contract-ready lint checks |
| Hygiene (`rescope-vendor:check`) | `pnpm exec tsx scripts/rescope-vendor.ts --check` | **FAIL — pre-existing, confirmed identical on the R4 plan base.** Same 26-problem list (Markdown fences, docs prose, code specifiers across `docs/event-producer-consumer*`, `docs/subsystems/extensions*`, `packages/api/remotes`, `packages/extensions/cordis-*`, `packages/extensions/ui-cordis`, `packages/extensions/tool-cordis/src/api-catalog.ts`, `scripts/gen-cordis-catalog.ts`) run at head `92ee890e8d` via a disposable worktree; R4 neither adds to nor fixes it |
| Hygiene (`knip`) | `pnpm exec knip --treat-config-hints-as-errors` | **FAIL — pre-existing, confirmed identical on the R4 plan base.** Same 2 unused files (`examples/headless-agent/tests/fixtures/science-{mock-llm,runtime-fixture}.ts`, last touched by the R3 review-repair commit `be46f69b6e`), confirmed via the same disposable worktree; R4 touches neither file |
| Hygiene remaining sub-checks | `publint`; `constraints`; `verify-dsh-package-licenses`; `verify-package-invariants`; `verify-built-package-invariants`; `verify-node-next-types`; `verify-runtime-closure`; `verify-vendored-links` | PASS — 225 packages declare MIT; 222 hand-owned and 222 compiled invariant companions conform; 231 declaration APIs compile under NodeNext; 109 packages form a closed runtime graph; 9 vendored names resolve |
| Documentation | `pnpm run gen-cordis-catalog`; `./node_modules/.bin/tsx scripts/verify-translation-pairing.ts --write ...` for the affected pairs; `CI=true pnpm run doc-sync`; `git diff --check` | PASS — the exported copy failure contract is reflected in `api-catalog.ts` and the bilingual core catalog, all 28 documentation gates pass, and no whitespace violation remains |
| Cross-file duplication | `CI=true pnpm run duplication` | **FAIL — pre-existing, unrelated.** 8 clone pairs, identical set to the one recorded in the R3 evidence record (`goal/goal`↔`science-session` invariants, `science-runtime` internals, `bash-sandbox`↔`pwsh-sandbox`, `gen-config-catalog.ts` self-clone); none touch an R4-added or R4-changed file |
| Final acceptance review | Semantic and diff review of the prior closure, repair commit, tests, generated catalogs, and current verification matrix | **ACCEPT** — the audit first rejected `b3a7f03a5d` for the fail-open policy and stale Science limitation; `cda69a9e5f` closes both, tests every new failure mode at parser/discovery/service/real shipped-root layers, preserves the user/system metadata distinction, and leaves no remaining blocking or high-severity finding in the repaired scope |
| Real Python/R and provider | Not authorized for this session | `NOT-RUN`, as declared in the Note; separate from source, fake-Runtime, built, Web, Desktop, and release acceptance |
| Desktop and release | No command | `NOT-RUN`; R4 creates no carrier, installer, signature, publication, tag, or release evidence |

### Explicitly NOT-RUN

Repository-wide unit suite (CI owns the exhaustive matrix), real Python/R Science Runtime acceptance against explicitly authorized existing Conda prefixes, Desktop, provider credentials, signing, publication, tag, release, Git push, and PR are `NOT-RUN` for R4. Those layers are outside this slice.

## Review

The original review correctly confirmed the built-in preset identity, roster, Host/Runtime non-ownership, wire code, and disabled Web action, but it did not challenge the metadata reader's fail-soft behavior. Final acceptance traced the negative path end to end and found that deleting or damaging `science/preset.yml` made discovery default `copyable` back to true. That violated the copy-only authoring promise because the resulting derived id could mount visible tools yet fail every Science operation. The same audit compared current source behavior with package prose and found the stale `tool-science` claim that tool schemas were globally registered.

The repair separates presentation from policy. Invalid display fields remain ignorable, but a present metadata document must be readable map-shaped YAML and a declared `copyable` field must be boolean. System roots additionally require the file; user roots may still omit it. Discovery turns every metadata or composition failure into `broken` plus `copyable: false`, and `copyComposition()` reports the broken reason. Parser and discovery units cover each invalid form, authoring units cover direct refusal, and the CLI e2e suite damages a copied real shipped root in all three policy-relevant forms. Generated and package documentation now state the same rule, and the obsolete global-schema limitation is removed.

## Domain port provenance

R4 is original composition work, not a port. The built-in `science` preset's roster, config values, and Chinese metadata are decided directly by the Note rather than copied from `omdsh-dev/dsh-science@fae091e1080e830bed8ad0456e4cbced29101b01`; that commit is read-only reference for what a downstream roster/locale looked like, named explicitly in the Note's alternatives as rejected provenance (failed whole-range candidate, missing R3's `stateHistoryLimit`, a direct-assembly snapshot instead of a real request). The generic `copyable` preset-metadata mechanism has no downstream analog and is R4-original, designed to close the specific hazard R1/R3 created by binding `ScienceModeRef.presetId` to the literal `science` id.

## Overlay inventory update

| `delta_id` | Prior status | R4 status |
|---|---|---|
| `SCI-PRESET` | `deferred` (open since R0) | `verified` at repaired behavior candidate `cda69a9e5f` |
| `SCI-CHARTS-OUTCOME` | `deferred` | unchanged: `deferred` |
| `SCI-SETTINGS-SIDEBAR` | `deferred` | unchanged: `deferred` |
| `DESKTOP-CARRIER` | `deferred` | unchanged: `deferred` |
| Remaining overlay rows | as recorded in the [R3 closure evidence](2026-08-16-dsh-science-v01-r3-science-tools.md) | unchanged |

## Protected-state preservation

No protected worktree outside `/Users/superjj/ccproj/DSHscience` (branch `codex/science-v01-r3-science-tools-plan`) was staged, cleaned, reset, checked out, or repointed; the one disposable worktree used during the original closure to confirm pre-existing behavior was created under `/tmp` and removed in that session. The final repair audit performed no cleanup, reset, checkout, worktree mutation, environment mutation, push, tag, PR, publish, or release action. Build and browser commands used the configured Node 24 runtime and isolated `/private/tmp` DSH homes; tracked writes are limited to the repair, its tests, current documentation, catalogs, and evidence.

## Risks, unknowns, and deferred product decisions

- `rescope-vendor:check`'s pre-existing 26-problem gap remains open; R4 neither fixes nor extends it.
- The pre-existing 8-clone `duplication` gap remains open; R4 neither fixes nor extends it, and no R4-added file appears in the reported clone pairs.
- `knip`'s pre-existing 2-unused-file report (`examples/headless-agent` Science test fixtures from R3) remains open; R4 does not touch either file.
- The preset is discoverable and selectable on any Host that configures no `dsh-science-runtime` row, including the shipped Web Host as of this record; the first real Science request on such a Host fails loudly (`no Science Runtime is mounted (ctx.scienceRuntime)`), confirmed in `apps/cli/tests/web-agent-presets.e2e.ts`, but no settings/sidebar surface tells a user this in advance — `SCI-SETTINGS-SIDEBAR` remains the open row that would add that.
- Real Python and R Science Runtime acceptance, chart/Outcome publication, the settings/sidebar surface, and Desktop remain exactly as recorded in the R0–R3 overlay inventory: open work for later slices.
