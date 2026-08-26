# S3 handoff — cross-session artifact continuity (DONE)

Owner: S3 implementation agent. Created: 2026-08-26. Retire when S4 has read
this and its durable facts (the Browser read path section) have moved into
`packages/client/ui-science`'s own docs or a new Agent Note it writes; delete
this file at that point. This handoff supersedes and replaces S1-HANDOFF.md
and S2-HANDOFF.md, both deleted in the same commit as this file's creation —
their durable facts already moved into the package READMEs and the
S1/S2/S3 Agent Notes (`.agents/notes/implemented/architecture/
2026-08-26-project-artifact-store-s{1,2,3}.md`), and S2-HANDOFF.md's one
still-live fact for a future consumer (the browser read path) is carried
forward in this file's own section below.

Consumers: the S4 implementation agent.

## Per-item status against PLAN.md's S3 line

PLAN.md's S3 bullet: "同 project 新会话读取/引用/追加既有 artifact(producer 记
新 session);Files 投影升 project 级(一个 Artifact 一行、显示 latest);restart
续写验证。"

| Item | Status |
| --- | --- |
| A second session in the same project reads/references an existing artifact via `artifact_inputs` | DONE — `prepareRunArtifacts` (`science-runtime/src/inputs.ts`) falls back to `store.listVersions(projectId, artifactId)` when a run input is not in the requesting session's own live projection; `science-session`'s strict fold (`requireRunInputArtifactVersion` in `transition.ts`) accepts a run-input reference to an artifactId this session's own fold has never recorded, trusting the pre-commit validation the live Runtime already did against the store. |
| A second session appends a version to a first session's artifact, producer = new session | DONE — `captureRunArtifacts` (`science-runtime/src/capture.ts`) consults `store.listArtifacts(projectId)` when a captured path's logical name has no local record, and appends to the existing artifactId instead of creating a duplicate; the strict fold's contiguity check (`applyArtifactSaved` in `transition.ts`) no longer requires a first-locally-sighted logical name to open at version 1. |
| Files lists one row per artifact showing latest | DONE, and required no new mechanism — S1's `listArtifacts(projectId)` already returns one row per artifact with `latestVersionId`; what changed is capture's create-vs-append decision (above), which is what previously would have forked a duplicate row for a cross-session recapture of the same logical name. A dedicated `science-runtime` test (`capture.spec.ts`) proves exactly one store row survives cross-session continuation, with the new session as latest's producer. A project-level UI listing ("Files" as a rendered surface) is explicitly S4's job — see Browser read path below. |
| Restart continues writing to the same store | DONE — no new mechanism (S1's `openProject` already derives a project's store path deterministically from `dshHome`+`projectId`); a dedicated `science-runtime` test disposes one harness's Context after a first session's capture, creates a second, fully independent harness (fresh Context/Runtime/Store, same `dshHome`) and proves the second session's continuation carries forward only what was durably committed. |
| `editBaselines`/parent lineage cross-session | Explicitly OUT of scope for this slice (PLAN's S3 line names artifact reads/references/appends, not lineage; S5 is where "编辑/画板管线在新 store 上的回归验证" belongs) — `editBaselines` resolution and `artifact.parent` fold validation both stay same-session-only, documented in both package READMEs' Known Limitations and in the S3 Agent Note. |
| Keyless snapshot for the new cross-session behavior | NOT added as a new scenario — see Gates section below for why, and what was verified instead. |

## What shipped, by file

- `packages/science/science-session/src/transition.ts`: `applyArtifactSaved`'s
  contiguity check accepts any positive ordinal (the codec's own
  `POSITIVE_INTEGER` schema already bounds it) for a logical name this
  session's own fold has never recorded, instead of requiring exactly 1; a
  same-session continuation still enforces strict `+1` contiguity unchanged.
  A new `requireRunInputArtifactVersion` (replacing the shared
  `requireArtifactVersion` at this one call site) returns without throwing
  when a run input's artifactId is not in `state.artifacts` at all, but still
  throws when it IS known locally at the wrong version. `artifact.parent`
  resolution (`requireArtifactVersion` itself) is untouched — still strict,
  same-session-only, since nothing upstream produces a legitimate
  cross-session parent today.
- `packages/science/science-runtime/src/capture.ts`: the create-vs-append
  decision and its dedup check consult the project store
  (`store.listArtifacts`/`store.getVersion`, fetched lazily and cached once
  per walk) when the acting session's own live projection has no record of a
  captured path's logical name. Deduplication against a direct human edit's
  own ancestor chain is unchanged (still session-local only).
- `packages/science/science-runtime/src/inputs.ts`: `prepareRunArtifacts`'s
  run-input resolution (`resolveInputArtifactVersion`, new) falls back to
  `store.listVersions(projectId, artifactId)` matched by `ordinal` when the
  session's own live projection has no record of the referenced artifactId.
  `editBaselines` resolution (the pre-existing sync `artifactVersion`
  helper) is unchanged — still same-session-only, by design (see the S3
  Agent Note's Alternatives considered).
- Tests: `science-session/tests/fold.spec.ts` and `invariant.spec.ts` updated
  fixtures that used to exercise "unknown artifactId rejected" (now
  accepted) to instead exercise "known-locally-but-wrong-version still
  rejected", plus a new dedicated cross-session-acceptance test.
  `science-runtime/tests/capture.spec.ts` gained two dedicated composition
  tests (cross-session continuation; Host-restart continuation, both using
  the real `ScienceArtifactStore`/`ScienceRuntime`, no mocks) and its
  `failingStoreOverride` double gained a `listArtifacts` stub.
  `science-runtime/tests/inputs.spec.ts` gained a `listVersions` stub on its
  store harness and a dedicated cross-session-resolution test.
- Docs: `science-runtime/README.md`+`.zh.md` (auto-capture cross-session
  paragraph, `artifactInputs` fallback sentence, a new Known Limitations
  bullet for `editBaselines`, Verification-section test list), `science-
  session/README.md`+`.zh.md` (the fold-rejection sentence and its Known
  Limitations bullet rewritten for the run-input relaxation — the latter was
  also stale pre-S2 prose describing behavior S2 had already replaced; fixed
  in passing since it sits exactly where this slice's own change belongs),
  `science-artifact-store/README.md`+`.zh.md` (two stale links to the S0 note
  fixed after S0 moved lifecycle folders — pre-existing breakage from S2's
  own move-that-never-happened, not introduced by this slice).
- Agent Notes: S0 (`2026-08-25-project-artifact-store.md`+`.zh.md`) moved
  `proposed/` → `implemented/architecture/` (all three slices it specifies
  have now shipped) with its `## Proposal`/`## Acceptance criteria`/
  `## Risks` sections rewritten into `## Decision`/`## Consequences` per the
  lifecycle-move rule in `.agents/notes/README.md`. New S3 note
  (`2026-08-26-project-artifact-store-s3.md`+`.zh.md`). S1's and S2's own
  notes had their cross-links to S0 repointed (same-directory relative links,
  not `../../proposed/...`) and their "S2/S3 remain unbuilt" sentences
  corrected to present-tense fact, per `implemented/AGENTS.md`'s "kept
  current with what actually shipped" rule.

## Design decisions S4 must know

- **A reference is trusted only strictly ahead of this session's own
  locally-recorded maximum version for that artifactId; a reference at or
  below that maximum is still validated strictly by the fold** (corrected
  after S3 shipped: the original binary known/unknown test above did not
  survive two sessions truly interleaving writes against one artifact — see
  the S3 Agent Note's Decision section for the current rule). If S4 (or
  anything else) ever needs the fold to validate a cross-session
  `parent`/`editBaselines` reference, that is new design work — the human-edit
  invariants (parent logical name, media type, environment-provenance
  equality) have no fallback for a `parent` with no local copy to check those
  facts against. See the S3 Agent Note's Alternatives considered for why this
  was not attempted here.
- **Cross-project reference remains completely out of scope** — everything in
  this slice is single-project; a `projectId` mismatch across a session's own
  artifacts is still rejected exactly as before (S2's rule, unchanged).
- **No project-level "Files" listing tool, RPC, or UI section exists yet.**
  The store's `listArtifacts`/`getVersion` (S1) already return everything
  needed to render one; nothing new needs to be invented at the store or
  runtime layer — S4's work is the presentation layer over data this slice's
  tests already prove is correct across sessions and restarts.

## Browser read path — for the S4 agent (carried forward from S2-HANDOFF.md, unchanged by S3)

`packages/client/ui-science` (`ArtifactContent.tsx`, `ScienceDetailsView.tsx`,
`ScienceOutcomeRow.tsx`, `ScienceTurnArtifacts.tsx`) and its own test suite
still read the removed `attachment` field and `session.readAttachment`; the
package does not compile under `tsconfig.client.json` (confirmed again this
pass: `npx tsc -b tsconfig.client.json` fails there with the same class of
`Property 'attachment' does not exist` errors; `tsc -b tsconfig.host.json` is
unaffected). This slice did not touch `packages/client/ui-science` at all
(out of S3's scope per PLAN.md, same as S1/S2). Suggested route (from
S1/S2, still unclaimed): a Typert `sessions.scienceArtifact({sessionId,
versionId})`-shaped RPC in `packages/host/apiproxy`, authorized by folding
the session log, bytes via `store.readBlob(projectId-from-fold, sha256)`. A
genuine project-level "Files" section (distinct from per-session transcript
occurrences) additionally needs a project-scoped read path — most naturally a
`projects.scienceArtifacts({projectId})`-shaped RPC returning
`store.listArtifacts`/`getVersion` data, authorized by whatever mechanism S4
decides identifies "the current project" from the browser session (the
`ScienceRuntime.sessionProject` resolution this slice and S2 use Host-side is
not itself browser-reachable).

## Gates run this pass (all PASS unless noted)

- `npx tsc -b tsconfig.host.json` — clean.
- `npx tsc -b tsconfig.client.json` — fails, pre-existing, `packages/client/ui-science` only (see Browser read path above); not this pass's scope.
- `npx vitest run packages/science/science-session` — 95/95 (94 baseline + 1 new cross-session-acceptance test).
- `npx vitest run packages/science/science-runtime/tests/capture.spec.ts packages/science/science-runtime/tests/inputs.spec.ts --maxWorkers=2` — 45/45.
- `npx vitest run packages/science/science-runtime/tests/kernel-process.spec.ts packages/science/science-runtime/tests/kernel-set.spec.ts packages/science/science-runtime/tests/run.spec.ts packages/science/science-runtime/tests/failures.spec.ts --maxWorkers=4` — 115/115 (a whole-package `--maxWorkers=4` run of all 18 files hit 13 timeouts across these same files under this pass's shared-machine load — confirmed environmental by rerunning each in isolation, not a regression; unrelated to any file this slice touched).
- `npx vitest run packages/science/tool-science --maxWorkers=2` — 129/129 (unchanged baseline; no tool-science source touched this pass).
- `npx vitest run packages/science/science-session --coverage --coverage.include="packages/science/science-session/src/**"` — 100% on `transition.ts` (this slice's only changed file in this package); the package-wide report fails on `applicability.ts` (90.9%/85.71%), a **pre-existing** gap from S2's presetId rider, not touched by S3 (S2's own handoff already flagged coverage was not run for that rider).
- `npx vitest run packages/science/science-runtime/tests/capture.spec.ts packages/science/science-runtime/tests/inputs.spec.ts --maxWorkers=2 --coverage --coverage.include="packages/science/science-runtime/src/capture.ts" --coverage.include="packages/science/science-runtime/src/inputs.ts"` — 100% statements/branches/functions/lines on both changed files.
- `DSH_SNAPSHOT=refresh npx vitest run --config vitest.snapshot.config.ts examples/headless-agent/tests/headless.snapshot.ts -t Science` — 1 passed, zero file diff (confirmed via `git status --porcelain`) — this slice changed no model-visible tool schema or event shape, only which previously-rejected calls now succeed, which the existing single-session Science snapshot scenario cannot exercise (see below).
- `DSH_SNAPSHOT=refresh npx vitest run --config vitest.snapshot.config.ts examples/jsonrpc-agent/tests/sdk.snapshot.ts` — 4 passed, zero diff. Python SDK not re-verified: no `SessionEventMap`/session-lifecycle/agent-loop change in this slice (only fold validation and runtime business logic), so the "both SDKs project the loop" rule's trigger condition does not apply; the S2 handoff already confirmed zero Science references in the Python SDK corpus and nothing in that corpus changed this pass.
- `npx tsx scripts/run-gates.ts doc-sync` — full 29-gate run, clean after fixing: two broken `science-artifact-store` README links to the moved S0 note, and three wrong-locale links in the new S3 Chinese note (both caught by the gate itself, not missed).
- `npx tsx scripts/verify-agent-note-format.ts` — 638 notes, all conform.

**No new keyless snapshot scenario for cross-session continuity.** This is a
deliberate scope decision, not an oversight: the tool-facing schemas
(`run_python`/`run_r`'s `artifact_inputs`, `get_science_state`) are
byte-identical before and after this slice; what changed is which previously-
rejected calls now succeed. Expressing "two sessions in one project" inside
`examples/headless-agent`'s existing single-session driver fixture needs new
fixture scaffolding (a second `ctx.agents.create()` sharing one `cwd`, plus
snapshot-normalizer coverage for whatever new IDs a second session
introduces) that this pass's budget did not include — real `ctx.plugin`-
composed `science-runtime` tests (real store, real sessions, no mocks in the
new coverage) are the "non-unit REAL-composition test" this repo's own
package-level convention requires, and were judged sufficient evidence for a
runtime-logic-only relaxation with an unchanged wire format. Flagged in the
S3 Agent Note's Consequences section for whoever next extends the
headless-agent example suite.

## Known pre-existing gaps, confirmed NOT this slice's to fix

- `packages/session/session-attachment-index/tests/policy.spec.ts`'s `team/*`
  event classification gap and the `session-attachment-index` 27/28 baseline
  — both pre-existing per this task's own instructions, independently
  unaffected by anything in this slice.
- `packages/client/ui-science` does not compile under `tsconfig.client.json`
  — pre-existing since S2, explicitly deferred to S4 (see Browser read path
  above).

Retire this file when S4 fully lands and the Browser read path section's
surviving facts move into whatever S4 writes (a new Agent Note or the
`ui-science`/`apiproxy` package READMEs).
