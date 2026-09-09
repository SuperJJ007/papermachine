# Agent Note: Projection checkpoint watermark admission

Status: implemented

English | [中文](2026-09-09-projection-checkpoint-watermark-admission.zh.md)

## Problem

A structurally valid checkpoint may describe an earlier event prefix than its envelope claims.

## Decision

A well-typed checkpoint can still contain an older state under a newer outer sequence. Using the outer sequence to skip events loses durable facts. Projection definitions may expose their state watermark through checkpointStateSeq. One parser validates both stateSchema and equality to the row sequence before a cached view, replay seed, or hydration can consume the row.

## Consequences

Invalid rows disappear from cached views and force full replay when the supplied tail is insufficient. Separate checkpoint schemas and notification comparators are unnecessary for this correctness check. Live view notification frequency follows the upstream reference-comparison behavior. The existing read-only session migration preparation note addresses log-format conversion, so it is not superseded.

## Alternatives considered

Checking only during restore leaves cold views and hydration able to accept inconsistent state. A second checkpoint schema would duplicate validation.

Patch scope, line counts, and upstream status are recorded in the [replant patch ledger](../process/2026-09-09-replant-upstream-patch-ledger.md).
