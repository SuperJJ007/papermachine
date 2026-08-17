# Agent Note: DSH Science v0.1 R1 Science Session on RC5

Status: implemented

English | [中文](2026-08-15-dsh-science-v01-r1-science-session.zh.md)

## Problem

At the time, the accepted DSH Science v0.1 baseline contained official RC5 plus governance and evidence, but no Science product code. The downstream Science Session implementation at `omdsh-dev/dsh-science@e5e8b29b435f67e0a5dde5e2132580966e78b27b` was built beside a broader projection, persistence, query, and lifecycle refactor. Copying its branch or cherry-picking its Phase 1 commits would have imported changes R1 neither owns nor needs.

R1 needed one executable scope authority that preserved the accepted domain semantics while adapting them to the RC5 APIs, made the first Science product slice independently reviewable, and did not turn a domain port into Science Runtime, tools, preset, UI, Desktop, release, or upstream-version work.

## Decision

R1 adds the durable Science Session domain at `packages/science/science-session`, plus the minimal optional generic projection behavior required to restore that domain safely. The line has since [rebaselined onto rc.7](../../implemented/process/2026-08-17-dsh-science-v01-rc7-rebaseline.md); the RC5 adaptation this Note records below describes the port as executed, not the line's current upstream base. The Session log remains the sole durable authority. The package exposes no public mutation service, starts no process, observes no interpreter, registers no model tool or prompt, and renders no client UI.

Every file in `packages/science/science-session/src/*.ts` (17 files) and `tests/*.ts` (11 files) is a direct, unmodified copy of the matching file at `omdsh-dev/dsh-science@e5e8b29`'s `packages/science/science-session`, because none of them reference the downstream session-projection refactor's excluded concerns. Two files are adapted rather than copied: `src/index.ts` drops the `definitionToken` field from its `ctx.sessionProjections.register(...)` call, because RC5's `ProjectionDefinition` does not declare it; and `tsconfig.json`'s TypeScript project `references` are re-derived against RC5's actual package layout (dropping `vendor/cosmokit`, which RC5's sibling packages do not depend on). `package.json` and both READMEs are freshly written from RC5 sibling-package templates — version `0.1.0-rc.5`, `publishConfig.access: public`, MIT, the shared repository field — not copied from the downstream's `0.0.1-rc.2`/`restricted`/BSD-3-Clause metadata.

