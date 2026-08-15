# Agent Note: DSH Science v0.1 R1 Science Session on RC5

Status: proposed

English | [中文](2026-08-15-dsh-science-v01-r1-science-session.zh.md)

## Problem

The accepted DSH Science v0.1 baseline contains official RC5 plus governance and evidence, but no Science product code. The downstream Science Session implementation at `omdsh-dev/dsh-science@e5e8b29b435f67e0a5dde5e2132580966e78b27b` was built beside a broader projection, persistence, query, and lifecycle refactor. Copying its branch or cherry-picking its Phase 1 commits would import changes that R1 neither owns nor needs.

R1 needs one executable scope authority that preserves the accepted domain semantics while adapting them to the RC5 APIs. It must make the first Science product slice independently reviewable and must not turn a domain port into Science Runtime, tools, preset, UI, Desktop, release, or upstream-version work.

## Proposal

R1 adds the durable Science Session domain to the accepted RC5 line and adds only the optional generic projection behavior required to restore that domain safely. The Session log remains the sole durable authority. R1 exposes no public mutation service, starts no process, observes no interpreter, registers no model tool or prompt, and renders no client UI.

The [R0 closure record](../../../../docs/evidence/2026-08-15-dsh-science-v01-r0-rc5-baseline-closure.md) owns the completed baseline identity. The [generic session-projection proposal](../architecture/2026-07-27-session-projection-and-command-log.md), [session log version decision](../../implemented/architecture/2026-08-10-session-log-version-mechanism.md), and [session end-seed decision](../../implemented/architecture/2026-07-30-session-end-seed-log-boundary.md) remain the generic owners; this note fixes only the Science consumer and its bounded RC5 prerequisite.

### Exact identities

| Subject | Identity | R1 use |
|---|---|---|
| Official RC5 source | `deepseek-ai/deepseek-harness@47f943859bef60e4160492346772ded9b24f765a`, version `0.1.0-rc.5` | Immutable upstream product base |
| Accepted R0B head | `omdsh-dev/dsh-science@f9bb7b4a91afe1cf69568184ff093fa9a8bd52f9` | Required product ancestor; no rebase onto another history |
| Science source snapshot | `omdsh-dev/dsh-science@e5e8b29b435f67e0a5dde5e2132580966e78b27b` | Read-only semantic and file provenance |
| Science implementation history | `26b3d5013c1fc216ab8ee13d7bec903183cfdf90` through the Phase 1 closure at `66becdbd97a8284ed3b226686840d19a1e436284`; later `2386ad5d675141495777f5753b6911cd27608302` changes only a shared Science fixture in this package | Historical clues; never a cherry-pick range or inherited PASS |
| R1 implementation base | The accepted commit containing this triplet and the R0 archival change, with `f9bb7b4a91afe1cf69568184ff093fa9a8bd52f9` as an ancestor and only documentation/governance paths between them | Parent of the first R1 product commit; record its exact SHA in R1 closure evidence |

RC6, an observed npm artifact, a later official source, Phase 3 candidate `fae091e1080e830bed8ad0456e4cbced29101b01`, and every dirty worktree are not R1 source identities.

### Entry conditions

| Condition | Required evidence | Hard stop |
|---|---|---|
| Clean implementation worktree | New branch/worktree created from the accepted commit containing this note; `git status --porcelain=v1 --untracked-files=all` is empty before product edits | Existing worktree state, staged content, or untracked content would be reused or cleaned |
| RC5 ancestry | `git merge-base --is-ancestor f9bb7b4a91afe1cf69568184ff093fa9a8bd52f9 HEAD` succeeds; the pre-product diff from that SHA contains only the accepted R0 retirement and R1 plan paths | Product base, parent, or documentation-only prelude differs |
| Read-only source | The exact `e5e8b29...` tree and named historical commits resolve locally; their worktrees remain unchanged | Source identity cannot be resolved or requires editing a provenance worktree |
| Supported toolchain | Node satisfies `^22.19.0 || >=24.0.0`; pnpm is `11.7.0`; the baseline frozen install is usable | A dependency or toolchain workaround would alter the product design |
| Protected state | Existing main, R0A, R0B, governance, Phase 3, R-probe, task, and Grok worktrees are recorded before implementation | R1 would reset, clean, repoint, stage, or absorb any protected state |

