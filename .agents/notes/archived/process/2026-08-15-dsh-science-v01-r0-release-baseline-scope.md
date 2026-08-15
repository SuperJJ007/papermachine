# Agent Note: DSH Science v0.1 RC5 release baseline

Status: implemented
Archived: 2026-08-15

English | [中文](2026-08-15-dsh-science-v01-r0-release-baseline-scope.zh.md)

## Problem

DSH Science needs one attributable upstream source before Science or Desktop implementation moves onto a public release line. The downstream Science history and official DeepSeek Harness source have no merge base, and the downstream line combines accepted Science foundations, failed Phase 3 candidates, repository governance, and later distribution work. Replaying that history would hide ownership and make source, build, installed-artifact, runtime, Desktop, signing, and publication results appear interchangeable.

The first v0.1 implementation also needs a stable source. Continuously rebasing onto a moving upstream revision would invalidate each accepted overlay while the product is still establishing its first complete version.

## Decision

R0 establishes `codex/science-v01-rc5-baseline` directly from official DeepSeek Harness commit `47f943859bef60e4160492346772ded9b24f765a`, whose tree is `f904efab9ef435201d6ba4da88a34d6366568272` and root version is `0.1.0-rc.5`. Its single deliverable is the accepted tip of that branch together with the canonical scope and evidence records that resolve the tip. The R0 line carries governance routing, identity and validation evidence, and an overlay inventory only. It contains no product source, package manifest, lockfile, runtime configuration, release-workflow, Science, or Desktop change.

RC5 remains fixed until the first DSH Science v0.1 implementation is complete. A later migration selects the then-current exact official revision and replays the accepted overlay stack. RC6 and other observed revisions do not change this baseline.

### Exact identities

| Identity | Value | Maximum claim |
|---|---|---|
| Adopted official source | `https://github.com/deepseek-ai/deepseek-harness.git`; commit `47f943859bef60e4160492346772ded9b24f765a`; tree `f904efab9ef435201d6ba4da88a34d6366568272`; root `0.1.0-rc.5`; MIT | Exact public source identity |
| R0A governance provenance | `codex/science-v01-r0a-governance-closure`; `73c0e9c004157798682759e7d5b0280b9ec913c3`; tree `c53d3a9274ebf3f5986be5f42224f724c0324a91` | Accepted governance subset on the downstream lineage |
| R0B checked-content commit | `948693150e2fe8a9d38fbb1e125a2a106d9488ee`; tree `35062cb234e05176fa83132253ea797634700a1a` | Product-input checks whose exact inputs are unchanged by the closure-only commit |
| R0B accepted head | The commit that last changes this triplet and the [closure evidence](../../../../docs/evidence/2026-08-15-dsh-science-v01-r0-rc5-baseline-closure.md); both paths resolve to the same commit, which is the accepted branch tip | R0 source, build, packed, and documentation results recorded in the closure evidence |
| Observed npm artifact | `@deepseek-ai/dsh@0.1.0-rc.6`, registry integrity `sha512-brpZfED7ieRa2PQ5tUxMhHrM1pb2CmKFVM/f6yMULBDMicahk+Z2OsHgTwTDnoiZm23Ftu9rQz0NN4pflaoJcg==`, no observed `gitHead` | A source-unmapped npm artifact exists; it is not RC5 |
| Science overlay | `https://github.com/omdsh-dev/dsh-science.git` at the full SHAs in the closure inventory | Downstream or historical candidate source only |
| Desktop artifact | None | No Desktop source, installer, signature, or runtime evidence exists |

An evidence file cannot contain the SHA of its own containing commit. R0 therefore resolves its accepted head from Git history instead of copying a self-referential placeholder into prose:

```sh
git log -1 --format=%H -- .agents/notes/implemented/process/2026-08-15-dsh-science-v01-r0-release-baseline-scope.md
git log -1 --format=%H -- docs/evidence/2026-08-15-dsh-science-v01-r0-rc5-baseline-closure.md
```

Both commands return the same commit at acceptance, and `codex/science-v01-rc5-baseline` points to it. The closure record pins that commit's exact parent, ancestry, tree, allowed path manifest, and clean status. Product-input results originate at `948693150e2fe8a9d38fbb1e125a2a106d9488ee`; the closure record proves that the accepted head changes only the scope/evidence triplets after that commit. Documentation checks run on the accepted head itself.

### R0A and R0B

R0A classifies and accepts the minimum governance subset without taking ownership of the dirty architecture-governance worktree. Its first commit carries the distribution reconnaissance and Science MVP alignment on the downstream lineage. Its second commit establishes concise Agent/evidence/subsystem routes, required symlinks, documentation exclusions, and the dated-evidence tier. Broad root and `docs/AGENTS.md` condensation remains outside R0.

