# Agent Note: Science Runtime queues a second concurrent run instead of rejecting it

Status: implemented

English | [中文](2026-08-25-science-runtime-queue-concurrent-runs.zh.md)

## Problem

Two callers can request a run while the same session owns a live kernel operation. Rejecting every contender as busy creates avoidable tool failures; running both violates interpreter ownership.

## Decision

Runtime operations reserve queued access to the exact Session. A contender waits without publishing a running record, observes cancellation and its configured call budget, then rechecks current environment and lifecycle state after acquiring ownership. Runs, installs, and chart mutations share the reservation discipline. At most one operation may own execution for that session; independent sessions retain independent queues.

## Alternatives considered

**Return busy immediately.** Ordinary concurrent tool dispatch becomes a retry problem for the model.

**Allow parallel runs inside one interpreter.** Shared variables, working directories, and output capture are not isolated.

**Validate only before waiting.** The preceding operation can rebind or close the session while the contender is queued.

## Consequences

Queueing is serialization, not a concurrency guarantee for user code. Cancellation must remove waiting work without releasing another operation’s lease. Ownership continues through capture and quiescence, so a queued successor cannot reuse files still being finalized.

## Related

Related owners: [dsh-science-v01-r2-science-runtime](../feature/2026-08-15-dsh-science-v01-r2-science-runtime.md).
