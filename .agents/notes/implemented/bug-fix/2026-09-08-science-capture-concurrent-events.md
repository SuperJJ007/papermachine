# Agent Note: Preserve concurrent session events during artifact capture

Status: implemented

English | [中文](2026-09-08-science-capture-concurrent-events.zh.md)

## Problem

Artifact capture awaits filesystem and store operations while kernel teardown and session title changes can append events to the same session. Applying only the subsequent artifact event to an earlier fold skips those intervening sequence numbers. The strict fold rejects the gap after the artifact has already committed, leaving the caller without capture accounting.

## Decision

Capture seeds one fold from the session log and advances it through every newly committed event up to each artifact append. The complete log remains authoritative; artifact writes do not imply exclusive ownership of the session event stream. Incremental replay avoids folding the entire history for every file.

## Alternatives considered

Accepting discontinuous sequence numbers would conceal missing facts from every projection consumer. Replaying the full history per file would restore correctness with unnecessary repeated work. Serializing all session writers behind artifact I/O would delay unrelated lifecycle facts and title changes.

## Consequences

A real kernel exits during extraction while its durable exit event is held until an artifact-store write completes. Capture must return the saved PNG and its unavailable-chart diagnostic, and the next run must use a fresh kernel epoch. The runnable Science snapshot also appends a user title during a store write and preserves the artifact transcript through cold history reload. The existing store/session reconciliation decision remains independently applicable to failed durable commits.

## Related

Related owners: [science-auto-capture](../feature/2026-08-19-science-auto-capture.md); [artifact-store-session-reconciliation](../architecture/2026-09-01-artifact-store-session-reconciliation.md).
