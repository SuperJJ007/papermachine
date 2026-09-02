# Agent Note: Restore Science artifact lineage, edit summaries, and curation authorization

Status: implemented

English | [中文](2026-09-02-science-artifact-receipts-restoration.zh.md)

## Problem

The [store-authority migration](../architecture/2026-09-01-project-artifact-store-schema-v2.md) moved producer, ancestry, annotation, and live-figure facts out of session artifact events. The first [tool migration](../feature/2026-09-02-science-tool-receipts-slimming.md) then removed model-visible lineage, producer references, and direct-edit summaries instead of reconstructing them from the project artifact store. That reduced the information available to the model after a run or annotation. Separately, `annotate_artifact` checked curation-call reuse against the current session projection before writing. The check did not cover the project's full annotation history and did not share the transaction that consumed the authorization.

## Decision

The project artifact store consumes model curation authorization inside the existing `BEGIN IMMEDIATE` annotation write transaction. A model annotation must provide `sessionId`, `toolCallId`, and `requestHeaderSeq`; the exact tuple may occur only once across all annotations in the project. Reuse fails with `ANNOTATION_TOOL_CALL_REUSED`, which the Science runtime maps to the typed, model-visible `ARTIFACT_ANNOTATE_TOOL_CALL_REUSED` error. The schema does not change, so `SCHEMA_VERSION` remains `2`.

The same write path enforces annotation ownership. Capture may create only the first annotation for a version. Later metadata changes must be model curation or a human edit. Capture and human writes cannot claim model authorization fields.

`dsh-tool-science` reconstructs bounded model-facing receipts from store-owned facts without adding provenance fields back to session events:

- `run_python` and `run_r` describe an explicit base as `edited from <logicalName> v<N>` and an implicit continuation as `continues v<N>`.
- `annotate_artifact` describes the producer as `produced by run_python (turn N)` or `produced by run_r (turn N)`. Internal run identifiers remain hidden.
- PNG artifacts expose `editCount` and the latest direct chart edits decoded from `figure_state`. `stateHistoryLimit` bounds the returned edit list while the count remains complete.

All facts included in tool results are logged through the existing tool-result session events. `versionId`, `sha256`, `projectId`, annotation actor, and internal run identifiers remain absent from model-facing text.

## Alternatives considered

**Put producer and ancestry fields back into `science/artifact-saved`** — rejected. The artifact store already owns those durable facts, and tool execution can resolve them when it builds a receipt. Duplicating them in session events would create two authorities.

**Keep the reduced receipts** — rejected. The missing lineage, producer context, and edit summaries are model-visible regressions, not optional presentation details.

**Keep the runtime's projection scan and add more cases** — rejected. A read before the write cannot provide exact-once consumption under concurrent calls and cannot cover the complete project history as reliably as the authoritative store transaction.

## Consequences

The annotation input is a discriminated union: model writes require the full authorization tuple, while capture and human writes do not accept it. Store and runtime tests cover successful consumption, reuse across versions and superseded annotations, capture ownership, and typed runtime error mapping.

Artifact-listing tools now resolve the matching `VersionRecord`; PNG listings additionally read and decode `figure_state`. The configured history limit also bounds direct-edit detail, so receipt size stays predictable. Unit tests cover explicit and implicit ancestry, producer wording, non-PNG behavior, edit truncation, and the absence of internal identifiers. The three model-visible receipt forms are also pinned by the keyless Science snapshots.
