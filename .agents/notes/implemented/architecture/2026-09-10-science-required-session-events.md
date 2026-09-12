# Agent Note: Required Science events and historical Session refusal

Status: implemented

English | [中文](2026-09-10-science-required-session-events.zh.md)

## Problem

Skipping artifact notes discards durable user state even though notes do not enter model messages. PaperMachine 0.1.0 also stores Science events in V0 logs whose sequence references cannot safely pass through upstream's adjacent migrations without Science-specific remapping.

## Decision

All nine Science event declarations belong to `SessionEventMap`; there is no Science `IgnorableSessionEventMap` augmentation. Note add/remove use ordinary Session append, carry no `ignorable` flag, and remain non-surface events folded by the separate `scienceArtifactNotes` projection. Science replay refuses a known Science event marked ignorable. The seven model-state events retain their existing strict fold and preset applicability rules.

The generated current event catalog recognizes all nine types. Native V3 persistence retains their payloads and sequence references unchanged. The released V0, V1, and V2 codecs and adjacent migrations receive no Science dispositions or payload rewrites. The persistence provider refuses legacy Science logs on both read and write open; it neither changes their bytes nor publishes a migrated successor on refusal. This follows the [released generation policy](2026-08-31-released-session-format-migrations.md).

## Alternatives considered

**Keep notes ignorable.** Their absence leaves model history unchanged but loses user-authored state, so model visibility does not justify making the events optional to readers.

**Add opaque dispositions to legacy migrations.** V1-to-V2 chunk compaction and V2-to-V3 rewrites renumber events. Opaque Science payloads retain old `requestHeaderSeq` and `noteSeq` values, so successful format conversion would not establish valid replay.

**Recover legacy Science sessions during the replant.** The approved D1 decision defers this work. Recovery requires dispositions, Science reference remapping across all three adjacent edges, and replay validation against real legacy logs; the planning estimate is two to three days, without a delivery commitment.

## Consequences

PaperMachine 0.1.0 Science sessions are unreadable in the replant. Their files remain intact, and new sessions use V3. The [release note](../../../../docs/user/papermachine-0.1.2-release-notes.md) states this limitation. Header-only listing is not proof that the body can be opened. Generic upstream V0 sessions without Science events retain upstream migration support; this decision adds no blanket V0 ban.

The [storage regressions](../../../../packages/science/science-session/tests/persistence.spec.ts) exercise all nine types in plain and Zstandard V3 read/write round trips and reject each legacy type on read and write while preserving bytes and file identity. Note Remote tests verify required envelopes without an agent follow-up. [P3 acceptance](../../../migrations/0.1.5/P3.md) records real V0 evidence and both SDK projection refreshes. No upstream runtime package is patched for P3; persistence catalog output derives from owned Science JSDoc.
