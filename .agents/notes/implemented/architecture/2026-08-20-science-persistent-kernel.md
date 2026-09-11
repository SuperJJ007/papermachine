# Agent Note: A persistent per-language kernel replaces one-shot Python/R execution

Status: implemented

English | [中文](2026-08-20-science-persistent-kernel.zh.md)

## Problem

One-shot interpreters cannot preserve analysis variables, while unmanaged persistent processes make cancellation and session shutdown unsafe.

## Decision

Each session and language has a managed kernel with an epoch. Rebinding, expiry, process loss, and failed cooperative interruption end that epoch; a later run creates fresh state. Python and R use small drivers without an additional notebook server or RPC dependency. Protocol responses are separate from user stdout and stderr.

The shared subprocess provider owns cooperative interruption. Runtime cancellation waits for acknowledgement within the configured grace period, escalates when required, and keeps the lease until quiescence. The Windows provider does not supply POSIX SIGINT semantics; state preservation cannot be assumed there. FIFO and authenticated TCP transports have separate platform responsibilities.

## Alternatives considered

**Start a process per run.** This discards interactive analysis state and repeatedly pays interpreter startup.

**Adopt a notebook kernel server.** It adds a deployment and protocol stack beyond the two supported language drivers.

**Declare cancellation complete when a signal is sent.** Delivery is not acknowledgement, and surviving code may still write files.

## Consequences

Persistent state is best effort within an epoch, never durable session state. Restarts must be visible in results. User output cannot masquerade as a driver response, and shutdown errors must not erase the original failure cause. Platform execution acceptance is separate from these lifecycle rules.

## Related

Related owners: [managed-cooperative-interruption](2026-09-09-managed-cooperative-interruption.md); [science-kernel-scoped-inline-installs](2026-08-22-science-kernel-scoped-inline-installs.md); [win32-kernel-response-transport](../feature/2026-09-05-win32-kernel-response-transport.md).
