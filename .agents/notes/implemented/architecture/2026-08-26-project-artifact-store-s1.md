# Agent Note: Project artifact store independence and durability

Status: implemented

English | [中文](2026-08-26-project-artifact-store-s1.zh.md)

## Problem

The project store must be usable by both live execution and cold readers without depending on whichever session happened to initialize it first.

## Decision

Branded project, artifact, and version ids belong below the session layer. Every store method taking a project id can lazily open that project’s SQLite database; callers do not need a prior workspace-resolution side effect. Per-project transactions serialize ordinal allocation and annotation mutation, using configured lock timeouts.

Blobs use temporary-file rename for publication. Metadata and blob storage have different failure points: a successful rename is not a promise that every directory and data page was fsynced. The project store is separate from a generic session key/value service because its lifetime, transactions, and lookup keys differ.

## Alternatives considered

**Require resolveProject before every read.** Cold and background readers would depend on unrelated initialization order.

**Reuse a single session key/value hub.** Project lifetime and multi-row uniqueness would be hidden in a store with different ownership.

**Claim crash durability from rename alone.** Rename provides publication behavior, not a complete power-loss guarantee.

## Consequences

Session deletion leaves artifact data intact. Blob files orphaned before metadata commit are not automatically garbage-collected. Full fsync and retention need explicit future design if stronger durability or disk reclamation becomes necessary; project identity still uses resolved rather than canonical real paths.

## Related

Related owners: [project-artifact-store](2026-08-25-project-artifact-store.md); [project-identity-locking](../bug-fix/2026-09-09-project-identity-locking.md).
