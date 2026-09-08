# Agent Note: Validate recorded sandbox enforcement in Science wire projections

Status: implemented

English | [中文](2026-09-08-science-enforcement-wire-validation.zh.md)

## Problem

Science environment bindings record `sandboxEnforcement`, and the client projection preserves it, but the exact-key environment validator omitted that field. Both `full` on macOS and `partial` on Windows therefore made an otherwise valid projection fail with `invalid Science projection value`. Runtime execution and artifact persistence could succeed while live projection updates and cold session history failed. Field-transmission tests did not exercise the receiving wire validator.

## Decision

The environment wire validator admits the optional field only when its value is `full` or `partial`. It retains exact-key validation and accepts older bindings with no recorded level. No event, checkpoint, or session format changes; existing session logs and artifact bytes need no repair.

The runnable keyless Science scenario restarts its Loader composition, resumes the persisted session, and reads the registered projection through `sessionProjections.snapshot`, which executes the same wire validator used by history reads. Its cold-history snapshot records the enforcement level and complete counters. Unit cases pass both recorded levels through replay, client projection, JSON serialization, and wire validation, and reject invalid values.

The [sandbox-enforcement policy](../architecture/2026-09-05-science-runtime-minimum-sandbox-enforcement.md) remains authoritative for accepting weaker confinement. This repair changes neither that policy nor [cold trajectory ownership](2026-09-02-science-cold-trajectory-ownership.md); both notes retain their independent rationale.

## Alternatives considered

**Drop the field from the client projection.** Rejected because the accepted confinement level is an intentional environment fact consumers can inspect.

**Allow arbitrary environment keys or discard stored sessions.** Rejected because neither is necessary: the writer emits a declared valid field, and the durable data remains valid. Keeping strict validation catches unrelated malformed wire values.

## Consequences

Recorded bindings become readable in both live and cold projections without changing sandbox permissions. Package tests alone are insufficient release evidence: desktop acceptance includes quitting the application and reopening the same session with its runs and artifacts. Previously built installers still contain the defective validator and must be rebuilt before this repair can reach users.
