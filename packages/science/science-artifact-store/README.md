# @deepseek-ai/dsh-science-artifact-store

English | [中文](README.zh.md)

Project-owned Science artifact registry and content-addressed version store. Sessions are producers, consumers, and provenance of an artifact — never its owner: a second session in the same project reads, references, and appends to an artifact a first session created, and an artifact outlives the session that produced it. Design rationale: [project artifact store Agent Note](../../../.agents/notes/implemented/architecture/2026-08-25-project-artifact-store.md).

Loading the service does not load SQLite. The engine imports `node:sqlite` only when it opens a project database; an idle Web host does not incur database startup work or SQLite experimental warnings.

## Project identity

A project is a workspace directory. `openProject(workspacePath)` resolves its identity from a marker file at `<workspace>/.papermachine/project.json` (`{projectId, createdAt}`), creating one on first use. The store keeps its own record at `<storeRoot>/project.json` (`{projectId, createdAt, workspacePath, workspaceUpdatedAt}`), refreshed on every open — this record is the registry; there is no separate global index.

Resolution rule when the store's recorded `workspacePath` differs from the path opening now:

- The recorded path is gone, or no longer carries a marker naming this project → **move**: same id, the store's recorded path is updated.
- The recorded path still exists and still carries a marker naming this project → **copy**: the opening directory is a duplicate and gets a fresh id; its marker is rewritten.
- No marker at all in the opening directory → **created**: a brand-new project.
- The marker survived but the store side was lost or never materialized → **reopened**: rematerialized fresh under the same id.

`openProject` returns this outcome (`ProjectIdentityOutcome`) alongside the resolved `projectId` and `storeRoot`.

## Store layout

Every other method takes a `projectId` directly and is self-sufficient — it opens (or reuses a cached connection to) that project's store without requiring a prior `openProject` call in the same process, so a Host restart or a second session that already knows a project id can resume work immediately. The store directory, rooted under the harness home (`@deepseek-ai/dsh-home-paths`'s `resolveDshHome`, never a hardcoded path) at `<harnessHome>/projects/<projectId>/`, holds:

- `project.json` — identity and last-known workspace path (above).
- `store.sqlite` — the `artifacts` and `versions` tables (below), opened with `node:sqlite`'s `DatabaseSync` and a configured `sqlite3_busy_timeout()`, journal mode `wal` by default.
- `blobs/sha256/<hh>/<hash>` — content-addressed verbatim bytes, admitted by writing a temp file under `blobs/tmp` then renaming it onto the final path. The rename atomically replaces an existing target, which is always byte-identical for the same digest, so admission is idempotent by hash with no existence pre-check.

## Artifact and Version records

An **Artifact** row (`artifact_id` PRIMARY KEY): `owningProjectId`, `originSessionId` (the session that created it), `logicalName`, `latestVersionId`, `createdAt`.

A **Version** row (`version_id` PRIMARY KEY, `UNIQUE(artifact_id, ordinal)`): per-artifact contiguous 1-based `ordinal`, `parentVersionId` (nullable; may name a version of a *different* artifact — an explicit `editBaselines` branch point), `sha256`, `mediaType`, `byteCount`, `origin` (`'auto' | 'model' | 'human-edit'`), `title`/`caption`, producer provenance (`producerSessionId`, `producerRunId`, `producerToolCallId`, `producerRequestHeaderSeq`, `environmentRevision`, `environmentFingerprintPreview`), `createdAt`.

`annotateVersion` is a metadata-only patch on the version it names: `title`/`caption`/`origin` change in place; bytes, `sha256`, and `ordinal` never do.

## Concurrent append linearization

`appendVersion`'s write transaction (`BEGIN IMMEDIATE` … `COMMIT`) is the linearization point: it reads the artifact's current `latestVersionId`, inserts the new version with that (or the explicit `editBaselines`) as parent, and updates `latestVersionId`. SQLite's `sqlite3_busy_timeout()` (the `busyTimeoutMs` connection option) makes a second writer block-and-retry on `BEGIN IMMEDIATE` instead of failing outright, so two sessions — including two separate OS processes — appending concurrently serialize on this transaction: the later committer becomes latest, and the chain never forks automatically.

## Delete boundaries

`deleteProject(projectId)` permanently removes `<storeRoot>/` — index and blobs — the one cascade this package performs. There is no session-scoped delete operation: deleting a session's log is a `dsh-session` concern this package never observes, and every stored row keeps its producer `sessionId` as provenance regardless of whether that session still exists.

## Configuration (schemastery)

```ts
interface Config {
  dshHome?: string           // explicit harness-home override; omitted follows DSH_HOME, then ~/.dsh
  journalMode?: 'wal' | 'delete' | 'truncate' | 'persist'   // journal_mode pragma; default 'wal'
  busyTimeoutMs?: number     // sqlite3_busy_timeout() for every project connection; default 5000
}
```

## Model Experience

None, as the package persists project-owned artifact bytes and metadata; model-facing consumers such as `dsh-science-runtime` and `dsh-tool-science` own any prompt, schema, or request rendering of what it stores.

#### KV Cache effect

None — this package never assembles or sends provider requests; it has no live-request presence to invalidate or preserve.

## Known Limitations and Deferred Work

- **No unreferenced-blob garbage collection** — a blob admitted for an append that then fails its artifact-existence check (bytes are admitted before the transaction validates the target artifact) is never reclaimed; content addressing makes this an inert orphan, not a correctness issue.
- **Workspace identity uses `resolve()`, not `realpath()`** — a workspace reached through two different symlink paths is not recognized as the same directory; only literal path equality distinguishes reopen from move/copy.
- **Copy detection is heuristic at open time** — a copy opened while the original is unreachable (e.g. an unmounted disk) is indistinguishable from a move and keeps the id, per the design note's accepted v1 risk.
- **No cross-project read/write, retention policy, or dependency DAG** — this package implements spec items 1/2/5/6/10 of the [project artifact store Agent Note](../../../.agents/notes/implemented/architecture/2026-08-25-project-artifact-store.md) only; cross-project access, version retention, and dependency tracking are explicitly deferred.
- **No science-runtime or tool-science wiring yet** — this package is the store only; the session-event, capture, and tool-resolution seams that consume it are a later slice of the same design.
