# @deepseek-ai/dsh-session-projection

English | [中文](README.zh.md)

Session-projection Service Definition and drive registry. It owns `ctx.sessionProjections`, the registry that drives every registered projection unit over committed session events and serves finished whole values to carriers, currently the api-proxy history tail page and `session/projection` push frame. A domain registers pure mathematics; the framework owns the drive. The [session-projection RFC](../../../.agents/notes/proposed/architecture/2026-07-27-session-projection-and-command-log.md) records the design rationale.

## Service: `SessionProjectionRegistry` (ctx key: `sessionProjections`)

### Public API

- `ctx.sessionProjections.register(definition): () => void` Register one domain's unit. A duplicate key or an invalid `stateVersion` throws; registration is an effect tied to the calling fiber, so its key (and cached cell) disappears from later drive and snapshots once the domain plugin unloads — a client reads that as capability absence.
- `ctx.sessionProjections.onChanged(listener): () => void` Subscribe to the change feed: one call per client-visible unit whose state reference changed, per committed event, carrying the schema-validated view and the causing seq. Effect-tied like `register`.
- `ctx.sessionProjections.stateOf(session, key)` Read one registered unit's current host state without computing unrelated views. The returned value is a live read-only reference; callers must not mutate it.
- `ctx.sessionProjections.snapshot(session): ProjectionSnapshot` One consistent synchronous cut over every registered client-visible unit — `{ asOfSeq, values }` with `asOfSeq` = the seq of the last event every value reflects (`-1` for an empty log). Host-only state is available only through `stateOf`.
- `ctx.sessionProjections.checkpoint(session): ProjectionCheckpoint`, `viewCheckpoint(checkpoint)`, `restoreFloor(checkpoint)`, `restore(checkpoint, events, baseSeq)` The persisted-cache write/read faces: state-level checkpoint rows, a zero-I/O view of stored rows, the tail-read floor a caller must supply, and cold restore from a checkpoint plus a stored log suffix.

### Key Types

- `SessionProjectionMap` — the merge-extensible client-view table shared by wire blocks and client hooks. Values are wire-JSON whole values; rendering belongs to the slot system, never this layer.
- `SessionProjectionStateMap` — the merge-extensible host fold-state table. Every client-visible key appears in both tables; host-only keys appear only here.
- `ProjectionDefinition<K, S>` — `{ key, stateSchema, checkpointStateSchema?, checkpointStateSeq?(state), init(), apply(state, event), wire?, viewChanged?(previous, next), stateVersion }`: a synchronous state-driven computation unit of pure functions plus declarations, never an opaque getter. `wire` supplies `viewSchema` and `view`; omitting it makes the unit host-only. The remaining optional members bind a unit's private state to the persisted checkpoint face: `checkpointStateSchema` admits a persisted row's state (validation-only — a transform whose output is not deeply equal to its input rejects the row), `checkpointStateSeq` requires every state the registry writes to or admits from a row to report exactly that row's outer `seq`, and `viewChanged` narrows public-change notification after `apply` already returned a different reference (it cannot turn a same-reference no-op into a change). All three are omittable; an omitting unit keeps the registry's unqualified behavior.

## Contract

- **The framework drives, the domain computes.** The registry subscribes to `session/event` once; every committed event passes every unit's `apply` eagerly. Domains hold no subscriptions. Cells (`{state, observedSeq}` per unit per session, WeakMap-keyed) build lazily — a unit registered after events flowed, or a read of a session predating the registration, folds `init` over the in-memory log on first touch.
- **Same-reference means no work.** `apply` MUST return the same state reference for events that do not concern the unit; the drive gates the change feed on `Object.is`, so non-matching events cost one call and nothing downstream.
- **Whole-value event rule (load-bearing).** A state-carrying log event MUST carry the complete post-change state, never a bare delta — it keeps every transition trivially cheap and every served value self-describing (last-wins for consumers).
- **Synchronous unit discipline.** `init`/`apply`/`wire.view` MUST be synchronous; carriers read `snapshot()` in the same tick as their page slice, which is what makes `asOfSeq` one consistent cut. An accidentally async view returns a Promise, which fails `wire.viewSchema.parse`.
- **State is validated plain JSON, `stateVersion` is its invalidation anchor.** The persisted projection cache stores `(sessionId, key, ver, seq, val)` rows and validates `val` with `stateSchema` before use; bump `stateVersion` whenever the state fields or fold semantics change. Every unit's state is checkpointed — client-visible and host-only alike.
- **No wire vocabulary here.** The registry exposes only the change feed and the snapshot read face; carriers (api-proxy) mint their own frames (`session/projection`) and blocks from them.
- **Optional capability.** Domain plugins register under `ctx.inject(['sessionProjections'], …)` so headless assemblies without the registry stay unaffected; carriers use `ctx.get('sessionProjections')` and omit their block/frames entirely when the registry is absent.

## Role

This package owns the Service Definition and drive roles of the capability seam: domain host plugins (e.g. `dsh-tool-todo`) contribute units, carriers (`dsh-host-apiproxy`) consume the snapshot and change feed, and neither knows the other.

## Model Experience

None, as the registry only computes client-facing read models of already-logged session state and touches no prompt, message, schema, stream, or tool result.

#### KV Cache effect

None; projections never assemble or send provider requests.

## Known Limitations and Deferred Work

- **Every tail page carries every client-visible key** — there is no per-key opt-out or lazy-key request shape yet; acceptable while values are UI-scale whole states (a todo list, a goal snapshot), revisit if a domain's value grows large.
- **The unit table is process-wide, so key presence is not a per-session capability signal** — a key registered by ANY agent preset appears in every session's snapshot, including sessions whose own composition mounts nothing that produces it. A client must read the VALUE (`plan.active`, an empty todo list) rather than treat an absent key as absence of the feature; a unit whose empty value is indistinguishable from a real one belongs on the host plane instead, which is why `dsh-token-meter` sits there.
- **Eager drive touches every unit per event** — cheap by construction (whole-value rule, same-reference gate), but a hot path would justify per-unit event-type prefilters, addable without contract change.
- **Registry cells live in memory only** — a restart rebuilds by folding the log on first touch; compositions that mount `dsh-session-projection-cache` seed that fold from persisted rows instead.
- **Synchronous unit discipline is only partially mechanical** — `wire.viewSchema.parse` rejects a Promise-returning view, but an `apply` that blocks or reads torn non-session state is a review concern; the invariant companion documents why no runtime check exists.
