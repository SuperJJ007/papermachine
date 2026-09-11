# Agent Note: PaperMachine brand as the desktop's slot occupant

Status: implemented

English | [中文](2026-09-01-papermachine-brand.zh.md)

## Problem

Product branding needs to change the visible mark, name, and hero together without forking the shared client or changing official builds.

## Decision

The PaperMachine branding plugin registers the mark, name, and hero slots through the same injected slot and locale services. Registration is gated by the `papermachine` client build profile. Locale-dependent text participates in effect ownership so disposal removes the contribution. Product identity and runtime home selection remain separate from these visual slots.

## Alternatives considered

**Patch shared client labels directly.** Official builds would acquire fork-specific identity.

**Replace only one brand surface.** The navigation and landing page would describe different products.

**Read locale once without effect ownership.** Text can become stale and plugin disposal can leave contributions behind.

## Consequences

The product owns its visible branding through a plugin. A build-profile gate is not runtime installation isolation; product app id, storage roots, and update origin have their own owner.

## Related

Related owners: [papermachine-installation-isolation](../architecture/2026-09-10-papermachine-installation-isolation.md).
