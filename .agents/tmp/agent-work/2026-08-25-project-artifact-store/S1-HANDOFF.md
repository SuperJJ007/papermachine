# S1 handoff — project artifact store package

Owner: S1 implementation agent. Created: 2026-08-26. Retire when S2 has read this
and its durable facts (if any survive S2's own changes) have moved into the
package README / Agent Notes; delete this file at that point.

Consumers: the S2 implementation agent (and, transitively, S3).

## What shipped

New package `@deepseek-ai/dsh-science-artifact-store` at
`packages/science/science-artifact-store/`. Branch `feat/project-artifact-store`,
commit `<see final report / git log>` on top of `codex/claude-science-artifact-sidebar`
tip `3e59f4c29d`.

Full source tree:
```
packages/science/science-artifact-store/
  package.json  tsconfig.json  README.md  README.zh.md  README.i18n.yaml
  src/
    ids.ts        ProjectId / ArtifactId / VersionId branded id factories
    types.ts       ArtifactRecord, VersionRecord, Create/Append/AnnotateVersionInput,
                    OpenedProject, ProjectIdentityOutcome, ArtifactVersionOrigin
    errors.ts       ProjectArtifactStoreError + ProjectArtifactStoreErrorCode
    schema.ts        PROJECT_ARTIFACT_STORE_SCHEMA_VERSION, openStoreDatabase
                     (node:sqlite DatabaseSync, PRAGMA user_version reject-old-schema)
    blobs.ts          admitBlob / readBlob (content-addressed, temp-then-rename)
    registry.ts        resolveProjectIdentity, storeRootForProject, deleteProjectStore
                       (workspace marker + store project.json, create/reopen/move/copy)
    store.ts            ProjectArtifactStoreEngine — the framework-free CRUD engine
    index.ts             ScienceArtifactStore Cordis Service (extends @deepseek-ai/cordis
                          Service), wraps the engine, registers ctx.scienceArtifactStore
    invariant.ts          package invariant companion (explained-empty; no owned
                          in-process relation to assert — see JSDoc)
  tests/
    ids.ts not separately tested (trivial brand casts); covered incidentally
    registry.spec.ts     marker create/reopen/move/copy + decode-failure branches
    blobs.spec.ts          admission idempotence, corruption, non-EEXIST/ENOENT errors
    schema.spec.ts          fresh stamp, reopen, old-schema rejection, non-EEXIST open failure
    store.spec.ts             full CRUD, editBaselines branching, concurrency/lock-timeout,
                              durable-inconsistency defensive branches (raw-SQL manipulation)
    index.spec.ts              real ctx.plugin(ScienceArtifactStore, config) composition test
    concurrent-append.spec.ts    REAL two-OS-process test (spawns
                                 `node --import tsx/esm tests/fixtures/concurrent-append-worker.ts`
                                 twice concurrently against the same on-disk store)
    fixtures/concurrent-append-worker.ts   child-process entry point (no Cordis; plain script)
```

Registered in `tsconfig.host.json` (references), `packages/science/README.md` +
`.zh.md` (package table row), `scripts/gen-cordis-catalog.ts` (`SERVICE_PAGE`
maps `scienceArtifactStore` → `science.md`; `TYPE_LINK_EXEMPTIONS` for the 9
new types, pointing at this package's README), `scripts/gen-doc-graphs.ts`
(`SERVICE_ROLES` entry, mode `core`, no `consumers` yet).

Agent Note: `.agents/notes/implemented/architecture/2026-08-26-project-artifact-store-s1.md`
(+ `.zh.md`), cross-linking the still-`proposed` S0 note. S0 stays proposed
until S2/S3 also ship — do not move it to implemented yet.

## Public service surface (`ctx.scienceArtifactStore`, class `ScienceArtifactStore`)

All methods below live on the Cordis service in `src/index.ts`, thin
delegations to `ProjectArtifactStoreEngine` in `src/store.ts` (same
signatures, engine methods take the same params). Every method except
`openProject` is self-sufficient given a `projectId` — no prior `openProject`
call is required in the same process (the engine lazily opens/caches a
connection per `projectId`, deriving the store path deterministically from
`dshHomePath('projects', projectId)`-equivalent logic in `registry.ts`'s
`storeRootForProject`).

```ts
openProject(workspacePath: string): Promise<OpenedProject>
// OpenedProject = { projectId, storeRoot, workspacePath, outcome: 'created'|'reopened'|'moved'|'copied' }

createArtifact(projectId: ProjectId, input: CreateArtifactInput):
  Promise<{ artifact: ArtifactRecord; version: VersionRecord }>
// CreateArtifactInput = { logicalName, originSessionId: SessionId, data: Uint8Array,
//   mediaType: string, origin: 'auto'|'model'|'human-edit', title?, caption?,
//   producerRunId?, producerToolCallId?, producerRequestHeaderSeq?,
//   environmentRevision?, environmentFingerprintPreview? }
// First version: ordinal 1, parentVersionId undefined, producer = originSessionId.

appendVersion(projectId: ProjectId, artifactId: ArtifactId, input: AppendVersionInput): Promise<VersionRecord>
// AppendVersionInput = CreateArtifactInput's version fields minus logicalName/originSessionId,
//   plus producerSessionId: SessionId (REQUIRED — the appending session, may differ from origin)
//   and optional editBaselines?: VersionId (explicit parent; may name a version of a
//   DIFFERENT artifact in the same project; omitted -> parent = artifact's current latest).
// Throws ProjectArtifactStoreError code ARTIFACT_NOT_FOUND if artifactId unknown in this project.
// THIS is the linearization point: one BEGIN IMMEDIATE transaction reads latest,
// computes ordinal = MAX(ordinal)+1, inserts, updates artifacts.latest_version_id.

annotateVersion(projectId: ProjectId, versionId: VersionId, patch: AnnotateVersionInput): Promise<VersionRecord>
// AnnotateVersionInput = { title?, caption?, origin? } — metadata-only, in place;
//   an omitted field keeps its current value. Bytes/sha256/ordinal never change.
// Throws VERSION_NOT_FOUND if versionId unknown.

getArtifact(projectId, artifactId): Promise<ArtifactRecord | undefined>
getVersion(projectId, versionId): Promise<VersionRecord | undefined>
getLatestVersion(projectId, artifactId): Promise<VersionRecord | undefined>
listArtifacts(projectId): Promise<readonly ArtifactRecord[]>   // oldest-created first
listVersions(projectId, artifactId): Promise<readonly VersionRecord[]>  // ordinal order
readBlob(projectId, sha256: string): Promise<Uint8Array>       // verified, throws BLOB_NOT_FOUND/BLOB_CORRUPT
deleteProject(projectId): Promise<void>   // rm -rf the WHOLE store dir; the only cascade
```

Record shapes (`src/types.ts`):
```ts
interface ArtifactRecord {
  artifactId: ArtifactId; owningProjectId: ProjectId; originSessionId: SessionId;
  logicalName: string; latestVersionId: VersionId; createdAt: number
}
interface VersionRecord {
  versionId: VersionId; artifactId: ArtifactId; ordinal: number;
  parentVersionId: VersionId | undefined; sha256: string; mediaType: string;
  byteCount: number; origin: 'auto'|'model'|'human-edit';
  title: string | undefined; caption: string | undefined;
  producerSessionId: SessionId; producerRunId/producerToolCallId/
    producerRequestHeaderSeq/environmentRevision/environmentFingerprintPreview: * | undefined;
  createdAt: number
}
```

`SessionId` is imported (type-only) from `@deepseek-ai/dsh-session` — NOT
re-branded locally. `ProjectId`/`ArtifactId`/`VersionId` are `Branded<'ScienceProjectId'>`
/ `Branded<'ScienceStoreArtifactId'>` / `Branded<'ScienceStoreVersionId'>`
respectively (see `src/ids.ts`), owned by THIS package — deliberately
independent of `science-session`'s existing `ScienceArtifactId` brand (see
"Deviations" below).

Error type: `ProjectArtifactStoreError extends Error` with a `code:
ProjectArtifactStoreErrorCode` field — codes are `SCHEMA_VERSION_MISMATCH |
INVALID_MARKER | ARTIFACT_NOT_FOUND | VERSION_NOT_FOUND | BLOB_NOT_FOUND |
BLOB_CORRUPT`. All exported from `src/index.ts` (`export {
ProjectArtifactStoreError, type ProjectArtifactStoreErrorCode }`).

## How S2 gets the store from a science-runtime context

Not yet wired. To inject: add `'scienceArtifactStore'` to `science-runtime`'s
`inject` array (currently `['attachments', 'sessions', 'subprocess',
'sandbox']` in `packages/science/science-runtime/src/index.ts`), and add
`packages/science/science-artifact-store` as a peer+dev dependency of
`dsh-science-runtime`'s `package.json` plus a `tsconfig.json` reference. The
Cordis service key is `scienceArtifactStore` (declared via `declare module
'@deepseek-ai/cordis' { interface Context { scienceArtifactStore:
ScienceArtifactStore } }` in `src/index.ts`) — `ctx.scienceArtifactStore.<method>(...)`
is available anywhere the service is composed into the same Cordis context
tree (mount alongside `dsh-attachment-local` etc. in the product `cordis.yml`
assembly — S2 needs to find/add that mount point, likely in whatever bundle
currently mounts `science-runtime` + `attachment-local`).

`Config` (schemastery, on the class as `static Config`, NOT a module-level
export — see "gotchas" below): `{ dshHome?: string; journalMode?: 'wal' |
'delete' | 'truncate' | 'persist'; busyTimeoutMs?: number }` (`busyTimeoutMs`
default 5000ms, `journalMode` default `'wal'`).

## SQLite schema as shipped (`store.sqlite` per project, `PRAGMA user_version = 1`)

```sql
CREATE TABLE artifacts (
  artifact_id        TEXT PRIMARY KEY,
  owning_project_id  TEXT NOT NULL,
  origin_session_id  TEXT NOT NULL,
  logical_name       TEXT NOT NULL,
  latest_version_id  TEXT,                 -- NULL only transiently mid-creation-transaction
  created_at         INTEGER NOT NULL
) STRICT

CREATE TABLE versions (
  version_id                      TEXT PRIMARY KEY,
  artifact_id                     TEXT NOT NULL REFERENCES artifacts(artifact_id),
  ordinal                         INTEGER NOT NULL,          -- 1-based, contiguous per artifact
  parent_version_id               TEXT REFERENCES versions(version_id),  -- global FK, cross-artifact OK
  sha256                          TEXT NOT NULL,
  media_type                      TEXT NOT NULL,
  byte_count                      INTEGER NOT NULL,
  origin                          TEXT NOT NULL CHECK (origin IN ('auto','model','human-edit')),
  title                           TEXT,
  caption                         TEXT,
  producer_session_id             TEXT NOT NULL,
  producer_run_id                 TEXT,
  producer_tool_call_id           TEXT,
  producer_request_header_seq     INTEGER,
  environment_revision            TEXT,
  environment_fingerprint_preview TEXT,
  created_at                      INTEGER NOT NULL,
  UNIQUE (artifact_id, ordinal)
) STRICT
```
Opened with `node:sqlite`'s `DatabaseSync(path, { timeout: busyTimeoutMs })`
(sets `sqlite3_busy_timeout()`), `PRAGMA foreign_keys = ON`, `PRAGMA
journal_mode = <config>`. Any on-disk `user_version` other than `0` (fresh) or
`1` (current) throws `SCHEMA_VERSION_MISMATCH` at open — no migration path
(pre-release stance). If S2/S3 need a schema change, bump
`PROJECT_ARTIFACT_STORE_SCHEMA_VERSION` in `src/schema.ts` and the old value
simply stops opening (no shim, per repo convention).

Blobs: `<storeRoot>/blobs/sha256/<first-2-hex-chars>/<sha256-hex>`, written to
a `blobs/tmp/<uuid>` temp file then `rename()`d onto the final path (atomic
replace; idempotent since content-addressed).

## Marker / registry file formats

Workspace marker, `<workspace>/.papermachine/project.json`:
```json
{ "projectId": "<uuid>", "createdAt": <epoch-ms> }
```

Store's own record, `<storeRoot>/project.json` (`storeRoot` =
`resolveDshHome(dshHome)/projects/<projectId>`, via `@deepseek-ai/dsh-home-paths`
— NEVER a hardcoded `.papermachine` path; the desktop app is what sets
`DSH_HOME` to `~/.papermachine` at boot, per `apps/desktop/src/harness-home.ts`):
```json
{ "projectId": "<uuid>", "createdAt": <epoch-ms>, "workspacePath": "<absolute path>", "workspaceUpdatedAt": <epoch-ms> }
```
This store-side record IS the registry — refreshed on every `openProject`
call, no separate global index file exists anywhere.

