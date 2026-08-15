# Agent Note: DSH Science v0.1 RC5 release-baseline scope

Status: proposed

English | [中文](2026-08-15-dsh-science-v01-r0-release-baseline-scope.zh.md)

## Problem

DSH Science needs a release line with one attributable upstream source before any Science or Desktop implementation is moved onto it. The current downstream line and official DeepSeek Harness source have unrelated histories, different repository metadata, and different version and license identities. Replaying the downstream history would mix accepted Science foundations, failed Phase 3 candidates, repository governance, publication mechanics, and future Desktop work into one unreviewable change.

The release baseline also needs an explicit evidence limit. A clean source tree, a successful build, an installed npm closure, a real Python/R run, a Desktop package, signing, and publication are different results. Treating one as proof of another would make the first v0.1 claim unreliable.

On 2026-08-15, the product owner fixed the first v0.1 implementation to official RC5. Migration to the then-current official version begins only after the first version is complete. RC6 and later moving sources are therefore neither R0 inputs nor reasons to refresh the v0.1 branch.

## Proposal

R0 establishes one clean local release-baseline candidate rooted directly at official DeepSeek Harness commit `47f943859bef60e4160492346772ded9b24f765a`, whose root version is `0.1.0-rc.5`. It ports no product code. It carries only accepted governance routing, dated identity and baseline evidence, the overlay inventory, and any mechanically unavoidable non-runtime metadata needed to validate those documents.

The one-sentence objective is: **create an exact, reproducible RC5 source baseline from which every later Science delta can be ported and accepted independently.** This is needed now because continued feature work on the unrelated downstream history would make source ownership and release evidence harder to recover.

R0 has one logical deliverable: a clean locally committed head named `<R0B_HEAD>` on `codex/science-v01-rc5-baseline`, with `47f943859bef60e4160492346772ded9b24f765a` as its direct root and with an in-repository identity, inventory, and check record bound to `<R0B_HEAD>`. R0A governance commits are provenance and entry evidence for that baseline, not a second product line. R0 authorizes no push, tag, npm publication, installer, or release.

## Evidence basis

### Verified facts on 2026-08-15

