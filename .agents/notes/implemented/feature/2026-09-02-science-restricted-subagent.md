# Agent Note: Science preset gains a restricted subagent

Status: implemented

English | [中文](2026-09-02-science-restricted-subagent.zh.md)

## Problem

A delegated Science task needs useful analysis tools without recursively delegating, inheriting parent kernel variables, or bypassing the parent’s restricted tool policy.

## Decision

The Science child preset has its own narrower persona and tool set, denies further subagent dispatch, and limits delegation depth to one. A child reads or recomputes required data through its own Python/R execution; it does not assume the parent’s in-memory objects exist. Artifact exchange uses exact project references.

The parent remains responsible for integrating the child result. Runtime and preset confinement apply to child execution as well as direct calls.

## Alternatives considered

**Give the child the complete parent tool set.** Recursive delegation and unrelated tools enlarge the permitted behavior without a Science requirement.

**Share the parent’s live interpreter.** Child work would mutate analysis state without independent ownership.

**Create many specialist presets immediately.** Separate roles need demonstrated independent tool or instruction requirements, not only different labels.

## Consequences

Delegation can parallelize independent work across sessions, not simultaneous mutation of one kernel. New specialist roles require an explicit capability and policy decision; depth limits alone are not filesystem or process confinement.

## Related

Related owners: [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.md); [project-artifact-store-s3](../architecture/2026-08-26-project-artifact-store-s3.md).
