# DSH Science v0.1 R0 RC5 baseline identity and check record

English | [中文](2026-08-15-dsh-science-v01-r0-rc5-baseline.zh.md)

Investigated on 2026-08-15 on macOS 26.5.2 (Darwin 25.5.0, arm64), Node v24.14.0, pnpm 11.7.0. Scope authority: [`.agents/notes/proposed/process/2026-08-15-dsh-science-v01-r0-release-baseline-scope.md`](../../.agents/notes/proposed/process/2026-08-15-dsh-science-v01-r0-release-baseline-scope.md).

## Investigated identity

The official [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness) source has commit `47f943859bef60e4160492346772ded9b24f765a`, tree `f904efab9ef435201d6ba4da88a34d6366568272`, committed 2026-08-13T19:38:46+08:00 ("Merge pull request #2519 from deepseek-harness/feat/npm-public"). `package.json` at that commit reads `name: "@deepseek-ai/dsh-root"`, `version: "0.1.0-rc.5"`, `license: "MIT"`, `engines.node: "^22.19.0 || >=24.0.0"`, `packageManager: "pnpm@11.7.0"`. The commit object was already present in this repository's local object database before this investigation (no fetch was required; no local or remote-tracking branch was moved to obtain it).

The separately observed npm artifact `@deepseek-ai/dsh@0.1.0-rc.6` (registry `latest`/`next`, publication `2026-08-13T12:35:03.812Z`, integrity `sha512-brpZfED7ieRa2PQ5tUxMhHrM1pb2CmKFVM/f6yMULBDMicahk+Z2OsHgTwTDnoiZm23Ftu9rQz0NN4pflaoJcg==`, no `gitHead`) is recorded only to prevent substitution. It is not adopted, not mapped to a public commit/tag/tree, and out of scope for v0.1.

## R0 baseline candidate

| Slice | Branch | Worktree | HEAD | Parent chain |
|---|---|---|---|---|
| R0A | `codex/science-v01-r0a-governance-closure` | `/Users/superjj/ccproj/dshscience-r0a-governance-closure` | `73c0e9c004157798682759e7d5b0280b9ec913c3` (tree `c53d3a9274ebf3f5986be5f42224f724c0324a91`) | `e5e8b29b435f67e0a5dde5e2132580966e78b27b` (current downstream `main` tip) ← `50ff1552ca8ed138ecd162b52c46856e8493e0fb` ← `73c0e9c004157798682759e7d5b0280b9ec913c3` |
| R0B | `codex/science-v01-rc5-baseline` | `/Users/superjj/ccproj/dshscience-r0b-rc5-baseline` | `<R0B_HEAD>` (recorded below once the final commit lands) | `47f943859bef60e4160492346772ded9b24f765a` (official RC5, no downstream-history ancestor) ← `3751f6fcc4...` ← `922d60421a...` ← `<final>` |

R0A and R0B are independent branches with unrelated histories (`e5e8b29...` and `47f943...` have no merge base; `12,293/17` commits left/right). R0B was created directly at the official commit with `git worktree add -b codex/science-v01-rc5-baseline <path> 47f943859bef60e4160492346772ded9b24f765a`; no rebase, merge, or cherry-pick from R0A, the downstream governance worktree, `main`, Phase 3, or the R-probe branch was performed. R0A's two commits accept a reviewed subset of the dirty governance worktree at `/private/tmp/dshscience-science-v01-architecture-governance` (branch `codex/science-v01-architecture-governance`); R0B's evidence-routing commit ports the same content by direct file copy after confirming the touched files' pre-governance blob hashes are byte-identical between `main` and RC5, not by cherry-pick or merge. The distribution/MVP decision notes accepted in R0A (`.agents/notes/proposed/architecture/2026-08-15-dsh-science-desktop-distribution-reconnaissance.*` and the revised `.agents/notes/proposed/feature/2026-08-12-science-mode-core-mvp.*`) are governance closure for the downstream lineage and are deliberately not carried onto R0B: they are Science/Desktop product-architecture decisions, R0B's own expected-path table does not list them, and RC5 has no `packages/science/*` tree for them to describe.

## Verification matrix

Every result below is bound to the R0B commit current at the time the command ran; the final row repeats identity and protected-state checks against the closing `<R0B_HEAD>` after every other layer passed.