Do not rebase, merge, or cherry-pick the downstream history. Port or rewrite each accepted delta against RC5 and retain exact source-path provenance in the R1 evidence inventory.

### Scope

| Direction | Delta | Allowed result |
|---|---|---|
| IN | `SCI-SESSION` | New `packages/science/science-session/**`: branded IDs, six required-on-read Science events, strict decoders and fold, applicability policy, invariant companion, incremental projection, checkpoint admission, replay, package documentation, and owning tests |
| IN | Minimal `GEN-SESSION-REGISTRY` | Optional private checkpoint-state validation, optional private-state-to-row watermark validation, and optional public-view change detection in the existing RC5 `session-projection` implementation, with generic tests and documentation |
| IN | Mechanical integration | `packages/science/` group documentation, RC5-aligned package metadata and version, TypeScript aggregates/paths, workspace lockfile importer, invariant/model-experience allowlists, generated known-event and documentation artifacts, and type-equivalence registrations required by repository gates |
| IN | Acceptance records | This Agent Note lifecycle update and a dated R1 closure evidence triplet after the exact candidate passes review and checks |
| OUT | Later Science slices | Science Runtime, R-probe, runtime-context repair, read-only filesystem entry, Science tools, preset, charts or Outcome consumers, settings, sidebar, Client UI, and Desktop |
| OUT | Broad generic refactor | Definition-token/HMR owner arbitration, callback-containment changes, source file splitting, persistence revision or retirement changes, projection-cache durability redesign, query/API/UI changes, `lastActivityTime`, and every unrelated path from `66becdb...` or `e5e8b29...` |
| OUT | Distribution and migration | Provider calls, real Python/R, browser or Desktop acceptance, installer, signing, npm publication, tag, release, Git push, PR, RC6 adoption, or migration to latest upstream |

### Science Session behavior

The package owns `science/mode-bound`, `science/environment-bound`, `science/run-started`, `science/run-finished`, `science/chart-saved`, and `science/outcome-published`. Each payload has `version: 1`, is lossless JSON, carries a complete domain value rather than a patch, and is required on read. The generated `KNOWN_SESSION_EVENT_TYPES` list includes all six through `gen-persistence-catalog`; no Science event is marked `ignorable`.

`science/mode-bound` is legal once, only for a Session whose `agentPreset` is `science`, and before the first Science-preset request, step, or tool-call fact. The strict fold rejects discontinuous sequences, malformed values, invalid transitions, forward provenance, reused or settled tool calls, non-monotonic revisions or times, and foreign evidence. The invariant applies the Session-header applicability rule and the same strict fold before commit, so rejection appends nothing.

Environment, run, chart, and Outcome types exist as durable vocabulary even though their producers remain out of scope. `session/end-seed` alone derives `interrupted` for an unmatched running run; no synthetic Science terminal event is appended. Outcome stays independent of Goal: neither domain reads, writes, completes, or references the other.

The optional `science` projection is absent when the package is not composed and is `null` before a valid mode binding. Its public value contains only compact replayed metadata and counters; code, stdout, stderr, chart bytes, credentials, and host-absolute attachment paths never enter it. The strict fold remains the one transition authority, and live projection must equal cold replay for every admitted log.

The private projection state remains plain JSON with `stateVersion: 2`, an observed event watermark, an encoded fold, and a sparse redacted witness. Persisted state is admitted only when the Science checkpoint schema can replay the witness to the encoded fold and the embedded watermark equals the checkpoint row's outer `seq`. Supporting events may advance the private watermark without changing the public Science value; such advances must not emit duplicate public projection notifications.

### RC5 adaptation

Keep the RC5 `packages/session/session-projection/src/index.ts` layout. Extend its existing `ProjectionDefinition` with optional `checkpointStateSchema`, `checkpointStateSeq`, and `viewChanged` members; apply them consistently in checkpoint creation, zero-I/O checkpoint view, restore-floor selection, cold restore, and live notification. Definitions that omit the members retain RC5 behavior. Invalid or transformed checkpoint state is discarded and requires a full-log refold; an embedded/outer watermark mismatch is rejected on both checkpoint emission and admission.

Do not port `definitionToken`, owner-aware HMR takeover, callback containment, prototype-key hardening, the downstream file split, or its persistence/query/lifecycle changes. Those changes are not required for the Science definition on RC5 and remain under their generic owner. A failing focused test that proves one is necessary is a scope change, not permission to import the downstream commit.

