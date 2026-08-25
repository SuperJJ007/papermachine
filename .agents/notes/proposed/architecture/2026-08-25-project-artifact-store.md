# Agent Note: Project-level artifact store

Status: proposed

English | [中文](2026-08-25-project-artifact-store.zh.md)

## Problem

Science artifacts are today projections of one session log: `science/artifact-saved` embeds the complete attachment reference, the bytes live in the session-scoped attachment store, and deleting the session deletes every artifact it produced. Claude Science's model — an eleven-item project/session mechanism spec researched from the product on 2026-08-25, whose cited items are restated inline below — makes artifacts project-owned: sessions are producers, consumers, and provenance, never owners, so a second session in the same project can read, reference, and append to an artifact the first session created, and artifacts outlive session deletion. Our roadmap (S1–S4) commits to that ownership model for v1 scope items 1/2/5/6/10 of the spec; this note is the S0 design the slices implement.

## Proposal

**Project identity.** A project is a workspace directory. Its identity is a marker file `<workspace>/.papermachine/project.json` holding a generated branded `projectId` plus `createdAt`; the first Science session in an unmarked workspace creates it. The marker travels with the directory, so moving or renaming the workspace keeps the id. The harness home holds one store directory per project (below); the store's own `project.json` records the last-known workspace path and is refreshed on open, making the store tree itself the registry — no separate global index file. Copy detection at open: when the store's recorded path exists, differs from the opening path, and still carries a marker with the same id, the opening directory is a copy — it gets a fresh id and its marker is rewritten; a move (old path gone or markerless) keeps the id.

**Store layout.** Authoritative artifact data lives at `~/.papermachine/projects/<projectId>/` (the harness home, never the workspace): `project.json` (identity + last-known path), `store.sqlite` (the index, with a monotonic `SCHEMA_VERSION` per the pre-release stance — old schemas are rejected, never migrated), and `blobs/sha256/<hh>/<hash>` holding content-addressed verbatim bytes written temp-then-rename, admission idempotent by hash.

**Artifact and Version records** (spec item 2). An Artifact row: `artifactId` (branded, generated), `owningProjectId`, `originSessionId`, `logicalName`, `latestVersionId`, `createdAt`. A Version row: `versionId`, `artifactId`, per-artifact contiguous `ordinal`, `parentVersionId` (nullable; may name a version of another artifact, preserving today's cross-artifact `editBaselines` derivation), `sha256`, `mediaType`, `byteCount`, `origin` (`auto` | `model` | `human-edit`), `title`/`caption`, producer provenance (`sessionId`, and for run-produced origins `runId`/`toolCallId`/`requestHeaderSeq`, plus the environment revision and fingerprint preview the session events already carry), `createdAt`. Curation (`annotate_artifact`) stays a metadata update on the version it names — title/caption/origin change in place, bytes and ordinal never do.

**Session log vs store.** The model-visible ⟺ logged rule restated for two authorities: the session log records *events and references* — `science/artifact-saved` slims from an embedded attachment to `{artifactId, versionId, ordinal, sha256, mediaType, origin, parent, title, caption}` — while the store owns *bytes and the cross-session index*. Everything the model saw remains reconstructable from log + store: the event pins content by checksum, the store resolves it. The strict fold stays deterministic over the log alone: same-session references are validated in-fold as today; a cross-session or cross-project reference is validated against the store *before* the producing event commits (the Host-side pre-commit invariant may consult the store; replay may not), and the committed event carries the validated result as fact. Session export's attachment extraction re-targets the project store by checksum.

**Concurrent append linearization** (spec item 5). One SQLite write transaction is the linearization point: read the artifact's `latestVersionId`, insert the new version with `parent = latest` (or the explicitly named `editBaselines` parent, which records a visible branch in `parentVersionId` without forking the chain), update `latestVersionId`. Two sessions appending concurrently serialize on that transaction; the later committer becomes latest; the chain never forks automatically. SQLite is already the repo's durable-index choice (`storage-sqlite`, `session-persistence-sqlite`), and cross-process serialization is exactly what a JSON index would have to hand-roll with lock files.

**Delete boundary** (spec item 10). Deleting a session removes its log only; store rows keep their producer `sessionId` as a possibly-dangling provenance id, documented as such. Deleting a project removes `~/.papermachine/projects/<projectId>/` entirely — the one cascade. Artifact-level delete/rename stays deferred to the P1 artifact-light-features batch.

**Three storage layers** (spec item 6). Files = the owning project's artifact/latest projection out of the store (S3/S4); the session workspace stays the execution and scratch directory (`science-runtime`'s private trees, unchanged); host filesystem access stays governed by the existing fs policy (spec item 7 maps onto it — no new grant machinery in v1).

**No compatibility shim.** The fold rejects the old embedded-attachment `science/artifact-saved` value outright (pre-release stance); no reader, writer, or test keeps the old format alive. `SESSION_FORMAT_VERSION` stays 0.

## Alternatives considered

**Project-level index over session-owned bytes** — keep attachments where they are and add a cross-session index. Loses the goal: artifacts still die with their producing session, and export/read paths would straddle two authorities forever.

**Realpath-keyed registry without a workspace marker** — no file in the user's directory, but identity breaks on every move or rename, which the user explicitly required to survive.

**JSON index instead of SQLite** — simpler to read, but the linearization point becomes hand-rolled file locking across processes, and the repo already ships SQLite infrastructure with the `SCHEMA_VERSION` convention.

**Fork on concurrent append (version DAG)** — the CS spec itself linearizes (later committer is latest); the dependency DAG is spec item 11 and stays deferred with it.

**Store inside the workspace** — maximally portable, but puts blob trees in user data directories where backup and sync tools churn them; the marker file carries identity, the harness home carries data.

## Acceptance criteria

- S1: creating, reopening, moving, and copying a workspace yield the documented id behavior; append/read/latest work; two concurrent appends from separate processes produce a linear chain with the later committer as latest; session delete leaves the store intact; project delete removes it; an old-schema `store.sqlite` is rejected loudly.
- S2: capture writes bytes to the store and slims the event; fold, projection, `get_science_state`, and every keyless snapshot replay from references; the old event value is rejected with a clear error.
- S3: a second session in the same project reads, references (`artifact_inputs`), and appends versions to a first session's artifact; Files lists one row per artifact showing latest; a Host restart continues the chain.

## Risks

- Dangling producer `sessionId` after session deletion is accepted, documented provenance decay — a Reviewer consuming provenance must tolerate it.
- Copy detection is heuristic at open time; a copy opened while the original is unreachable (unmounted disk) is indistinguishable from a move and keeps the id. Accepted for v1.
- S2 touches every transcript snapshot and the export path in one slice; the slice is large by construction and must land atomically.
- A workspace marker is user-visible dotfile surface in the user's directory; tooling that strips dotfiles breaks identity (falls back to fresh id, data intact in harness home).
