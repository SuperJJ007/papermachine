# Agent Note: GUI ACL runners own their descendant console

Status: implemented

English | [中文](2026-09-09-gui-acl-runner-console.zh.md)

## Problem

The packaged Electron executable can run the ACL wrapper as Node without owning a console. Creating a console-subsystem child under the restricted token then fails during DLL initialization with `0xC0000142`. Science reports invalid interpreter probes even though the same Python and R executables work when launched directly. CLI-only runner tests inherit a console and miss this desktop path.

## Decision

The runner establishes console ownership before creating restricted children. An existing console or pseudoconsole remains untouched. Attachment is determined by `GetConsoleCP`, including windowless consoles where `GetConsoleWindow` returns null; a window handle alone cannot establish whether allocation is legal. A consoleless runner allocates a console under its own token, hides its window, and restores its inherited standard handles. The process owns the console until exit. Allocation or handle-restoration failure prevents child creation and uses the existing runner failure diagnostic.

Child creation retains suspension and job assignment before execution. Token restrictions, grants, environment selection, inherited pipe bytes, and exit-code mirroring remain unchanged. The [restricted-token sandbox decision](../feature/2026-08-08-windows-acl-restricted-token-sandbox.md) still owns those security constraints; this note supplies its GUI startup prerequisite.

A failed Science probe is durable. Before the first recorded run, the first prompt assembly after loading a failed binding retries observation under the current runtime. The Session seed boundary and subsequent environment events determine whether that lifecycle has already retried; no separate retry cache is needed. Applied bindings and sessions with runs remain unchanged. This lets a repaired desktop reopen a failed pre-run session without erasing its history.

## Alternatives considered

Adding `DETACHED_PROCESS` lets a direct Python child start, but a Conda R launcher can create another console-subsystem process without propagating that flag. A runner-owned console supports the whole descendant chain. Adding token privileges or disabling confinement would change security behavior without addressing the missing console owner. Inheriting the ambient environment does not repair console allocation.

## Consequences

Managed subprocess startup requests `SW_HIDE` through Node’s `windowsHide` option. A consoleless runner owns an additional console for its lifetime. Hiding a newly allocated window preserves a background execution interface; initial window visibility requires separate desktop validation. Existing CLI console ownership and all restricted-token rules remain unchanged.

## Verification

Native acceptance compares the original and repaired runner from consoleless Electron, with the product’s empty environment and piped output. Python and the configured Conda R launcher must preserve the Unicode probe, report their package inventories, and execute plotting work. Unit checks preserve an existing console, restore all standard handles after allocation, and reject allocation, ownership, or handle-restoration failures. Packaged acceptance includes reopening persisted history after execution.
