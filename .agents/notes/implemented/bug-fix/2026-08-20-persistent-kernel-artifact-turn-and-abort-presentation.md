# Agent Note: Persistent-kernel source-run turns and abort presentation

Status: implemented

English | [中文](2026-08-20-persistent-kernel-artifact-turn-and-abort-presentation.zh.md)

## Problem

One persistent-kernel request-header configuration can authorize more than one user turn. Treating `requestHeaderSeq` as artifact-version identity therefore collapsed changed files from later turns into an earlier visible version.

The Science fallback row also treated the durable post-dispatch `AbortError` code `ABORTED` as a failed execution even though the associated Science run is cancelled.

## Decision

Auto-capture and strict replay compare the authorizing `tool/call.turn` of each artifact's source run only for changed `origin: 'auto'` saves: a different source-run turn opens the next version, while the same turn supersedes the existing version. `origin: 'model'` is metadata-only and must retain the target attachment; either origin can supersede an unchanged attachment. `requestHeaderSeq` remains the durable authorization and provenance field.

`ScienceToolFallbackRow` renders both `interrupted` and `ABORTED` results as stopped. `ABORTED_BEFORE_DISPATCH` remains a generic error because no dispatched Science run was cancelled.

## Alternatives considered

**Keep `requestHeaderSeq` as the version key.** A request header identifies a model-request configuration epoch, not one user turn, so it cannot distinguish the persistent-kernel runs this bug exposed.

**Map every abort code to stopped.** A pre-dispatch rejection did not stop a running Science operation and must keep the generic error presentation.

## Consequences

Artifact history follows user turns even when their model requests reuse one configuration header. The durable log still exposes `requestHeaderSeq` for authorization and provenance joins.

The stopped presentation now matches the durable `cancelled`/`CANCELLED` Science state for canonical post-dispatch aborts. The assembled Web fixture replays a `run_python` call with `AbortError`/`ABORTED` beside its cancelled Science run and asserts both the stopped row and the durable projection. A real Stop-control interaction still needs a replayable running kernel fixture and is not inferred from this completed replay coverage.

## Testing

Focused Runtime capture proves two source-run turns sharing one request header create v1 and v2, while two runs in one turn supersede v1. Strict replay rejects a cross-turn changed auto supersede and a changed later model curation, while accepting an unchanged attachment. The assembled Chromium fixture renders v1/v2 run-row chips and Details navigation, then renders the canonical aborted run as stopped while replay retains `cancelled`/`CANCELLED`. UI component coverage pins `ABORTED` as stopped and `ABORTED_BEFORE_DISPATCH` as an error.
