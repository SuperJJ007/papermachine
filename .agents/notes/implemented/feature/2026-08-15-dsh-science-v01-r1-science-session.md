# Agent Note: Deterministic Science session state

Status: implemented

English | [中文](2026-08-15-dsh-science-v01-r1-science-session.zh.md)

## Problem

Science state must survive replay without reading a live interpreter or applying the final preset retroactively to earlier events.

## Decision

`science-session` owns a deterministic event fold; the Host observes the environment and appends facts. Applicability is evaluated at the event position against the then-current preset and environment revision. A sparse request witness proves the relevant request relationship without copying the whole transcript. Runtime leases and mutable interpreter objects stay outside this durable projection.

The nine Science event types are required on read. Native V3 references remain unchanged; historical Science recovery is subject to the required-event owner, not an ignorable-event bypass. Checkpoint admission uses the shared `stateSchema` and checkpoint-watermark parser so cold replay and cache hydration agree.

## Alternatives considered

**Infer state from the current process.** A cold reader has no process, and a restarted interpreter cannot reconstruct earlier observations.

**Apply the latest preset to all history.** This changes whether an earlier run was legal when a later preset switch occurs.

**Copy the entire transcript into Science state.** A sparse witness preserves the relationship while avoiding a second transcript and its synchronization cost.

## Consequences

Pure folding makes malformed durable relationships rejectable in live and cold paths. A checkpoint is an optimization only after admission; it cannot excuse a missing event or future watermark. Environment capabilities and package inventories are observations, not claims that a later run still uses identical bytes.

## Related

Related owners: [science-required-session-events](../architecture/2026-09-10-science-required-session-events.md); [projection-checkpoint-watermark-admission](../architecture/2026-09-09-projection-checkpoint-watermark-admission.md).
