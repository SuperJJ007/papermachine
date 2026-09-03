# Agent Note: Desktop Host launches on its last bound port

Status: implemented

English | [中文](2026-09-01-desktop-host-port-persistence.zh.md)

## Problem

`apps/desktop/src/main.ts` launched the Host with `--port 0` on every launch, so the OS assigned a fresh port each time. A new port is a new browser origin, and browser-side client state persisted to `localStorage` is keyed by origin — so everything a client store persisted was silently dropped on every single launch, not only after a crash or update. The user-visible symptom was panel widths and similar UI state resetting every time the app opened.

Reading `packages/client/*/src/**/stores.ts` for which stores actually opt into `createSnapshotStore`/`defineStore`'s `persist` option (rather than assuming) found six: the details-panel width (`ui-layout`; the sidebar width is deliberately `transient` and unaffected), the current session selection (`runtime/sessions/service.ts`), the trajectory-duration preference (`ui-trajectory`), the workspace browser's grouping/ordering/expansion state (`ui-workspace`), the per-session chat draft and view/inspect selection (`ui-conversation`), and the Science artifact viewer's open tabs and library state (`ui-science`).

## Decision

The Host now launches preferring the port it last bound successfully, persisted at `<dshHome>/host-port.json` (`apps/desktop/src/host-port.ts`) through the same `writeFileAtomic` pattern `environment-binding.ts` and `custom-environment.ts` use for their own pointer files. `apps/desktop/src/host-launch.ts`'s `launchHostOnRememberedPort` reads that record before each launch; a first launch, with nothing recorded yet, requests `0` directly.

The Host reports no bind failure this carrier can distinguish from any other startup failure. `WebServer`'s `[Service.init]` (`packages/host/webserver/src/index.ts`) rejects its Cordis fiber on an EADDRINUSE `listen`, which fails the boot before the readiness line (`dsh web: …`) is ever printed; `HostProcessSupervisor.start()` (`apps/desktop/src/host-process.ts`) then sees only the child exiting before readiness — the identical protocol outcome an unrelated boot error produces. The carrier now persists bounded, redacted stderr for human diagnosis, but does not parse free-form diagnostics as a launch protocol; see [Recoverable raster declarations and Desktop Host diagnostics](2026-09-02-raster-capture-recovery-and-host-diagnostics.md). `launchHostOnRememberedPort` therefore does not try to diagnose the cause: a launch failure on a remembered, nonzero port is retried exactly once on an OS-assigned port (`0`).

The port recorded afterward is always the port the Host actually reported — read off the ready loopback URL — never the port that was requested; the two differ exactly in the fallback case this exists to handle, so recording the request would keep remembering an unavailable port forever. Reading and writing the record never blocks or fails a launch: `readRememberedHostPort` degrades a missing, unreadable, or corrupt `host-port.json` to `undefined` (requesting an OS-assigned port) instead of throwing, and `writeRememberedHostPort` logs and swallows a write failure after an otherwise-successful launch instead of propagating it. This deliberately differs from `environment-binding.ts` and `custom-environment.ts`, whose readers fail loud on a corrupt file: those guard a correctness fact (which environment a session binds), while `host-port.json` guards only a UX optimization (origin stability), so degrading it costs nothing but that optimization.

## Alternatives considered

**A fixed, hardcoded port.** Rejected per the design brief: it turns any collision — another process on that port, or a second PaperMachine instance already running — into a hard failure with no fallback, which is worse than the bug it would fix.

**Distinguish EADDRINUSE from other Host boot failures before deciding to retry.** Not possible from the carrier's side today: the Host process exits before printing anything the carrier trusts, and the exit code a failed Cordis fiber produces is not specific to a listen failure. Retrying once on any remembered-port launch failure is a safe superset — a failure that was never about the port also fails identically on `0` and surfaces exactly as it did before this change.

**Move the affected UI state out of `localStorage`, into the settings service.** The actual long-term fix, since it would survive a fallback launch too, not only an ordinary one. Left out of scope: it reaches across every client package listed in Problem, none of which this change touches.

## Consequences

Ordinary launches keep the same origin, so the six persisted client stores above survive an app restart — the observable fix for the reported symptom. The occasional fallback launch (another process holding the remembered port, or two instances racing) still loses that state for that one session: this narrows the defect from every launch to the exceptional one, not to zero, and this note states that residual loss rather than overstating the fix as complete. The settings-service migration that would close the residual gap remains open, unscheduled work.

## Verification

`apps/desktop/tests/host-port.spec.ts` covers the record's parser, round-tripping a remembered port, and degrading to `undefined` on a missing, corrupt, or unreadable file and to a swallowed failure on an unwritable destination. `apps/desktop/tests/host-launch.spec.ts` covers reusing a remembered port with no fallback attempt, the fallback-and-record path (recording what the Host actually reported, not what was requested), propagating a failure that survives the fallback attempt too, and degrading to an OS-assigned port when the remembered-port file is corrupt.
