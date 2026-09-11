# Agent Note: A pluggable kernel response-channel transport makes win32 Science kernel execution possible

Status: implemented

English | [中文](2026-09-05-win32-kernel-response-transport.zh.md)

## Problem

Kernel protocol responses need a channel that user stdout cannot corrupt and that works with each platform’s available process and confinement mechanisms.

## Decision

POSIX uses a FIFO with its independent reader. Windows uses authenticated loopback TCP: a per-kernel secret admits one driver connection, rejects other tokens and later connections, and keeps protocol frames separate from stdout and stderr. Every accepted socket retains an error listener through queued startup, token handoff, and destruction; missing requested stdin fails before channel handoff.

Minimal Windows OS-root variables permit process and Winsock initialization, while private TEMP/TMP and the Conda executable path remain explicit. Managed cooperative interruption follows the provider: Windows supplies no equivalent state-preserving SIGINT acknowledgement, so cancellation can escalate and lose kernel memory.

## Alternatives considered

**Use Windows named pipes immediately.** Their ACL and sandbox-token interaction needs real-platform proof before replacing a functioning authenticated channel.

**Replace POSIX FIFO with TCP too.** This changes POSIX network policy without a corresponding requirement.

**Mix responses into stdout.** Native library writes, especially in base R, cannot be assumed to obey Python-style descriptor redirection.

**Treat a synthetic acknowledgement as Windows signal support.** Fixture protocol tests do not establish native console/process-group behavior.

## Consequences

Wrong-token, duplicate-connection, queued reset, missing-stdin, EOF, and teardown tests remain required. TCP protocol support is not proof of Windows packaging or cooperative interrupt acceptance. A future Windows interrupt mechanism needs explicit console/process-tree design and real execution evidence.

## Related

Related owners: [managed-cooperative-interruption](../architecture/2026-09-09-managed-cooperative-interruption.md); [science-fifo-reader-isolation](../bug-fix/2026-08-31-science-fifo-reader-isolation.md); [kernel-reset-exit-cause](../bug-fix/2026-09-09-kernel-reset-exit-cause.md).
