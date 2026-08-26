# Agent Note: Project artifact store — S1 store package

Status: implemented

English | [中文](2026-08-26-project-artifact-store-s1.zh.md)

## Problem

[The project artifact store design](2026-08-25-project-artifact-store.md) (S0) specifies a project-owned artifact registry replacing session-scoped attachment storage, delivered across slices S1–S3. S1 is the store itself: the workspace-identity registry and the SQLite index plus content-addressed blob store, usable in isolation before any product package wires into it. [S2](2026-08-26-project-artifact-store-s2.md) (session-event slimming, capture, `get_science_state` rebuild) and [S3](2026-08-26-project-artifact-store-s3.md) (cross-session read/reference/append, Files projection, restart continuity) have since shipped on top of this package; this note describes only what S1 itself shipped.

## Decision

`@deepseek-ai/dsh-science-artifact-store` (`packages/science/science-artifact-store`) implements S0's project identity, store layout, Artifact/Version records, concurrent-append linearization, and delete boundary exactly as specified there. It is a standalone Cordis service with no current consumer: science-session, science-runtime, and tool-science are unchanged by this slice.

Branded ids (`ProjectId`, `ArtifactId`, `VersionId`) are owned by this package, not by `science-session`'s existing `ScienceArtifactId` vocabulary — the store is a lower-level package science-session and science-runtime will depend on in S2, not the reverse, so it cannot take a dependency on either. [S2](2026-08-26-project-artifact-store-s2.md) reconciles the two id spaces by re-exporting these branded ids from `science-session` under its own names and deleting its prior `ScienceArtifactId` brand.

Every public method past `openProject` takes a `projectId` directly and is self-sufficient: it opens or reuses a cached SQLite connection for that project without requiring a prior `openProject` call in the same process. This is what lets a Host restart or a second session that already knows a project id resume work immediately, per S0's S3 acceptance criterion, without forcing S3 to add a second access path.

Concurrency uses `node:sqlite`'s `DatabaseSync` with a configured `sqlite3_busy_timeout()` and `BEGIN IMMEDIATE` around the read-latest/insert-version/update-latest sequence: a second writer blocks and retries within `busyTimeoutMs` instead of failing outright, so two OS processes appending to the same artifact serialize correctly with the later committer becoming latest. This is proven by a real-process test (`tests/concurrent-append.spec.ts`) that spawns two `node --import tsx/esm` child processes against the same on-disk store and asserts a linear, unforked chain.

Package README documents the full public contract (project identity resolution rules, store layout, Artifact/Version fields, linearization, delete boundary, Config); this note does not restate it.

## Alternatives considered

**Reuse `science-session`'s `ScienceArtifactId`** — rejected for this slice: it names the old embedded-attachment model S2 will redesign, and taking the dependency would invert the intended layering (store below science-session, not above).

**Route through the shared `dsh-storage` KV hub** instead of a bespoke per-project SQLite file — rejected per the exploration in [the domain KV storage Agent Note](../../proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.md): that hub is one shared medium per backend, while this store is one SQLite file per project directory, a materially different shape closer to `science-runtime`'s per-session scratch tree.

**Full fsync-durability blob admission** (matching `attachment-local`'s hardlink-plus-directory-fsync publish path) — rejected as disproportionate for S1: the S0 note specifies "written temp-then-rename", and content-addressed rename-over-existing-target is already idempotent by hash without the extra durability machinery; revisit if a durability gap surfaces in practice.

See also the [S0 note](2026-08-25-project-artifact-store.md)'s own Alternatives considered section, which this slice does not revisit.

## Consequences

S1 ships a fully tested, documented, standalone package with no product-visible effect yet — no tool, event, or UI references it. S2 must add the Cordis injection, redesign `science/artifact-saved` to the reference form, and reconcile id vocabularies; S3 must add cross-session read/reference/append plumbing and the Files projection. Both remain scoped exactly as S0 describes.

Two durable simplifications the store's own tests exercise directly: blob admission never garbage-collects an orphan (a blob written for an append whose target artifact then fails to exist), and workspace identity compares literal `resolve()`d paths rather than `realpath()`, so two symlink paths to the same directory are not recognized as the same workspace. Both are recorded in the package README's Known Limitations.
