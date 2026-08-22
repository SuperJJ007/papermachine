# Agent Note: Science artifact lineage and run inputs are session facts

Status: implemented

English | [中文](2026-08-22-science-artifact-lineage-and-run-input-schema.zh.md)

## Problem

Science artifact versions recorded production provenance but could not state which exact version an edit descended from. Runs likewise recorded their code and execution environment but not the artifact versions they consumed. Filename inference could not fill either gap: two artifacts may share a name, one version may branch into several edits, and a run may materialize one version under a different input path.

The broader [artifact-domain and image-edit proposal](../../proposed/architecture/2026-08-22-science-artifact-domain-and-image-edit.md) needs these relationships before Runtime materialization, tool parameters, or viewer editing can rely on them.

## Decision

`ScienceArtifactVersion` carries an optional `parent: { artifactId, version }`. The pair is the exact content baseline named by the operation that produced the version. Numeric version order remains commit order; `parent` alone records ancestry, including a cross-artifact branch or a branch from an older version.

`ScienceRunIdentity` carries an optional `inputs` array of `{ artifactId, version, path }`. When present, `science/run-started` fixes the array and `science/run-finished` repeats it unchanged with the other start-owned identity fields, so replacing the running projection with its terminal value cannot discard dependency provenance. The fold treats omission and an empty array as the same run identity, preserving logs written before the field existed without rewriting their values. `path` is the canonical forward-slash location below the run's reserved `inputs/` directory; paths are unique within one run.

The strict fold admits a parent or input only when the named artifact version was committed earlier in the same Session. A parent cannot name the version being committed, and a superseding save cannot rewrite that version's existing parent. Terminal run facts must repeat the ordered input array exactly. The package invariant applies these rules before commit, while the client projection and witness-backed checkpoint retain both relationships losslessly.

`ScienceRuntime.startRun` does not yet write `inputs`. Reading attachment bytes, enforcing configurable materialization bounds, writing the reserved input directory, and assigning edit baselines remain Runtime responsibilities outside this decision.

## Alternatives considered

**Derive relationships from logical names or paths.** Names are presentation and workspace coordinates, not immutable identities. They cannot distinguish two same-named artifacts, preserve a renamed input, or represent several children of one baseline.

**Store dependency and ancestry edges in a separate graph.** The existing artifact and run events already own the facts each edge qualifies. A second store would require another transaction, replay path, and consistency rule before any project-level catalog exists.

**Carry inputs only on `science/run-started`.** The fold replaces a running record with its terminal whole value. Omitting inputs from `ScienceRunIdentity` would erase them from every settled run projection or require a second retained start-record authority.

**Require `inputs` and decode an omitted field as an empty array.** Normalizing older events would change their replayed value and make every current producer add a field before Runtime materialization exists. Keeping the field optional preserves prior logs and avoids expanding this schema change into Runtime, Web fixtures, and model-visible state decisions.

**Allow unresolved references for later repair.** Durable replay would then depend on event arrival outside log order and could project a graph with missing nodes. Science references remain backward-only and fail loud like Outcome evidence.

## Consequences

Artifact ancestry and run dependencies are reconstructable from the Session log, survive terminal replacement and projection checkpoints, and use the same serializable `{artifactId, version}` identity across future transcript, viewer, export, and tool entry points.

This schema does not make non-empty inputs reachable through the current Runtime or tools. It establishes the fail-loud durable authority that those producers must satisfy; their byte movement, limits, error codes, and model-visible receipts remain separate changes.

## Testing

`science-session` tests cover legacy events without inputs, strict codec paths, same-baseline sibling versions, valid cross-artifact ancestry, non-empty input projection, unresolved, future, and self references, same-parent and different-parent superseding saves, terminal input rewrites, witness-backed checkpoint round trips, and pre-commit invariant rejection.