Adapt the Science package root to the RC5 definition by omitting downstream-only registration members outside the three optional capabilities above. Derive the package manifest from RC5 sibling packages: use version `0.1.0-rc.5`, `publishConfig.access: public`, the sibling repository field, and RC5 dependency versions. Manifest metadata does not authorize publication. Do not copy the downstream package's `0.0.1-rc.2` or `publishConfig.access: restricted` metadata.

`packages/core/session/src/known-event-types.ts` is generated output. Add Science declaration merging first, run the owning generator, and review the resulting event list. Do not hand-edit the generated file. Existing persistence, projection-cache, and query implementations remain source-identical unless a named R1 acceptance test fails for the three optional registry capabilities; any required code change outside the listed generic owner requires an amendment to this note before implementation continues.

### Expected impact

| Area | Expected paths | Rule |
|---|---|---|
| Science domain | `packages/science/science-session/**`, `packages/science/README.{md,zh.md,i18n.yaml}` | Port domain semantics, rewrite only for RC5 APIs, and keep package/invariant tests with the owner |
| Generic prerequisite | `packages/session/session-projection/src/index.ts`, its tests and README pair, and `docs/subsystems/session-projection.*` | Add only the three optional capabilities; preserve current consumers |
| Package integration | `packages/README.*`, `tsconfig.base.json`, `tsconfig.host.json`, `pnpm-lock.yaml`, and narrowly required script manifests or allowlists | Every change must be mechanical evidence of the new package |
| Generated references | `packages/core/session/src/known-event-types.ts`, persistence/module graphs, subsystem indexes, and other outputs named by the generators | Regenerate from owners; do not edit generated English sources directly |
| Decision and evidence | This triplet, the still-active generic projection note when its declared interface changes, and one dated R1 closure evidence triplet | Keep stable rationale in Agent Notes and dated SHA/command results in evidence |

The implementation records the final path list with `pnpm --silent run change-scope --base <R1-plan-base> --head HEAD`. A changed path outside these categories is a hard stop unless its owning generator names it or this note is amended before the code change.

### Implementation stages

1. Record the exact implementation base, protected-worktree state, supported toolchain, source identities, and an empty product diff. Build a per-file mapping from the `e5e8b29...` Science package to RC5; do not copy files until every dependency and generated owner is classified.
2. Add the three optional generic projection capabilities in place, with focused invalid-state, watermark, unchanged-public-view, restore, and existing-consumer regression tests. Keep this as an independently reviewable generic prerequisite commit.
3. Add the RC5-aligned Science package, strict domain and invariant behavior, projection registration, package metadata, group docs, focused tests, and mechanical generator outputs. Do not compose it into a shipped preset or application.
4. Run the verification matrix, inspect the complete diff, and obtain a fresh independent review at the exact candidate SHA. Any repair creates a new candidate SHA and repeats affected checks and review.
5. On acceptance, add dated closure evidence, move this triplet to `implemented/feature`, and rewrite it into present-tense `Decision` and `Consequences` sections. Stop before Science Runtime.

### Verification matrix

| Evidence | Required command or observation | Limit |
|---|---|---|
| Scope and ancestry | `git merge-base --is-ancestor f9bb7b4a91afe1cf69568184ff093fa9a8bd52f9 HEAD`; `pnpm --silent run change-scope --base <R1-plan-base> --head HEAD`; `git diff --check <R1-plan-base>..HEAD` | Proves only ancestry, changed paths, and whitespace |
| Science and registry behavior | `pnpm exec vitest run packages/science/science-session/tests packages/session/session-projection/tests` | Must cover strict fold, applicability, invariant rejection, live/cold replay, optional registration, HMR disposal, checkpoint admission, and notification behavior |
| Focused per-file coverage | `pnpm exec vitest run --coverage --coverage.include='packages/science/science-session/src/**' --coverage.include='packages/session/session-projection/src/**' packages/science/science-session/tests packages/session/session-projection/tests` | Every included source file reaches 100%; do not lower thresholds or add unjustified ignores |
| Existing durability consumers | Focused `session-projection-cache`, JSONL, SQLite, and session-query tests selected from the actual generic diff | Regression evidence only; no code port is implied by running them |
| Static and package checks | `pnpm run typecheck`; `pnpm run hygiene`; `pnpm run check:ci:artifacts` | Source, package, built export, publint, invariant, and NodeNext evidence; no installed application claim |
| Documentation | Focused translation re-records; `pnpm run doc-sync`; `pnpm run lint` | Pair meaning requires human review in addition to mechanical PASS |
| Exact candidate review | Fresh reviewer receives the exact base/head, IN/OUT table, path inventory, test results, and NOT-RUN list | A verdict on another SHA is not acceptance evidence |

