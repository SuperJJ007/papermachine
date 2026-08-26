# S2 handoff — runtime wiring onto the project artifact store (DONE)

Owner: S2 completion agent. Created: 2026-08-26 (previous partial handoff),
finished 2026-08-26. Status: **S2 core and the presetId rider are both
landed and green.** Commits: `7a341d30d8` (S2 core, WIP — store wiring,
event slimming, fold rework) and `8c4670bddc` (partial handoff doc) already
existed; this pass added the remaining core work (compositions, snapshot
refresh, test fixes, docs, SDK verification) and the presetId rider as its
own commit — see the final report / `git log` for their hashes. Nothing
pushed.

Consumers: S3 (Design decisions section below), and the S4 agent (Browser
read path section below).

## Per-item status — everything below is DONE unless marked otherwise

Everything the prior partial handoff listed as DONE (event slimming, fold
rework, capture→store, project resolution, annotate→store, run inputs,
style edit + edit message, presentation meta v2, get_science_state/
projection, attachment extractor removal) is unchanged and still accurate;
not repeated here. What this pass completed:

| Item | Status |
| --- | --- |
| `real-acceptance.ts` mechanical swap | DONE — mounts `ScienceArtifactStore` (dropped `LocalAttachmentStore`, now unused in this package's tests), gives both sessions a `cwd` (fresh `mkdtemp` workspace; the real conda prefix directory must NOT be reused as cwd — it would pollute the prefix-manifest diff the script asserts against), `'width' in .attachment` → `mediaType === 'image/png'`, readback via `ctx.scienceArtifactStore.readBlob(chart.projectId, chart.sha256)`, replay comparison via `versionId`. `dsh-attachment-local` dropped entirely from `science-runtime`'s `devDependencies` (fully unused now). |
| Three `apps/web` science test files | DONE — `science-artifact-types.e2e.ts` and `science-chart-outcome.e2e.ts` rebuild their hand-written fixtures with `projectId`/`versionId`/`sha256`/`mediaType`/`byteCount` (deterministic `sha256` digests via `createHash`, not real store writes — these fixtures inject raw session JSONL, no store is mounted for them); `science-preset.snapshot.ts` (a REAL composition test) fixes its presentation-version assertion (`kind: 'science/artifact', version: 2`, was `1`), drops the stale `attachmentId` field from its return-value type casts, adds `not.toHaveProperty('projectId'/'versionId'/'sha256')` to its `get_science_state` no-leak assertions, and swaps its final readback to `scaffold.ctx.scienceArtifactStore.readBlob(...)` — this one actually exercises the real runtime end to end. |
| **Unplanned fallout found and fixed**: `packages/host/apiproxy/tests/api-proxy-models.spec.ts` and `session-export.spec.ts` both used `'science/artifact-saved'` as a stand-in "real extractor-required event type" to exercise the generic `sessionAttachments` registration mechanism without a domain dependency. Once `science/artifact-saved` was reclassified `attachment-free`, both broke (one at compile time via the narrowed `SessionAttachmentExtractorMap` key union, one at runtime via `SESSION_ATTACHMENT_EXTRACTOR_MISSING` never firing since `science/artifact-saved` is no longer extractor-required). Neither was in the original handoff's file list. Both now declare a local test-owned `SessionEventMap`/`SessionAttachmentExtractorMap` augmentation, mirroring the pattern `session-attachment-index`'s own suite already used. | DONE |
| `session-attachment-index/src/types.ts` JSDoc | DONE — the `SessionAttachmentExtractorMap` example no longer cites `science/artifact-saved` as a live extractor (there are none in production today); rewrote generically plus a note explaining why. |
| Compositions | DONE — `packages/bundle/web-app/cordis.patch.yml` mounts `@deepseek-ai/dsh-science-artifact-store` (row `science-artifact-store`, no `dshHome` override — follows the same `$DSH_HOME` default the `science-runtime` row's own unset `dshHome` already relies on) before the `science-runtime` row; its package.json gains the dependency. `examples/headless-agent/science-tools.cordis.snapshot.yml` mounts it beside `attachment-local`, pinned to the same `DSH_SCIENCE_SNAPSHOT_ROOT`-scoped `dshHome` its sibling rows use; `examples/package.json` gains the dependency. `apps/web/tests/science-preset.overlay.yml` needed no change — it only disables `science-runtime`, and inherits the root-mounted store row unmodified. `python/sdk-runtime/package.json` also gains the dependency (parity with its existing `dsh-science-runtime`/`dsh-science-session`/`dsh-sandbox-local`/`dsh-subprocess-local` entries). |
| Driver cwd + async `submit` | DONE — `examples/headless-agent/tests/fixtures/science-driver.ts`'s `ctx.agents.create` now passes `meta: { agentPreset: 'science', cwd: process.cwd() }` (the driver's own already-isolated, already-scrubbed process cwd); both `ctx.scienceEdits.submit(...)` calls gained the `await` the now-async method requires (a real, if narrow, correctness bug in the WIP driver — a floating promise racing the following `agent.whenIdle()`/session-event assertions). |
| Snapshot refresh | DONE, executed (not just planned) — `DSH_SNAPSHOT=refresh npx vitest run --config vitest.snapshot.config.ts examples/headless-agent/tests/headless.snapshot.ts -t Science`: 1 passed. Diff in `model-view.expected.json`/`stream-json.expected.jsonl` is exactly the expected schema delta (no `1x1`/width-height text in model-visible descriptions, `projectId`/`sha256`/`mediaType`/`byteCount` present on durable events). **The prior handoff's own speculation was wrong**: it worried `scienceIds`/`tokenizeScienceIds` would need dedicated `versionId`/`projectId` tokenization. Empirically they do not — the *generic* headless normalizer (`packages/test-support/acp-snapshot/src/normalize.ts`'s catch-all `UUID_RE` replace) already sweeps every stray UUID (including the new `versionId`/`projectId` values) onto the shared `{{sessionId}}` placeholder token, before the Science-specific tokenizer even runs. Deterministic and correct, just a generic (not versionId-specific) name; not worth adding bespoke tokenization for. |
| `apps/web`'s own snapshot suite (`science-preset.snapshot.ts`) | **NOT independently executed as a snapshot** — it only runs under `pnpm run test:snapshot` with `DSH_EXAMPLE_MODE=lib` (a prior client build required; `vitest.snapshot.config.ts`'s own `include` gates it there), which neither `pnpm run test` nor the handoff's own snapshot-refresh recipe covers. Verified instead by static type-correctness (`tsc -b tsconfig.host.json` clean) and by the headless-agent example's own REAL, executed composition test exercising the identical core mechanisms (project resolution, store injection, async edit submit). Whoever next runs a full `DSH_EXAMPLE_MODE=lib` snapshot pass should treat a diff here as expected-and-reviewable, not a regression. |
| TS/Python SDK expected outputs | **VERIFIED — no diff, no science scenario, in either.** TypeScript: executed `DSH_SNAPSHOT=refresh` against `examples/jsonrpc-agent/tests/sdk.snapshot.ts` (4 passed, zero file changes). Python: `smoke-python-runtime.py` requires a full native single-exe build (heavy, not attempted — disproportionate for a "confirm zero scenarios" check); confirmed instead by an exhaustive static grep across `python/sdk-runtime/`'s source, `python/sdk/tests/`, and `scripts/snapshots/python-sdk-single-exe/` — zero "science" references anywhere except `python/sdk-runtime/package.json`'s own dependency list (fixed to add the missing `dsh-science-artifact-store` entry, see Compositions above). |
| Docs | **PARTIALLY DONE, deliberately bounded.** Fixed and bilingually re-paired: `science-runtime/README.md`+`.zh.md` (composition/provider-requirement line, every "attachment"/"attachment store" mechanism claim — normalization, allowlist mirroring, same-turn supersede description, curation's store-vs-attachment reads), `science-session/README.md`+`.zh.md` (intro line, `science/artifact-saved`'s field list, the whole "Attachment authorization" section renamed/rewritten to "Session attachment registry"), `tool-science/README.md`+`.zh.md` (composition line, `submit`/`commitStyleEdit` mechanism paragraph — async region-image minting, store-based append, no size cap), `session-attachment-index/README.md`+`.zh.md` (Role section). Generated catalogs regenerated and re-paired: `docs/config-catalog.md`+`.zh.md`, `docs/persistence-catalog.md`+`.zh.md`, `docs/module-graph.md`+`.zh.md`, `docs/subsystems/science.md`+`.zh.md`+`.i18n.yaml`, `packages/extensions/tool-cordis/src/api-catalog.ts` (all via their own `gen-*.ts`/`--check` scripts, not hand-edited prose). `packages/preset/agent-presets/src/metadata.ts`'s `copyable` JSDoc updated to state the presetId-rider-era reason precisely. **NOT done**: `science-session/README.md`'s and `tool-science/README.md`'s longer fold-mechanics prose (the "Durable vocabulary"/strict-fold paragraphs describing supersede/parent/human-edit rules in exhaustive technical detail) still describes some pre-S2 mechanics verbatim in places this pass did not line-by-line rewrite — the composition, requirement, and directly-touched-mechanism paragraphs are current; a fuller accuracy pass of the deep fold-semantics prose is real remaining debt, flagged but not attempted (risk of introducing a subtly wrong restatement of intricate invariants outweighed the value under this pass's budget). |
| presetId generalization rider | **DONE, its own commit** (see below — separate from the S2 core commit, same schema wave). |
| Coverage (`--coverage` on the touched packages) | **NOT RUN** — not in this pass's explicit gate list (typecheck + scoped vitest + doc-sync); CI's `test:coverage` owns this signal per repo convention. Whoever runs it next: expect newly-covered branches in `capture.ts` (parent-version lookup), `index.ts` (`sessionProject` eviction), `edit-message.ts` (dedupe/missing-minted-image), `codec.ts` (embedded-attachment reject helper), `applicability.ts` (the new self-consistency branches) — all were exercised by the passing unit suites above but per-file 100% coverage was not independently confirmed. |

