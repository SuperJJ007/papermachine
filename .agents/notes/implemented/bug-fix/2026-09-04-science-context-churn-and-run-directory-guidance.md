# Agent Note: Science context churn and run-directory guidance

Status: implemented

English | [中文](2026-09-04-science-context-churn-and-run-directory-guidance.zh.md)

## Problem

Append-on-change runtime context can repeatedly add a full environment snapshot when only run status changes. Per-run directories and version-specific library columns also invite avoidable analysis mistakes.

## Decision

Environment context depends on mode, environment, and interpreter facts rather than the latest run. Run results and explicit state reads supply status. Ordinary runs therefore do not create new environment text solely because their status changed.

Guidance distinguishes fresh `SCIENCE_ARTIFACT_DIR` output from kernel variables and `SCIENCE_STATE_DIR` working data. Exact artifact inputs materialize in their own directory, and workspace access uses the declared workspace path. Library-result references require printing unfamiliar result columns or R structure before indexing. Recorded pingouin/scipy/statsmodels examples are version-specific observations.

## Alternatives considered

**Move run status into another append-on-change entry.** It still churns on every run.

**Add overlapping directory guidance instead of rewriting its owner.** This repeats fixed prompt cost and can leave contradictory instructions.

**Recall library columns from memory.** Version changes are exactly the failure the reference is intended to prevent.

## Consequences

Runtime context remains stable when its owned facts are unchanged. Artifacts are final deliverables, not a persistent intermediate workspace. Static library references have no automatic column-drift gate; changing the shipped dependency versions requires rechecking those examples.

## Related

Related owners: [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.md); [science-runtime-input-materialization-and-edit-baselines](../feature/2026-08-22-science-runtime-input-materialization-and-edit-baselines.md).
