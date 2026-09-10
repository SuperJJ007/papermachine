# Agent Note: Science Runtime auto-capture of run-written files

Status: implemented

English | [中文](2026-08-19-science-auto-capture.zh.md)

## Problem

A run can create useful files even when its code fails. Releasing execution ownership before capture also lets the next run change the directory being inspected.

## Decision

Capture runs after terminal execution and before lease release. Eligible output bytes are committed to the project artifact store, then referenced by session events. Run failure does not by itself discard produced output. Capture has independent count and byte limits and records partial failures without changing a completed interpreter result into a fictional success.

Raster admission follows explicit output declarations. A late capture updates durable state; it cannot retroactively change a tool result already delivered to the model or invent a model notification. Event folding catches up with concurrent session appends after each await.

## Alternatives considered

**Capture only successful runs.** Diagnostic figures and partial results from a failed analysis would disappear.

**Release the lease before reading outputs.** A subsequent run could mutate the same files.

**Use one global process-output budget.** Stream output and artifact bytes consume different resources and need separate configured bounds.

## Consequences

Store commit and session append are distinct operations; append failure can leave an orphan requiring reconciliation. Capture is bounded and may be partial. It does not infer scientific intent from filenames or guarantee collection of files outside the declared output policy.

## Related

Related owners: [artifact-identity-stability-and-raster-capture-policy](2026-08-27-artifact-identity-stability-and-raster-capture-policy.md); [science-capture-concurrent-events](../bug-fix/2026-09-08-science-capture-concurrent-events.md); [artifact-store-session-reconciliation](../architecture/2026-09-01-artifact-store-session-reconciliation.md).