| Layer | Command | Result |
|---|---|---|
| Toolchain/install | `pnpm install --frozen-lockfile` | PASS — 1,203 lockfile entries, no violation; two benign `WARN Failed to create bin at .../examples/node_modules/.bin/...` messages for demo bins whose `lib/bin.js` exists only after `pnpm run build` |
| Documentation (focused) | `pnpm run verify-doc-budgets`, `verify-md-links`, `verify-agent-note-format`, `verify-agent-note-classification`, `verify-translation-pairing` | PASS — 12/12 budgeted docs; 1,897 files/links resolve; 542/542 Agent Notes conform; 937/937 bilingual pairs consistent |
| Documentation (full gate) | `pnpm run doc-sync` | PASS — 28/28 gates in 44.96s |
| Documentation (whitespace) | `git diff --check 47f943...HEAD` | PASS — no whitespace error in the full R0B diff |
| Standard source | `pnpm exec vitest run apps/cli/tests/source-launch.compat.spec.ts` | PASS — 2/2 tests |
| Standard source (Web composition) | `pnpm exec vitest run --config vitest.e2e.config.ts apps/cli/tests/web-agent-presets.e2e.ts` | PASS — 30/30 tests, no real provider credential; discovered prerequisite: this suite resolves packages through built `lib/`, so it only passes after the Standard build layer below has run once |
| Standard build | `pnpm run check:ci:artifacts` | PASS — 5/5 gates (build, publint, node-next-types, built-package-invariants, built-bin smoke) in 34.42s |
| Standard build (built CLI smoke) | `DSH_REQUIRE_BUILT_CLI_SMOKE=1 pnpm exec vitest run apps/cli/tests/lazy-search-startup.compat.spec.ts` (no rebuild) | PASS — 1/1 test |
| Release-family pack (version check) | `pnpm run release:verify --family dsh` | PASS — family `dsh`, 221 members, version `0.1.0-rc.5` |
| Release-family pack (dsh) | `pnpm run release:pack --family dsh --out <outside-worktree>/npm` | PASS — 221 tarballs |
| Release-family pack (vendor) | `pnpm run release:pack --family vendor --out <outside-worktree>/npm-vendor` | PASS — 9 tarballs |
| Release-family pack (Landlock) | `pnpm --dir native/landlock-run run build:ts` then `pnpm --dir native/landlock-run/packages/entry pack --pack-destination <outside-worktree>/npm-landlock` | PASS — 1 tarball, `verify-entry-lib` confirmed built `lib/` present |
| Installed CLI identity (literal official command) | `pnpm run release:verify-packed-install --family dsh --from <npm> --from <npm-vendor> --from <npm-landlock>` | **FAIL — environment-blocked, diagnosed root cause, not a product/R0B defect.** Deterministic across 3 independent host escalations (plain retry; retry with the agent sandbox fully disabled; retry after installing CMake). The script's `npm install --omit=optional` — chosen upstream to skip the unrelated per-architecture Landlock platform packages — collaterally omits `koffi`'s own `@koromix/koffi-darwin-arm64` optional prebuilt binary, forcing `koffi` to build from source via CMake; that from-source build fails to link (`ld: symbol(s) not found for architecture arm64`, missing N-API symbols) on this host's Mach-O/arm64 toolchain. The identical packed tarballs installed fine under `pnpm install --frozen-lockfile` earlier (prebuilt binary resolved normally). R0 does not touch `koffi`, the release workflow, or any dependency to work around this |
| Installed CLI identity (adapted, same tarballs) | Same 231 packed tarballs installed into a separate throwaway consumer with identical `DSH_HOME`/`DSH_AGENTS_HOME`/`DSH_TELEMETRY_DISABLED` environment but without `--omit=optional` (673 packages, exit `0`); `node <consumer>/node_modules/@deepseek-ai/dsh/lib/bin.js --version` | PASS — reports `0.1.0-rc.5`, matching the packed identity exactly |
| Packed Standard Web readiness | In the same adapted consumer, `node <consumer>/node_modules/@deepseek-ai/dsh/lib/bin.js web --host 127.0.0.1 --port 0` under the exact PTY probe in `scripts/publish-npm-baseline.ts` (`POSIX_WEB_PROBE`): wait for `dsh web: http://127.0.0.1:`, `SIGTERM`, require exit `0` | PASS — reached `http://127.0.0.1:50914`, exited `0` after `SIGTERM` |
| Protected state | Re-recorded every pre-existing worktree/ref (`main`, `origin/main`, governance, Phase 3, R-probe, task, Grok worktrees) | PASS — every one matches its entry snapshot exactly; see the scope record's protected-worktree table for the entry values |
| Identity and scope (final) | `git rev-parse HEAD HEAD^{tree}`; `git merge-base --is-ancestor 47f943... HEAD`; `git diff --name-status 47f943...HEAD`; `git status --porcelain=v2 --branch` | Bound to the commit that adds this record, which cannot contain its own resulting hash; the exact `<R0B_HEAD>` and this check's output are recorded in the R0 handoff outside this file |

### Acceptance-criteria gap

The scope record's acceptance criteria name "installed CLI identity" as a required PASS layer bound to the literal minimum-verification-matrix command. That literal command (`pnpm run release:verify-packed-install --family dsh ...`) is FAIL on this host for the diagnosed reason above, not because of any defect in `<R0B_HEAD>`'s content. The adapted verification directly above installs the identical packed tarball set and confirms the packed dependency graph resolves and the installed CLI reports the expected version — but it deliberately does not pass `--omit=optional`, so it does not prove the literal official command's own flag combination would succeed against these tarballs on any platform; it only isolates that the tarball closure and installed identity are correct once optional dependencies are allowed to install. This gap is recorded rather than silently closed; it is not resolved by editing `koffi`, the release workflow, or any dependency, which R0 does not authorize.

