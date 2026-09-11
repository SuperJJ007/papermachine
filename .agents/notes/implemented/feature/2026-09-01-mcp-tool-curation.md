# Agent Note: Deployment-level MCP tool curation

Status: implemented

English | [中文](2026-09-01-mcp-tool-curation.zh.md)

## Problem

A Science preset can constrain built-in tools yet accidentally expose a broad MCP server’s execution or mutation tools. Tool inventory changes after startup also need the same policy.

## Decision

MCP curation selects permitted remote tools using declared server/tool policy at load and whenever generation changes the inventory. A tool is not safe merely because its name resembles a read operation. Curation is applied before model exposure, while the server’s underlying inventory remains available to its owner. Missing or invalid configured referents fail loudly.

The Science preset and deployment-policy owner select the curated set. Curation is not a substitute for runtime filesystem or subprocess confinement.

## Alternatives considered

**Filter only the first tools/list response.** Reconnection or a later inventory update could reintroduce excluded tools.

**Hide tools in the UI but retain model schemas.** The model can still invoke the excluded operation.

**Guess safety from tool names.** Remote names do not prove behavior or privilege.

## Consequences

The model sees a stable policy-derived subset across inventory refreshes. A permitted remote tool still runs with its server’s own authority; selection is an exposure policy, not a sandbox for the server.

## Related

Related owners: [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.md).
