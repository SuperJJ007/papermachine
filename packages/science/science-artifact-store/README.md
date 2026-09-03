# @deepseek-ai/dsh-science-artifact-store

English | [中文](README.zh.md)

Project-owned Science artifact registry and content-addressed version store. Sessions are producers, consumers, and provenance of an artifact — never its owner: a second session in the same project reads, references, and appends to an artifact a first session created, and an artifact outlives the session that produced it. Design rationale: [project artifact store Agent Note](../../../.agents/notes/implemented/architecture/2026-08-25-project-artifact-store.md); the schema v2 authority rule (the store is the sole authority for a version's provenance, never the session log) is in [project artifact store schema v2 Agent Note](../../../.agents/notes/implemented/architecture/2026-09-01-project-artifact-store-schema-v2.md).

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
- `store.sqlite` — the tables below, opened with `node:sqlite`'s `DatabaseSync` and a configured `sqlite3_busy_timeout()`, journal mode `wal` by default.
- `store.sqlite.v<N>.bak` — a pre-upgrade snapshot of `store.sqlite`, written before a schema migration touches the file (see Schema migration below). Retention is configurable.
- `blobs/sha256/<hh>/<hash>` — content-addressed verbatim bytes, admitted by writing a temp file under `blobs/tmp` then renaming it onto the final path. The rename atomically replaces an existing target, which is always byte-identical for the same digest, so admission is idempotent by hash with no existence pre-check. Blobs are never touched by a schema migration — they are content-addressed and outside `store.sqlite`.

## Artifact, Version, and side-table records

An **Artifact** row (`artifact_id` PRIMARY KEY, `UNIQUE(owningProjectId, logicalName)`): `owningProjectId`, `originSessionId` (the session that created it), `logicalName`, `kind` (`'figure' | 'dataset' | 'document' | 'job-output'`), `latestVersionId`, `createdAt`.

A **Version** row (`version_id` PRIMARY KEY, `UNIQUE(artifact_id, ordinal)`) is immutable except for one pointer column:

- Per-artifact contiguous 1-based `ordinal`.
- `baseVersionId` (nullable, may name a version of a *different* artifact) + `baseExplicit`: the content baseline this version was EXPLICITLY built from (a model `edit_of`, a viewer edit, or a `save_artifact_as`). A plain chain continuation (the common case — a second `run` overwrites the same file) leaves `baseVersionId` `undefined`; the chain predecessor is always derivable from `(artifactId, ordinal - 1)` and is never stored on its own. `appendVersion` never defaults `baseVersionId` from the artifact's current latest version.
- `sha256`, `mediaType`, `byteCount` — the content address.
- `contentOrigin` (`'run-auto' | 'human-edit' | 'import'`) — how these BYTES came to exist. Immutable once written.
- Producer provenance, fixed at creation and never rewritten by curation: `producerSessionId`, `producerRunId`, `producerToolCallId`, `producerRequestHeaderSeq`, `producerTurn`, `environmentRevision`, `environmentFingerprint` (full 64-hex digest, not a preview).
- `createdAt` — content-commit time; never changes after creation.
- `latestAnnotationId` — the ONE mutable column, a pointer into `version_annotations` (below).

A **VersionAnnotation** row (`version_annotations`, `annotation_id` PRIMARY KEY) is one metadata edit, appended never updated: `title`/`caption` (each independently nullable), `actor` (`'capture' | 'model' | 'human'` — who wrote THIS edit, distinct from `contentOrigin`), `sessionId`/`toolCallId`/`requestHeaderSeq` (the edit's own authorizing call), `derived` (`true` for a row synthesized by the v1→v2 migration rather than recorded live), `createdAt` (this edit's own timestamp, distinct from the version's `createdAt`). `VersionRecord.latestAnnotation` carries the newest row; `VersionRecord.title`/`caption` are convenience reads of `latestAnnotation?.title`/`caption`.

A **FigureState** row (`figure_state`, `version_id` PRIMARY KEY) holds one version's live-figure-object state — `figureKey`, `dpi`, and an opaque `stateJson` string this package stores and returns verbatim without parsing (the shape belongs to `dsh-science-runtime`).

An **ArtifactNote** row (`artifact_notes`, `note_id` PRIMARY KEY) is a user-authored note, optionally pinned to a version, soft-deleted via `removedAt` (never hard-deleted).

A **VersionHealth** row (`version_health`, `version_id` PRIMARY KEY) records reconciliation status a CALLER computed — `orphan`, `reconstructed`, `missingContent`, `checkedAt`. This package only stores what `setVersionHealth` is told; it does not run reconciliation itself.

### Writing and curating

`createArtifact`/`appendVersion` carry no `title`/`caption` — annotate a version's metadata afterward with `annotateVersion`. A model curation must carry its complete `(sessionId, toolCallId, requestHeaderSeq)` identity; the write transaction rejects that exact triple after it has authorized one annotation anywhere in the project, including after a later edit supersedes it. A capture annotation is accepted only when the version has no annotation yet; later metadata writes must be model curation or human edits. Every accepted call **appends** a new `version_annotations` row and advances `latestAnnotationId`; it never updates a row in place, so a version's metadata history is fully reconstructable. `title`/`caption` are independently tri-state: omit to carry the current value forward unchanged, pass `null` to explicitly clear it, pass a string to set it.

`listNotes`/`putNote`/`removeNote` manage `artifact_notes`; `getFigureState` reads `figure_state` (write it via `figureState` on `createArtifact`/`appendVersion`); `setVersionHealth` is this package's one write method onto `version_health` — building the reconciliation algorithm that calls it is a consumer's job.

## Concurrent append linearization

`appendVersion`'s write transaction (`BEGIN IMMEDIATE` … `COMMIT`) is the linearization point: it reads the artifact's current `latestVersionId` only to compute the next `ordinal`, inserts the new version, and updates `latestVersionId`. SQLite's `sqlite3_busy_timeout()` (the `busyTimeoutMs` connection option) makes a second writer block-and-retry on `BEGIN IMMEDIATE` instead of failing outright, so two sessions — including two separate OS processes — appending concurrently serialize on this transaction: the later committer becomes latest, and the chain never forks automatically.

## Schema migration

`PROJECT_ARTIFACT_STORE_SCHEMA_VERSION` (currently `2`) is the highest on-disk `PRAGMA user_version` this build writes; whether an OLDER on-disk version can still be opened depends on whether `STORE_MIGRATIONS` has an unbroken chain toward it, not on the version number's shape. Opening a store branches on the on-disk value:

| On disk | Behavior |
|---|---|
| `0` | Fresh database: target DDL is created, then `user_version` is stamped last (a failure above leaves the medium unstamped, so a retried open starts clean). |
| `= current` | Used as-is (the target DDL is re-applied idempotently as a safety net). |
| `< current`, chain unbroken | `store.sqlite` is checkpointed and copied to `store.sqlite.v<N>.bak` (see below), then each step in the chain runs in its own write transaction, `PRAGMA foreign_keys = OFF` for the rebuild and `ON` again once every step completes. A step's transaction runs `PRAGMA foreign_key_check` before its own `PRAGMA user_version = <to>` and `COMMIT`; a violation throws `SCHEMA_UPGRADE_UNAVAILABLE` and the transaction rolls back — this is a real SQL `ROLLBACK`, not a file restore, since the check runs before commit. |
| `< current`, chain missing a step | Throws `SCHEMA_UPGRADE_UNAVAILABLE`, names the on-disk path, and touches nothing else. |
| `> current` | Throws `SCHEMA_VERSION_NEWER` — the store was written by a newer harness; its blob directory is still content-addressed and recoverable by hand. |

The v1→v2 migration (`STORE_MIGRATIONS`'s only step today) does six things in one transaction: creates the four new tables; rebuilds `artifacts`/`versions` under the target DDL, inferring `kind` from each artifact's latest `mediaType` (`image/png`→`figure`, `text/csv`→`dataset`, everything else→`document` — no other media type is written by any producer in this build) and copying v1's `origin` into `contentOrigin` (`'human-edit'` stays, `'auto'`/`'model'` both become `'run-auto'`) and `parent_version_id` into `baseVersionId` **with `baseExplicit` always `false`** (v1 could not distinguish an explicit baseline from an auto-defaulted chain predecessor, so this migration does not guess); derives one `version_annotations` row per version from v1's `title`/`caption`/`origin` (`actor: 'model'` when v1's `origin` was `'model'`, `'capture'` otherwise), marked `derived: true`; resolves any `UNIQUE(owningProjectId, logicalName)` collision v1 never enforced by keeping the earliest-created artifact's name and renaming the rest to `<name>#<short artifactId>` with an explanatory `artifact_notes` row (version chains are never merged); and finally runs an OPTIONAL step: a caller-supplied `backfillProvenance` hook (see Configuration) may recover `environmentFingerprint`/`producerTurn`/`figureState`/the derived annotation's real `toolCallId`/`createdAt` from that project's v1-era session logs — the only place this package ever lets a caller feed session-log-derived facts back into the store, because in v1 those facts had no other home. A hook that is omitted, rejects, or returns nothing for a given version degrades that version to its already-migrated defaults and reports one warning through `onWarning`; it never fails the migration.

### Backups

`storeBackupRetention` (Config, default `1`) controls how many `store.sqlite.v<N>.bak` files a project keeps, pruned oldest-numbered-first after each upgrade. A failure listing the backup directory degrades silently (best-effort pruning); a failure checkpointing WAL before the copy is likewise best-effort — the backup is still usable, just possibly missing very recent writes.

## Delete boundaries

`deleteProject(projectId)` permanently removes `<storeRoot>/` — index and blobs — the one cascade this package performs. There is no session-scoped delete operation: deleting a session's log is a `dsh-session` concern this package never observes, and every stored row keeps its producer `sessionId` as provenance regardless of whether that session still exists.

## Reconciliation

`reconcile.ts` compares the store's own version rows against `science/artifact-saved` events a caller has already read from that project's session logs and folded per `versionId` (last write wins) — this package never reads session logs itself. `ScienceArtifactStore.reconcileProject(projectId, events, eventSetComplete, cursor?)` runs the comparison and repairs the store to match; `eventSetComplete` states whether the caller read every relevant session log and event, and a returned cursor continues bounded work over that stable event set. `getReconciliationSummary(projectId)` is a pure read of whatever the last reconciliation run recorded. The hard rule: **reconciliation only ever writes the store, never a session log** — the log is append-only, and rewriting its history would break the replay contract.

Seven cases, classified per version:

| Case | Condition | Handling |
|---|---|---|
| Consistent | store row and event both name this `versionId`, same `sha256`, same title/caption | no write |
| Unverified | store row exists, no event names this `versionId`, and `eventSetComplete` is false | no orphan write; any existing orphan value is preserved because the partial read cannot prove or disprove it, while `missingContent` is still refreshed |
| Orphan (W1/W2) | store row exists, no event names this `versionId`, and `eventSetComplete` is true | `version_health.orphan = 1`; the row and its bytes stay exactly as committed — an orphan is a real, complete artifact version with no session claiming it produced |
| Dangling event | an event names a `versionId` the store has no row for (the store row was lost while the event survived) | `reconstructVersion` rebuilds a version row (and its owning artifact row, if that is also missing) from the event's fallback fields, `content_origin` fixed to `'import'` (the one `ContentOrigin` value that does not claim a real origin this reconstruction cannot recover); `version_health.reconstructed = 1` |
| Content conflict | same `versionId` in both, different `sha256` | not reachable through any normal write path; recorded as a diagnostic error, the store row marked `orphan`, the event untouched |
| Metadata divergence | same `versionId`, same `sha256`, but the event's title/caption snapshot differs from the store's current annotation | no write — the store's latest annotation already is the current fact; the event is a historical presentation snapshot, correctly left as it was |
| Missing blob | the version row exists but its blob is absent from `blobs/sha256/` | `version_health.missingContent = 1`; the row is never deleted |

Reconciliation is idempotent: rerunning it over an unchanged store and event set produces the same `version_health` state, since every conclusive write recomputes from the current comparison instead of accumulating and an incomplete set preserves inconclusive orphan state. Content conflicts, dangling-event reconstruction, metadata comparison, and `missingContent` refresh still run against an incomplete event set; only the inference from an absent event to orphan is withheld. Work is bounded by `reconcileMaxVersions` (Config, below): `ReconcileResult.cursor` retains unfinished version and dangling-event work for the next call, and a failed item rotates behind untouched work so it cannot pin the bounded prefix. `truncated` remains true while the cursor has work. `reconstructVersion`'s reconstructed row is honest about what it cannot recover: `mediaType` is inferred from the dangling event's `logicalName` extension (falling back to `application/octet-stream` for an unrecognized one), and `byteCount` is the blob's real on-disk size when present or `0` — a sentinel, not a claimed size — when also missing (in which case `missingContent` is set too, so a caller checks that flag before trusting the byte count).

Who calls `reconcileProject`, and how the event set is built, is a consumer's job: `dsh-science-runtime`'s `sessionProject` triggers a bounded pass when it resolves a project id, reading that project's own session logs through `@deepseek-ai/dsh-session-persistence`'s `SessionPersistence.inspect()` (bounded by its own `reconcileMaxSessions` Config). The Runtime retains both the accumulated per-session events and the store cursor between eligible attempts. A complete event collection followed by a cursor-free, error-free store pass suppresses later attempts for that project during the Host lifetime; otherwise a later project resolution may retry after `reconcileRetryDelayMs`. See that package's README for the trigger mechanism and W2/W3 crash-window narrowing at its own `annotateArtifact`/`performChartEdit`/`saveArtifactAs` append sites.

## Configuration (schemastery)

```ts
// BackfillProvenanceHook's own row/value shapes are exported from this
// package's `.` entry point; see "Schema migration" above for their fields.
type BackfillProvenanceHook = (
  projectId: string,
  rows: readonly { versionId: string; artifactId: string; producerSessionId: string }[],
) => Promise<ReadonlyMap<string, {
  environmentFingerprint?: string
  producerTurn?: number
  figureState?: { figureKey: string; dpi: number; stateJson: string }
  annotationToolCallId?: string
  annotationCreatedAt?: number
}>>

interface Config {
  dshHome?: string           // explicit harness-home override; omitted follows DSH_HOME, then ~/.dsh
  journalMode?: 'wal' | 'delete' | 'truncate' | 'persist'   // journal_mode pragma; default 'wal'
  busyTimeoutMs?: number     // sqlite3_busy_timeout() for every project connection; default 5000
  storeBackupRetention?: number   // pre-upgrade .bak files kept per project; default 1
  reconcileMaxVersions?: number   // version rows + dangling events one reconcileProject call processes; default 2000
  backfillProvenance?: BackfillProvenanceHook   // see Schema migration; omitted skips step 4 with a warning
}
```

`backfillProvenance` is a function value, validated by `z.any()` like other injected-instance config fields in this repo (e.g. `dsh-session-telemetry-otel`'s `exporter`/`processor`) — it is supplied programmatically, not from `cordis.yml`. This package never reads session-log format itself; a consumer that does (e.g. `dsh-science-runtime`) supplies the hook.

## Model Experience

None, as the package persists project-owned artifact bytes and metadata; model-facing consumers such as `dsh-science-runtime` and `dsh-tool-science` own any prompt, schema, or request rendering of what it stores.

#### KV Cache effect

None — this package never assembles or sends provider requests; it has no live-request presence to invalidate or preserve.

## Known Limitations and Deferred Work

- **No unreferenced-blob garbage collection** — a blob admitted for an append that then fails its artifact-existence check (bytes are admitted before the transaction validates the target artifact) is never reclaimed; content addressing makes this an inert orphan, not a correctness issue.
- **Workspace identity uses `resolve()`, not `realpath()`** — a workspace reached through two different symlink paths is not recognized as the same directory; only literal path equality distinguishes reopen from move/copy.
- **Copy detection is heuristic at open time** — a copy opened while the original is unreachable (e.g. an unmounted disk) is indistinguishable from a move and keeps the id, per the design note's accepted v1 risk.
- **No cross-project read/write, retention policy, or dependency DAG** — this package implements spec items 1/2/5/6/10 of the [project artifact store Agent Note](../../../.agents/notes/implemented/architecture/2026-08-25-project-artifact-store.md) only; cross-project access, version retention, and dependency tracking are explicitly deferred.
- **`reconstructVersion`'s recovered `mediaType`/`kind` is inferred, not verified** — a dangling event whose `logicalName` extension is not in the fixed five-type set falls back to `application/octet-stream`/`document`; there is no way to recover the real value once both the store row and the event have stopped carrying it.
