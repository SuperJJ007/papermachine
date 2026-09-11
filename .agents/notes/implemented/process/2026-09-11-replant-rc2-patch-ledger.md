# Agent Note: Replant rc.2 private patch ledger

Status: implemented

English | [中文](2026-09-11-replant-rc2-patch-ledger.zh.md)

## Problem

The [rc.1 patch ledger](2026-09-09-replant-upstream-patch-ledger.md) measures a frozen historical slice, `ce76a86204..0888810bd4c41e6b80495df8bbf1eb0c2de50865`. Those counts are correct for that slice, but they are not the branch's standing delta against upstream, and that ledger is an implemented record whose numbers must not be rewritten in place. After the rc.2 merge-forward the branch needs a ledger measured from the upstream release it now contains, so the next upgrade can plan against what the replant actually adds.

## Decision

The private delta is measured from the newest upstream release the branch contains, not from an older release and not from a hand-picked commit pair. After merging rc.2 the upstream baseline is `fb2c4b9e698e30edb738bca4cf0618587db7d203`, so the delta is `fb2c4b9e698e30edb738bca4cf0618587db7d203..0888810bd4c41e6b80495df8bbf1eb0c2de50865` — 1515 changed files, +132011/−2596 with `--no-renames`. At the code candidate before the documentation commit, `0888810bd4c41e6b80495df8bbf1eb0c2de50865`, the same measurement is 1508 files and +129876/−2596.

Measuring from rc.1 instead would count rc.2's own release as private work. The two bases differ by 322 files: rc.2 changed 334 files over rc.1, of which 272 are version lines. A path like `packages/workflow/workflow/package.json` has no difference against rc.2 and must not appear as a private modification. Any future upgrade recomputes the base as the upstream release it has merged.

The 52 historical ledger rows keep their recorded values. Against rc.2, 31 rows still match their historical figures and 21 have drifted; across the same 52 paths the historical slice totals +2560/−737 and the current delta totals +4957/−718. `packages/session/session-attachment-index` is the largest row change and also the most misleading: the package does not exist at rc.1, so its row covers 13 new files, +1087/−0, not the 50-line delta the row records.

Ledger rows are pathspecs over packages and files, so a row can cover many files and a gap count alone does not say what needs keeping. Two gap classes are recorded separately in [the rc.2 evidence](../../../migrations/0.1.5/evidence/RC2/). First, 228 files that exist at rc.2 carry a private modification or deletion with no ledger row, totalling +5978/−1878; `pnpm-lock.yaml`, `docs/config-catalog*.md`, `apps/desktop/src/main.ts`, `.github/workflows/ci.yml`, `scripts/ci-workflow.spec.ts`, and `packages/client/ui-conversation` are the largest. Second, 1041 files do not exist at rc.2 and total +121331/−0; this class mixes replant-owned packages with additions that only look new because rc.1 predates them, so ownership must be decided before it drives an upgrade plan. `ledger-rows.json` and `ledger-gap.json` carry the full lists and per-row numbers; the counts in this note come from those files.

An upgrade conflict count cannot be extrapolated from this stage. The rc.2 merge-forward produced no production source conflict, but it was a 334-file release with 2 bilingual pairing records resolved by the configured driver; a wider upstream range would exercise files this merge never touched.

## Alternatives considered

**Measure from rc.1 because the branch originally forked there.** Rejected. The branch has merged rc.2, so rc.1 no longer bounds the private work; everything rc.2 changed would be reported as private and would then be re-derived by every later upgrade.

**Rewrite the historical ledger's counts in place.** Rejected. The historical slice is a real measurement of a real commit pair, and the note is an implemented record. Editing it would destroy the only surviving account of how those rows were derived.

**Derive the delta by subtracting the historical slice.** Rejected. The historical slice is an interior span of the private line, not a prefix of it: its start excludes four earlier commits and its end excludes everything after the rc.1 merge. Subtraction would attribute those commits' changes to the wrong rows.

**Treat every uncovered path as a missing ledger row.** Rejected as stated. The 228 modified files are the real gap, because those are private patches on upstream paths. The 1041 new files are mostly owned Science and PaperMachine packages that the historical ledger's scope statement already exempts; the rest need an ownership decision, not a row each.

**Record a width-1 delta for the rc.2 merge itself.** Rejected. A merge-scoped count answers a different question and expires at the next merge.

## Consequences

The rc.2 merge-forward is small; the standing delta is large and belongs to the replant. The next upstream upgrade should expect the bilingual pairing driver to remain the only conflict mechanism, and should budget review against the 52-row table plus the two gap classes rather than against the merge size.

The version line needs its own step after any future merge. Upstream manifests move to the new rc version while replant-owned manifests stay behind, which breaks the dsh family's shared-version invariant (`scripts/release/families.ts` rejects mixed members). Nine owned packages needed alignment for rc.2; `pnpm run release:dsh <version> --dry-run` names them, and `scripts/release/bump.ts`'s `writeVersion` rule is the exact rewrite to apply. The npm family version is not the product version: `apps/desktop/src/product-version.json` remains `0.1.3` and this stage does not change it.

## Testing

`ledger-rows.json` and `ledger-gap.json` are produced by `git diff --numstat` and `git diff --name-only` over the recorded ranges, so every number in this note recomputes from the repository alone. `pnpm run verify-translation-pairing` covers the pairing records the merge rewrote.
