# Agent Note: Desktop onboarding reaches its install path

Status: implemented

English | [中文](2026-09-01-desktop-general-environment.zh.md)

## Problem

Environment readiness must reflect the declared package content, not a marketing version or whichever interpreter happens to be on PATH.

## Decision

The product general-environment declaration supplies interpreter and package requirements, health checks, installer settings, and timeout. Content revision follows the declaration’s meaningful bytes so a changed environment cannot reuse an unrelated applied observation. ProductEnvironment builds the Science profile and provisioning inputs from the same resource declaration.

The desktop owns installation into its selected product home. The installed environment is observed before use; an existing prefix is not proof that the current declaration has been satisfied.

## Alternatives considered

**Use the application version as the environment revision.** UI-only releases would trigger needless work while independently changed environment content could be overlooked.

**Detect and bind arbitrary host interpreters.** Package sets and provenance become machine-dependent and cannot satisfy the product’s install-only policy.

## Consequences

Changing declared content can require provisioning or re-observation. The declaration is not a universal lock against later external mutation; shared-prefix drift is checked by Runtime. Platform packaging acceptance remains separate from the common environment declaration.

## Related

Related owners: [desktop-owns-its-environment](2026-09-01-desktop-owns-its-environment.md); [science-shared-prefix-drift](../bug-fix/2026-09-06-science-shared-prefix-drift.md).
