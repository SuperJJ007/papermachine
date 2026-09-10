# Agent Note: Artifact identity stability and raster-capture policy

Status: implemented

English | [中文](2026-08-27-artifact-identity-stability-and-raster-capture-policy.zh.md)

## Problem

Streaming projection replacement can retrigger identical artifact reads, while automatic raster capture cannot safely infer which files the analysis intends to publish.

## Decision

Artifact reads are keyed by immutable version identity, not by a newly allocated projection object. Promise caches are bounded and evict rejected reads so transient failures remain retryable. Native artifact panes preserve exact version parameters when unrelated session state changes.

Raster capture uses explicit `raster_artifacts` declarations. Declared PNG outputs are eligible under capture policy; diagnostic files can stay outside the artifact directory. A skipped raster appears in the tool’s capture result instead of creating a separate durable event merely to describe the skip.

## Alternatives considered

**Key reads by projection object identity.** Streaming allocations invalidate an unchanged byte request.

**Debounce repeated reads.** This delays symptoms without fixing their identity.

**Capture every image or guess from filenames.** Temporary diagnostics become project artifacts and scientific intent is inferred from a naming convention.

## Consequences

Exact version selection remains stable while streaming, and retryable failures do not poison the cache. Declarations specify eligibility rather than guaranteeing a file exists or passes byte and type limits. Omitting an output intentionally means it is not published by raster capture.

## Related

Related owners: [science-native-sidebar](../architecture/2026-09-10-science-native-sidebar.md); [science-auto-capture](2026-08-19-science-auto-capture.md).