Identity resolution rule (implemented in `src/registry.ts`'s
`resolveProjectIdentity`): no marker → `created` (fresh id); marker present,
store record missing → `reopened` (rematerialize under the SAME id); marker
present, store record's `workspacePath` matches the opening path → `reopened`
(refresh timestamp); store record's `workspacePath` differs AND that OTHER
path still exists and still carries a marker naming the SAME project id →
`copied` (fresh id for the directory opening now); otherwise → `moved` (same
id, store record's `workspacePath` updated).

## Deviations from the S0 note (with reasons)

1. **Branded ids are package-local, not `science-session`'s `ScienceArtifactId`.**
   S0 doesn't specify which package owns the id types. Reusing
   `science-session`'s existing brand would create a dependency in the wrong
   direction (store is meant to be a lower-level dependency of
   science-session/science-runtime, not a consumer of them). **S2 must decide**
   how/whether the store's `ArtifactId` and science-session's
   `ScienceArtifactId` reconcile — options include making the session-log
   reference field literally store the store's `ArtifactId` string (simplest,
   recommended) or keeping two distinct id spaces with an explicit mapping
   (more complex, probably unwarranted).
2. **Blob admission is plain temp-then-`rename()`**, not `attachment-local`'s
   fsync-heavy hardlink-plus-directory-fsync durability chain. S0 literally
   says "written temp-then-rename", so this matches the letter of the design;
   flagged in the README's Known Limitations as a deliberate simplification.
   If S2/S3 hit a real durability gap (e.g. crash-consistency requirements
   surface), revisit against `attachment-local/src/store.ts`'s pattern.
