# Agent Note: Publish projection baselines when a cold Session attaches

Status: implemented

English | [中文](2026-09-09-resume-projection-baseline.zh.md)

## Problem

History inspection does not resume a Session. If cold history reaches a browser before a later request resumes that Session, its projection snapshot predates the constructor's `session/end-seed`. Constructor seeds do not publish `session/event`, so the browser can retain `started` kernel records even after the Host derives `interrupted` from the new marker.

## Decision

When a Session attaches after a mux stream opens, ApiProxy sends its current client projection snapshot immediately after `session/subscribed`, using ordinary `session/projection` frames at the snapshot's `asOfSeq`. Higher-seq-wins client storage prevents an older in-flight history response from replacing this baseline. Snapshot serialization excludes host-only projection state, as defined by [the projection state/view decision](../architecture/2026-08-19-session-projection-state-and-client-views.md).

## Alternatives considered

Publishing constructor events would violate the Session seed/publication distinction. Re-reading all history after every metadata query adds redundant reads and leaves other resume callers exposed. Inferring kernel death in the UI would make historical values depend on browser lifecycle rather than the durable log.

## Consequences

Late attachment refreshes every registered client projection without changing the wire format or restoring a Session merely to read history. The kernel readout remains a historical record, not a process-health probe. No previous Agent Note is superseded: the change supplies a missing baseline within the existing projection carrier.

## Verification

An ApiProxy regression proves constructor-derived values arrive without publishing seed events. The runnable Science browser snapshot holds session-scoped requests until cold history displays `started`, then permits resume and requires `interrupted` without another user action.
