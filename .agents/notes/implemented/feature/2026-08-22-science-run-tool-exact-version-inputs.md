# Agent Note: Science run tools expose exact-version inputs and edit ancestry

Status: implemented

English | [中文](2026-08-22-science-run-tool-exact-version-inputs.zh.md)

## Problem

Tools must preserve exact artifact version requests and duplicate-path mistakes until the domain validator can reject them.

## Decision

Run tool inputs and edit baselines use typed arrays of `{ artifactId, version, path }`. The adapter performs lossless conversion and rejects duplicate edit paths before constructing a map. Runtime owns path, version, project access, and materialization validation; tool descriptions do not create a second resolver.

A request names an exact version rather than a moving latest pointer. Store provenance owns the committed baseline. Minimal tool receipts do not promise a second parent or edit-operation record.

## Alternatives considered

**Use a JSON object keyed by output path at the tool boundary.** Duplicate keys may disappear before validation.

**Resolve latest in the adapter.** Concurrent writes can change the intended source and split domain ownership between tools and Runtime.

## Consequences

Non-tool consumers can use the same Runtime validation. A valid tool schema proves representation only; it does not prove that a referenced project version exists or that a path is safe.

## Related

Related owners: [science-runtime-input-materialization-and-edit-baselines](2026-08-22-science-runtime-input-materialization-and-edit-baselines.md); [science-tool-receipts-slimming](2026-09-02-science-tool-receipts-slimming.md).
