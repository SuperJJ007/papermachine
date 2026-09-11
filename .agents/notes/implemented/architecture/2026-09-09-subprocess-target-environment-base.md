# Agent Note: Explicit subprocess target environments

Status: implemented

English | [中文](2026-09-09-subprocess-target-environment-base.zh.md)

## Problem

Science interpreter discovery and kernel startup require an environment built from the selected runtime rather than ambient Python, R, or proxy settings. A target-only choice must not remove the transport environment required to start a managed runner or contact E2B.

## Decision

Every ordinary subprocess request chooses `scrubbed-parent` or `empty`. Local launch paths and E2B apply the choice before explicit overrides and tombstones. Windows empty targets require the native Win32 Job runner; the Node fallback rejects them before launch because libuv restores absent parent variables such as PATH and TEMP. Empty targets receive no automatic local proxy injection; callers can deliberately provide proxies. Terminal requests retain their existing ambient policy.

The [native containment](2026-08-28-subprocess-native-containment.md) and [proxy policy](2026-08-27-outbound-proxy-policy.md) decisions remain active: runner transport state stays separate, and scrubbed local targets keep upstream proxy normalization. Process identities remain provider-private.

## Alternatives considered

**Override unwanted ambient names individually.** Rejected because newly introduced ambient variables would silently enter kernels.

**Clear the runner or E2B control environment too.** Rejected because target configuration must not break provider bootstrap or remote transport.

## Consequences

Existing consumers explicitly retain scrubbed inheritance. Tests keep strict absence assertions on real native Windows targets and prove fallback rejection before process creation. They also cover real local spawning, managed target serialization, E2B target/control separation, proxy overrides, tombstones, and Windows case folding. OS-added process variables remain outside the provider's environment construction.

The fork patch affects subprocess request types, local spawn and runner target preparation, E2B environment serialization and its caller, plus consumer request declarations. Upstream has proxy normalization and control/target separation but no empty target choice. This implements the migration audit's subprocess RE-APPLY item; no upstream report is submitted with this commit.

Patch scope, line counts, and upstream status are recorded in the [replant patch ledger](../process/2026-09-09-replant-upstream-patch-ledger.md).