3. **Workspace identity uses `resolve()`, not `realpath()`.** Two symlink
   paths to the same physical directory are NOT recognized as the same
   workspace (recorded as a Known Limitation). S0 doesn't specify which to
   use; this was the simpler choice for S1. Revisit if this surfaces as a
   real product bug.
4. **No `annotate_artifact`-specific method name** — the store's
   `annotateVersion` is the mechanism S2's `science-runtime.annotateArtifact`
   will presumably call into; the naming is store-vocabulary (`Version`, not
   `Artifact`) since it curates one version's metadata, matching the S0 note's
   own framing ("Curation... stays a metadata update on the version it
   names").
5. **No cross-project operations, retention, or dependency DAG** — matches
   the PLAN.md's explicit v1 scope decision (items 3/4/8/9/11 of the CS spec
   deferred); not a deviation, just confirming S1 didn't scope-creep into
   those.

## Gotchas for S2

- **`Config` is a `static` class member** (`static Config: z<Config> = z.object({...})`
  on `ScienceArtifactStore`), NOT a module-level `export const Config` —
  Cordis reads the static property for schemastery validation on
  `ctx.plugin(ScienceArtifactStore, config)`. Getting this wrong silently
  skips default-application (caught this exact bug during S1 — see the
  Agent Note's Consequences / this file's own development history if useful,
  though the fix is already applied and tested).
