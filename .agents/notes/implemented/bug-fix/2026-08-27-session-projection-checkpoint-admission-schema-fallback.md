# Agent Note: Checkpoint row admission falls back to stateSchema when checkpointStateSchema is omitted

Status: implemented

English | [中文](2026-08-27-session-projection-checkpoint-admission-schema-fallback.zh.md)

## Problem

`SessionProjectionRegistry.admitCheckpointState` (`packages/session/session-projection/src/index.ts`), when a unit does not supply `checkpointStateSchema`, admitted the persisted checkpoint row's `val` completely unvalidated — aside from the optional `checkpointStateSeq` watermark check most units also omit. A unit without `checkpointStateSchema` (the common case: most units' checkpoint representation matches their live state exactly) got zero structural validation of a persisted row before serving it through `wire.view`/`viewSchema.parse` or seeding a fold. A malformed row (corrupted storage, a state shape drifted out from under an unbumped `stateVersion`, a hand-edited fixture) reached `wire.view` with whatever shape it carried and failed only later, as an uncaught `ZodError` out of `viewCheckpoint`/`restore`, contradicting the documented contract: the package README states the persisted cache "validates `val` with `stateSchema` before use," and the [state/client-view split Agent Note](../architecture/2026-08-19-session-projection-state-and-client-views.md) records "cached rows are validated before they seed a fold." `packages/session/session-projection/tests/registry.spec.ts`'s `'rejects version-matching rows whose state no longer matches the registered schema'` test caught this: `viewCheckpoint` threw instead of returning `{}`.

## Decision

`admitCheckpointState` now validates `row.val` against `def.checkpointStateSchema ?? def.stateSchema` uniformly, dropping the previous unconditional-trust branch for a schema-less unit. `stateSchema`'s type-erased shape widens from `{ parse(...) }` — a shape that, in fact, was never called anywhere in the module — to `{ safeParse(...) }`, matching `checkpointStateSchema`'s existing shape, since admission must never throw. `checkpointStateSchema` keeps its role as an override for a unit whose checkpoint representation needs different validation than its live-state `stateSchema`; a unit that omits it is no longer unvalidated at the checkpoint boundary — it inherits `stateSchema` instead. The JSDoc on both fields and the package README now state the fallback explicitly.

The one existing consumer test that depended on the old two-attempt recovery — `packages/session/session-projection-cache/tests/cache.spec.ts`'s `'discards malformed persisted state and degrades to one full re-read'` — asserted a first `readFrom` call anchored at the (wrongly trusted) row's watermark, a thrown `ZodError` surfacing through `restore()`, and a second full re-read from `0` as the cache's own recovery. With the fix, `restoreFloor`'s own admission check now catches the malformed row immediately, so the floor is `0` from the first read: one `readFrom` call, matching the shape of the sibling `'discards a version-mismatched row'` test exactly. Updated to assert one call.

## Alternatives considered

**Keep `admitCheckpointState`'s schema-less branch but validate `row.seq` only (today's behavior for `checkpointStateSeq`).** Rejected: the documented contract and the failing test both require structural admission of a row's state, not just its watermark; a watermark check alone cannot catch a shape drift.

**Require every `ProjectionDefinition` to supply `checkpointStateSchema` explicitly, dropping the optional field's implicit fallback.** Rejected: every current consumer (`session-stats`, `token-meter`, `subagent`, `science-session`) would need an identical duplicate schema for no behavioral difference from falling back to `stateSchema`; the field's own JSDoc already frames it as an override for a unit whose checkpoint state needs something different, not a mandatory restatement.

## Consequences

Every unit's checkpoint row is now validated against a real schema before it can seed a fold or reach `wire.view` — a stale, corrupted, or hand-edited row fails admission cleanly (empty `viewCheckpoint` value, `restore` full re-read) instead of surfacing an uncaught `ZodError` to the carrier. `checkpointStateSchema` no longer needs restating a unit's `stateSchema` when the two shapes agree, the common case across every current consumer. `session-projection-cache`'s `coldSnapshot` now recovers a malformed row in one full re-read instead of two, matching its version-mismatch sibling.

## Verification

`packages/session/session-projection/tests/registry.spec.ts`'s `'rejects version-matching rows whose state no longer matches the registered schema'` now passes: `viewCheckpoint` returns `{}` and `restore` throws for a row whose `val` fails `stateSchema`. `packages/session/session-projection-cache/tests/cache.spec.ts`'s `'discards malformed persisted state and degrades to one full re-read'` is updated to assert one `readFrom` call from seq `0`. The full `session-projection`, `session-projection-cache`, `session-stats`, `token-meter`, `subagent`, and `science-session` suites pass unchanged otherwise, confirming no current consumer relied on the unvalidated fallback.
