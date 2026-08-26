# S2 handoff — runtime wiring onto the project artifact store (PARTIAL)

Owner: S2 implementation agent. Created: 2026-08-26. Status: **S2 core is
partially landed** — host-side event/store/fold/projection rework is done and
green at package level; snapshots, compositions, docs, and the presetId rider
are NOT done. Stopped on a coordinator budget override, not at a natural
boundary. Commit: `7a341d30d8` on `feat/project-artifact-store` (on top of S1
`fafca4a582`). Nothing pushed.

Consumers: whoever finishes S2, then S3.

## Per-item status

| Item | Status |
| --- | --- |
| Store `/ids` subpath (`@deepseek-ai/dsh-science-artifact-store/ids`) | DONE (package.json exports + tsconfig.base.json paths; node-free, browser-safe) |
| Id reconciliation | DONE — one id space owned by the store package; science-session re-exports `ProjectId/ArtifactId/VersionId` as `ScienceProjectId/ScienceArtifactId/ScienceVersionId` (its own `ScienceArtifactId` brand deleted). science-session now depends on the store package (peer+dev+tsconfig ref). |
| Event slimming | DONE — `science/artifact-saved` base fields now `{artifactId, logicalName, version, title, caption?, projectId, versionId, sha256, mediaType, byteCount, environmentRevision, environmentFingerprint, createdAt}` + run/human-edit variants as before. `width`/`height`/attachment name are GONE everywhere (store does not record them). Old embedded-attachment value rejected with a clear error (`codec.ts` `rejectEmbeddedAttachmentArtifact`), proven by tests. |
| Fold rework | DONE — new invariants: one `projectId` per session's artifacts; `versionId` unique across committed versions; supersede-in-place is now **model curation only** and must retain the versionId/sha256/mediaType/byteCount; **auto same-turn content supersede is REMOVED** (session `version` ≡ store `ordinal`; changed content always opens the next version). `scienceRunsShareTurn` deleted (fold-state/fold/index exports). `SCIENCE_PROJECTION_STATE_VERSION` bumped 9→10. |
| Capture → store | DONE — `capture.ts` hashes locally (sha256 skip/dedup + human-edit stale rule), writes `createArtifact`/`appendVersion`, then appends the reference event (store row commits before the event; a vetoed append leaves an orphaned store version, documented). Attachment store fully removed from science-runtime (`inject` now `['scienceArtifactStore', 'sessions', 'subprocess', 'sandbox']`). |
| Project resolution | DONE — `ScienceRuntime.sessionProject(session)`: `openProject(session.header.cwd)`, cached per live Session (WeakMap), failed opens evicted; new error code `PROJECT_UNAVAILABLE` when the header has no cwd; resolved eagerly in `bindEnvironment` (fail loud at first Science op) and in `startRun`. |
| annotate → store | DONE — `annotateVersion` in place BEFORE the superseding event; caption-clearing divergence documented in code (store cannot clear a caption; the fold value is authority). curatedVersion now carries `parent` through (old code dropped it, which would have failed the fold for parented versions). |
| Run inputs | DONE — `prepareRunArtifacts(projection, store, projectId, ...)` reads via `store.readBlob(projectId, sha256)`; byte caps on `byteCount`. |
| Style edit + edit message | DONE — `commitStyleEdit` appends through the store. `ScienceEditService.submit` is now async: region targets read the blob and mint a session message image via `attachments.saveImage(verbatim)` (model-visible ⟺ logged); `createScienceEditMessage(resolved, regionImages)` takes the minted map keyed by `String(versionId)` and dedupes repeated region targets per version (behavior change: previously one image per region target). edit-service `inject` = `['attachments', 'scienceArtifactStore']`. |
| Presentation meta | DONE — `ScienceArtifactPresentation` bumped to `version: 2`; `attachment` → `content: {versionId, mediaType, byteCount}`. Run/annotate canonical values: `attachmentId/attachmentName/width/height` → `versionId`. |
| get_science_state / projection | DONE — model state keeps `mediaType`/`bytes`, drops width/height, never exposes versionId/sha256. Client projection artifact carries `versionId/sha256/mediaType/byteCount` (no projectId — reads stay session-addressed). `projection-schema.ts` validators updated. |
| Attachment extractor | REMOVED — registration + `SessionAttachmentExtractorMap` merge deleted; `science/artifact-saved` reclassified `attachment-free` in session-attachment-index `policy.ts`. Session export/GC therefore no longer carries artifact bytes — deliberate: the project store owns them and outlives the session. Extractor-required registry paths now tested via a test-local `test/media-saved` key (`index.spec.ts` mutates `KNOWN_SESSION_EVENT_TYPES` for the suite). |
| Snapshots (`test:snapshot` refresh) | **NOT DONE** — see below. |
| Compositions (cordis.yml) | **NOT DONE** — see below. |
| TS/Python SDK expected outputs | NOT VERIFIED — no science scenario exists in either SDK snapshot set (checked `examples/jsonrpc-agent/tests/snapshots/`, `scripts/snapshots/python-sdk-single-exe/`), so likely no diff; still must be confirmed by running the suites. |
| Browser read path + ui-science | **NOT DONE, deliberately deferred to S4** per PLAN (S4 owns the UI data source). ui-science still reads `artifact.attachment` and `session.readAttachment` — it no longer compiles against the new client projection and artifact viewing is functionally dark until S4 adds a store-read RPC (suggested: `sessions.scienceArtifact({sessionId, versionId})` in `packages/host/apiproxy`, authorized by folding the session log, bytes via `store.readBlob(projectId-from-fold, sha256)`). |
| Bilingual Agent Note + README updates | **NOT DONE**. |
| doc-sync / oxlint / coverage gates | **NOT RUN**. |
| presetId rider | **NOT STARTED**. |

