# Agent Note: Replant rc.2 private patch ledger

Status: implemented

English | [中文](2026-09-11-replant-rc2-patch-ledger.zh.md)

## Problem

The [rc.1 patch ledger](2026-09-09-replant-upstream-patch-ledger.md) measures a frozen historical slice, `ce76a86204..6528088e9f8c579024124add2642cde5a062ff16`. Those counts are correct for that slice, but they are not the branch's current delta against upstream, and that ledger is an implemented record whose numbers must not be rewritten in place. After the rc.2 merge-forward the branch needs a ledger whose range is derived from the merge base rather than from a hand-picked commit pair, so the next upgrade can be planned against real numbers.

## Decision

The current private delta is the range from the upstream merge base to the candidate commit, not a historical commit pair. For the rc.2 candidate it is `183f08e9c6dde7e36cd2318eaee70b0da08fb35e..0888810bd4c41e6b80495df8bbf1eb0c2de50865` — 55 commits, 1830 changed files, +130922/−3642 measured with `--no-renames`. The range start is `git merge-base HEAD dsh-v0.1.5-rc.1`, which equals rc.1 because the branch already merged rc.1 at `d2409f7235`. Future upgrades recompute this start instead of copying a literal.

The 52 historical ledger rows keep their recorded values. On the current range, 3 rows still match exactly and 49 have drifted; the current total across the same 52 paths is +5003/−764 against the historical +2560/−737. The three matching rows are `packages/api/remotes` (+6/−3) and the two `scripts/verify-application-entrypoints*` files (+4/−0, +10/−0); they are the only rows no commit outside the historical slice has touched.

Ledger rows are pathspecs over packages and files, so a row can cover many files. Two consequences the next upgrade must plan for are recorded here because they are large and easy to miss. First, `packages/session/session-attachment-index` is not a 50-line delta: the package does not exist at rc.1 and the row actually covers 13 new files, +1087/−0. Second, 500 files that exist at rc.1 carry a private modification or deletion with no ledger row at all, and a further 1041 files are new. The uncovered paths and the per-row recomputation are machine-readable in [the rc.2 evidence](../../../migrations/0.1.5/evidence/RC2/) (`ledger-rows.json`, `ledger-gap.json`); the counts in this note come from those files.

## Alternatives considered

**Rewrite the historical ledger's counts in place.** Rejected. The historical slice is a real measurement of a real commit pair, and the note is an implemented record. Editing it would destroy the only surviving account of how those rows were derived and would not make the current delta any more accurate.

**Derive the current delta from `rc.1..candidate` by subtracting the historical slice.** Rejected. The historical slice is an interior span of the private line, not a prefix of it: its start excludes four earlier commits and its end excludes everything after the rc.1 merge. Subtraction would silently attribute those commits' changes to the wrong rows.

**Treat every uncovered path as a missing ledger row.** Rejected for the 1041 new files, which are owned Science and PaperMachine packages that the historical ledger's own scope statement already exempts. The 500 modified upstream paths are the real gap, because those are exactly the private patches a ledger exists to track, and at least `pnpm-lock.yaml`, `apps/desktop`, `.github/workflows`, `scripts/ci-workflow.spec.ts`, and `packages/client/ui-conversation` are large enough to change an upgrade plan.

**Record a width-1 delta only for the rc.2 merge itself.** Rejected. The rc.2 merge brought 334 files and 2 text conflicts, but the ledger's job is the branch's standing delta against upstream, which the next upgrade must rebase. A merge-scoped count would answer a different question and expire at the next merge.

## Consequences

The rc.2 merge-forward itself was small: 334 source files, no production source conflict, and two bilingual pairing records that the configured `merge.dsh-translation-pairing.driver` resolves. The standing delta is large and belongs to the replant, so the next upstream upgrade should expect the pairing driver to be the only conflict mechanism and should budget its review against the 52-row table plus the gap lists rather than against the merge size.

The version line needs its own step after any future merge. Upstream manifests move to the new rc version while replant-owned manifests stay behind, which breaks the dsh family's shared-version invariant (`scripts/release/families.ts` rejects mixed members). Nine owned packages needed alignment for rc.2; `pnpm run release:dsh <version> --dry-run` names them, and `scripts/release/bump.ts`'s `writeVersion` rule is the exact rewrite to apply.

## Testing

`ledger-rows.json` and `ledger-gap.json` are produced by `git diff --numstat` and `git diff --name-only` over the recorded ranges, so every number in this note recomputes from the repository alone. `pnpm run verify-translation-pairing` covers the pairing records the merge rewrote.
