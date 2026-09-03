# Agent Note: restore same-turn Science draft folding from store producer facts

Status: implemented

English | [中文](2026-09-02-science-same-turn-draft-folding-restoration.zh.md)

## Problem

The [client raw-byte migration](../architecture/2026-09-01-science-artifact-raw-byte-reads.md) removed content origin, producer Session, and producer turn from `ScienceClientArtifactVersion`. It also removed `intermediate-versions.ts` and stopped skipping same-turn intermediate drafts in the artifact version stepper. The store still retained those facts, but the browser had no authorized per-version path to read them at that point.

The restored provenance read now returns the exact store producer through `sessions.scienceVersions`. Folding can therefore return without duplicating producer fields into the Session artifact projection or reconstructing them from nearby conversation nodes.

## Decision

**The version-summary batch is the complete folding input.** For each version of the active artifact, `ScienceDetailsView` reads `contentOrigin`, `producer.sessionId`, and `producer.turn` from that exact version's authorized summary. A summary that has not loaded, or a producer without a turn, leaves the version walkable. The viewing Session id and the session artifact's former turn field are not substitutes.

**A version folds only when a strictly later version of the same artifact has the same producer Session and turn.** `human-edit` is always exempt. `run-auto` and `import` follow the same identity rule when they carry a producer turn. `foldIntermediateVersions` returns version numbers only; it never mutates the projection, store, or durable bytes.

**The toolbar removes folded versions only from its default walk.** If a direct link opens a folded version, the current version remains in the walk and its adjacent controls can leave it. No intermediate-draft toggle returns: the [explicit removal decision](../simplification/2026-09-01-remove-intermediate-toggle.md) remains authoritative.

## Alternatives considered

**Restore `contentOrigin`, `producerSessionId`, and `turn` on `ScienceClientArtifactVersion`** — rejected. The store owns producer identity, and the authorized version-summary RPC already transports the exact facts needed by both provenance and folding.

**Use the viewing Session id and the projection version's turn** — rejected. A project artifact can contain versions from multiple Sessions, and turn counters are comparable only inside one producing Session. Missing summary facts must keep a version visible, not make a guess.

**Delete or make folded versions unreachable** — rejected. Folding is presentation only. Durable versions remain addressable from existing exact-version links, including the Science Process view, and a directly opened folded version remains in its own stepper walk.

## Consequences

`intermediate-versions.ts` again owns the pure same-artifact rule, while `ScienceDetailsView` owns the authorized summary-to-fact mapping and toolbar filtering. The package README no longer lists C2 as missing and continues to document the absence of an intermediate-draft toggle.

Pure tests cover later same-turn versions, cross-Session turn collisions, human edits, missing turns, and arbitrary input order. Details-view tests prove the store-summary wiring and current-version exemption. The built Web fixture creates two versions in one producer turn, proves the default stepper skips the earlier one, then opens that version through the Process direct link and leaves it through the stepper. The keyless accessibility transcript records the assembled three-version scenario.
