# Agent Note: Project-level artifact store

Status: implemented

English | [中文](2026-08-25-project-artifact-store.zh.md)

## Problem

Artifacts should outlive the conversation that produced them and remain discoverable when a workspace moves, without committing binary analysis outputs into the workspace.

## Decision

A workspace marker identifies a project whose SQLite metadata and immutable blobs live under the configured Harness home. Session deletion does not delete project artifacts. The marker and project index use resolved paths for move/copy detection: a missing old location permits a move, while an existing old location makes a copy a new project. Removing the marker creates fresh identity while old stored data remains.

Project-wide logical names identify artifact chains; SQLite transactions allocate monotonically ordered immutable versions. Provenance, annotations, chart state, and explicit baselines belong to the store. Session events carry the references needed for replay. Schema-v2 migration and native V3 event admission have separate owners.

## Alternatives considered

**Own artifact identity inside each session.** Reusing the same logical project artifact across conversations would require manual merging, and deleting a conversation would delete its outputs.

**Store blobs inside the workspace.** Copies and source-control operations would acquire unrelated analysis storage.

**Treat every matching marker as the same live project.** A copied workspace would silently share future output writes.

## Consequences

Move/copy detection is a heuristic: an unmounted old location is indistinguishable from a move, and resolved paths are not realpath-based symlink identity. Producer session ids may dangle after deletion. Cross-project export/import and retention are separate policies; a session export alone does not promise a portable project artifact store.

## Related

Related owners: [project-artifact-store-s1](2026-08-26-project-artifact-store-s1.md); [project-artifact-store-schema-v2](2026-09-01-project-artifact-store-schema-v2.md); [project-identity-locking](../bug-fix/2026-09-09-project-identity-locking.md); [papermachine-installation-isolation](2026-09-10-papermachine-installation-isolation.md).
