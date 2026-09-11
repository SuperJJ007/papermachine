# Agent Note: Preserve checkpoint request order across log flushes

Status: implemented

English | [中文](2026-09-11-projection-checkpoint-write-order.zh.md)

## Problem

A checkpoint waits for session-log durability before reaching the storage domain's write chain. Different flush durations can reverse arrival order: an earlier creation checkpoint can overwrite a newer turn-end or disposal checkpoint. Domain serialization alone cannot order work that has not reached it.

## Decision

The cache snapshots projection values and reserves a per-session queue position synchronously. Log flushes may overlap, but each record replacement waits for both its durability barrier and the previous replacement. A failed request rejects its caller and releases the queue for subsequent repair. Cold write-backs use the same queue. Cache disposal drains these requests before closing the domain.

## Alternatives considered

**Rely on the storage domain queue.** It sees writes only after each log flush, so it cannot preserve checkpoint request order.

**Capture values after flushing.** A write would describe a later event cut, changing the caller's requested checkpoint and potentially getting ahead of the flushed log.

## Consequences

Different sessions remain independent. The log stays authoritative, and no storage format changes. A controlled delayed flush proves that a later checkpoint remains durable after the earlier request settles; existing recovery cases retain fail-soft writes and schema refusal.
