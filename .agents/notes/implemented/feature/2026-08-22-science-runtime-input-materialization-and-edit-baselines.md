# Agent Note: Science Runtime materializes artifact inputs and assigns edit baselines

Status: implemented

English | [中文](2026-08-22-science-runtime-input-materialization-and-edit-baselines.zh.md)

## Problem

An analysis must read the requested bytes without exposing artifact-store paths or mistaking copied inputs for newly produced outputs.

## Decision

Runtime resolves all requested exact versions and validates safe relative paths, collisions, counts, and edit baselines before publishing a run. Inputs are materialized separately from the artifact output directory. `store.readBlob` supplies bytes; the aggregate byte limit counts actual bytes read rather than trusting stored size metadata. Cancellation is checked while preparing inputs, and failed preparation removes its temporary files.

Cross-session inputs can be resolved from the project store. Edit baselines remain exact session-projection references. The baseline mapping survives through capture so the store can record an explicit `baseVersionId`; it never infers that the latest version was the intended source. Byte-identical outputs remain subject to capture deduplication.

## Alternatives considered

**Pass private store paths directly to code.** This exposes implementation paths and bypasses the run-specific input directory.

**Place inputs in artifacts.** Capture would rediscover copied inputs as new outputs.

**Validate declared sizes only or partially launch before resolution finishes.** Incorrect metadata or a late missing input would evade the budget or start an incomplete request.

## Consequences

Inputs are all-or-nothing preparation, not a new driver protocol. Exact version selection does not imply arbitrary cross-project access. The baseline association records user intent separately from ordinal ordering.

## Related

Related owners: [project-artifact-store-s3](../architecture/2026-08-26-project-artifact-store-s3.md); [project-artifact-store-schema-v2](../architecture/2026-09-01-project-artifact-store-schema-v2.md).