- The official [`deepseek-ai/deepseek-harness` source](https://github.com/deepseek-ai/deepseek-harness/commit/47f943859bef60e4160492346772ded9b24f765a) had `master` at `47f943859bef60e4160492346772ded9b24f765a`; its tree is `f904efab9ef435201d6ba4da88a34d6366568272`, root version is `0.1.0-rc.5`, license is MIT, and Node support is `^22.19.0 || >=24.0.0`. No public `dsh-v0.1.0-rc.5` tag was returned for that exact name. The repository contains CLI and Web applications and no Electron or Desktop application tree.
- Local `main` and the ordinary project worktree were at `e5e8b29b435f67e0a5dde5e2132580966e78b27b`; live `origin/main` was `0be28653be115622c554dae3f00105c2305b9c02`. The local branch was clean and two commits ahead of that remote.
- `e5e8b29...` and `47f943...` have no merge base. Comparing official source on the left and downstream source on the right gives `12,293/17` commits. A traditional rebase or merge would therefore be a history transplantation, not an ordinary refresh.
- The integrated downstream `main` contains the Science Session domain, Science Runtime, the generic runtime-context repair in `0a940733e80d57c70245134bf260012f9be29114` and `e5e8b29b435f67e0a5dde5e2132580966e78b27b`, and their required generic support. It does not contain `packages/science/tool-science`, a built-in Science preset, Science chart or Outcome Consumers, a Science settings card, a Science sidebar, or Desktop code.
- The separate Phase 3 candidate `fae091e1080e830bed8ad0456e4cbced29101b01` contains the read-only filesystem entry, Science tools, and Science preset. Historical exact-range evidence reported a failed hygiene check and a final review with unresolved HIGH findings; this investigation treated that report as historical evidence and did not revalidate or modify the candidate. The later `b15f1ef42e92b72ad1b53412966408415f669a18` R-probe correction and real-runtime result do not cure the inherited whole-Phase-3 review failure.
- npm registry metadata exposed `@deepseek-ai/dsh@0.1.0-rc.6` as `latest` and `next`, with publication time `2026-08-13T12:35:03.812Z` and integrity `sha512-brpZfED7ieRa2PQ5tUxMhHrM1pb2CmKFVM/f6yMULBDMicahk+Z2OsHgTwTDnoiZm23Ftu9rQz0NN4pflaoJcg==`. The version had no `gitHead`, and registry metadata had no RC5 publication time. RC6 is an observed, source-unmapped artifact and is ignored by the v0.1 implementation line.

The protected worktree snapshot below records pre-R0 state. It is evidence, not authority for later status.

| Worktree | Branch or state | HEAD | Dirty state at observation |
|---|---|---|---|
| `/Users/superjj/ccproj/DSHscience` | `main` | `e5e8b29b435f67e0a5dde5e2132580966e78b27b` | clean |
| `/private/tmp/dshscience-science-v01-architecture-governance` | `codex/science-v01-architecture-governance` | `e5e8b29b435f67e0a5dde5e2132580966e78b27b` | 11 tracked modifications and 11 untracked paths |
| `/Users/superjj/.codex/worktrees/24b6/DSHscience` | detached task worktree | `e5e8b29b435f67e0a5dde5e2132580966e78b27b` | clean before this record was created |
| `/Users/superjj/.codex/worktrees/7e1d/DSHscience` | `codex/fix-science-r-version-probe` | `b15f1ef42e92b72ad1b53412966408415f669a18` | clean |
| `/Users/superjj/.codex/worktrees/8489/DSHscience` | detached Phase 3 candidate | `fae091e1080e830bed8ad0456e4cbced29101b01` | clean |
| `/Users/superjj/.codex/worktrees/8942/DSHscience` | detached | `e5e8b29b435f67e0a5dde5e2132580966e78b27b` | clean |
| `/Users/superjj/.codex/worktrees/e229/DSHscience` | detached | `e5e8b29b435f67e0a5dde5e2132580966e78b27b` | clean |
| `/Users/superjj/.grok/worktrees/ccproj-dshscience/2026-08-13-a6c14eca` | detached Phase 2 worktree | `9e1086777a0eb1c9429e7877deb88387bf52459b` | 54 tracked modifications and 31 untracked paths |

### Inferences

- The v0.1 branch must start directly from the official commit rather than from any downstream branch name. Current Science work becomes an attributable overlay inventory, not inherited history.
- The governance worktree contains at least three independent concerns: distribution reconnaissance and product alignment, evidence-routing mechanics, and a broad rewrite of root documentation instructions. Moving that worktree wholesale would create a large unrelated diff and obscure ownership.
- The Phase 3 candidate can supply code-reading evidence and delta provenance, but its local slice checks and real-runtime correction cannot be promoted to whole-phase acceptance or copied as a single R1 change.

### Decisions

- RC5 remains fixed through the first v0.1 completion. No daily or every-two-day observation changes the implementation baseline. A separate post-v0.1 migration selects and validates the then-current exact official source.
- Governance closure and baseline materialization belong to one R0 because the baseline needs an accepted identity and evidence home before it can be authoritative. They remain separate as R0A and R0B so their histories, diffs, and checks stay reviewable.
- R0 contains no Science, generic runtime, Standard behavior, Electron, release, or migration implementation. Every code-bearing delta starts in R1 or later.

### Unverified and NOT-RUN evidence

- The GitHub source-archive SHA-256, the RC5 dependency installation, source smokes, build, package packing, installed Web/CLI checks, and final R0 diff checks are R0B execution evidence and were not run by this scope investigation.
- No RC6 source mapping, complete RC6 package-family inventory, anonymous RC6 installation, or compatibility audit is required for v0.1. Their absence does not block R0.
- Real provider, real Python/R, installer, signing, notarization, Authenticode, Desktop runtime, updater, publication, and release readiness are `NOT-RUN` for R0.
- The exact official target for the post-v0.1 migration is unknowable until that migration begins; it is a later selection, not an R0 unknown requiring user input.

## R0A and R0B

| Slice | Purpose | Permitted work | Exit |
|---|---|---|---|
| R0A — governance closure | Establish the accepted baseline decision, evidence route, and exact port allowlist without taking ownership of unrelated dirty files | Review the existing governance worktree by exact path; separate distribution/MVP decisions, evidence-routing mechanics, and broad instruction condensation; accept only the records and route required by R0; perform the scoped Agent Note supersession audit | Exact local governance commit or commits, no unclassified path, a reviewed R0B file allowlist, and no product-source change |
| R0B — official baseline materialization | Create the sole release-baseline candidate | Create `codex/science-v01-rc5-baseline` directly at `47f943...`; add only the approved R0A records, dated baseline evidence, overlay inventory, and mechanically required documentation metadata; run the minimum checks | Clean `<R0B_HEAD>`, exact ancestry and allowed diff, all required R0 checks PASS, and every protected pre-existing worktree unchanged |

R0A does not require the entire governance worktree to land as one commit. The distribution reconnaissance and the Science MVP alignment may form one reviewed decision set; evidence routing may form a second mechanical set; the broad root and `docs/AGENTS.md` condensation remains a separate governance change unless R0 can prove each line is required by the evidence route. R0B ports approved file contents deliberately and does not cherry-pick or merge the governance branch.

## IN and OUT scope

| Area | IN scope | OUT of scope |
|---|---|---|
| Source identity | Official commit `47f943...`, its tree, root version, license, archive URL and checksum, and the eventual `<R0B_HEAD>` | RC6 adoption, a moving branch, an inferred source/artifact equivalence, or post-v0.1 migration |
| Git topology | One new local branch and isolated non-temporary worktree rooted directly at the official commit | Rebase, merge, history rewrite, or advancement of current `main`, `origin/main`, Phase 3, R-probe, governance, or Grok worktrees |
| Governance | The canonical R0 record, the accepted distribution/MVP decision subset, and the minimum route for dated evidence | Wholesale transfer of the dirty governance diff, broad documentation cleanup, temporary plans, or chat handoffs |
| Evidence | A dated baseline/version record, protected-state snapshot, complete overlay inventory, exact commands, results, and evidence-layer limits | Claims that source or build evidence proves runtime, Desktop, signing, installer, or release status |
| Metadata | Documentation pairing/budget/exclusion entries and other non-runtime metadata mechanically required by the accepted route; no change is expected outside that allowlist | Package versions, dependencies, `package.json`, `pnpm-lock.yaml`, runtime config, generated product catalogs, branding, license, release workflow, or publication credentials |
| Standard baseline validation | Focused source launch/config checks, built Web/CLI and package invariants, release-family packing, installed CLI identity, and installed Web readiness/clean shutdown | Real model/provider calls, broad product e2e, Windows Wine diagnosis, GUI interaction acceptance, or exhaustive platform CI |
| Science | Inventory and provenance only | Science Session, Runtime, runtime-context, filesystem, tools, preset, chart, Outcome, settings, sidebar, or client code and tests |
| Desktop and release | Identity columns explicitly marked absent or `NOT-RUN` | Electron/Tauri code, installers, updater, signing, notarization, Authenticode, npm publication, Git tag, push, PR, or public release |

If RC5 cannot pass its baseline checks without changing product source, R0 stops. It does not use “necessary metadata” as a route for a source fix. Any proposed `package.json`, lockfile, package, application, runtime configuration, test-fixture, or product-doc change requires a new scoped decision or R1.

## Identity ledger and upstream intake

| Identity class | Exact identity or required fields | R0 treatment | Maximum claim |
|---|---|---|---|
| Adopted official source | `https://github.com/deepseek-ai/deepseek-harness.git`; commit `47f943859bef60e4160492346772ded9b24f765a`; tree `f904efab9ef435201d6ba4da88a34d6366568272`; root `0.1.0-rc.5`; MIT; source archive URL plus R0-computed SHA-256 | Immutable R0/R1–first-version base | Exact official source identity only |
| R0 baseline candidate | Branch `codex/science-v01-rc5-baseline`; `<R0B_HEAD>`; parent chain rooted directly at `47f943...`; exact R0-only diff | Sole R0 deliverable | Source/build/packed results actually recorded for `<R0B_HEAD>` |
| Observed npm artifact | `@deepseek-ai/dsh@0.1.0-rc.6`; publication time and integrity above; `gitHead` absent | Recorded only to prevent substitution; ignored for v0.1 | Unmapped npm artifact exists |
| Science overlay | Current-main source `e5e8b29...`; candidate identities `fae091e...` and `b15f1ef...`; per-delta source paths and commits | Inventory only; ported one R1 slice at a time | Existing downstream source or historical evidence, never RC5 compatibility |
| Desktop artifact | No first-party DSH Science Desktop source or artifact exists in the adopted baseline | `NOT-RUN`; no placeholder version or checksum | No Desktop evidence |

During v0.1 work, upstream intake is observation-only and optional. At most once every two days, a recorder may store the official default-ref SHA, release/security links, observation time, and one disposition: `no-impact`, `security-review-required`, or `post-v0.1-migration-input`. The record never merges, rebases, cherry-picks, updates a dependency, or invalidates RC5 merely because the branch moved. A credible security or build-blocking event pauses the affected work and opens a separate change-control decision. After v0.1 completes, one migration task selects the then-current exact official SHA and replays the accepted small overlay stack; intermediate observed versions need not be adopted.

## Branch and worktree procedure

1. Re-record every existing worktree path, branch, HEAD, staged, unstaged, and untracked state. Treat every existing path as protected user data.
2. Verify the official URL, exact commit, tree, root version, license, and supported Node/pnpm versions. If the commit object is absent, fetch that exact object from the official URL without moving any local or remote-tracking branch.
3. Verify that `codex/science-v01-rc5-baseline` and the chosen non-`/tmp` worktree path do not exist. The worktree must be isolated from every listed current worktree and suitable for later Science tests that reject generic temporary roots.
4. Create the branch and worktree directly from `47f943859bef60e4160492346772ded9b24f765a`. Configure no upstream branch and perform no merge, rebase, or cherry-pick from the downstream history.
5. Apply only the reviewed R0A content allowlist. Keep the official version, license, repository metadata, release workflows, package graph, lockfile, and product source unchanged.
6. Bind every check and evidence row to the current full `<R0B_HEAD>`. A content change after a check invalidates the affected result and requires a rerun.
7. Create local R0 commits only after all exit conditions pass. Stop without push, tag, PR, publication, or cleanup of another worktree.

The required ancestry is `47f943...` followed only by small R0-owned documentation/evidence commits. The old downstream root, `main`, Phase 3, and R-probe commits must not appear in `<R0B_HEAD>` ancestry.

## Overlay inventory

Every inventory row uses the following minimum schema.

| Field | Required content |
|---|---|
| `delta_id` | Stable local identifier, independent of commit order |
| `owner` | Person/team and owning package or process area |
| `source_identity` | Repository URL, full source SHA, and source paths; multiple SHAs remain separate when evidence differs |
| `target` | Adopted source SHA plus target package, capability, or carrier |
| `classification` | Exactly one of `generic`, `upstream-candidate`, `Science-owned`, or `Desktop-owned` |
| `dependencies` | Other delta IDs and exact upstream APIs that must exist first |
| `port_status` | `not-started`, `mapping`, `candidate`, `verified`, `deferred`, or `rejected` |
| `tests` | Planned focused source, build, packed, real-runtime, Desktop, and release checks, with inapplicable layers explicit |
| `evidence` | Exact candidate SHA, command, result, date, platform, and evidence layer; historical evidence is labelled historical |
| `disposition` | Port, rewrite, propose upstream, retain only as reference, or reject, plus any hard-stop reason |

R0 seeds at least these rows but does not port them.

| Delta | Source | Classification | R0 status and earliest owner |
|---|---|---|---|
| Generic runtime-context repair | `0a940733...` plus test correction `e5e8b29...`, `packages/core/agent-loop` | `upstream-candidate` | Implemented on downstream `main`; no RC5 mapping or checks; required before model-visible Science tools, not before R0 |
| Science Session domain | `e5e8b29...`, `packages/science/science-session` plus its generic projection/event dependencies | `Science-owned` | Integrated downstream only; R1 sole next slice |
| Science Runtime | `e5e8b29...`, `packages/science/science-runtime`; R-probe correction `b15f1ef...` remains separate | `Science-owned` | Integrated downstream infrastructure with separately accepted real-runtime evidence at `b15f1ef...`; port only after Science Session and revalidate on RC5 |
| Read-only filesystem entry | `8c7d5e01...` and `0073f6e0...` | `upstream-candidate` | Phase 3 candidate only; whole candidate not accepted; defer until its Consumer needs it |
| Science tool Consumer | `27c96d8e...`, `packages/science/tool-science` | `Science-owned` | Candidate only; inherited Phase 3 hard stops; requires Runtime and runtime-context repair |
| Built-in Science preset | `fae091e...`, Science preset/config/snapshot paths | `Science-owned` | Candidate only; final review failed; requires accepted tools and composition evidence |
| Charts and Outcome | No implementation SHA | `Science-owned` | `not-started`; after tools/preset |
| Settings and Science sidebar/client | No implementation SHA | `Science-owned` | `not-started`; product decisions and projection APIs first |
| Desktop carrier | No implementation SHA or first-party artifact | `Desktop-owned` | `not-started`; only after shared Web Standard and Web Science compositions pass |

## Entry, exit, and hard stops

| Kind | Condition | Required response |
|---|---|---|
| Entry | This scope record and the applicable distribution/MVP decision set are accepted; R0A has a classified file ledger and an exact R0B allowlist | Proceed to R0A/R0B only from named SHAs |
| Entry | Official URL resolves the exact commit/tree/version/license; supported Node and pinned pnpm are available; target branch/path are absent | Record values before creating the worktree |
| Entry | Existing `main`, `origin/main`, Phase 3, R-probe, governance, task, and Grok worktree identities and dirty states are recorded | Protect them by path and compare them again at exit |
| Exit | `<R0B_HEAD>` descends directly from `47f943...`; its diff contains only the approved non-product allowlist; worktree is clean | Record full SHA, parent list, tree, status, and diff manifest |
| Exit | The identity ledger and every overlay row have owner, source, target, classification, dependency, status, tests, and evidence-layer state | No unknown or implicitly accepted delta remains |
| Exit | Documentation, focused source, build, packed CLI, packed Web readiness, and clean-diff checks all PASS on `<R0B_HEAD>` | Record literal commands and outputs; do not reuse earlier-SHA results |
| Exit | Every protected pre-existing worktree and ref matches its entry snapshot | Report zero interference and stop |
| Hard stop | Official identity, archive, tree, version, or license mismatches; a source object cannot be attributed to the official URL | Do not create or advance the baseline |
| Hard stop | A dirty/untracked path is unclassified, overlaps another owner, or would be overwritten; a target branch/path already exists | Stop without cleanup or takeover |
| Hard stop | R0 requires product source, tests, package manifests, lockfile, runtime config, branding, license, or release-workflow changes | Re-scope the change to R1 or a separate decision |
| Hard stop | Any required check fails, is environment-blocked without a reproducible host rerun, or was run on a different SHA | Do not claim R0 complete or commit a passing label |
| Hard stop | A step would push, tag, publish, create a PR, access release credentials, or modify an existing protected ref/worktree | Stop for separate explicit authorization |

## Minimum verification matrix

| Layer | Minimum command or probe on `<R0B_HEAD>` | R0 meaning | Investigation status |
|---|---|---|---|
| Identity and scope | `git rev-parse HEAD HEAD^{tree}`; `git merge-base --is-ancestor 47f943859bef60e4160492346772ded9b24f765a HEAD`; `git diff --name-status 47f943859bef60e4160492346772ded9b24f765a..HEAD`; `git status --porcelain=v2 --branch` | Exact ancestry, allowlisted delta, clean tree | Identity inputs verified; future `<R0B_HEAD>` `NOT-RUN` |
| Toolchain/install | `node --version`; `pnpm --version`; `pnpm install --frozen-lockfile` | Reproduce RC5 with its supported engine and immutable dependency graph | `NOT-RUN` |
| Documentation | Focused `verify-agent-note-format`, `verify-agent-note-classification`, and `verify-translation-pairing` while iterating; then `pnpm run doc-sync` and `git diff --check` | Canonical records, links, pair integrity, and generated-doc freshness | `NOT-RUN` for R0B |
| Standard source | `pnpm exec vitest run apps/cli/tests/source-launch.compat.spec.ts apps/cli/tests/web-agent-presets.e2e.ts` | Source CLI launch and shipped Standard/Web composition without real credentials | `NOT-RUN` |
| Standard build | `pnpm run check:ci:artifacts`; then `DSH_REQUIRE_BUILT_CLI_SMOKE=1 pnpm exec vitest run apps/cli/tests/lazy-search-startup.compat.spec.ts` without rebuilding | Host/client/Web build, publint, package invariants, built CLI, and loopback Web readiness | `NOT-RUN` |
| Release-family pack | Reproduce the credential-free `release.yml` pack job: `pnpm run release:verify --family dsh`, pack dsh/vendor/Landlock entry into outside-worktree directories, then `pnpm run release:verify-packed-install --family dsh --from ...` | RC5 package versions, tarball closure, dependency resolution, and installed CLI version; no registry write | `NOT-RUN` |
| Packed Standard Web | In the same isolated packed consumer, run `node <consumer>/node_modules/@deepseek-ai/dsh/lib/bin.js web --host 127.0.0.1 --port 0` with isolated `DSH_HOME`, wait for the ready URL, terminate it, and require exit `0`; use the committed readiness semantics in `scripts/publish-npm-baseline.ts` | The packed Web closure reaches loopback readiness and settles cleanly without a monorepo fallback | `NOT-RUN` |
| Protected state | Repeat the entry worktree/ref/status inventory and compare exact outputs | No existing user work was changed | `NOT-RUN` |

R0 does not run `test:e2e`, model snapshots requiring a key, real Python/R acceptance, Windows Wine checks, browser interaction acceptance, Desktop builds, installers, updater checks, signing, notarization, Authenticode, publication, or release verification. These remain explicitly `NOT-RUN`, not silently skipped.

## Preservation and rollback

Current `main`, live `origin/main`, the Phase 3 candidate, the R-probe branch, the dirty governance worktree, the dirty Grok worktree, and every detached checkout are read-only inputs. R0 does not stage, clean, reset, checkout, prune, repoint, or delete any of them. A status change in any protected path is a hard stop even when the change looks unrelated.

R0 failure affects only the new R0 worktree and branch. The default failure action is to record the new worktree's exact status and HEAD and leave it in place for inspection. Discard is allowed only after proving the target is the exact task-created path, every change is task-owned and preserved or intentionally abandoned, no untracked user path exists, and the full HEAD is recorded. Remove the exact worktree through Git; retain the branch by default. Deleting the exact task-created branch requires separate explicit discard authority. Never use recursive filesystem deletion, reset, or checkout to “clean” a failed candidate.

## Expected file, package, and test impact

| Stage | Expected paths | Explicit non-impact |
|---|---|---|
| This scope investigation | This English/Chinese Agent Note pair, its `.i18n.yaml` record, and the pairing workflow's content-addressed `refs/dsh/translation-pairing/snapshots/*` recovery refs only | No other documentation, source, test, manifest, lockfile, worktree, existing branch/tracking ref, or remote |
| R0A | Existing governance-owned distribution/MVP note pairs; the minimum evidence-route instructions, symlinks, pairing/budget exclusions, and their focused tests; broad instruction condensation split unless independently required | No `packages/`, `apps/`, `vendor/`, `native/`, product tests, package manifests, lockfile, or release workflow |
| R0B | This scope record on the new line; one dated RC5 baseline/evidence pair; one overlay inventory within that evidence; only mechanically required documentation-route metadata | No product or runtime source, no generated product catalogs, no package/version/dependency change, and no Science or Desktop test edit |
| R1 and later | `packages/science/science-session` first; later exact rows may touch generic Session/projection owners, Science Runtime, agent-loop, filesystem, tools, preset, charts/Outcome, settings/client, and Desktop packages with their owning tests/docs | None of these paths is authorized by R0 |

Build and test commands may create ignored outputs and outside-worktree artifacts. R0 records their exact locations and removes only task-created disposable outputs after all processes settle and after verifying that no accepted evidence depends on them. It never treats repository cleanup as permission to touch another worktree.

## Document lifecycle

This record starts as a `proposed/process` Agent Note because it authorizes future workflow and contains acceptance criteria. It moves to `implemented/process` only after R0B exists, all exit conditions pass on one exact `<R0B_HEAD>`, and the file is rewritten into present-tense `Decision`, `Verification`, and `Consequences` sections. Moving the file does not turn `NOT-RUN` layers into PASS.

Exact SHAs, archive hashes, commands, platforms, results, and protected-state snapshots belong in the dated R0 baseline evidence record once R0A establishes that route. Stable architecture documentation receives only current composition or extension-point facts after product code exists; it does not receive branch names, current worktree status, or check reports. Temporary plans and handoffs retire when their durable facts have been transferred and their owning task permits deletion; R0 does not delete pre-existing temporary material merely because this note supersedes its planning role.

The scoped Agent Note audit retains the proposed Science MVP and distribution decisions because they own product architecture, retains the implemented npm release-sequence decision because it owns packing/publication mechanics, and retains the partially superseded artifact-first publication proposal because this R0 does not resolve its remaining installed-artifact questions. No active note qualifies for archive or deletion merely because this scope record is added.

After v0.1 and the later latest-source migration are complete, archive the implemented R0 note only if its baseline-selection rationale, negative guarantees, and overlay replay rules no longer guide future releases. A proposed note is never archived; an abandoned proposal is rejected or deleted under the Agent Note lifecycle rules.

## Sole next step

After R0 completes, the only NEXT is **R1: port and accept the Science Session domain on `<R0B_HEAD>`**. R1 starts only when the R0 worktree is clean, the exact baseline checks are recorded, the Science Session inventory row names its current-main source paths and every required RC5 adaptation, and the R1 diff can be bounded to that domain plus unavoidable generic event/projection support. R1 excludes Science Runtime, runtime-context repair, read-only filesystem, Science tools/preset, charts/Outcome, settings/sidebar, Desktop, publication, and migration to latest. Any RC5 SHA change or R1 finding requires a new exact candidate and affected checks before acceptance.

## Open decisions and unknowns

No additional product decision is required to execute R0: the product owner has selected RC5 and deferred the latest-source migration until after the first version. Build failures, archive checksums, API mapping, and candidate scope are discoverable execution facts and must not be returned to the user as preference questions.

Genuine later decisions remain deliberately deferred: the canonical public repository and remote before any push; v0.1 application name, bundle identifier, signing identities, and update feed before Desktop release work; final settings-card semantics for external Python/R prefixes before settings implementation; and the exact official source selected by the post-v0.1 migration. None blocks an unmodified RC5 baseline.

## Alternatives considered

**Rebase or merge the current downstream history onto official RC5.** Rejected because the histories have no merge base and differ by thousands of official commits. The result would hide ownership and combine accepted, failed, and unimplemented work.

**Start v0.1 from RC6 or continuously follow the latest official source.** Rejected because RC6 is source-unmapped and the product owner fixed v0.1 to RC5. Continuous adoption would invalidate every overlay acceptance repeatedly; one post-v0.1 migration is the bounded alternative.

**Treat governance closure as a separate phase before R0.** Rejected because a baseline without an accepted identity/evidence route cannot become authoritative. R0A keeps governance inside R0 while preventing it from contaminating the R0B source diff.

**Copy the dirty governance worktree wholesale into RC5.** Rejected because its distribution decision, product-note alignment, evidence routing, instruction condensation, manifests, tests, and symlinks have independent owners. R0A classifies and splits them before R0B ports an allowlist.

**Port the currently implemented Science Session, Runtime, or generic runtime-context repair during R0.** Rejected because any product code would make baseline failure ambiguous and erase the clean comparison point. R1 begins with one Science Session slice.

**Trust official RC5 metadata without local source/build/packed checks.** Rejected because upstream publication does not prove this repository's exact branch, allowed diff, local toolchain, packed Web/CLI closure, or absence of monorepo fallback.

## Acceptance criteria

- R0A records an accepted governance decision set, evidence route, exact commit identities, supersession disposition, and R0B file allowlist without taking over unrelated dirty paths.
- `codex/science-v01-rc5-baseline` begins directly at `47f943859bef60e4160492346772ded9b24f765a`, has no downstream-history ancestor, and carries only R0-owned non-product commits.
- The adopted source, R0 head, ignored observed npm artifact, Science overlay, and absent Desktop artifact are separate identity rows with no inferred equivalence.
- The overlay inventory contains every known generic, upstream-candidate, Science-owned, and Desktop-owned delta with the required schema and no product code ported.
- The final diff contains only the approved documentation/evidence allowlist and no `packages/`, `apps/`, `vendor/`, `native/`, `package.json`, lockfile, product test, branding, license, or release-workflow change.
- Documentation, focused source, build, release-family pack, installed CLI identity, and packed Web readiness checks PASS on the same exact `<R0B_HEAD>`; all other evidence layers remain explicitly `NOT-RUN`.
- The R0 worktree is clean, every pre-existing worktree/ref/status matches the entry snapshot, and no cleanup, push, tag, PR, publication, or credential access occurred.
- The handoff names exactly one NEXT: the bounded R1 Science Session port with the entry contract above.

## Risks

The main risks are letting an unrelated-history branch masquerade as an RC5 update, moving failed Phase 3 code as one accepted overlay, allowing broad governance cleanup to dominate the baseline diff, or promoting source/build evidence into release claims. Exact source and baseline identities, the R0A/R0B split, the inventory schema, SHA-bound checks, and separate evidence layers constrain those risks.

Freezing RC5 through the first version accepts a later migration cost. That cost is deliberate: the first release gains a stable source and review target, while the post-v0.1 migration receives its own exact source selection, compatibility audit, overlay replay, and acceptance rather than being paid continuously through daily rebases.
