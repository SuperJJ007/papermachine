# Agent Note: every provisioning source attempt writes its full micromamba log to disk

Status: implemented

English | [中文](2026-09-07-provisioning-attempt-logs.zh.md)

## Problem

An earlier source attempt can fail before a later source succeeds, leaving no useful evidence if logging only preserves the final error or a small shared ring buffer.

## Decision

Provisioning writes one append-only file per source attempt as output arrives, serializing stdout and stderr writes. Each attempt finishes with status, and the next provisioning call clears previous-round attempt logs. Setup failure of this diagnostic side channel disables it rather than failing installation; later write failure likewise does not replace the primary provisioning result. The inline recent-log buffer belongs only to the last attempt.

Full attempt paths are included in failure message text because Electron’s thrown-error IPC preserves the message rather than arbitrary properties. Progress may mention the previous failure, but transient progress is not the durable log. Attempt files have no byte cap or output-content redaction; the child environment’s credential-name filter is not a scan of arbitrary printed secrets.

## Alternatives considered

**Keep only a larger ring buffer.** Earlier failed attempts still disappear after fallback succeeds.

**Write files only on total failure.** A successful fallback erases the very failure being diagnosed.

**Depend on custom Error properties crossing IPC.** The renderer cannot rely on their preservation.

**Retain every round forever.** Repeated retries accumulate unbounded files.

## Consequences

Current-round logs survive until the next provisioning call, including an immediate user retry. They are diagnostic best effort, not crash-fsynced records. Deferred issues remain separate: residue beyond existing prefix cleanup, per-retry capacity rechecks, revocation-offline retry policy, and Windows system-proxy discovery beyond forwarded ambient proxy variables. These are not asserted fixed by retaining this note.

## Related

Related owners: [desktop-owns-its-environment](../feature/2026-09-01-desktop-owns-its-environment.md); [win32-desktop-provisioning-env-and-space-path](2026-09-06-win32-desktop-provisioning-env-and-space-path.md).
