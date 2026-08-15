# DSH Science v0.1 R0 RC5 baseline closure

English | [中文](2026-08-15-dsh-science-v01-r0-rc5-baseline-closure.zh.md)

Investigated and closed on 2026-08-15. Scope authority: [DSH Science v0.1 RC5 release baseline](../../.agents/notes/implemented/process/2026-08-15-dsh-science-v01-r0-release-baseline-scope.md). This record supersedes only the acceptance conclusion of the [preliminary macOS record](2026-08-15-dsh-science-v01-r0-rc5-baseline.md); that record remains the authority for its observed macOS failure and adapted-install diagnostic.

## Outcome

R0A is accepted at `73c0e9c004157798682759e7d5b0280b9ec913c3`. R0B's checked product inputs are fixed at `948693150e2fe8a9d38fbb1e125a2a106d9488ee`. The accepted R0B head is the single closure commit whose parent is `948693150e2fe8a9d38fbb1e125a2a106d9488ee`, which last changes both the canonical scope triplet and this evidence triplet and is the tip of `codex/science-v01-rc5-baseline`.

The required literal packed-install command passed in the official `Release (dsh)` workflow on its declared `ubuntu-24.04` platform at the exact adopted source commit. The closure commit passes the final documentation and Git-scope rows below, so R0B is accepted. No Science or Desktop implementation is present.

## Exact identities