Keyless or with-key model snapshots are not required because R1 adds no model-facing Consumer or assembled Science composition. Real Python/R, provider calls, browser, Desktop, packed installer, signing, publication, and release remain `NOT-RUN` and cannot be inferred from this matrix.

## Alternatives considered

**Cherry-pick the Phase 1 commits.** Rejected because `66becdb...` combines Science closure with broad generic persistence, query, API, lifecycle, and documentation changes. Commit identity is provenance, not an applicable patch boundary on RC5.

**Copy the Science package without checkpoint admission.** Rejected because RC5 would accept a version-matching private cache row without proving its witness, fold, or embedded watermark. A corrupt or spliced shortcut could then serve a value that strict replay would reject.

**Port the complete downstream projection refactor.** Rejected because owner-aware HMR arbitration, callback containment, file splitting, durability revisions, and query changes are independent generic work. R1 needs only three optional capabilities that preserve existing RC5 definitions.

**Wait for Science Runtime before adding the domain.** Rejected because Runtime must append durable facts through an accepted Session vocabulary and invariant. Reversing the dependency would make execution behavior define its own record semantics.

**Move to the latest official version first.** Rejected because v0.1 is fixed on RC5. Migration to the latest official source occurs only after the first complete version and replays accepted overlay rows as a separate program.

## Supersession and lifecycle

This note does not supersede the generic session-projection, session-log-version, session-end-seed, persistence, or Goal decisions. They remain active because their generic rationale and guarantees continue to govern other consumers. The R1 implementation updates the generic projection note only where the three optional members change its declared interface and links back to the implemented R1 decision.

The completed [R0 scope record](../../archived/process/2026-08-15-dsh-science-v01-r0-release-baseline-scope.md) is archived because all of its one-time baseline steps are resolved and the R0 closure evidence owns the accepted identities and results. It remains a frozen historical snapshot. This proposed triplet stays active until R1 is implemented or rejected and is never archived while proposed.

## Acceptance criteria

- The accepted candidate descends from the recorded R1 plan base and has no Runtime, tools, preset, UI, Desktop, release, or latest-upstream path.
- All six Science event declarations are generated into the required-on-read vocabulary, and an RC5 reader without them refuses the resulting log rather than silently skipping them.
- Strict replay, incremental projection, cold restore, and checkpoint-backed restore produce the same public Science value for every accepted test log; malformed streams and invalid cache rows fail or refold as specified.
- The invariant rejects invalid Science facts before append, while Standard sessions and hosts without the optional projection registry retain their prior behavior.
- Every changed Science and generic projection source file meets focused per-file 100% coverage, and the required static, package, artifact, documentation, and exact-SHA review checks pass.
- A dated closure record separates source/unit, generated, built-package, and NOT-RUN evidence and lists every final delta with its source SHA and owner.
- The final Agent Note is implemented, the worktree is clean, protected worktrees are unchanged, and the sole next implementation is Science Runtime on the accepted R1 head.

## Risks

- The downstream package mixes durable vocabulary for future producers with no current producer. Strict applicability and the absence of a mutation service prevent R1 from fabricating runtime evidence, but reviewers must keep consumer code out of the slice.
- Sparse witnesses still grow with retained provenance. R1 makes no constant-time or bounded-history claim; optimization waits for measured need and may not weaken replay equivalence.
- Optional checkpoint admission changes a generic published package. Existing definitions must preserve RC5 behavior when the new members are absent, and focused consumer tests must prove that compatibility.
- Required-on-read Science events intentionally make sessions unreadable by older builds. Marking them ignorable to improve compatibility would silently remove domain truth and is forbidden.
- Generated and package-integration paths can obscure scope growth. Every such path must trace to an owning generator or manifest requirement; otherwise implementation stops for a plan amendment.
