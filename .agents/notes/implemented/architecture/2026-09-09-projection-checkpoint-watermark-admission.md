# Agent Note: Projection checkpoint watermark admission

Status: implemented

English | [中文](2026-09-09-projection-checkpoint-watermark-admission.zh.md)

## Problem

A structurally valid checkpoint may describe an earlier event prefix than its envelope claims.

## Decision

A well-typed checkpoint can still contain an older state under a newer outer sequence. Using the outer sequence to skip events loses durable facts. Projection definitions may expose their state watermark through checkpointStateSeq. One parser validates both stateSchema and equality to the row sequence before a cached view, replay seed, or hydration can consume the row.

## Consequences

Schema failures and internal-watermark mismatches both make a cache row unusable, including when its projection key and state version match. Invalid rows disappear from cached views and make `restoreFloor` return zero. `restore` and `hydrate` reject an insufficient suffix, but reconstruct the state from the complete log instead of propagating the discarded cache schema error. Separate checkpoint schemas and notification comparators are unnecessary for this correctness check. Live view notification frequency follows the upstream reference-comparison behavior. The existing read-only session migration preparation note addresses log-format conversion, so it is not superseded.

## Alternatives considered

Checking only during restore leaves cold views and hydration able to accept inconsistent state. A second checkpoint schema would duplicate validation.

Patch scope, line counts, and upstream status are recorded in the [replant patch ledger](../process/2026-09-09-replant-upstream-patch-ledger.md).

## Verification

The projection registry tests use current-version rows with a valid outer cursor and either malformed state or an inconsistent internal watermark. They check cached-view omission, full-read selection, suffix rejection, exact replayed checkpoints, and hydration on a separate Session without pre-existing live cells. Domain tests retain negative token-count, duplicate turn-number, and inconsistent title-input fixtures; corrupted rows must not seed a fold, while a valid checkpoint can resume the same suffix. Complete-log recovery must reproduce both the expected view and the internal state, so an assertion that recovery merely does not throw is insufficient.

The [prepared-session cache tests](../../../../packages/session/session-projection-cache/tests/cache.spec.ts) also cover a readable cached state that violates the current wire-view schema. Direct registry hydration rejects that row, while cache hydration retries with the exact complete log and installs the expected live projection values. The prepared observation leaves the stored row unchanged. Malformed-state tests alone cannot establish this retry: row parsing already discards their invalid state before hydration can throw.