R0B ports the approved documentation mechanics by content, not by merge or cherry-pick, onto the official RC5 history. The downstream root, `main`, Phase 3, and R-probe commits are absent from R0B ancestry. A blocked candidate may retain local evidence commits for diagnosis, but only the closure record and its resolved containing commit establish acceptance.

### Included and excluded work

| Area | Included | Excluded |
|---|---|---|
| Identity | Official RC5 commit/tree/version/license, observed archive checksum, accepted R0 head, unmapped RC6 observation | RC6 adoption, inferred source/artifact equivalence, or a moving upstream branch |
| Governance | R0 decision, dated evidence route, exact validation record, complete overlay inventory, mechanical pairing/budget/site metadata | Wholesale dirty-governance transfer, broad documentation cleanup, temporary plans, or chat handoffs |
| Validation | Frozen install; documentation; Standard source, build, CLI, Web composition; release-family packing; installed CLI identity on the workflow platform; packed Web readiness; exact Git scope | Real provider/model, real Python/R, broad product e2e, Windows diagnosis, Desktop, installer, signing, publication, or release readiness |
| Product | Inventory and provenance only | Every Science, generic runtime, Electron/Tauri, Desktop, package, application, test, manifest, lockfile, branding, license, or release-workflow implementation |

The literal `release:verify-packed-install` command is evaluated on the release workflow's declared `ubuntu-24.04` platform. The macOS arm64 source-build failure caused by `npm install --omit=optional` is retained as a platform diagnostic; an adapted install without that flag does not substitute for the required Ubuntu result.

### Entry, exit, and hard stops

| Type | Condition | Required response |
|---|---|---|
| Entry | Official URL, commit, tree, root version, license, Node range, and pnpm version resolve exactly; R0A has an accepted allowlist; every pre-existing worktree/ref and dirty/untracked state is recorded | Create an isolated branch/worktree directly at the official commit; do not move an existing ref or worktree |
| Entry | The supported toolchain and the release workflow's `ubuntu-24.04` platform are available | Run only the minimum source/build/packed checks that match R0's unmodified product inputs |
| Exit | The accepted tip descends from official RC5 through R0-owned documentation/evidence commits only; the closure commit has checked-content parent `948693150e2fe8a9d38fbb1e125a2a106d9488ee`; the exact logical-record allowlist is clean | Record ancestry, tree, path manifest, clean status, and mechanical accepted-head resolution |
| Exit | Every overlay row has owner, exact source and target, classification, dependencies, status, planned tests, evidence layer, and disposition | Keep every code row unported and name exactly one next slice |
| Exit | Required documentation, Standard source/build, release-family pack, workflow-platform installed identity, packed Web, and protected-state checks pass at their exact inputs | Move the scope pair to `implemented/process`; retain every other layer as explicit `NOT-RUN` |
| Hard stop | Official identity or archive metadata disagree; a required check fails on its required platform; the result cannot be bound to exact unchanged inputs | Do not accept, commit, fast-forward, or push the R0B closure |
| Hard stop | R0 would need a product source, test, package manifest, lockfile, runtime config, branding, license, or release-workflow edit | Leave the change for R1 or a separately authorized decision |
| Hard stop | A protected worktree/ref changes, ownership of a dirty path is unclear, or a step would tag, publish, create a release/PR, or rewrite history | Stop without cleanup or broader mutation |

### Overlay inventory contract