## The presetId rider (separate commit)

`ScienceModeRef.presetId` widens from the literal type `'science'` to
`string` (`science-session/src/types.ts`), `codec.ts`'s schema from
`z.literal('science')` to a bounded non-empty string. A new named constant
`SCIENCE_PRESET_ID = 'science'` (`science-session/src/ids.ts`, exported from
`index.ts`) replaces the scattered literal. `applicability.ts`'s admission
check becomes self-consistent instead of hardcoded: the first
`science/mode-bound` event must record `SCIENCE_PRESET_ID` and match the
currently resolved preset (a shallow, untyped read of
`event.data.mode.presetId`, mirroring how this package's invariant already
reads `event.data.agentPreset` off a raw `agent-preset/selected` event
before strict decode — see `nextPreset` in `invariant.ts`); every later
Science event must find the resolved preset still equal to
`state.mode.presetId`. `dsh-tool-science`'s `isScienceSession` and
`ensureScienceBound` (`context.ts`) reference the same constant and record
the actually-resolved preset id (`resolveSessionPreset(session)`) instead of
a literal. `packages/preset/agent-presets/src/metadata.ts`'s `copyable`
JSDoc updated to state precisely why the science preset still can't be
copied (its `isScienceSession`/mode-bound eligibility check still recognizes
only the one shipped preset id — a copy's differing id would silently never
activate Science mode). `apps/cli/config/agent-presets/science/preset.yml`
itself is unchanged (`copyable: false` is still correct).

