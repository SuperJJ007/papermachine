# Agent Note: Science artifact domain, notebook projection, and image editing

Status: proposed

English | [中文](2026-08-22-science-artifact-domain-and-image-edit.zh.md)

## Problem

Science needs its first human content operation — region-selected image editing over an exact artifact version — plus a durable answer for how artifact data flows, artifact identity, and notebook views grow without a redesign later. The design input is the [Claude Science 0.1.25 artifact architecture snapshot](../../../../docs/evidence/2026-08-22-claude-science-artifact-architecture.md): its identity model is deliberately mirrored here wherever DSH does not already hold a stronger position. Three product constraints bound every choice below: Science becomes the deployment's default agent mode; the preset layer carries installable discipline packs on top of it; and community plugin installation (the extensions subsystem and bundle patch layers) keeps working unchanged.

This note assumes the upstream `dsh-v0.1.1-rc.2` merge as its base: multimodal DeepSeek messages (`image_url` content parts), the unified image attachment pipeline, and composer mentions all exist there.

## Decision summary

1. **The persistent kernel drivers do not change.** `kernel_python.py` / `kernel_r.R`, the six-field `RUN` frame, the FIFO response channel, fd-level output redirection, `SIGINT` interrupt semantics, and per-run `SCIENCE_ARTIFACT_DIR` stay at protocol version 1. The Host owns a run's private directory before it sends `RUN`, so every new capability lands Host-side around the kernel, never inside it.
2. **Artifact identity is the interaction currency.** Every entry point — transcript rows, gallery, viewer tabs, future library and mentions — exchanges a serializable selection `{artifactId, version}` (plus an explicit follow-latest flag where live-following is genuinely wanted). No entry point reconstructs artifact state from filenames, tool result text, or a private card cache. This is the rule that makes Claude Science's surfaces read as one product, adopted before DSH grows more entry points.
3. **Version numbers stay per-request-turn sequence; ancestry becomes an explicit field.** The [per-request-turn version decision](../../implemented/architecture/2026-08-19-artifact-version-per-request-turn.md) is unchanged for agent-produced saves. A new optional `parent: {artifactId, version}` on `ScienceArtifactVersion` records edit ancestry, populated only by operations that name an explicit baseline. Numeric order means time; `parent` means ancestry; v2 and v3 may both descend from v1.
4. **Runs gain explicit inputs.** `startRun` accepts materialized artifact-version inputs; the consumed versions are recorded on `science/run-started`. This is the dependency edge of Claude Science's `artifact_dependencies`, grounded in DSH's existing run provenance instead of a separate graph store.
5. **The notebook is a projection, never a second history.** The session notebook view and full/sliced bundle exports derive from Science events joined with transcript tool calls; nothing notebook-shaped owns durable state of its own.

## What stays fixed, and why the kernel is not touched

The drivers are deliberately dumb: stdlib/base-R only, no helper functions injected into the user namespace, no knowledge of artifacts beyond the `SCIENCE_ARTIFACT_DIR` path they export per run. Image editing needs input bytes in the run's working directory and richer capture attribution afterward — both are Host responsibilities on the two sides of the kernel exchange, reachable with zero wire changes:

- The Host writes the run directory (source file, cwd, capture files) before sending `RUN`; materialized inputs are one more pre-`RUN` write.
- Auto-capture walks `SCIENCE_ARTIFACT_DIR` after the terminal fact commits; baseline-aware attribution is one more fact at that walk.

Keeping the wire fixed also keeps every future producer cheap: a discipline pack, a human notebook-cell channel, or an import operation reuses the same `RUN` exchange and the same capture walk. Injecting save helpers into the kernel namespace was rejected: it would create a second save path outside the logged capture flow, pollute the user's namespace, and break the model-visible ⟺ logged invariant.

## Domain records

| Record | Owner | Semantics |
|---|---|---|
| Artifact (logical) | Science session projection (project catalog is a deferred seam) | Stable `ScienceArtifactId`, `logicalName`, latest-version convenience; organization metadata moves to a project catalog when that seam lands. |
| Artifact Version | `science/artifact-saved` event | Immutable content-addressed attachment plus provenance (`runId`, `toolCallId`, `requestHeaderSeq`, environment revision/fingerprint), per-request-turn numbering, and new optional `parent: {artifactId, version}` edit ancestry. |
| Dependency edge | `science/run-started` `inputs` field | Exact versions materialized into the run: `{artifactId, version, path}[]`. Consumption provenance, distinct from ancestry. |
| Notebook execution view | Projection over Science events × transcript tool calls | Cells recovered by `runId → toolCallId → args.code`, verified against `codeSha256`; kernel grouping by language and `kernelEpoch`; no persistent notebook id. |
| External content reference | Deferred | Host-file-backed content is never presented as an immutable version; materialize before citing as evidence. |
| Outcome | `science/outcome-published` (unchanged) | Evidence-backed revisions pinning exact runs, versions, and messages. |

## Data flows

### Input materialization

`StartScienceRunRequest` gains `artifactInputs?: readonly { artifactId: ScienceArtifactId; version: number; path: string }[]`. The Runtime resolves each against the live Science projection, reads the attachment through its checksummed read path, and writes it under `<runDirectory>/inputs/<path>` before the `RUN` frame is sent. `inputs/` sits outside `SCIENCE_ARTIFACT_DIR`, so materialized bytes can never be re-captured as new versions. Rejections are pre-publication `ScienceRuntimeError`s: an unresolvable version (`INPUT_NOT_FOUND`), a path that escapes or collides inside `inputs/` (`INPUT_PATH_INVALID`), or exceeding the configured byte/count bounds (`INPUT_TOO_LARGE`; new validated `Config` fields, not constants). The committed `science/run-started` carries the complete input mapping, so replay knows exactly which versions the run consumed. Run code reads `inputs/...` relative to its cwd.