| Subject | Exact identity | Evidence claim |
|---|---|---|
| Official source | `https://github.com/deepseek-ai/deepseek-harness.git@47f943859bef60e4160492346772ded9b24f765a`; tree `f904efab9ef435201d6ba4da88a34d6366568272`; root `package.json` name `@deepseek-ai/dsh-root`, version `0.1.0-rc.5`, license `MIT`, Node `^22.19.0 || >=24.0.0`, pnpm `11.7.0` | Adopted immutable source |
| Official source archive | GitHub API tarball endpoint `https://api.github.com/repos/deepseek-ai/deepseek-harness/tarball/47f943859bef60e4160492346772ded9b24f765a`; 13,745,620 bytes; SHA-256 `ce0f276905132b73faf7a4d91d6a2d878eeecca1750e0c99aeb192cda727b8ef`; top directory `deepseek-ai-deepseek-harness-47f9438/`; 8,618 archive entries | Download, `gzip -t`, metadata extraction, and checksum PASS on 2026-08-15 |
| Official workflow | [`Release (dsh)` run `31701562303`](https://github.com/deepseek-ai/deepseek-harness/actions/runs/31701562303), job [`94451698870`](https://github.com/deepseek-ai/deepseek-harness/actions/runs/31701562303/job/94451698870); push event; `head_sha` `47f943859bef60e4160492346772ded9b24f765a`; `.github/workflows/release.yml`; started 2026-08-13T12:45:35Z, completed 2026-08-13T12:52:19Z | Primary exact-SHA `ubuntu-24.04` build, pack, and literal packed-install evidence |
| R0A | Branch `codex/science-v01-r0a-governance-closure`; head `73c0e9c004157798682759e7d5b0280b9ec913c3`; tree `c53d3a9274ebf3f5986be5f42224f724c0324a91`; commits `50ff1552ca8ed138ecd162b52c46856e8493e0fb`, `73c0e9c004157798682759e7d5b0280b9ec913c3` after downstream `e5e8b29b435f67e0a5dde5e2132580966e78b27b` | Accepted governance subset; not R0B ancestry |
| R0B checked content | `948693150e2fe8a9d38fbb1e125a2a106d9488ee`; tree `35062cb234e05176fa83132253ea797634700a1a`; direct ancestry `47f943859bef60e4160492346772ded9b24f765a` → `3751f6fcc497e9e23385f69a0d5f3cfdbaac5a6e` → `922d60421a8a6a2983f27de266a02d3d7c5af3b3` → `3ca64b38867fe78792a4d95ff3ba39e26444db82` → `948693150e2fe8a9d38fbb1e125a2a106d9488ee` | Exact product-input tree used by the source/build/packed checks |
| R0B accepted head | Resolve with `git log -1 --format=%H -- .agents/notes/implemented/process/2026-08-15-dsh-science-v01-r0-release-baseline-scope.md` and the same command for this English evidence file; both must equal branch tip and have `948693150e2fe8a9d38fbb1e125a2a106d9488ee` as the sole parent | Exact closure commit; no self-referential SHA placeholder |
| Observed npm artifact | `@deepseek-ai/dsh@0.1.0-rc.6`; integrity `sha512-brpZfED7ieRa2PQ5tUxMhHrM1pb2CmKFVM/f6yMULBDMicahk+Z2OsHgTwTDnoiZm23Ftu9rQz0NN4pflaoJcg==`; no observed `gitHead` | Source-unmapped observation only; not adopted and not equivalent to RC5 |
| Science overlay | `https://github.com/omdsh-dev/dsh-science.git`; source rows below name full SHAs and paths | Downstream provenance only |
| Desktop artifact | None | Desktop build/runtime/installer/signing/release evidence is absent |

The official source archive was downloaded as data and inspected; no archive code was installed or executed. The R0B build used the local Git tree rooted at the same official commit.

## Input inheritance and allowed closure diff

Product-input checks ran at `948693150e2fe8a9d38fbb1e125a2a106d9488ee`. The accepted closure commit may change only these logical records:

- move `.agents/notes/proposed/process/2026-08-15-dsh-science-v01-r0-release-baseline-scope.{md,zh.md,i18n.yaml}` to the corresponding `implemented/process/` paths and rewrite the pair as an implemented Decision;
- add `docs/evidence/2026-08-15-dsh-science-v01-r0-rc5-baseline-closure.{md,zh.md,i18n.yaml}`;
- correct links and acceptance wording in `docs/evidence/2026-08-15-dsh-science-v01-r0-rc5-baseline.{md,zh.md,i18n.yaml}` without changing its historical command results.

`git diff --name-status 948693150e2fe8a9d38fbb1e125a2a106d9488ee..HEAD` must contain no other path. `git diff --exit-code 948693150e2fe8a9d38fbb1e125a2a106d9488ee..HEAD -- package.json pnpm-lock.yaml packages apps vendor native .github/workflows` must exit `0`. These checks prove that source, package, lockfile, application, native, and release-workflow inputs are byte-identical to the checked-content commit. They do not permit results whose inputs include the changed documentation.

## Verification matrix

| Layer | Platform and command | Result and limit |
|---|---|---|
| Toolchain/frozen install | macOS 26.5.2 arm64; Node `v24.19.0`; pnpm `11.7.0`; `pnpm install --frozen-lockfile` | PASS at checked content; exit `0`; dependency graph unchanged |
| Standard source launch | macOS; `pnpm exec vitest run apps/cli/tests/source-launch.compat.spec.ts` | PASS, 1 file and 2 tests |
| Standard build/artifact checks | Non-`/tmp` R0B worktree on macOS; `pnpm run check:ci:artifacts` | PASS, 5/5: build, publint, built-package invariants, NodeNext consumer types, built-bin smoke; 19.25 s |
| Standard Web composition | Same built tree; `pnpm exec vitest run --config vitest.e2e.config.ts apps/cli/tests/web-agent-presets.e2e.ts` | PASS, 30/30; no real provider credential |
| Focused built CLI | Same built tree; `DSH_REQUIRE_BUILT_CLI_SMOKE=1 pnpm exec vitest run apps/cli/tests/lazy-search-startup.compat.spec.ts` | PASS, 1/1 |
| macOS literal packed install | Preliminary record's exact `pnpm run release:verify-packed-install --family dsh --from ...` | Historical FAIL: `--omit=optional` removed koffi's arm64 prebuilt and the fallback source link failed. This was not introduced by the R0B documentation diff; it did not prove whether the workflow platform passed |
| macOS adapted install and Web | Preliminary record's same 231 tarballs, install without `--omit=optional`, installed `--version`, and `POSIX_WEB_PROBE` | PASS: installed version `0.1.0-rc.5`; Standard Web reached loopback readiness and exited `0`. Diagnostic only; it did not replace the literal command |
| Workflow-platform release pack | Official `Release (dsh)` run `31701562303`, exact `head_sha` `47f943859bef60e4160492346772ded9b24f765a`; `.github/workflows/release.yml` declares `runs-on: ubuntu-24.04`, Node major `24`, immutable install, `release:verify --family dsh`, build, dsh/vendor/Landlock pack | PASS: every named job step succeeded; log reports family dsh, 221 members, version `0.1.0-rc.5`, 221 dsh tarballs and 9 vendor tarballs; the Landlock entry makes the installed set 231 |
| Workflow-platform installed CLI identity | Same run/job; literal `pnpm run release:verify-packed-install --family dsh --from dist/npm --from dist/npm-vendor --from dist/npm-landlock` | PASS: step 13 succeeded; log reports installation of 231 tarballs and `installed @deepseek-ai/dsh reports 0.1.0-rc.5` |
| Local Ubuntu replay diagnostic | `docker buildx build --progress plain --load --network host --platform linux/amd64 ...` from a clean `git archive` of checked content | `NOT-RUN` at the product layer: repeated transport preparation was stopped during apt package acquisition after the exact official workflow evidence was found; no repository install/build/pack command ran in the container and no result is inherited from it |
| Final documentation | Accepted head; focused Agent Note, classification, pairing and reasoning-leakage checks; `pnpm run doc-sync`; `pnpm run lint`; `git diff --check 47f943859bef60e4160492346772ded9b24f765a..HEAD` | PASS; all repository documentation gates, lint, pair/link integrity, prose recall review, and whitespace checks succeed on the closure tree; exact command output is reported with the accepted head |
| Final Git scope | Accepted head; ancestry, sole parent, logical-record allowlist, protected-state comparison, and clean status | PASS: official RC5 is an ancestor, the sole parent is checked content, exactly 12 physical paths form the three authorized logical triplets, product/release inputs are unchanged, protected inputs match, and the worktree is clean |

The `/tmp` closure worktree produced a non-acceptance `check:ci:artifacts` failure in two built-bin lifecycle tests. The same command passed in the required non-`/tmp` R0B worktree at the same checked-content commit, so the accepted result uses only the non-temporary worktree run.

## Complete overlay inventory

Every row below is `not-started` against RC5 unless a more restrictive status is shown. Historical downstream tests establish provenance only; they do not establish an RC5 port.

### Identity and ownership

| `delta_id` | Owner | `source_identity` | RC5 target | Classification | `port_status` |
|---|---|---|---|---|---|
| `GEN-SESSION-REGISTRY` | DSH Science maintainers; generic Session/projection owners | `omdsh-dev/dsh-science@e5e8b29b435f67e0a5dde5e2132580966e78b27b`; `packages/core/session/src/known-event-types.ts`, `packages/session/session-projection/**`, persistence/query consumers touched by the downstream Session refactor | `47f943859bef60e4160492346772ded9b24f765a`; generic known-event and projection registration APIs | `generic` | `mapping` in R1 only; no code ported by R0 |
| `SCI-SESSION` | DSH Science maintainers; `science-session` | `omdsh-dev/dsh-science@e5e8b29b435f67e0a5dde5e2132580966e78b27b`; `packages/science/science-session/**`; implementation history begins at `26b3d5013c1fc216ab8ee13d7bec903183cfdf90` and includes `66becdbd97a8284ed3b226686840d19a1e436284` | RC5; new `packages/science/science-session` capability | `Science-owned` | `not-started`; sole R1 product slice |
| `GEN-RUNTIME-CONTEXT` | DSH Science maintainers; `agent-loop` owner; upstream review required | `omdsh-dev/dsh-science@0a940733e80d57c70245134bf260012f9be29114`, tests corrected at `e5e8b29b435f67e0a5dde5e2132580966e78b27b`; `packages/core/agent-loop/src/agent.ts`, loop/resume tests and README | RC5 `packages/core/agent-loop` request-context restoration | `upstream-candidate` | `deferred` until a model-visible Science consumer requires it |
| `SCI-RUNTIME` | DSH Science maintainers; `science-runtime` | `omdsh-dev/dsh-science@e5e8b29b435f67e0a5dde5e2132580966e78b27b`; `packages/science/science-runtime/**`; provider history includes `bf4be838066576dc005822428e259673b049e048` | RC5; new Science runtime capability and local Conda provider composition | `Science-owned` | `deferred` until `SCI-SESSION` is accepted |
| `SCI-R-PROBE` | DSH Science maintainers; `science-runtime` environment owner | `omdsh-dev/dsh-science@b15f1ef42e92b72ad1b53412966408415f669a18`; `packages/science/science-runtime/src/environment.ts` and focused tests/docs | RC5 Science runtime R version discovery after `SCI-RUNTIME` | `Science-owned` | `deferred`; remains a separate evidence identity |
| `FS-READONLY` | Generic filesystem maintainers; upstream review required | `omdsh-dev/dsh-science@8c7d5e01e3876b0c645f13f20ada8cf7add0c356`; `packages/fs/tool-fs/src/{config,index,read-only}.ts`, package metadata, tests/docs | RC5 `packages/fs/tool-fs` read-only plugin entry | `upstream-candidate` | `candidate`; whole Phase 3 candidate was not accepted |
| `FS-READONLY-LOAD-FIX` | Generic filesystem maintainers; upstream review required | `omdsh-dev/dsh-science@0073f6e0a11cd3444564cd1add5a252c70200b64`; read-only loader, package metadata, lockfile and focused tests | RC5 `packages/fs/tool-fs`; depends on `FS-READONLY` | `upstream-candidate` | `candidate`; retain separately from the feature source SHA |
| `SCI-TOOLS` | DSH Science maintainers; `tool-science` | `omdsh-dev/dsh-science@27c96d8e8b2431814fe70a2e94fe8feeaf207b63`; `packages/science/tool-science/**` and directly owned composition/docs | RC5 model-facing Science tool Consumer | `Science-owned` | `candidate`; Phase 3 whole-candidate acceptance was FAIL |
| `SCI-PRESET` | DSH Science maintainers; CLI preset composition | `omdsh-dev/dsh-science@fae091e1080e830bed8ad0456e4cbced29101b01`; `apps/cli/config/agent-presets/science/**`, Science fixture/snapshot and Web preset composition paths | RC5 CLI/Web Science preset | `Science-owned` | `candidate`; Phase 3 whole-candidate acceptance was FAIL |
| `SCI-CHARTS-OUTCOME` | DSH Science product and visualization owners | No implementation SHA; product requirement only | Future RC5 Science chart rendering and Outcome Consumer | `Science-owned` | `not-started` |
| `SCI-SETTINGS-SIDEBAR` | DSH Science product and client owners | No implementation SHA; product requirement only | Future RC5 settings projection, settings card, Science sidebar/client | `Science-owned` | `not-started` |
| `DESKTOP-CARRIER` | DSH Science Desktop/release owners | No implementation SHA and no first-party Desktop artifact | Future desktop carrier over accepted Standard and Science Web composition | `Desktop-owned` | `not-started` |

### Dependencies, tests, evidence, and disposition

| `delta_id` | Dependencies | Required tests and evidence layers | Current evidence and disposition |
|---|---|---|---|
| `GEN-SESSION-REGISTRY` | RC5 known-event mechanism, projection registration, persistence and query APIs | Focused registration/persistence/replay tests; build and package invariants; packed/runtime/Desktop/release not applicable | Historical downstream state only. Map the minimum APIs in R1; port only RC5-missing generic support and propose upstream if independently useful |
| `SCI-SESSION` | `GEN-SESSION-REGISTRY` | Per-file 100% unit coverage; fold, invariant, projection, checkpoint, durability and replay; typecheck/build/publint; real Python/R, Desktop and release not applicable | Historical downstream tests only. Port or rewrite as one R1 slice; hard stop on Runtime/tools/preset leakage |
| `GEN-RUNTIME-CONTEXT` | RC5 agent loop request and resume lifecycle | Focused loop/resume tests, typecheck/build, source-launch composition; packed consumer when a published path reaches it; real-runtime/Desktop/release not applicable | Historical downstream commit and tests only. Re-evaluate after Session; propose upstream or rewrite to RC5 APIs |
| `SCI-RUNTIME` | `SCI-SESSION`; RC5 sandbox, subprocess, shell and session APIs | Runtime lifecycle/unit/loader composition; source/build/packed; clean exact-SHA real Conda Python and R acceptance; Desktop/release not applicable at this layer | Historical downstream infrastructure only. Port after Session and rerun all RC5/runtime evidence; do not inherit Phase 2 PASS |
| `SCI-R-PROBE` | `SCI-RUNTIME`; real Conda R `Rscript` | Environment-spec unit test and independent machine-readable real R acceptance at exact accepted SHA; Desktop/release not applicable | `b15f1ef...` has historical accepted real-runtime evidence. Port with Runtime, then rerun; never infer RC5 PASS |
| `FS-READONLY` | RC5 FS service/tool interfaces | Unit config/tool tests, built read-only entry e2e, typecheck/build/publint and packed root import; real-runtime/Desktop/release not applicable | Candidate provenance only. Defer until the Science tool Consumer requires it, then port or propose upstream separately |
| `FS-READONLY-LOAD-FIX` | `FS-READONLY`; RC5 package-resolution behavior | Invalid and valid loader cases, built e2e, package/lockfile review, build/hygiene | Candidate provenance only. Apply only if the mapped RC5 feature reproduces the loading issue; otherwise reject as obsolete |
| `SCI-TOOLS` | `SCI-RUNTIME`, `GEN-RUNTIME-CONTEXT`, `FS-READONLY`, `FS-READONLY-LOAD-FIX` as proven necessary | Unit and invariant tests, agent-loop composition, built root import, typecheck/build/publint; keyless assembled preset snapshot belongs with the first runnable composition; real Python/R command evidence before acceptance | Phase 3 final review and hygiene were FAIL. Rewrite/port in bounded slices after dependencies; no whole-candidate adoption |
| `SCI-PRESET` | Accepted `SCI-TOOLS` and `SCI-RUNTIME` | Keyless CLI snapshot, Standard/Science Web composition, browser replay fixtures, source/build/packed Web; provider e2e remains key-gated | Phase 3 final review was FAIL. Port only after tools are accepted, then rerun all composition evidence |
| `SCI-CHARTS-OUTCOME` | Accepted tools/preset plus a product decision for model-visible result and renderer ownership | Unit/render/snapshot, assembled app and accessibility/browser evidence; packed Web/Desktop when carriers exist; signing/release later | No implementation or evidence. Make product decision, then implement; do not infer from generic chart support |
| `SCI-SETTINGS-SIDEBAR` | Accepted Runtime and product decisions for prefix/settings projection and navigation ownership | Client unit, API/projection, keyless browser/snapshot, packed Web; Desktop runtime later | No implementation or evidence. Decide settings-card and sidebar semantics before implementation |
| `DESKTOP-CARRIER` | Accepted Standard and Science Web compositions, branding/bundle/signing/update decisions | Desktop build, installed runtime, installer/updater, macOS signing/notarization and Windows Authenticode/platform matrix; publication and release as separate gates | No source or artifact. Start only after shared Web acceptance; all Desktop/release layers are `NOT-RUN` |

## Protected-state preservation

The following paths and refs were read-only inputs. The final comparison must reproduce the same head, branch/detached state, and tracked/untracked status recorded before closure; the closure worktree itself is excluded because this task created it.

| Protected worktree/ref | Entry identity and state |
|---|---|
| `/Users/superjj/ccproj/DSHscience`; `main` | `e5e8b29b435f67e0a5dde5e2132580966e78b27b`; clean; `origin/main` at `0be28653be115622c554dae3f00105c2305b9c02`; local ahead 2 |
| `/private/tmp/dshscience-science-v01-architecture-governance` | `codex/science-v01-architecture-governance@e5e8b29b435f67e0a5dde5e2132580966e78b27b`; 11 tracked modifications and 11 untracked paths |
| `/Users/superjj/.codex/worktrees/24b6/DSHscience` | detached `e5e8b29b435f67e0a5dde5e2132580966e78b27b`; clean before this R0 closure task |
| `/Users/superjj/.codex/worktrees/7e1d/DSHscience` | `codex/fix-science-r-version-probe@b15f1ef42e92b72ad1b53412966408415f669a18`; clean |
| `/Users/superjj/.codex/worktrees/8489/DSHscience` | detached Phase 3 `fae091e1080e830bed8ad0456e4cbced29101b01`; clean |
| `/Users/superjj/.codex/worktrees/8942/DSHscience` | detached `e5e8b29b435f67e0a5dde5e2132580966e78b27b`; clean |
| `/Users/superjj/.codex/worktrees/e229/DSHscience` | detached `e5e8b29b435f67e0a5dde5e2132580966e78b27b`; clean |
| `/Users/superjj/.grok/worktrees/ccproj-dshscience/2026-08-13-a6c14eca` | detached `9e1086777a0eb1c9429e7877deb88387bf52459b`; 54 tracked modifications and 31 untracked paths |
| `/Users/superjj/ccproj/dshscience-r0a-governance-closure` | `codex/science-v01-r0a-governance-closure@73c0e9c004157798682759e7d5b0280b9ec913c3`; clean |
| `/Users/superjj/ccproj/dshscience-r0b-rc5-baseline` before accepted-head fast-forward | `codex/science-v01-rc5-baseline@948693150e2fe8a9d38fbb1e125a2a106d9488ee`; clean; only the named branch may be fast-forwarded to the accepted closure commit after all checks pass |

No protected worktree is staged, cleaned, reset, deleted, or repointed. The canonical R0B branch is fast-forwarded only after acceptance. The task-created closure worktree may then be removed because the accepted commit remains reachable from the canonical branch; authorized remote publication is verified separately. Failed uncommitted state is otherwise retained for inspection.

## Lifecycle and supersession audit

The R0 scope pair moves from `proposed/process` to `implemented/process` only in the accepted closure commit because its entry, exit, and hard-stop conditions are then resolved into the current Decision and Consequences. The preliminary evidence remains dated history and links forward to this record; its macOS FAIL is not rewritten. Stable architecture documents receive no volatile SHA, platform, branch, or check result.

The implemented doc-tier and npm release-sequence notes remain active because they own evidence routing and packing mechanics. The proposed Science MVP, Desktop distribution, and artifact-first notes remain active because R0 does not implement or reject their remaining product decisions. No related active note meets archive or deletion criteria, and no archived note is edited.

## Risks, unknowns, and deferred product decisions

- RC5 intentionally accumulates migration cost while v0.1 is built. The later migration must select an exact current official source and replay each accepted inventory row; it does not inherit RC5 evidence.
- Phase 3 code is provenance, not an accepted stack. A later slice stops if its RC5 mapping pulls unrelated candidate changes or retains its failed whole-candidate state.
- Desktop name, bundle identifier, signing identities, update feed, packaging targets, and release channels remain real product/release decisions, but they do not block R0 or R1 Session.
- Settings-card semantics for external Python/R prefixes, Science navigation ownership, chart/Outcome presentation, and the post-v0.1 target SHA are deferred to their owning slices.
- RC6 source mapping is unnecessary for the fixed first-version base. A security or build-blocking upstream event is handled by separate change control rather than an incidental rebase.

## Explicitly NOT-RUN

Real provider/model calls, key-required e2e or snapshot recording, real Python/R, Windows Wine diagnosis, browser interaction acceptance, Science composition, Desktop/Electron/Tauri build or runtime, installer, updater, signing, notarization, Authenticode, npm publication, Git tag, release job, PR creation, and migration to latest source are `NOT-RUN`. Repository push, when explicitly authorized after acceptance, publishes Git refs only and proves none of these layers.

## Sole next step

The only next implementation is R1: map, port, and accept `GEN-SESSION-REGISTRY` plus `SCI-SESSION` from `omdsh-dev/dsh-science@e5e8b29b435f67e0a5dde5e2132580966e78b27b` onto the resolved accepted R0B head. Every other inventory row remains deferred.
