# Agent Note: Close the Python SDK bundled runtime over the science preset

Status: implemented

English | [中文](2026-08-24-python-sdk-runtime-science-closure.zh.md)

## Problem

`python/sdk-runtime/package.json`'s `dependencies` field is the executable deploy manifest the Python SDK's bundled runtime ships: `verify-runtime-closure` requires it to contain every plugin a shipped agent preset references plus the transitive workspace-peer closure over whatever is already listed, because auto peer installation is disabled and either omission otherwise surfaces only when Cordis loads the packaged plugin at runtime, in the field, with no local signal beforehand. The `science` preset (`apps/cli/config/agent-presets/science/agent.cordis.yml`) composes `@deepseek-ai/dsh-tool-science`, but that package was entirely absent from the runtime manifest, along with `@deepseek-ai/dsh-agent-presets`, `@deepseek-ai/dsh-science-runtime`, `@deepseek-ai/dsh-science-session`, and `@deepseek-ai/dsh-session-attachment-index` — its required peer-dependency closure. A Python SDK consumer selecting the shipped `science` preset would have failed at Cordis load time with a missing-plugin error, not at build or test time.

## Decision

Added `@deepseek-ai/dsh-tool-science` to the runtime manifest's `dependencies`, then resolved the gate's cascading peer-closure failures by adding `@deepseek-ai/dsh-agent-presets`, `@deepseek-ai/dsh-science-runtime`, `@deepseek-ai/dsh-science-session`, and `@deepseek-ai/dsh-session-attachment-index` in turn — each one surfaced only after its predecessor closed the previous gap, since `verify-runtime-closure` walks the peer graph breadth-first from whatever is already declared. `pnpm run verify-runtime-closure` now reports a closed graph (5 presets, 125 workspace packages).

## Alternatives considered

**Drop `science` from the presets the Python SDK bundled runtime ships.** Rejected: the preset is already shipped and selectable through the roster; hiding it from one deploy target while every other target serves it is a product regression disguised as a build fix, and the task at hand is to close an already-existing gap, not to narrow what ships.

## Verification

`pnpm run verify-runtime-closure` (was failing on the missing `dsh-tool-science` row, then on each surfaced peer in turn; now reports a closed graph). `pnpm run hygiene`'s full 13-gate run passes.

## Consequences

The Python SDK's bundled runtime tarball now includes `dsh-tool-science` and its full peer closure, so selecting the `science` preset through that SDK loads instead of failing at Cordis plugin resolution. The bundled runtime grows by five packages' worth of code.
