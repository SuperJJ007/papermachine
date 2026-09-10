# Agent Note: Kernel reset classification follows process exit

Status: implemented

English | [中文](2026-09-09-kernel-reset-exit-cause.zh.md)

## Problem

Windows can report a dying kernel's TCP channel as `ECONNRESET` before its process-exit notification. Classifying every stream error as a protocol violation mislabels both ordinary crashes and requested shutdowns.

## Decision

A response-channel reset follows the existing EOF path: bounded process-exit observation distinguishes a dead interpreter from a still-live interpreter that abandoned its channel. Requested shutdown ignores subsequent stream errors, while a protocol fault recorded before shutdown retains priority. Other live stream errors still fail immediately.

The [Windows transport decision](../feature/2026-09-05-win32-kernel-response-transport.md) remains the owner of transport selection and authentication; this note specifies exit classification.

## Alternatives considered

Treating every reset as a crash would accept a broken live driver. Treating every reset as a protocol violation loses the authoritative process outcome. Changing test expectations would preserve incorrect runtime diagnostics.

## Consequences

Reset classification may wait for the existing descendant-exit grace. No extra timeout or configuration is introduced, and a surviving process still fails closed.

## Verification

Kernel tests cover resets followed by process exit and resets from a process that remains alive. TCP lifecycle tests retain their commanded/crash expectations, and pending chart extraction during shutdown rejects with process-exit evidence.

## Related

Related owners: [win32-kernel-response-transport](../feature/2026-09-05-win32-kernel-response-transport.md).
