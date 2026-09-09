# Agent Note: Managed cooperative interruption

Status: implemented

English | [中文](2026-09-09-managed-cooperative-interruption.zh.md)

## Problem

Science kernels need a recoverable interrupt while their provider retains ownership of process identity and cleanup.

## Decision

Science keeps interpreter streams open across cancellation. Termination cannot substitute for an interrupt because it destroys the reusable kernel. The managed subprocess owner sends SIGINT to its POSIX process range without starting termination or closing streams. Windows returns without changing cancellation state. E2B signals only after publishing the remote group identity. Target identities remain provider-private, and completion prevents subsequent interruption.

## Consequences

Confinement contributes required environment entries after caller overrides. Science starts from an empty environment and uses the sandbox’s declared runner-failure evidence. The native Windows console, process containment, and proxy-environment decisions remain independent and active. Forwarding SIGINT from a test wrapper would signal a child twice because it already receives the group signal; the fixture therefore consumes its own signal without forwarding.

## Alternatives considered

Exposing target PIDs would let consumers bypass process ownership. Termination cannot represent a recoverable kernel interrupt.