The [closure evidence](../../../../docs/evidence/2026-08-15-dsh-science-v01-r0-rc5-baseline-closure.md#complete-overlay-inventory) owns the complete rows. Every row carries:

| Field | Required content |
|---|---|
| `delta_id` | Stable identifier independent of commit order |
| `owner` | Responsible maintainers plus owning package or process area |
| `source_identity` | Repository URL, full source SHA, and source paths; distinct evidence identities remain distinct rows |
| `target` | Official RC5 SHA plus target package, capability, or carrier |
| `classification` | Exactly one of `generic`, `upstream-candidate`, `Science-owned`, or `Desktop-owned` |
| `dependencies` | Other delta IDs and exact upstream APIs required first |
| `port_status` | `not-started`, `mapping`, `candidate`, `verified`, `deferred`, or `rejected` |
| `tests` | Planned source, build, packed, real-runtime, Desktop, and release checks, with inapplicable layers explicit |
| `evidence` | Exact candidate SHA, command/result/date/platform/evidence layer, or an explicit historical/NOT-RUN state |
| `disposition` | Port, rewrite, propose upstream, retain as reference, or reject, including any hard stop |

No inventory row is implicitly accepted. A source SHA and historical PASS establish provenance, not RC5 compatibility.

### Verification

The [closure evidence](../../../../docs/evidence/2026-08-15-dsh-science-v01-r0-rc5-baseline-closure.md) records commands, platforms, exact identities, results, and inherited-input arguments. R0 keeps these evidence layers separate:

| Layer | R0 result |
|---|---|
| Official source/archive | Commit, tree, metadata, GitHub archive SHA-256, and archive contents verified |
| Documentation | Focused Agent Note/pairing checks, `doc-sync`, lint, and whitespace checks pass on the accepted head |
| Standard source/build | Source launch, Standard Web composition, build, publint, NodeNext types, built-package invariants, built-bin smoke, and focused built CLI smoke pass |
| Packed artifact | DSH/vendor/Landlock families pack; the literal installed CLI check passes on `ubuntu-24.04`; packed Standard Web reaches loopback readiness and shuts down cleanly |
| Runtime/Desktop/release | Real provider, Python/R, Desktop runtime, installer, updater, signing, notarization, Authenticode, npm publication, tag-based release, and latest-source migration are `NOT-RUN` |

Source or build PASS never proves an installed artifact, runtime, platform, Desktop, signing, or release result. A later source or product-input change inherits no result without an exact input-identity proof and the affected rerun.

### Preservation and upstream intake

The existing `main`, `origin/main`, architecture-governance, task, R-probe, Phase 3, detached, and Grok worktrees remain protected inputs. R0 does not stage, clean, reset, repoint, delete, or rewrite them. The closure evidence records their exact heads and dirty/untracked counts before and after R0.

During the first v0.1 implementation, upstream intake is observation-only and occurs at most once every two days. A record stores the official default-ref SHA, relevant release/security links, observation time, and one disposition: `no-impact`, `security-review-required`, or `post-v0.1-migration-input`. It never merges, rebases, cherry-picks, or changes RC5 merely because upstream moved. A credible security or build-blocking event opens separate change control.

### Sole next step

The only next implementation is R1: port and accept the Science Session domain from `https://github.com/omdsh-dev/dsh-science.git@e5e8b29b435f67e0a5dde5e2132580966e78b27b` onto the resolved R0B accepted head.

R1 starts from a clean worktree and maps `SCI-SESSION` plus `GEN-SESSION-REGISTRY` before editing. Its diff is limited to `packages/science/science-session` and unavoidable generic event/projection registration that RC5 lacks, with owning tests, documentation, and exact-RC5 build evidence. R1 excludes Science Runtime, the runtime-context repair, read-only filesystem, Science tools/preset, charts/Outcome, settings/sidebar, Desktop, publication, and migration to latest.

## Alternatives considered

**Rebase or merge the downstream history onto RC5.** Rejected because the histories have no merge base and the downstream line mixes accepted, failed, and unfinished work. The overlay inventory preserves provenance without transplanting that history.

**Start v0.1 from RC6 or continuously follow upstream.** Rejected because the observed RC6 npm artifact has no verified source mapping and continuous adoption would repeatedly invalidate overlay evidence. One post-v0.1 migration has a bounded source identity and review.

**Treat the adapted macOS install as the required packed-install result.** Rejected because omitting `--omit=optional` changes the official command. The required literal command runs on the workflow's declared Ubuntu platform; macOS remains a separate diagnostic.

**Copy an accepted commit's own SHA into its evidence file.** Rejected because a Git commit cannot contain its resulting hash. Resolving the commit that last changed both canonical records is mechanically checkable and avoids an external handoff or mutable placeholder.

**Move the dirty governance worktree or Phase 3 candidate wholesale.** Rejected because each contains independently owned concerns and Phase 3 retains failed whole-candidate evidence. R0 takes only its reviewed governance routes; later overlays move one inventory row at a time.

## Consequences

R0 provides a clean RC5 comparison point and exact ownership ledger without claiming that any Science or Desktop feature is present. The first version pays no continuous-upstream churn; the later migration pays one explicit compatibility and overlay-replay cost.

The accepted head contains a documentation-only closure commit after the checked-content commit. This arrangement preserves an in-repository evidence owner without pretending a file can embed its own commit hash; exact path-equivalence checks define which earlier results remain applicable, and final documentation checks bind to the accepted head.

The R0 decision remains active while RC5 is the first-version base or its replay rules guide the later migration. No related implemented note is archived, no proposed note is rejected, and no pre-existing temporary or dirty work is deleted by this decision.

A later explicitly authorized push of the accepted branches is repository publication only. It does not create a product tag, npm package, installer, signed artifact, or release-readiness claim.
