# Agent Note: `science-runtime` accepts partial sandbox enforcement only by explicit configuration, and records what it accepted

Status: implemented

English | [中文](2026-09-05-science-runtime-minimum-sandbox-enforcement.zh.md)

## Problem

A Science deployment must not silently accept weaker sandbox enforcement just because a host provider can start the interpreter.

## Decision

Validated `minimumEnforcement` defaults to full. Every confinement path, including observation, execution, installation, and recovery, requests the configured floor. A binding records actual `sandboxEnforcement`; full and partial remain explicit observations rather than platform guesses. Choosing partial is a deployment decision and must not be hidden in a provider fallback.

## Alternatives considered

**Accept whichever level the provider returns.** Deployment security changes silently across machines.

**Hardcode a platform exception in Runtime.** Platform identity does not establish actual provider capability or user policy.

**Apply the floor only to normal runs.** Probes, installs, or cold replay would bypass the same requirement.

## Consequences

Providers below the configured floor fail admission rather than running unconstrained. Recording enforcement does not upgrade partial confinement to full or prove a platform has passed real acceptance. Wire validation must preserve the recorded level in live and cold projections.

## Related

Related owners: [managed-cooperative-interruption](2026-09-09-managed-cooperative-interruption.md); [science-enforcement-wire-validation](../bug-fix/2026-09-08-science-enforcement-wire-validation.md).
