# Agent Note: PaperMachine owns its environment outright

Status: implemented

English | [中文](2026-09-01-desktop-owns-its-environment.zh.md)

## Problem

A research desktop cannot promise a reproducible starting environment while silently adopting a user’s existing Conda installation or relying on a single unreachable package source.

## Decision

The product installs and owns its environment. ProductEnvironment supplies the bundled micromamba path, general-environment declaration, and ordered package sources to the provisioner, then produces the Science runtime configuration. Each source attempt is a complete source choice; fallback advances in declared order and retains diagnostics. Locale selects a suitable default order without making locale part of interpreter identity.

Native desktop startup and IPC own setup interaction; shared product-path selection owns installation isolation. Applied state is tied to declared content and must pass health observation. Bundled skills use an explicit resource provider, not ambient default roots.

## Alternatives considered

**Detect and bind an existing environment.** This imports unknown package state and makes support depend on unrelated user installations.

**Hardcode one reachable mirror.** Reachability varies by deployment, and a single source can strand setup.

**Mix partial channel attempts into one hidden fallback.** The selected source and its failure become difficult to reproduce.

## Consequences

The product pays disk and provisioning costs for an owned environment. Ordered fallback is not proof that every source works on every platform. Shared-prefix mutation and session binding remain Runtime concerns; current native packaging and root isolation remain separate owners.

## Related

Related owners: [papermachine-installation-isolation](../architecture/2026-09-10-papermachine-installation-isolation.md); [desktop-bundled-skills](2026-09-01-desktop-bundled-skills.md); [desktop-general-environment](2026-09-01-desktop-general-environment.md); [provisioning-attempt-logs](../bug-fix/2026-09-07-provisioning-attempt-logs.md).
