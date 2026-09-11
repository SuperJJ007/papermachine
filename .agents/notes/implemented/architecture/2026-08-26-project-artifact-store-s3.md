# Agent Note: Exact project inputs across sessions

Status: implemented

English | [中文](2026-08-26-project-artifact-store-s3.zh.md)

## Problem

A session may consume a project artifact written by another session whose ordinal is ahead of its local projection. Requiring local history for every input defeats project-level ownership.

## Decision

Exact inputs resolve from the local projection when present and otherwise from verified project-store versions. A reference within the locally known ordinal range must agree with that history; an ahead-of-local reference relies on authoritative store validation instead of fabricating missing session events. The current session’s cwd determines project authorization for Remote reads.

The store head also prevents a locally stale session from resetting a shared chain during capture. Edit baselines remain session-local references; broad input access does not silently broaden every editing operation.

## Alternatives considered

**Require a prior local event for every project input.** Other sessions’ valid outputs become unusable until copied into a second history.

**Trust arbitrary ahead-of-local coordinates.** Without store proof a caller could invent versions.

**Infer the latest version as the edit source.** Concurrent project writes can change what latest means.

## Consequences

Cold replay can validate the references it records without reconstructing another conversation. Project sharing does not authorize a different project namespace. Ordinal ordering and explicit provenance are separate facts, and missing bytes remain a read failure rather than a fabricated attachment.

## Related

Related owners: [science-read-remotes](2026-09-09-science-read-remotes.md); [science-runtime-provenance-writes](2026-09-02-science-runtime-provenance-writes.md).
