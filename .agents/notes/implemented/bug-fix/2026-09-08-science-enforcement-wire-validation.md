# Agent Note: Validate recorded sandbox enforcement in Science wire projections

Status: implemented

English | [中文](2026-09-08-science-enforcement-wire-validation.zh.md)

## Problem

A writer can record sandbox enforcement correctly while a strict projection wire validator rejects the same field, breaking cold reads despite successful execution.

## Decision

The environment wire validator admits optional `sandboxEnforcement` only as full or partial while retaining exact-key validation. Absence remains valid where the recorded binding has no level. Tests must carry the value through event replay, client projection, JSON serialization, and the receiving validator, including a restarted composition reading persisted history.

The required-Science-event owner governs current V3 and historical full-session admission. Accepting this field does not bypass that policy or promise that every older Science format is readable.

## Alternatives considered

**Drop enforcement from the projection.** This hides an intentional observation from consumers.

**Allow arbitrary keys or discard stored data.** The legitimate field can be admitted without weakening unrelated validation or erasing valid records.

**Test only field transmission.** The actual receiving validator can still reject it.

## Consequences

Recorded enforcement remains visible without changing sandbox permissions. Package field tests alone cannot establish cold product behavior; assembled persistence and reload evidence remain required. A rebuilt client is necessary to distribute a validator change.

## Related

Related owners: [science-required-session-events](../architecture/2026-09-10-science-required-session-events.md); [science-runtime-minimum-sandbox-enforcement](../architecture/2026-09-05-science-runtime-minimum-sandbox-enforcement.md).
