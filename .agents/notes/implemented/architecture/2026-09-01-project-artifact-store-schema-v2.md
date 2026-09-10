# Agent Note: Project artifact store — schema v2 and its migration

Status: implemented

English | [中文](2026-09-01-project-artifact-store-schema-v2.zh.md)

## Problem

Artifacts outlive session logs, so their provenance cannot depend on replaying a producer conversation that may have been deleted. Earlier store rows also need an explicit interpretation when the schema gains provenance fields.

## Decision

Schema v2 makes the project store authoritative for content origin, producer coordinates, environment observations, run inputs, chart state, annotations, and explicit baselines. A version is immutable except for its latest-annotation pointer. Annotation is append-only, with omission, null, and a value distinguished; annotator identity does not replace original capture identity. A complete `(sessionId, toolCallId, requestHeaderSeq)` tuple is consumed transactionally across the project.

Migration uses an ordered chain, refuses unknown newer versions or missing steps, and advances the schema version only inside a successful transaction after foreign-key validation. Pre-migration WAL checkpoint and backup are best effort; SQL migration failure rolls back. A fresh version-zero database is stamped only after initialization.

Historical mappings preserve uncertainty: old parent pointers become non-explicit baselines; fingerprints are not expanded into invented observations; colliding names retain the earliest chain and rename later chains without merging them; numeric environment revisions are converted; optional provenance backfill is warning-only on failure; missing historical provenance remains unknown. Session events retain replay coordinates, not a competing current provenance database.

## Alternatives considered

**Keep provenance only in logs.** Session deletion would erase the explanation for longer-lived artifacts.

**Edit annotation fields in place.** This loses prior metadata and confuses a user’s annotation with content production.

**Default every baseline to the preceding ordinal.** Ordering does not prove that a version was derived from its predecessor.

**Make optional log backfill a migration prerequisite.** An unavailable old session would prevent opening otherwise valid project data.

## Consequences

Schema migration does not manufacture historical certainty or merge distinct artifact chains. Backup failure is diagnostic rather than a false claim of guaranteed rollback media. Session note events and full-session format admission have their own durable rules; optional historical backfill does not restore logs as the current provenance authority.

## Related

Related owners: [project-artifact-store](2026-08-25-project-artifact-store.md); [science-artifact-event-slimming](2026-09-02-science-artifact-event-slimming.md); [science-runtime-provenance-writes](2026-09-02-science-runtime-provenance-writes.md).
