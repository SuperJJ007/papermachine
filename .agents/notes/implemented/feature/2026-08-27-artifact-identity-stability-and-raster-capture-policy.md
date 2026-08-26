# Agent Note: Artifact identity stability and raster-capture policy

Status: implemented

English | [中文](2026-08-27-artifact-identity-stability-and-raster-capture-policy.zh.md)

## Problem

Every artifact in the Science right panel flickered continuously while the assistant streamed. The session projection rebuilds on every session event; `toClientScienceProjection` rebuilt a fresh `ScienceClientArtifactVersion` object per artifact on each rebuild, and the client subscribed to the whole session snapshot with `useSession(s => s)`, which also fires on every streamed event. Downstream image and text load effects keyed their dependency arrays on the rebuilt object's identity, so an unrelated event (a streamed token, a heartbeat) reset every open artifact to its loading state and refetched its bytes.

Separately, a session log showed the model asked for one Python chart and one R chart and produced four chart artifacts: the Python spec re-saved as a second version purely to match the R spec's decimal rounding, plus a PNG render of each spec saved under `SCIENCE_ARTIFACT_DIR` "for visual QA" after installing `vl-convert`. Auto-capture has no way to distinguish a deliverable chart from a self-inspection render; both are eligible files under `SCIENCE_ARTIFACT_DIR`.

## Decision

### Identity-stable artifact loading

`projection-value.ts` memoizes `clientArtifact` in a `WeakMap` keyed by the source `ScienceArtifactVersion` object. The fold state clones its `artifacts` array on every transition (`fold-state.ts`) but never mutates an unchanged version in place, so a version's source object stays reference-stable across projections until superseded by an edit or a new version; caching on that identity keeps the derived client object identity-stable across the frequent re-projections a streaming session produces.

`ScienceArtifactImage.tsx` and `ArtifactContent.tsx`'s `useLoadedText` key their load effects on `content.versionId` instead of the `content` object itself — a version's own durable identity, stable independent of which wrapper object currently names it. `science-attachment-loader.ts` additionally memoizes both loaders by `versionId` in a bounded (64-entry, oldest-inserted-first) `Map<string, Promise<T>>`: a version's bytes are immutable once written, so a settled read is cached for the loader's lifetime and concurrent callers for the same in-flight version share one read; a rejected read is evicted immediately so a retry still re-fetches.

`ScienceDetailsView.tsx` replaced `useSession(s => s)` with `useSession(s => s, eq)`, comparing only `nodes` and `chat` — the two snapshot fields the artifact-viewer subtree actually reads — so an unrelated streaming event (composer state, queue, a running call's byte counter) does not report a change. The derived `sessionTitles` record uses the same selector-plus-`shallowEqual` pattern. `ProjectLibrary`'s React `key` dropped `libraryPage`, keeping only the artifact-list content: switching between the Artifacts and Project files pages is now a prop change, not a remount, so search/sort/path state survives the switch.

### Raster-capture declaration

Auto-capture no longer captures every `.png` unconditionally. `science-runtime`'s `Config.rasterCapture` (`'declared' | 'always'`, default `'declared'`) governs it: under `'declared'`, an otherwise-eligible `.png` is captured only when the writing run named its capture-relative path in `StartScienceRunRequest.rasterArtifacts`; under `'always'`, every eligible `.png` is captured unconditionally, matching the prior behavior and every other accepted extension. `tool-science`'s `run_python`/`run_r` gained an optional `raster_artifacts: string[]` parameter, validated by the same `safeRelativePath` rule as `edit_of`/`artifact_inputs` (`inputs.ts`), and threaded through `StartScienceRunRequest` to the capture walk (`capture.ts`'s `isRasterCaptureAllowed`). An undeclared eligible `.png` is listed in the capture result's `skippedRasterPaths`, surfaced to the model as `runOutputSchema`'s `skippedRaster` field and a rendered `formatRunResult` line naming the skipped paths — no new session event: the rendered text is already part of the durable `tool/result` message the existing tool-dispatch mechanism logs, the same mechanism that already carried `captureSkippedOversizedCount`/`captureTruncatedPerRun` with no dedicated event.

`STATIC_GUIDANCE` gained two sentences: write a self-inspection render, preview, or debug dump outside `SCIENCE_ARTIFACT_DIR` so it is never captured as an artifact, and do not open a new artifact version to reconcile a cosmetic difference the user did not ask for. A third sentence ("one chart, one artifact; no raster duplicate of a chart already saved as a spec") was considered and dropped: the declaration mechanism enforces it directly — a raster render the model does not declare is never captured, so a duplicate PNG of an already-saved Vega-Lite chart requires actively naming it in `raster_artifacts`, an unlikely accidental action.

## Alternatives considered

**Detect a self-inspection render heuristically** (file naming convention, a "debug" directory, checking whether a same-named `.vl.json` already exists) — rejected. A heuristic guesses model intent from incidental signals and fails silently in either direction (false-positive: a legitimate PNG-only chart never gets captured; false-negative: a debug render matching no heuristic still becomes an artifact). A declaration is unambiguous and the model already declares `edit_of`/`artifact_inputs` the same way.

**Cap staleness instead of keying effects on identity** (a debounce or a minimum re-render interval before an artifact resets to loading) — rejected. A debounce still flickers on a slow enough stream and adds a tunable with no natural default; keying on the version's own durable identity (`versionId`) eliminates the spurious reset instead of merely slowing it down.

## Consequences

An open artifact's image or text load survives every unrelated session event during streaming; only an actual new version (a different `versionId`) triggers a reload. The project-store attachment loaders' cache is unbounded in lifetime but bounded in entry count (64), so a long session with many distinct versions evicts the oldest rather than growing without limit.

A model that wants a PNG captured must declare it in `raster_artifacts`; an existing session log or fixture that wrote a `.png` without declaring it now sees that file skipped (`packages/science/science-runtime/tests/capture.spec.ts`, `examples/headless-agent/tests/fixtures/science-mock-llm.ts`, and `apps/web/tests/science-preset.snapshot.ts` were updated to declare it where the fixture's intent was always to capture the PNG). A deployment that wants the prior unconditional behavior sets `rasterCapture: 'always'` in `cordis.yml`.