`koffi` is a general dependency (`packages/fs/fs-local`, `packages/host/directory-picker-native`, `packages/sandbox/sandbox-windows-acl`, `packages/session/session-persistence-jsonl`), not a Landlock-only one, so the same `--omit=optional` mechanism plausibly also strips koffi's own Linux prebuilt on the `ubuntu-24.04` runner this workflow actually targets, forcing the identical from-source build path there. Whether that build succeeds on Ubuntu's toolchain is genuinely **unverified** by this record — this diagnosis isolates the mechanism and confirms it is host-triggerable, not that it is host-*exclusive*. Whether the real CI is also affected is a separate open question this R0 execution does not resolve; a future dated evidence record or an upstream-intake observation (per the scope record's upstream-intake mechanism) is the right place to close it, not a same-record assumption.

### Explicitly NOT-RUN

Real provider/model calls, `test:e2e` requiring `DEEPSEEK_API_KEY`, real Python/R execution, Windows Wine diagnosis, browser interaction acceptance, Desktop/Electron build, installer, updater, code signing, notarization, Authenticode, npm publication, and release-tag verification are **NOT-RUN** for R0. No command in this record claims any of them.

## Overlay inventory

R0 seeds the following rows and ports none of them; every row's `port_status` is `not-started` unless noted. Full per-row `owner`/`dependencies`/`tests`/`evidence`/`disposition` fields (per the schema in the scope record) are assigned when each delta's own port begins.

| Delta | Source | Classification | R0 status and earliest owner |
|---|---|---|---|
| Generic runtime-context repair | `0a940733e80d57c70245134bf260012f9be29114` plus test correction `e5e8b29b435f67e0a5dde5e2132580966e78b27b`, `packages/core/agent-loop` | `upstream-candidate` | Implemented on downstream `main`; no RC5 mapping or checks; required before model-visible Science tools, not before R0 |
| Science Session domain | `e5e8b29...`, `packages/science/science-session` plus its generic projection/event dependencies | `Science-owned` | Integrated downstream only; R1 sole next slice |
| Science Runtime | `e5e8b29...`, `packages/science/science-runtime`; R-probe correction `b15f1ef42e92b72ad1b53412966408415f669a18` remains separate | `Science-owned` | Integrated downstream infrastructure with separately accepted real-runtime evidence at `b15f1ef...`; port only after Science Session and revalidate on RC5 |
| Read-only filesystem entry | `8c7d5e01e3876b0c645f13f20ada8cf7add0c356` and `0073f6e0a11cd3444564cd1add5a252c70200b64` | `upstream-candidate` | Phase 3 candidate only; whole candidate not accepted; defer until its Consumer needs it |
| Science tool Consumer | `27c96d8e...`, `packages/science/tool-science` | `Science-owned` | Candidate only; inherited Phase 3 hard stops; requires Runtime and runtime-context repair |
| Built-in Science preset | `fae091e1080e830bed8ad0456e4cbced29101b01`, Science preset/config/snapshot paths | `Science-owned` | Candidate only; final review failed; requires accepted tools and composition evidence |
| Charts and Outcome | No implementation SHA | `Science-owned` | `not-started`; after tools/preset |
| Settings and Science sidebar/client | No implementation SHA | `Science-owned` | `not-started`; product decisions and projection APIs first |
| Desktop carrier | No implementation SHA or first-party artifact | `Desktop-owned` | `not-started`; only after shared Web Standard and Web Science compositions pass |

The distribution/MVP governance decisions accepted in R0A (`2026-08-15-dsh-science-desktop-distribution-reconnaissance.*`, revised `2026-08-12-science-mode-core-mvp.*`) inform the eventual owners of the Science-owned and Desktop-owned rows above but are not themselves overlay rows: they carry no implementation SHA and port no code.

## Inferences

RC5's own governance/documentation infrastructure (`.agents/notes/`, `docs/AGENTS.md`, `scripts/doc-budgets.manifest.json`, `scripts/translation-pairing.manifest.json`, `scripts/project-doc-site.spec.ts`) is byte-identical to the same paths on downstream `main` before the architecture-governance worktree's edits — confirmed by matching git blob hashes before any port. This is why R0A's evidence-routing commit content applies to R0B unmodified: both branches started this investigation from the same unedited upstream state for these specific files, despite the branches themselves sharing no commit history.

## Unverified and out of scope

The GitHub source-archive SHA-256 for the official commit was not computed (the commit object was already present locally; no archive download occurred). No RC6 source mapping or compatibility audit was performed. Real provider, real Python/R, Desktop, installer, signing, notarization, and publication readiness remain unknown and are not implied by any PASS above. A later revision does not inherit any result in this record without its own exact-identity rerun.
