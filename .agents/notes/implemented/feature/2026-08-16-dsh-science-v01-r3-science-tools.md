# Agent Note: Science tool assembly and runtime ownership

Status: implemented

English | [中文](2026-08-16-dsh-science-v01-r3-science-tools.zh.md)

## Problem

Science tools need an environment before execution without making eager discovery a prerequisite for every session or retrying provider work during request reconstruction.

## Decision

Tool consumers await lazy binding through asynchronous assembly and delegate execution to ScienceRuntime. The Science preset selects the read-only filesystem entry and the curated Science tool set. Deployment policy owns copy eligibility, MCP curation, and retained request context; context retries reuse retained provider results rather than rerunning the provider.

Tool schemas expose typed requests, but domain admission stays in the Runtime. State and installation results must describe the actual recorded environment rather than infer readiness from a configured path. Science composition is shared by the product and headless preset.

## Alternatives considered

**Bind all environments eagerly.** This imposes interpreter probes on sessions that never use Science and couples composition to host readiness.

**Let the model use unrestricted shell or filesystem mutation.** This bypasses the Runtime observation and capture path.

**Repeat context-provider work for retries.** A retry would change side effects and observed inputs instead of rebuilding the same admitted request.

## Consequences

Asynchronous assembly must propagate binding failures; a configured but unusable environment is not silently skipped. Deployment-varying tool and pruning policy remains validated configuration. The preset does not make an unlogged external package mutation reproducible.

## Related

Related owners: [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.md); [science-run-tool-exact-version-inputs](2026-08-22-science-run-tool-exact-version-inputs.md).