## Gates status right now

PASS (run locally):
- `npx vitest run packages/science/science-session` — 94/94.
- `npx vitest run packages/science/science-runtime --maxWorkers=4` — 278 pass, 2 skipped. (Full-parallel runs hit 5s test timeouts under machine load — flake, not failures; use `--maxWorkers=4`.)
- `npx vitest run packages/science/tool-science --maxWorkers=2` — 129/129.
- `npx vitest run packages/session/session-attachment-index` — 27/28 (see policy gap below).
- `npx tsc -b` on the three science package tsconfigs.

FAIL / NOT RUN:
- `packages/session/session-attachment-index/tests/policy.spec.ts > classifies every known session event type exactly once` — **pre-existing on the branch base** (verified by `git stash` + rerun on `fafca4a582`): `KNOWN_SESSION_EVENT_TYPES` contains `team/member`, `team/message/delivered`, `team/message/queued`, `team/task` (from `packages/experimental/agent-team`) but `policy.ts` classifies none of them. Symptom: classified set is 4 short of the known set. Hypothesis: the agent-team domain events were added without updating the attachment policy lists — exactly the drift this freshness gate exists to catch; nothing to do with S2. Next step I would have taken: none in S2 (out of scope); the owner should classify the four `team/*` types (likely `built-in` for message-bearing ones if their payloads wrap `message.content`, else `attachment-free`) after reading `packages/experimental/agent-team/src/fold.ts` payloads.
- `npx tsc -b tsconfig.host.json` — fails ONLY in not-yet-updated test files (all src compiles):
  - `packages/science/science-runtime/tests/real-acceptance.ts` (6 errors, `artifact.attachment` reads; mechanical: `'width' in .attachment` checks → `mediaType === 'image/png'`, readback via `ctx.scienceArtifactStore.readBlob(chart.projectId, chart.sha256)`, replay comparison via versionId).
  - `apps/web/tests/science-preset.snapshot.ts` (1 error, line ~299 `artifact.attachment`), `apps/web/tests/science-artifact-types.e2e.ts`, `apps/web/tests/science-chart-outcome.e2e.ts` (construct old-shape `ScienceRunArtifactVersion` fixtures; mechanical swaps, but the e2e flows also exercise UI viewing that is dark until S4).
- `pnpm run test:snapshot` — NOT RUN; will fail until the work below lands.
- coverage / oxlint / doc-sync — NOT RUN.

## Exactly what remains for S2 core

1. **Compositions**: mount `@deepseek-ai/dsh-science-artifact-store` (config `dshHome` where the sibling rows set one) in:
   - `examples/headless-agent/science-tools.cordis.snapshot.yml` (beside `attachment-local`; keep attachment-local — the edit-message image minting still needs it),
   - `packages/bundle/web-app/cordis.patch.yml` (before the `science-runtime` row; also update its comment block that still describes the artifact-saved extractor),
   - `apps/web/tests/science-preset.overlay.yml` if it mounts science rows itself.
   Also: the snapshot driver (`examples/headless-agent/tests/fixtures/science-driver.ts`) must create its session WITH a `cwd` (workspace dir under the snapshot temp root) or every Science op fails `PROJECT_UNAVAILABLE`. Check how the web-app assembly sets session cwd for real product sessions — if web sessions can lack cwd, decide the product answer (probably: Science requires a workspace; surface the error).