**Behavior is unchanged today** — only `'science'` passes either check, and
every existing test (94/94 science-session, 129/129 tool-science, 278/280
science-runtime, 146/146 agent-presets) still passes unmodified. This is
foundation work, not a feature: recognizing a *different* preset id as
Science-family (a genuinely distinct future discipline preset, or a copy of
this one) needs a preset-metadata mechanism this package does not yet
consult, and inventing that mechanism was explicitly out of scope for this
rider — see "Alternatives considered" in the Agent Note below for why (fold-
purity: the strict fold cannot soundly depend on live, mutable preset
metadata that could differ across deployments/versions without first
capturing a durable fact at bind time, which is a real design nobody has
reviewed yet).

## Design decisions S3 must know (carried forward, unchanged from the prior handoff)

- **Version ≡ ordinal.** The fold requires contiguous per-session versions;
  S3's cross-session append means another session's store ordinal can
  exceed this session's expected `latest.version + 1` — the fold's
  contiguity rule (and the projectId-equality rule
  `state.artifacts[0].projectId`) will need relaxing for cross-session
  references. Both throws live in `transition.ts`'s `applyArtifactSaved`.
- **Event carries `projectId` per artifact event** (not a separate binding
  event); the fold pins all of a session's artifacts to one project. S3's
  "same project, second session" works unchanged; cross-project stays
  rejected.
- **Accepted decay** (documented in code): store row with no event after a
  vetoed capture append; store metadata curated with no event after a
  vetoed annotate append; store cannot clear a caption (`AnnotateVersionInput`
  has no explicit-null) — fold value is authority.
