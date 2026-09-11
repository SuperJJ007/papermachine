# Agent Note: Restore Science artifact lineage, edit summaries, and curation authorization

Status: implemented

English | [中文](2026-09-02-science-artifact-receipts-restoration.zh.md)

## Problem

A retry must identify an already committed artifact mutation without depending on a receipt reconstructed from only the current session projection.

## Decision

The store consumes a complete tool-call identity transactionally with annotation or creation. A retry returns the existing committed result rather than adding another metadata row or artifact version. The tuple includes session id, tool-call id, and request-header sequence; incomplete identity cannot claim exactly-once behavior. Capture-only provenance does not consume an unrelated model call.

Receipts expose the minimal committed identity and status required by the caller. Full figure operations and provenance remain in the store rather than being re-expanded into every tool response.

## Alternatives considered

**Pre-scan the current projection for a matching receipt.** The store may contain commits from another session or from an append that failed.

**Use tool-call id alone.** Its scope is insufficient for project-wide uniqueness.

**Reconstruct a fresh write on every retry.** This converts response loss into duplicate durable mutations.

## Consequences

Exactly-once mutation depends on the complete tuple and store transaction, not delivery of the response. Store commit and log append can still diverge and require reconciliation; the original committed record remains authoritative.

## Related

Related owners: [science-runtime-provenance-writes](../architecture/2026-09-02-science-runtime-provenance-writes.md); [science-tool-receipts-slimming](../feature/2026-09-02-science-tool-receipts-slimming.md); [artifact-store-session-reconciliation](../architecture/2026-09-01-artifact-store-session-reconciliation.md).