`packages/session/session-projection/src/index.ts` (RC5's existing single-file `SessionProjectionRegistry`) gained three optional `ProjectionDefinition` members — `checkpointStateSchema`, `checkpointStateSeq`, `viewChanged` — applied at exactly five integration points: checkpoint creation, zero-I/O checkpoint view, restore-floor selection, cold restore, and live notification. A definition that omits all three keeps RC5's unqualified behavior; every existing session-projection test still passes unmodified. `definitionToken`, owner-aware HMR takeover, callback containment, prototype-key hardening, the downstream's file split, and its persistence/query/lifecycle changes are not ported — they remain under their existing generic owner and were not required to serve the Science definition on RC5.

The [R0 closure record](../../../../docs/evidence/2026-08-15-dsh-science-v01-r0-rc5-baseline-closure.md) owns the accepted baseline identity this note builds on. The [generic session-projection proposal](../../proposed/architecture/2026-07-27-session-projection-and-command-log.md), [session log version decision](../architecture/2026-08-10-session-log-version-mechanism.md), and [session end-seed decision](../architecture/2026-07-30-session-end-seed-log-boundary.md) remain the generic owners of the mechanisms this note's package consumes; this note owns only the Science consumer and its bounded RC5 registry prerequisite.

### Science Session behavior

The package owns `science/mode-bound`, `science/environment-bound`, `science/run-started`, `science/run-finished`, `science/chart-saved`, and `science/outcome-published`. Each payload has `version: 1`, is lossless JSON, carries a complete domain value rather than a patch, and is required on read. The generated `KNOWN_SESSION_EVENT_TYPES` list includes all six through `gen-persistence-catalog`; no Science event is marked `ignorable`.

`science/mode-bound` is legal once, only for a Session whose `agentPreset` is `science`, and before the first Science-preset request, step, or tool-call fact. The strict fold rejects discontinuous sequences, malformed values, invalid transitions, forward provenance, reused or settled tool calls, non-monotonic revisions or times, and foreign evidence. The invariant applies the Session-header applicability rule and the same strict fold before commit, so rejection appends nothing.

Environment, run, chart, and Outcome types exist as durable vocabulary even though their producers remain out of scope. `session/end-seed` alone derives `interrupted` for an unmatched running run; no synthetic Science terminal event is appended. Outcome stays independent of Goal: neither domain reads, writes, completes, or references the other.

The optional `science` projection is absent when the package is not composed and is `null` before a valid mode binding. Its public value contains only compact replayed metadata and counters; code, stdout, stderr, chart bytes, credentials, and host-absolute attachment paths never enter it. The strict fold remains the one transition authority, and live projection equals cold replay for every admitted log.

The private projection state is plain JSON with `stateVersion: 2`, an observed event watermark, an encoded fold, and a sparse redacted witness. Persisted state is admitted only when the Science checkpoint schema can replay the witness to the encoded fold and the embedded watermark equals the checkpoint row's outer `seq`. Supporting events may advance the private watermark without changing the public Science value; such advances do not emit duplicate public projection notifications.

### Scope

| Direction | Delta | Result |
|---|---|---|
| IN | `SCI-SESSION` | `packages/science/science-session/**`: branded IDs, six required-on-read Science events, strict decoders and fold, applicability policy, invariant companion, incremental projection, checkpoint admission, replay, package documentation, and owning tests |
| IN | Minimal `GEN-SESSION-REGISTRY` | Optional private checkpoint-state validation, private-state-to-row watermark validation, and public-view change detection in RC5's existing `session-projection` implementation, with generic tests and documentation |
| IN | Mechanical integration | `packages/science/` group documentation, RC5-aligned package metadata and version, TypeScript project references, workspace lockfile entry, the `SENTENCE_MODEL_EXPERIENCE` allowlist entry, and generated known-event/catalog/doc-graph artifacts required by repository gates |
| OUT | Later Science slices | Science Runtime, R-probe, runtime-context repair, read-only filesystem entry, Science tools, preset, charts or Outcome consumers, settings, sidebar, Client UI, and Desktop |
| OUT | Broad generic refactor | Definition-token/HMR owner arbitration, callback-containment changes, source file splitting, persistence revision or retirement changes, projection-cache durability redesign, query/API/UI changes, and every unrelated path from `66becdb...` or `e5e8b29...` |
| OUT | Distribution and migration | Provider calls, real Python/R, browser or Desktop acceptance, installer, signing, npm publication, tag, release, Git push, PR, RC6 adoption, or migration to latest upstream |

## Alternatives considered

**Cherry-pick the Phase 1 commits.** Rejected because `66becdb...` combines Science closure with broad generic persistence, query, API, lifecycle, and documentation changes. Commit identity is provenance, not an applicable patch boundary on RC5.

**Copy the Science package without checkpoint admission.** Rejected because RC5 would accept a version-matching private cache row without proving its witness, fold, or embedded watermark. A corrupt or spliced shortcut could then serve a value that strict replay would reject.

**Port the complete downstream projection refactor.** Rejected because owner-aware HMR arbitration, callback containment, file splitting, durability revisions, and query changes are independent generic work. R1 needed only three optional capabilities that preserve existing RC5 definitions.

**Wait for Science Runtime before adding the domain.** Rejected because Runtime must append durable facts through an accepted Session vocabulary and invariant. Reversing the dependency would make execution behavior define its own record semantics.

**Move to the latest official version first.** Rejected because v0.1 is fixed on RC5. Migration to the latest official source occurs only after the first complete version and replays accepted overlay rows as a separate program.

## Supersession and lifecycle

This note does not supersede the generic session-projection, session-log-version, session-end-seed, persistence, or Goal decisions. They remain active because their generic rationale and guarantees continue to govern other consumers.

The completed [R0 scope record](../../archived/process/2026-08-15-dsh-science-v01-r0-release-baseline-scope.md) is archived; the R0 closure evidence owns the accepted identities and results it once governed.

## Consequences

R1 gives the Science overlay one independently reviewable domain slice with a strict, deterministic fold and checkpoint admission that cannot be spliced under the wrong watermark, at the cost of a durable vocabulary with no current producer: Science Runtime and its tool Consumers must still be built before any real Python/R execution can append these events. Required-on-read Science events make sessions containing them unreadable by a build that does not know the six event types; this is deliberate (domain truth over compatibility) and is not weakened by marking them `ignorable`.

`packages/session/session-projection/src/index.ts` is now a shared generic dependency of the Science domain, not a Science-owned file. Its three optional members are exercised by every existing consumer's regression suite (`session-projection-cache`, JSONL, SQLite, `session-query`, `session-query-sqlite`; 497 tests, unmodified) and by 27 session-projection-specific tests plus 43 Science-specific tests (70 total), with 100% statement/branch/function/line coverage on both packages' `src/` combined. A future change to `ProjectionDefinition` must preserve this compatibility contract for every registrant that omits the three optional members.

Real provider/model calls, real Python/R, Desktop, packed installer, signing, publication, and release remain `NOT-RUN`: this slice adds no model-facing Consumer and no assembled Science composition, so none of those evidence layers apply yet. The next implementation is Science Runtime: composing `ctx.scienceRuntime` with a host-local `ctx.subprocess`, a full `ctx.sandbox`, and this note's Session invariant.
