# Agent Note: `saveArtifactAs` — duplicating a committed artifact version into a new logical artifact

Status: implemented

English | [中文](2026-09-02-science-save-artifact-as.zh.md)

## Problem

A user may want a separate artifact chain from an exact existing version without pretending to have rerun its producer analysis.

## Decision

Save-as reads an exact authorized project version and creates a new logical artifact identity with copied bytes and explicit source provenance. It does not impersonate the original producing run. Store rules validate the new name and arbitrate project-wide uniqueness; the invoking session records its own reference to the committed result. A source from another session remains a project-store reference, not an invented local run.

The operation captures user-action attribution at entry and uses the shared commit/append/orphan path.

## Alternatives considered

**Rename the original chain.** This changes the identity of existing references instead of creating an independent result.

**Copy the original producer as if it made the new artifact.** It erases the user’s save-as action.

**Resolve a moving latest source after waiting.** Concurrent writes can change which bytes the user selected.

## Consequences

The new chain can evolve independently while retaining an explicit source relationship. Save-as is not a general cross-project import, and successful store commit is still separate from session event delivery.

## Related

Related owners: [project-artifact-store-schema-v2](../architecture/2026-09-01-project-artifact-store-schema-v2.md); [science-viewer-write-turn-attribution-and-data-loading-guidance](../bug-fix/2026-09-03-science-viewer-write-turn-attribution-and-data-loading-guidance.md).