### Edit baselines and capture attribution

`startRun` also gains `editBaselines?: Readonly<Record<string, { artifactId: ScienceArtifactId; version: number }>>`, keyed by capture-relative output path. At the capture walk, an output whose path has a baseline entry commits with `parent` set to that exact version: an existing logical name advances that artifact's version as usual; a new logical name opens a new artifact at version 1 whose `parent` is a cross-artifact branch edge. A stale baseline (the artifact moved past it) still commits with the named older parent — branching is visible, never silently merged, matching Claude Science's `version_of` rule that baselines are explicit and filenames are never inferred. Captures without a baseline keep today's behavior exactly, with no `parent`.

### Image editing end to end

1. The viewer's region-select entry operates on an exact open version. It emits a structured user message carrying `{artifactId, version, normalized region, instruction}` — a message, so it is durably logged and model-visible with no new event type.
2. The multimodal model reads the exact version's image bytes as an `image_url` content part, so it edits what it sees, not what it remembers.
3. The agent writes ordinary run code — spec-first regeneration for charts, pixel operations for photographic content — calling `run_python`/`run_r` with `artifact_inputs` (the version being edited, plus any data it needs) and `edit_of` naming the output path's baseline.
4. Auto-capture commits the next version with `parent` set; the viewer follows its selection to the new version and can navigate ancestry.

### Unchanged flows

Auto-capture eligibility, per-turn supersede semantics, `annotate_artifact` metadata curation (never a content version), and `publish_outcome` all keep their current contracts. The capture extension allowlist stays `.png`-only for images initially; widening to `.jpg`/`.webp` is a one-map change once a concrete need appears (the attachment store already admits those media types).

### Evidence bytes versus the upstream image pipeline

Upstream's attachment normalization (EXIF strip, sRGB, resize, format candidates) serves model consumption. Science capture is scientific evidence and must stay byte-exact: capture pins the file's source bytes; if the merged admission path normalizes, capture must use a byte-exact admission route or record the normalization as provenance. This is resolved in slice S2 against the merged API, not assumed away.

## Tool plane

`run_python`/`run_r` gain optional `artifact_inputs` and `edit_of` parameters mirroring the Runtime fields (model vocabulary: `artifactId` + `version` + relative path — ids the model already receives in capture receipts). Receipts name ancestry (`plots/fig1.png v4, edited from v2`). No dedicated edit tool: an edit is a run, and a separate tool would duplicate run semantics, kernel selection, and capture accounting for no added authority.

## Default mode and discipline presets

- Science becomes the default preset selection; the Science host rows (`science-session`, `science-runtime/with-settings`) already live in the web-app bundle's host layer, so default-mode is a preset-selection change, not a composition move.
- A discipline pack is an agent preset: the Science roster plus discipline skills, prompt sections, and its environment profile id. Presets do not stack (`recompose()` swaps whole compositions), so packs are full copies of the Science roster — the accepted-copy precedent the shipped `cordis`/`code` presets already set. An authoring helper that stamps packs from the Science base is worth adding only when copies multiply.
- `tool-cordis` stays out of the default Science agent. Community plugin capability is untouched by this design: the extensions subsystem (`cordis-host-runner`, `cordis-client-runner`, `ui-cordis`) stays host-plane in the web-app bundle, and deployment-level plugin installation continues through bundle `cordis.patch.yml` layers and user preset roots.

## Implementation slices

Each slice updates READMEs/JSDoc in the same PR, holds per-file coverage, and adds or updates a keyless assembled-app snapshot where model- or product-visible behavior changes.

1. **S1 — session schema.** `ScienceArtifactVersion.parent` and `ScienceRunStarted.inputs` in `dsh-science-session`: types, strict fold validation (a `parent` or input that does not resolve to a committed version fails loud), codec/projection/witness/checkpoint, invariant companion, unit coverage for invalid ancestry and inputs.
2. **S2 — runtime.** `artifactInputs` materialization (bounds, error codes, `inputs/` placement, run-started recording) and `editBaselines` attribution in the capture walk (existing-name advance, new-name branch, stale baseline). Resolve the byte-exact evidence route against the merged attachment API here.
3. **S3 — tools.** `artifact_inputs`/`edit_of` on both run tools, receipt and render updates, snapshot through a real runnable example.
4. **S4 — viewer entry.** Region-select on an exact version emitting the structured edit message; selection stays `{artifactId, version}` everywhere; PR carries the required GIF from the real server and model flow.
5. **S5 — notebook export.** Deterministic full/sliced bundle ZIP (`manifest.json`, `README.md`, `run.sh`, per-kernel `.ipynb`, referenced inputs/outputs) as a pure projection; no Artifact is created unless the user explicitly saves the bundle.
6. **Deferred.** Project artifact catalog seam, folders/copy/rename, anchored annotations, verification records (designed with the Reviewer), retention/GC.

## Rejected shortcuts

- **Filename as identity** — rename, copy, and cross-artifact branching all require ids independent of paths and display names.
- **Advancing a content version on title/caption changes** — curation stays metadata; readers keep a duplicate-free history.
- **Kernel-injected save or edit helpers** — a second save path outside the logged capture flow, namespace pollution, and an unlogged model-visible surface.
- **A live notebook that is a saved artifact** — execution state, derived bundles, and immutable `.ipynb` files have different identities and lifecycles.
- **A dedicated edit tool** — duplicates run semantics; the run tools carry the baseline fields instead.
- **Following latest implicitly** — transcript references, Outcome citations, diffs, and edit baselines pin exact versions; follow-latest is always an explicit flag.