2. **Snapshot refresh**: `pnpm run test:snapshot:refresh` (NEVER record). Expect to also EDIT `examples/headless-agent/tests/headless.snapshot.ts`: `scienceIds`/tokenizers must additionally collect and tokenize `versionId`s and the `projectId` (fresh UUIDs per run) the way runIds/chartIds are tokenized; hard assertions on version numbers should survive (the scenario has no same-turn same-file rewrite; curation still supersedes in place), but re-check `chartIds` count/uniqueness (11 events / 9 unique ids) and the multi-target edit — region-image dedupe changed message image content ordering only per-version. `modelView` assertions: `not.toContain('attachmentId')` can become `not.toContain('sha256')`? NO — sha256 IS allowed nowhere in model view; versionId appears in tool result values but render() hides it from model text; the model-view JSON is the request content (rendered text), so it should stay free of versionId — keep/adjust assertions accordingly.
3. **apps/web tests + real-acceptance.ts**: mechanical field swaps (above). `apps/web/tests/snapshots/science-preset/session.jsonl` has NO artifact events (verified) so the web snapshot fixture itself replays; but the science e2e tests are S4-coupled where they view artifact content.
4. **SDK expected outputs**: run the TS SDK snapshot (part of `test:snapshot`) and the Python one (`scripts/smoke-python-runtime.py`, CI `python-runtime` job); expect no diffs (no science scenarios) — verify, don't assume.
5. **Docs**: bilingual READMEs (science-session, science-runtime, tool-science, science-artifact-store cross-refs, session-attachment-index types.ts JSDoc still cites `'science/artifact-saved'` as the extractor example — update to a current-state example), the S1-added `TYPE_LINK_EXEMPTIONS`/catalog entries in `scripts/gen-cordis-catalog.ts` (new exported id aliases may need entries), bilingual Agent Note in `.agents/notes/implemented/architecture/` (en+zh+i18n) cross-linking S0/S1 notes, then `npx tsx scripts/run-gates.ts doc-sync`.
6. **Coverage**: scoped `--coverage` runs on the three science packages + session-attachment-index; new uncovered branches likely in `capture.ts` (parent-version lookup defensive throw), `index.ts` (`sessionProject` eviction path), `edit-message.ts` (dedupe/missing-minted-image throw — covered), `codec.ts` reject helper (covered).
7. **Commit split**: this WIP commit + the remainder can be squashed/reworded into the final S2 core commit before review; presetId rider stays its own commit (NOT started; touchpoints re-verified: `science-session/src/types.ts` ScienceModeRef literals, `codec.ts` scienceModeSchema, `applicability.ts` preset==='science', `tool-science/src/context.ts` `isScienceSession` + `ensureScienceBound`'s hardcoded mode ref, `apps/cli/config/agent-presets/science/preset.yml`).

## Design decisions S3 must know

- **Version ≡ ordinal.** The fold requires contiguous per-session versions; S3's cross-session append means another session's store ordinal can exceed this session's expected `latest.version + 1` — the fold's contiguity rule (and the projectId-equality rule `state.artifacts[0].projectId`) will need relaxing for cross-session references. Both throws live in `transition.ts` `applyArtifactSaved`.
- **Event carries `projectId` per artifact event** (not a separate binding event); the fold pins all of a session's artifacts to one project. S3's "same project, second session" works unchanged; cross-project stays rejected.
- **Accepted decay** (documented in code): store row with no event after a vetoed capture append; store metadata curated with no event after a vetoed annotate append; store cannot clear a caption (`AnnotateVersionInput` has no explicit-null) — fold value is authority.
- **Session export no longer includes artifact bytes** — project store owns them; an export/import story for artifacts is project-level (S3/S4 decision).
- `dsh-attachment-local` is still a devDependency of science-runtime but its tests no longer use it — drop it when convenient (knip will flag).

Retire this file when S2 fully lands and its surviving facts move into the
package READMEs / the S2 Agent Note.
