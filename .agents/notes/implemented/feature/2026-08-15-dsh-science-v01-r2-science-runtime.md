# Agent Note: Science Runtime observation and execution ownership

Status: implemented

English | [中文](2026-08-15-dsh-science-v01-r2-science-runtime.zh.md)

## Problem

Interpreter discovery, confinement, durable observations, and tool presentation need separate owners; a tool-local subprocess would evade session lifecycle and replay.

## Decision

`ScienceRuntime` observes configured interpreter profiles through the shared subprocess and sandbox services. It records canonical interpreter identity, Conda history and package digests, capability observations, and actual enforcement. Identity and package inventory answer different questions: a stable executable path does not prove unchanged packages.

A reservation belongs to the exact Session object, not merely its textual id. The Runtime serializes mutation, rechecks state after waiting, and releases a lease only after subprocess quiescence and capture. Prepared work is not a published run; failed preparation must clean up without inventing durable execution. Consumers translate tool requests and results while the Runtime owns admission, execution, and durable facts.

## Alternatives considered

**Spawn from each tool.** This duplicates confinement, cancellation, and environment observation and makes non-tool consumers inconsistent.

**Treat a session id as a live lease.** Distinct Session objects can share an id while having different lifecycle owners.

**Release on terminal notification.** A terminal event does not prove streams, kernel teardown, and artifact capture are finished.

## Consequences

The runtime remains usable by tools and direct viewer operations without moving execution into the agent loop. A bound environment is an observation, not a package lock or a guarantee against external prefix mutation. Cooperative interruption belongs to the subprocess provider; the Runtime must honor its actual result and retain ownership through escalation.

## Related

Related owners: [managed-cooperative-interruption](../architecture/2026-09-09-managed-cooperative-interruption.md); [science-shared-prefix-drift](../bug-fix/2026-09-06-science-shared-prefix-drift.md).
