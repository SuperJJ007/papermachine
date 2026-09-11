# Agent Note: `science/artifact-saved` event slimming and the store-is-authority fold

Status: implemented

English | [中文](2026-09-02-science-artifact-event-slimming.zh.md)

## Problem

Duplicating chart state and provenance in session artifact events makes every replay carry a second project database and creates conflicting authorities.

## Decision

Artifact events retain the immutable reference coordinates needed by the Science fold. The project store owns byte metadata, source and annotation provenance, figure state, and explicit baselines. Slimming does not weaken checks on environment revision, producing run, project identity, or exact reference consistency.

All nine Science event types are required on read in native V3. Tolerant event-codec handling of historical fields is not permission to open or rewrite an old full Science session: full-session admission and migration have separate requirements. Known Science events cannot opt out through an ignorable envelope.

## Alternatives considered

**Keep full receipts and figure state in both places.** Divergent copies make later annotation and session deletion ambiguous.

**Remove durable relationship checks with the fields.** A smaller event would then admit references unrelated to its producing environment or run.

**Treat a codec accepting one event as historical session support.** Complete logs also require consistent references and projections.

## Consequences

Session replay describes the relationship to an artifact; current byte and provenance reads consult the store. Missing project data can make an artifact unavailable even when the transcript remains readable. Historical Science recovery must remap every required reference relationship before support can be claimed.

## Related

Related owners: [science-required-session-events](2026-09-10-science-required-session-events.md); [science-read-remotes](2026-09-09-science-read-remotes.md); [project-artifact-store-schema-v2](2026-09-01-project-artifact-store-schema-v2.md).
