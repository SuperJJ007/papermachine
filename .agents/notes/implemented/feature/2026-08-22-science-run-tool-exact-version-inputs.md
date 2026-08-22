# Agent Note: Science run tools expose exact-version inputs and edit ancestry

Status: implemented

English | [中文](2026-08-22-science-run-tool-exact-version-inputs.zh.md)

## Problem

The Science Runtime can materialize committed artifact versions and assign explicit capture parents, but the model-facing run tools could not request either operation. The model also needed stable artifact ids and ancestry in capture receipts so one run result could authorize a later exact-version input without inferring identity from filenames.

The broader [artifact-domain and image-edit proposal](../../proposed/architecture/2026-08-22-science-artifact-domain-and-image-edit.md) assigns this Consumer behavior to the run tools while keeping validation and filesystem authority in the [Science Runtime](2026-08-22-science-runtime-input-materialization-and-edit-baselines.md).

## Decision

`run_python` and `run_r` accept the same optional `artifact_inputs` and `edit_of` arrays. Each item uses the model-visible `{artifactId, version, path}` fields. An `artifact_inputs` path is relative to `SCIENCE_INPUT_DIR`, an environment variable the kernel driver sets to the run's reserved materialized-input directory the same way it sets `SCIENCE_STATE_DIR` and `SCIENCE_ARTIFACT_DIR`; an `edit_of` path is relative to `SCIENCE_ARTIFACT_DIR` and names the exact parent version for that output. The Consumer brands opaque ids and converts the arrays to `StartScienceRunRequest.artifactInputs` and `.editBaselines`; the Runtime remains the only owner of version resolution, path safety (including case-folded/NFC collision rejection across both `artifact_inputs` and `edit_of` paths, each checked within its own set since the two materialize into disjoint run-directory trees), byte/count bounds, materialization, and capture attribution.

Duplicate `edit_of` paths reject before a run is published because converting the model array to the Runtime's path-keyed record must never silently overwrite a baseline. Other invalid or unresolved values reach the Runtime unchanged and retain its stable error classifications.

Every captured-artifact result entry carries its optional `parent`. The plain-text receipt names the current artifact's stable id and, when present, the exact parent id and version. The renderer derives both from the bounded canonical result rather than replaying live session state.

The keyless Science headless example executes the real Loader, agent loop, tool runtime, Science Runtime, attachment provider, durable Session path, and fake kernel protocol. Its model reads the exact image id and version from a prior capture receipt, then calls a second `run_python` with that version as both `artifact_inputs` and `edit_of`; the snapshot pins the tool schemas, recorded run input, captured branch parent, and final model-visible ancestry receipt.

## Alternatives considered

**Use logical names instead of artifact ids.** Logical names can advance or branch, so they do not identify the immutable version the caller consumed or edited.

**Expose `edit_of` as an untyped path-keyed JSON object.** The tool schema subset cannot validate each dynamic property's value, and duplicate keys disappear during JSON parsing. A typed array validates every reference and lets the Consumer reject duplicate output paths before conversion.

**Validate paths and version existence in the Consumer.** That would duplicate Runtime policy and allow direct Runtime callers to diverge. The tool only prevents lossy array-to-record conversion; the Runtime enforces operational validity.

**Read ancestry from the live projection while rendering.** Tool rendering is a pure function of arguments and the canonical result. Replaying mutable session state could make retained output differ from the durable result it originally described.

## Consequences

Models can feed exact prior evidence into either persistent kernel and mark edited outputs with explicit ancestry using one ordinary run call. Capture receipts provide the opaque identities required for the next call without exposing attachment handles or file bytes.

The two optional arrays add fixed schema tokens to every request in the Science preset. Each edited capture adds one parent reference to the retained result; runs without inputs or ancestry keep their existing execution and receipt behavior.