- Every engine operation that touches a project's store **lazily
  materializes that project's store directory** (mkdir + fresh `store.sqlite`)
  even for a `projectId` that was never legitimately created via
  `openProject` — this is intentional (self-sufficient methods, see above)
  but means a typo'd or forged `projectId` string silently creates an empty
  store rather than erroring "project not found". Since `projectId`s are
  UUIDs this isn't a practical security concern, but keep it in mind if S2/S3
  add any user-facing "open by id" surface — validate the id came from a
  trusted source (a session log reference) first.
- `admitBlob` runs BEFORE the SQL transaction that might reject the write
  (e.g. `ARTIFACT_NOT_FOUND` in `appendVersion`) — a failed append can leave
  an orphaned but harmless (content-addressed) blob on disk. No GC exists.
- The concurrent-append correctness relies on `busyTimeoutMs` > 0 and
  `BEGIN IMMEDIATE` (not `BEGIN DEFERRED`) — don't "simplify" that
  transaction wrapper (`runWriteTransaction` in `store.ts`) without
  re-running `tests/concurrent-append.spec.ts`, which is the one test that
  actually proves cross-process serialization (unit tests within one process
  cannot observe the SQLITE_BUSY path at all, since node:sqlite calls are
  synchronous and one process's transaction always runs to completion before
  yielding — see the test file's own comments).

## Test entry points

```sh
npx vitest run packages/science/science-artifact-store
npx vitest run packages/science/science-artifact-store --coverage --coverage.include="packages/science/science-artifact-store/src/**"
npx tsc -b packages/science/science-artifact-store/tsconfig.json
npx tsx scripts/run-oxlint.ts packages/science/science-artifact-store
npx tsc -b tsconfig.host.json   # whole host aggregate, catches cross-package registration breakage
npx tsx scripts/run-gates.ts doc-sync   # full bilingual-doc + generated-catalog suite
```
All green as of the S1 commit. Coverage is per-file 100% (statements/branches/
functions/lines) on every file in `src/`.
