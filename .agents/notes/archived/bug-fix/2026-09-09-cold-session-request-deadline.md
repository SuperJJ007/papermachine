# Agent Note: Bound cold session requests without cancelling valid restores

Status: implemented
Archived: 2026-09-10

English | [中文](2026-09-09-cold-session-request-deadline.zh.md)

## Problem

A packaged Intel application under Rosetta takes about 42 seconds to inspect and compose a long cold Science session. Its valid history and model responses exceed the fetch carrier's former 30-second unary deadline, so the browser reports `signal timed out` even though the host completes successfully. This is independent of the [environment-field validation repair](2026-09-08-science-enforcement-wire-validation.md).

## Decision

The fetch carrier's existing constructor budget defaults to 120 seconds for bounded unary calls. The budget includes host processing, not just network transit. Embedding clients retain the `timeoutMs` override and caller cancellation; native directory picking remains user-paced and deadline-exempt.

The real browser's paged-history scenario holds the real persistence read for 35 seconds, then checks the unchanged transcript and whole-session counts. Carrier tests accept a 35-second response, reject a response past 120 seconds, and retain cancellation and native-picker coverage.

## Alternatives considered

Keeping the 30-second limit rejects measured valid restores. Removing the deadline would let a hung host leave callers pending indefinitely. The longer bounded default accommodates cold composition without changing history ownership or weakening stored-data validation.

## Consequences

Cold restore remains a read of the original log and needs no migration. This change prevents premature cancellation; it does not make cold composition faster. Installer acceptance still requires a full quit and reopen with persisted history and artifacts.
