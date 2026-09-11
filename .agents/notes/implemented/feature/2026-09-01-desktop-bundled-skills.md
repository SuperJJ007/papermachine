# Agent Note: PaperMachine bundles default Science skills with the app

Status: implemented

English | [中文](2026-09-01-desktop-bundled-skills.zh.md)

## Problem

The packaged application must provide its curated skills offline without accidentally importing host-machine default skill roots.

## Decision

ProductEnvironment registers the bundled-skills provider with the product resource skills directory and `includeDefaultRoots: false`. Packaging owns those resources; the native desktop Host loads the generated environment composition. The configured directory is authoritative rather than an incidental working directory or user home.

## Alternatives considered

**Rely on user-installed skills.** A clean installation would have different behavior and an offline machine could not repair it.

**Combine bundled and ambient default roots.** Unrelated local skills would silently change the product’s advertised tool guidance.

## Consequences

Skill updates ship with the product resources and remain isolated from official Harness data. This does not imply every resource in the product directory is an active feature; composition, not file presence, establishes registration.

## Related

Related owners: [desktop-owns-its-environment](2026-09-01-desktop-owns-its-environment.md); [papermachine-installation-isolation](../architecture/2026-09-10-papermachine-installation-isolation.md).