- **Session export no longer includes artifact bytes** — project store owns
  them; an export/import story for artifacts is project-level (S3/S4
  decision).

## Browser read path — for the S4 agent

`packages/client/ui-science` (`ArtifactContent.tsx`, `ScienceDetailsView.tsx`,
`ScienceOutcomeRow.tsx`, `ScienceTurnArtifacts.tsx`) and its own test suite
still read the removed `attachment` field and `session.readAttachment` — the
package does not compile under `tsconfig.client.json` (confirmed:
`npx tsc -b tsconfig.client.json` currently fails there with dozens of
`Property 'attachment' does not exist` errors; `tsc -b tsconfig.host.json` is
unaffected — the two are genuinely separate compiler programs per
`docs/development.md`'s "Keep compiler faces explicit"). This is the
pre-existing, deliberately deferred state the S1/S2 handoffs already
documented; this pass did not touch `packages/client/ui-science` at all
(explicitly out of S2's scope per PLAN.md). `apps/web/tests/
science-chart-outcome.e2e.ts`'s UI-facing assertions (image load/fail
states, per-version content) are updated to the new event/presentation
shapes for type-correctness only — they exercise a path that is still dark
and were not run (Playwright + a full web boot; expected to fail on the UI
assertions specifically, not on session/event handling). Suggested route
(from S1/S2, unclaimed): a Typert `sessions.scienceArtifact({sessionId,
versionId})`-shaped RPC in `packages/host/apiproxy`, authorized by folding
the session log, bytes via `store.readBlob(projectId-from-fold, sha256)`.

## Gates run this pass (all PASS unless noted)

- `npx tsc -b tsconfig.host.json` — clean, repeatedly, after every edit round.
- `npx tsc -b tsconfig.client.json` — **fails**, pre-existing, `packages/client/ui-science` only (see Browser read path above); not this pass's scope.
- `npx vitest run packages/science/science-runtime --maxWorkers=4` — 278 pass, 2 skipped (matches prior baseline).
- `npx vitest run packages/science/science-session` — 94/94.
- `npx vitest run packages/science/tool-science --maxWorkers=2` — 129/129.
- `npx vitest run packages/session/session-attachment-index` — 27/28 (the pre-existing `team/*` gap; unrelated to S2, do not chase — see below).
- `npx vitest run packages/host/apiproxy` — 384/384 (was 383/384 before the `session-export.spec.ts` fix in this pass).
- `npx vitest run packages/preset/agent-presets` — 146/146.
- `DSH_SNAPSHOT=refresh npx vitest run --config vitest.snapshot.config.ts examples/headless-agent/tests/headless.snapshot.ts -t Science` — 1 passed; expected-output diff reviewed and matches the schema change exactly.
- `DSH_SNAPSHOT=refresh npx vitest run --config vitest.snapshot.config.ts examples/jsonrpc-agent/tests/sdk.snapshot.ts` — 4 passed, zero diff.
- `npx tsx scripts/run-gates.ts doc-sync` — full 29-gate run, clean after fixing the 3 generated-doc staleness failures (`config-catalog`/`persistence-catalog`/`module-graph`, all pre-existing staleness from the earlier WIP commit's uncommitted JSDoc edits, surfaced by this pass's first full run) and re-pairing their `.zh.md` mirrors.

**Known pre-existing failures, confirmed NOT to chase (per task instructions and independently re-verified)**:
- `packages/session/session-attachment-index/tests/policy.spec.ts` — `classifies every known session event type exactly once` — the `team/*` event types from `packages/experimental/agent-team` are unclassified in `policy.ts`'s static lists; confirmed pre-existing on the branch base by the prior agent (`git stash` + rerun on `fafca4a582`), unrelated to Science.

## Commit history left as-is

The handoff's suggestion to squash `7a341d30d8`/`8c4670bddc` into one final
S2-core commit before review was **not done** — nothing is pushed, and a
history rewrite under time pressure was judged riskier than leaving three
readable, individually-coherent commits (the original WIP core, the partial
handoff doc, and this pass's completion + a separate presetId-rider commit).
Squashing remains a purely optional cleanup for whoever finalizes the PR.

Retire this file when S2 fully lands and its surviving facts move into the
package READMEs / the S2 Agent Note (`.agents/notes/implemented/architecture/
2026-08-26-project-artifact-store-s2.md`, already written and current).
