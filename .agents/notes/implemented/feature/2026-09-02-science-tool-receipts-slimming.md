# Agent Note: `dsh-tool-science` model-facing artifact fields after the store-authority migration

Status: implemented

English | [中文](2026-09-02-science-tool-receipts-slimming.zh.md)

## Problem

Large repeated tool receipts consume context even though exact artifact identity is enough to request the remaining information when needed.

## Decision

Science tool results retain compact artifact identity, version, content origin, curated status, media type, and byte count where relevant. Full provenance and chart state are read on demand from the project store through authorized reads. Edit-operation lists are not repeated as routine result prose. The receipt still distinguishes a created artifact, an annotation, an unchanged result, and a failed operation.

## Alternatives considered

**Remove artifact identity along with detail.** The model could no longer refer to the exact result.

**Keep every provenance field and operation in each receipt.** Repeated context duplicates information already owned durably.

**Hide failures to keep output short.** A smaller result would misrepresent whether work committed.

## Consequences

Compact receipts reduce repeated context without changing store authority or exactly-once identity. Details remain accessible through explicit reads. Reducing output text is not permission to omit model-visible facts from the session log.

## Related

Related owners: [science-read-remotes](../architecture/2026-09-09-science-read-remotes.md); [science-artifact-receipts-restoration](../bug-fix/2026-09-02-science-artifact-receipts-restoration.md).
