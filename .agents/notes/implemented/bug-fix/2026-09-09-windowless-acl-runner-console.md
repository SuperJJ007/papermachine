# Agent Note: Console ownership for the windowless ACL runner

Status: implemented

English | [中文](2026-09-09-windowless-acl-runner-console.zh.md)

## Problem

On native Windows, a detached windowless parent using upstream `spawnInheritedJobProcess` creates a restricted Node child that exits with `0xC0000142` before printing output. The same restricted spawn succeeds with an attached console. Process creation and Job assignment alone do not establish the console needed by restricted descendants.

## Decision

The ACL runner checks `GetConsoleCP` before creating restricted children. It preserves an existing console, including a windowless console. Otherwise it allocates a console, hides any console window, and restores the three inherited standard handles. Its process owns the console until exit. Token restriction, suspended process creation, and kill-on-close Job ownership remain in the upstream Win32 primitive.

The [ACL sandbox decision](../feature/2026-08-08-windows-acl-restricted-token-sandbox.md) remains active; this addition supplies console ownership for its existing restricted-token launcher. The unrelated Python console-entry spawn-and-wait fix remains unchanged.

## Alternatives considered

**Rely on the upstream Job primitive alone.** Native Windows reproduces `0xC0000142` with detached startup, so Job containment is insufficient.

**Use window presence to detect attachment.** Rejected because a windowless console is still an existing console and must be preserved.

## Consequences

Captured pipe and NUL handles survive allocation. Native failures remain loud; children never fall back to unrestricted execution. The probe uses Windows Server with Node 24.19.0 and Koffi 3.1.1: the unpatched attached case succeeds, the unpatched detached case fails, and both patched cases succeed. Unit tests cover allocation, restoration, existing attachment, and native failures. This does not claim packaged Electron or Science kernel acceptance.

The migration audit permits this RE-APPLY patch. Its upstream footprint is the ACL runner's console helper, five FFI bindings, and the runner call; `win32-process` remains unchanged. No upstream report is submitted with this commit.

Patch scope, line counts, and upstream status are recorded in the [replant patch ledger](../process/2026-09-09-replant-upstream-patch-ledger.md).
