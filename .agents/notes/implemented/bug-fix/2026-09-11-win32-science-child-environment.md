# Agent Note: Windows Science child environments

Status: implemented

English | [中文](2026-09-11-win32-science-child-environment.zh.md)

## Problem

Interpreter probes and package installers start from an empty environment. They omitted the Windows system variables already supplied to persistent kernels. Native Windows qualification reproduced a Node fake interpreter abort in CSPRNG initialization before any probe could execute, leaving otherwise usable bindings invalid.

## Decision

Probes, kernels, and package installers share the fixed Windows system-variable allowlist in `windowsEnvironment` in [execution.ts](../../../../packages/science/science-runtime/src/execution.ts). Each operation sets `TEMP` and `TMP` to its own scratch temp directory. Other host variables remain excluded, and POSIX environments retain their existing entries. Sandbox-required entries retain precedence.

## Alternatives considered

Inheriting the entire host environment would also expose unrelated credentials and configuration. Supplying variables only in fake test runners would leave real interpreter startup dependent on missing system settings.

## Consequences

Native Windows probe and installer tests verify startup and scratch paths. Persistent-kernel tests retain coverage of absent variables and the platform-specific allowlist. Existing recorded-session outputs remain the oracle: this repair restores interpreter availability without changing the session format. The [scratch privacy and ordering decision](2026-09-06-win32-scratch-privacy-and-probe-ordering.md) remains independently applicable to ACL ownership and directory creation.
