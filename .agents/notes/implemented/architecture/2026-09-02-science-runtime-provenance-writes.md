# Agent Note: `science-runtime` writes provenance to the store, not the event

Status: implemented

English | [中文](2026-09-02-science-runtime-provenance-writes.zh.md)

## Problem

A session-local artifact projection may lag the project store, and metadata curation must not overwrite the original producer or duplicate a tool retry.

## Decision

Runtime provenance writes resolve current store identity and head before creating or extending a chain. Store transactions arbitrate concurrent creation and consume complete tool-call identities for curation. Capture records the content producer; later annotations append their own actor and explicit clearing semantics without replacing that producer. Explicit input baselines and ordinal predecessors remain distinct.

Session artifact events reference the committed result. If appending fails after the store commits, orphan handling preserves the original failure and leaves reconciliation to the store/log owner.

## Alternatives considered

**Allocate from the session’s local maximum alone.** Another session can already have advanced the shared chain.

**Pre-scan history to decide whether a tool call is consumed.** This cannot atomically arbitrate concurrent writers or commits missing from the log.

**Replace producer fields when a user curates metadata.** It falsely attributes existing content to the annotation author.

## Consequences

The SQLite transaction is the uniqueness authority. A session log cannot retroactively roll back an already committed project version. Provenance remains meaningful after session deletion, while absent source bytes and failed event append remain explicit failure cases.

## Related

Related owners: [project-artifact-store-schema-v2](2026-09-01-project-artifact-store-schema-v2.md); [science-artifact-receipts-restoration](../bug-fix/2026-09-02-science-artifact-receipts-restoration.md); [artifact-store-session-reconciliation](2026-09-01-artifact-store-session-reconciliation.md).
