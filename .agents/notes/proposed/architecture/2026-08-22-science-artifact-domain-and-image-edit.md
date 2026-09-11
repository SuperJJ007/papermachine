# Agent Note: Notebook projection and portable analysis bundles

Status: proposed

English | [中文](2026-08-22-science-artifact-domain-and-image-edit.zh.md)

## Problem

A reproducible notebook should explain recorded analysis without becoming a second editable source of session truth. Exact artifact inputs and native editing are implemented, but a portable notebook bundle is not.

## Proposal

Project a notebook from admitted session events and store references. Group cells by language and kernel epoch, join source to its run and tool-call identity, and retain source hashes and exact input versions. Provide full and sliced ZIP bundles with a manifest, README, runnable entry point, and per-kernel notebooks. A slice must retain the dependencies required by its selected outputs rather than guessing from the latest artifact.

The existing project store, input materialization, and live-figure editing supply prerequisites; this proposal does not recreate the removed image/text attachment families or promise support for old Science session formats.

## Alternatives considered

**Make the notebook a second writable analysis history.** Edits would diverge from the session log and create competing sources of provenance.

**Export only final images.** This loses the code, exact inputs, and environment explanation needed to understand or reproduce them.

**Replay every historical session format without a reference migration.** A bundle cannot repair invalid durable relationships by ignoring them.

## Acceptance criteria

Full and sliced exports have deterministic contents for the same admitted input, validate every included reference, preserve code/run/tool-call joins, and state missing dependencies explicitly. Tests must cover multiple languages and epochs, cross-session project inputs, deleted producers, missing blobs, and a slice whose inputs precede its first selected run. Opening the notebook must not mutate the original session.

## Risks

External side effects, undeclared package state, and missing historical bytes can prevent reproducibility. Cross-project import, retention and garbage collection need explicit policy. Native notebook export and deterministic bundling remain unimplemented; existing artifact editing is not evidence that these criteria are satisfied.

## Related

Related owners: [science-runtime-input-materialization-and-edit-baselines](../../implemented/feature/2026-08-22-science-runtime-input-materialization-and-edit-baselines.md); [project-artifact-store](../../implemented/architecture/2026-08-25-project-artifact-store.md); [science-live-figure-editing](../../implemented/architecture/2026-08-28-science-live-figure-editing.md); [science-required-session-events](../../implemented/architecture/2026-09-10-science-required-session-events.md).
