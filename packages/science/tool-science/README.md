# @deepseek-ai/dsh-tool-science

English | [中文](README.zh.md)

The **model-facing Science mode Consumer**: first-use mode/environment binding, the `science:environment` dynamic context, and five tools: `get_science_state`, `run_python`, `run_r`, `annotate_artifact`, `install_science_packages`. [`dsh-science-session`](../science-session) owns the durable vocabulary, strict fold, projection, and invariant; [`dsh-science-runtime`](../science-runtime) owns environment observation, private scratch, direct execution, terminal classification, auto-capture of run-written files, metadata-only artifact curation, and micromamba package installs. This package never spawns a process, writes run source, classifies termination, or manages Conda. Runtime appends environment, run, and artifact facts. Results are ordinary assistant replies, without a publication tool or separate Outcome revision.

A composition stacks, in order: `@deepseek-ai/dsh-session`, `@deepseek-ai/dsh-system-prompt`, `@deepseek-ai/dsh-tools`, `@deepseek-ai/dsh-science-session` plus its `/invariant`, `@deepseek-ai/dsh-science-artifact-store`, a host-local subprocess and sandbox provider, `@deepseek-ai/dsh-science-runtime` (configured with `dshHome` and `profiles`) plus its `/invariant`, then this package (configured with `profileId`, `modeRevision`, and `stateHistoryLimit`) plus its own `/invariant`.

The package also owns the `scienceEdits` Typert Remote used by the artifact viewer. Web Hosts mount its `./edit-service` entry in the Host root where the Typert Gateway resolves Remote services; the preset-scoped package root remains the model-facing Consumer and publishes no service. The entry injects `attachments`, `scienceArtifactStore`, and `scienceRuntime` so it can admit exact committed PNGs and direct chart operations. `submit` accepts a non-empty ordered array of `ScienceEditTarget`s (a normalized raster region or a `ScienceElementTarget` carrying one chart element's id, kind, axes, label, and bounded current-value summary) plus one instruction. Each target may carry an element comment, validated and trimmed by the same text rules as the instruction. It strictly folds the addressed live Agent's complete session and validates every target's current committed version before it queues one structured user message; a region target additionally requires a raster media type, while an element target must exactly match an entry in that version's addressable chart catalog. Any failure identifies the target position and prevents partial admission. Repeated region targets against the same version reuse one minted image; an element target reads neither the store nor mints one. A stale selection rejects as `SCIENCE_EDIT_STALE_VERSION`, and a media or catalog mismatch rejects as `SCIENCE_EDIT_TARGET_MISMATCH`; the method never substitutes the latest version. The message source preserves `{ kind: 'science-edit', targets, instruction }`, including each artifact's authoritative logical name. Its text requires the model to use every exact version in the corresponding `artifact_inputs` and `edit_of`; each selected raster version adds its minted image in target order, and each element target renders as a structured `element("id", kind=..., axes=..., label=..., current=...)` descriptor with no image.

`scienceEdits.applyChartOps` forwards an exact `{ artifactId, version, ops }` request and cancellation signal to `ctx.scienceRuntime.applyChartEdit`. Its receipt names the committed `origin: 'human-edit'` version and any indexed partial failures. It maps stale, unaddressable, and invalid or wholly unresolved operations to `CHART_STALE`, `CHART_NOT_ADDRESSABLE`, and `CHART_OP_INVALID`; the Runtime remains the only validator. Model-facing artifact values rebuild the cumulative direct-edit count and recent operation/target summaries from the project artifact store's PNG-only `figure_state`; operation arguments remain hidden.

`scienceEdits.saveArtifactAs` forwards a store `sourceVersionId` and a `newLogicalName` to `ctx.scienceRuntime.saveArtifactAs`, returning the new artifact's `{ artifactId, logicalName, version }`. A viewer-only operation — this package registers no model tool for it. It translates the Runtime's `ARTIFACT_VERSION_NOT_FOUND`/`ARTIFACT_LOGICAL_NAME_CONFLICT` rejections onto `SAVE_AS_SOURCE_NOT_FOUND`/`SAVE_AS_NAME_CONFLICT` and passes every other Runtime error through unchanged, matching `applyChartOps`'s own translation shape.

`ctx.scienceRuntime` is optional from this package's own `inject` — it statically injects only `tools` and `systemPrompt`, and reads `ctx.get('scienceRuntime')` at the first operation that needs it (first-use binding, each `run_python`/`run_r` call, and `annotate_artifact`). A deployment that omits the Runtime still loads this package; assembly for a `science`-preset session then rejects with a clear error instead of silently degrading.

Edit guidance identifies `artifactId` as the UUID in capture receipts and `get_science_state`, never a file name.

## Config

All three keys are required; none has a default or an environment-discovered value. This package supplies no shipped production identity or history policy.

| Key | Meaning |
|---|---|
| `profileId` | Selects one allowlist entry in the composed `ctx.scienceRuntime`'s `profiles` config. Validated against the durable Science safe-ID grammar (`^[A-Za-z0-9][A-Za-z0-9._-]*$`, ≤128 characters). |
| `modeRevision` | Deployment-owned revision of the Science mode contract, persisted in every session's `ScienceModeRef`. Trimmed, non-empty, ≤128 characters. |
| `stateHistoryLimit` | Positive safe-integer maximum applied independently to recent runs, artifact versions, and per-artifact direct-edit summaries. |

## First model request

On the first real Science prompt assembly for an Agent whose session currently resolves to the `science` preset (`@deepseek-ai/dsh-agent-presets`'s `resolveSessionPreset`: the session's creation header, overridden by the last `agent-preset/selected` event — a session switched to `science` while blank qualifies even though its header still names the preset it was created with), this package replays the session. If `science/mode-bound` is absent, it appends one before any `step/start`, `request/header`, or `tool/call` — the durable Science Session applicability rule enforces that ordering independently. An existing mode's revision must equal the configured `modeRevision`; a mismatch rejects assembly before a request is built. If no durable environment exists, it calls `ctx.scienceRuntime.bindEnvironment({ session, profileId, signal })`; a durably applied or `invalid` result is a model-visible value either way, while a missing Runtime, cancellation, timeout, Host I/O failure, or confinement failure rejects assembly instead. A matching resumed session performs no automatic rebind — replay alone confirms both facts already hold. Diagnostic prompt assembly with no initiating Agent, or a non-`science`-preset session, performs no Host I/O and never appends a Science event.

After binding, this package re-renders the `science:environment` context from the just-committed projection and replaces that one named entry inside the assembly already in progress, before delegating exactly once through the `system-prompt/assemble` waterfall. The agent loop then records that current context as a `user/message` before `request/header`, so the first request — and every retried request within the same step — remains reconstructable from the session log.

## Tools

| Tool | Arguments | Behavior |
|---|---|---|
| `get_science_state` | none | Returns a sanitized, bounded view of the session's durable Science projection: mode, model-safe environment facts, recent run and artifact-version histories, bounded PNG direct-edit summaries, omitted counts and total metrics. Rejects if Science mode is not yet bound. |
| `run_python` | `code` (non-empty string), optional `artifact_inputs`, optional `edit_of`, optional `raster_artifacts` | Runs `code` in this session's persistent Python kernel through `ctx.scienceRuntime.startRun`, forwarding the tool's cancellation signal. `artifact_inputs` materializes exact `{artifactId, version}` values at paths below `SCIENCE_INPUT_DIR`; `edit_of` maps capture-relative output paths to exact parent versions; `raster_artifacts` names the capture-relative `.png` paths this run declares for auto-capture under the Runtime's default `rasterCapture: 'declared'` policy. A declared PNG saved with `fig.savefig()` or `plt.savefig()` keeps addressable matplotlib chart state when extraction succeeds. Its result lists any files auto-capture durably saved from this run and any undeclared `.png` it left uncaptured (§ Run result). |
| `run_r` | `code` (non-empty string), optional `artifact_inputs`, optional `edit_of`, optional `raster_artifacts` | Applies the same exact-version input, edit-parent, and raster-declaration behavior to this session's persistent R kernel. A declared PNG saved with `ggsave()` keeps addressable ggplot2 chart state when extraction succeeds. |
| `annotate_artifact` | `logical_name`, optional `version`, `title`, optional `caption` | Adds a title/caption to an artifact `dsh-science-runtime`'s auto-capture already durably saved, through `ctx.scienceRuntime.annotateArtifact`; metadata-only, so it retitles the version it names rather than committing a version whose bytes repeat their predecessor's. If the logical name instead identifies an eligible PNG left uncaptured in a retained run directory, the error tells the model to rerun the writing code with that path declared in `raster_artifacts`; annotation does not capture or import it. Its text receipt identifies a known producer as `run_python`/`run_r` plus turn number, never by internal run id. |
| `install_science_packages` | `language` (`python`/`r`), `packages` (non-empty array of conda-forge specs) | Installs into this session's bound environment through `ctx.scienceRuntime.installPackages`, forwarding the tool's cancellation signal. Requires a deployment with a configured installer (`micromambaPath`/`installChannels`); otherwise rejects with the Runtime's `INSTALLER_NOT_CONFIGURED` message. Returns `status`, the fresh environment revision on success, and bounded `stdout`/`stderr`; a successful install takes effect only on that language's next `run_python`/`run_r` call, which restarts the kernel and loses whatever it currently holds in memory (§ Install result). |

Direct top-level dispatch, the latest `request/header`, and the exact tool-call ID are required by `run_python`, `run_r`, and `annotate_artifact`; nested Code Mode dispatch rejects before Runtime lookup or Session mutation. `install_science_packages` requires only direct top-level dispatch — it carries no `toolCallId`/`requestHeaderSeq` provenance of its own, matching `bindEnvironment`'s own whole-value environment append. A durably committed run terminal state is a structured canonical value with bounded output. Artifact success values render useful text for every client; `run_python`/`run_r` and `annotate_artifact` additionally preserve one tagged, versioned presentation value per captured or curated artifact (any accepted media type) for the dedicated Web rows. All five tools use generic render intent with no editor locations — `install_science_packages` included, since no Host path may leak into an `args`-only presenter.

## Model Experience

### Static tool guidance

#### What the model sees

This package contributes one fixed static section describing the run tools' process model, state-persistence rule, and failure/error distinction, quoted verbatim below; each of `run_python`/`run_r`'s own tool description carries the same persistence rule in language-specific terms — the restart causes, the "next run result says so" pointer to the run-result kernel fact described under Run Result, and the inline-install/environment-install distinction (`pip install`/`install.packages()` live and die with the kernel; `install_science_packages` persists a package into the environment across kernels, described under Install result below).

##### Science tool guidance

```markdown
Use run_python or run_r to execute source in the session's bound Science environment. Each language has one persistent kernel per session: variables, imports, and definitions stay in memory across calls to that language's run tool until the kernel restarts (idle timeout, environment re-bind, interrupt escalation, crash, or session end). A run result names the reason right after a restart. Store anything that must survive a kernel restart under SCIENCE_STATE_DIR; store final output files under SCIENCE_ARTIFACT_DIR; artifact_inputs materialize under SCIENCE_INPUT_DIR. The current directory is a private scratch directory that is not captured; write outputs under SCIENCE_ARTIFACT_DIR, and access workspace files through SCIENCE_WORKSPACE_DIR or an absolute path. When modifying or regenerating an existing artifact, reference its exact version through edit_of for a direct edit or artifact_inputs for an input, and write the output to the same relative path under SCIENCE_ARTIFACT_DIR so automatic capture appends the existing version chain. artifactId is the UUID printed in the capture receipt and by get_science_state, never the file name. A terminal program failure (exception, error condition, timeout) is a result to inspect in the returned stdout/stderr, not a tool malfunction. A tool error result means no trustworthy run occurred: nothing executed, or its outcome could not be confirmed. Use get_science_state to read the current mode, environment, kernel state, and run history without starting a run. Make charts with matplotlib (Python) or ggplot2 (R), save each one as a PNG under SCIENCE_ARTIFACT_DIR, and name it in raster_artifacts so it is captured. Do not use Altair or Vega-Lite. Save matplotlib figures with fig.savefig()/plt.savefig() and ggplot2 charts with ggsave(); figures saved that way stay addressable for direct edits in the viewer. A run's eligible written files (csv/json/md/txt under SCIENCE_ARTIFACT_DIR) are durably captured automatically as versioned artifacts, and a PNG only when named in raster_artifacts; no separate save step is needed otherwise. If a result says a PNG was not captured, rerun the code that writes it and declare the same path in raster_artifacts. Use annotate_artifact to give the artifact that best demonstrates your result a human-readable title and optional caption, so it is highlighted for the reader. Write a render, preview, or debug dump meant only for your own inspection outside SCIENCE_ARTIFACT_DIR (for example a temp directory), never into it, so it is never captured as an artifact. Do not open a new artifact version to reconcile a cosmetic difference the user did not ask for; mention the difference in your reply instead. Use install_science_packages to persist a package into the bound environment across kernel restarts; an in-kernel pip install/install.packages() only lasts until the current kernel restarts.
```

#### Token effect

Fixed guidance cost per request while the plugin is active; this section and the two run-tool descriptions grew by the persistence rule's sentences relative to the prior one-shot-process wording, and again by one sentence each naming `install_science_packages`, each a one-time fixed increase, not a per-run one. `install_science_packages`'s own schema is a further fixed per-request addition, described under Tool schemas below.

#### KV Cache effect

Prefix-stable while the guidance text is unchanged; plugin lifecycle may invalidate reuse from this section.

### `science:environment` dynamic context

#### What the model sees

For a `science`-preset session, the current mode revision; the bound environment's profile, revision, and status; each configured interpreter's capability plus its version and truncated fingerprint when available; the latest run's id, language, and status when one exists; and the fixed kernel-persistence/restart rule (which now names the same restart causes as the static guidance) plus the `SCIENCE_STATE_DIR`/`SCIENCE_ARTIFACT_DIR`/`SCIENCE_INPUT_DIR` split. It omits Runtime-owned free-text reasons, source, stdout, stderr, credentials, and Host path/identity fields, and — deliberately, to keep this always-rendered block small and stable — current kernel state itself; that lives in the run-result restart fact and in `get_science_state`'s bounded `kernels` list, read on demand rather than resent on every turn. Outside Science mode, or for a diagnostic assembly with no initiating Agent, it renders `''` and contributes nothing.

#### Token effect

Bounded: one mode line, one environment line, up to two interpreter lines, and one latest-run line. Unchanged between requests, it adds no further tokens; a changed environment or new run replaces the whole snapshot.

#### KV Cache effect

Append-only while the rendered snapshot is unchanged: [`dsh-agent-loop`](../../core/agent-loop) appends a fresh `user/message` copy only when the context actually changed, was compacted away, or a retried request needs it restored — never on every step. A changed snapshot invalidates reuse from the first changed token, matching every other dynamic runtime context.

### Tool schemas

#### What the model sees

The model sees the generated [`get_science_state`, `run_python`, `run_r`, `annotate_artifact`, `install_science_packages` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-science). They are registered unconditionally by this package whenever it is composed, independent of whether the composed Runtime has a configured installer; the built-in `science` agent preset (`apps/cli/config/agent-presets/science`) is the shipped composition that does so.

#### Token effect

Fixed schema cost on every request in this plugin's registration scope.

#### KV Cache effect

Prefix-stable while the visible tool definitions and order are unchanged. Plugin lifecycle may invalidate reuse from the first changed schema token.

### Viewer edit message

#### What the model sees

An admitted artifact-viewer edit is one ordinary user turn. Its text lists an ordered, non-empty set of targets, each target's logical artifact and exact version plus any element comment, one instruction, and the requirement to use each version as the corresponding `artifact_inputs` source and `edit_of` parent. The durable `science-edit` source preserves `{ targets, instruction }`; every raster target supplies its exact selected image attachment in target order, while an element target contributes no image.

#### Token effect

Bounded by fixed framing text, the validated target list and instruction, and one image attachment per raster target. The message remains in request history until compaction.

#### KV Cache effect

Append-only; the message follows the reusable request prefix like any other user follow-up.

### Viewer review notes

#### What the model sees

Nothing. `ScienceEditService.addArtifactNote` and `removeArtifactNote` are dedicated Host Remotes for user-only viewer state. Add validates an exact session-visible store `ScienceArtifactId` and version, trims plain text, and rejects more than 8,192 characters with `SCIENCE_EDIT_INVALID_REQUEST`; remove requires the active add-event sequence to belong to that artifact. Both append ignorable non-surface events and queue no agent follow-up.

#### Token effect

None; review notes never enter model requests.

#### KV Cache effect

None; review note mutations do not change the model-visible prefix.

### Run result

#### What the model sees

When this run is the first one recorded under a kernel epoch that followed an earlier epoch for the same language, a leading line states the fact: `kernel restarted (<reason>): variables from earlier runs are gone`, `<reason>` one of `idle timeout`, `environment re-bind`, `interrupt escalation`, `kernel crash`, `session end`, or the two internal-failure phrases for `protocol`/`service-disposed` — the only kernel fact a run result states, and only when it is informative (a language's very first epoch, and every later run reusing its own kernel, add nothing here). Every run then renders `status: <status>`, then `failureCode`/`failureMessage` lines when present, then `--- stdout ---`/`--- stderr ---` sections each showing the captured text or `(empty)`, with a `(stdout truncated)`/`(stderr truncated)` line when the Runtime's capture bound was reached. When capture ran synchronously and produced new versions, a trailing line lists each artifact's logical name, version, stable artifact id, media type, and byte count: `` Captured 2 artifacts: `summary.csv` v1 (artifact-a; text/csv, 4.1 KB), `plots/loss.png` v4 (artifact-b; image/png, 812.0 B). `` An explicit `edit_of` baseline appends `edited from <logicalName> v<N>` to that artifact; an ordinary later version appends `continues v<N>`. Each PNG with direct edits adds `N direct edits: op (target), ...`; the complete count is retained while at most `stateHistoryLimit` recent operation/target pairs are listed, and operation arguments stay hidden. Media type, byte count, lineage, and edit summaries come from the project artifact store; `content_origin`/curation status and the store's internal version id ride the structured value for the Client presentation row but are not printed in this text. An `edit_of` entry whose named output path the run did not actually write, or whose written bytes are byte-identical to that artifact's current version, is silently dropped: capture commits no new version for that path, so neither this receipt nor the durable log records the declared parent. Under the default `rasterCapture: 'declared'` policy, an eligible `.png` this run wrote but did not name in `raster_artifacts` renders a further trailing line naming it and the language-specific recovery call: `` (1 PNG file not captured, not declared in raster_artifacts: debug/preview.png; to capture, call run_python again with raster_artifacts: ["debug/preview.png"] and code that writes it) ``. Because output directories are per-run, a later empty run cannot recover the earlier file. A skipped-oversized count and per-run/per-session truncation flags render as further trailing lines when set. A non-success run status is a first-class result to read, not an error; the receipt derives entirely from the run's own bounded output fields, so it cannot drift from the durable `science/artifact-saved`/`science/kernel-state` events it describes.

#### Token effect

Bounded by the Runtime's stdout/stderr capture limits plus `captureMaxFilesPerRun` captured-artifact entries, plus one short line on the rare run that follows a kernel restart; the retained call and result are resent until compaction.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Install result

#### What the model sees

`install_science_packages` renders `status: <status>`. On `'success'` a second line states plainly that the fresh revision is not in effect yet: `environment revision <n> applied — this takes effect on the next run_python/run_r call for this language, not now: that call restarts the kernel (an environment re-bind) and every variable, import, and definition it currently holds in memory is lost then`. Every status then renders `--- stdout ---`/`--- stderr ---` sections showing the installer's captured text or `(empty)`, with `(stdout truncated)`/`(stderr truncated)` lines when the Runtime's capture bound was reached. A non-success status (`'failed'`, `'timed-out'`, `'cancelled'`) is a first-class result to read, matching every other Science tool's failure/error distinction; it appends no environment revision and durably changes nothing. The receipt never names a configured channel URL, the micromamba executable path, or which configured channel the successful attempt used — those are Runtime-owned deployment facts, not something the model reasons about.

#### Token effect

Bounded by the Runtime's stdout/stderr capture limits; the retained call and result are resent until compaction.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Science state result

#### What the model sees

`get_science_state` JSON-renders a sanitized, bounded view of the replayed projection: `mode`; model-safe `environment` identity, status, capabilities, versions, and fingerprint previews; the most recent `runs` with path-bearing Runtime-owned free text removed (each carrying its own `kernelEpoch`, the provenance fact that two runs sharing an epoch shared the kernel's in-memory state); the most recent `kernels`, each with `language`, `kernelEpoch`, `state` (`running`/`exited`/`interrupted`, model vocabulary for the durable `started`/`exited` transition plus the replay-derived interruption), `reason` (present only when `exited`, the same restart-cause vocabulary as the run-result kernel fact), and `startedAt`; the most recent `artifacts` (identity, title/caption as the model saw them, `contentOrigin` (`'run-auto' | 'human-edit' | 'import'`, read from the project artifact store's current version row — the sole authority for content provenance since the artifact-authority migration), `curated` (whether a model or human annotation has replaced the auto-capture title), media type, byte count, `seenAt`, and for PNGs the complete `editCount` plus at most `stateHistoryLimit` recent operation/target summaries; never operation arguments, the store's internal version id, content checksum, project id, or which actor wrote the current annotation); `metrics`; `history.runsOmitted`, `history.kernelsOmitted`, and `history.artifactVersionsOmitted`; and `lastScienceEventSeq`. It never returns configured/canonical prefixes, executable paths or identity, Conda history hashes, Runtime-owned free-text reasons, credentials, source, stdout, or stderr. Artifact titles/captions remain model- or capture-authored durable content, not Host observation fields. `metrics` is an explicit field selection over the durable projection's counters (`runCount`, `successfulRunCount`, `artifactCount`, `artifactVersionCount`), not a verbatim passthrough — a deliberate choice so a future Host-side counter needs a reviewed addition here before it reaches the model. The durable `kernelCount` counter is intentionally not selected: `kernels`/`history.kernelsOmitted` already state the same fact per-kernel, in model vocabulary, and in full; a redundant raw count would spend tokens without adding information and could read inconsistently against a `kernels` list bounded by a smaller `stateHistoryLimit`.

#### Token effect

Bounded independently to `stateHistoryLimit` recent run, kernel, and artifact-version items and recent direct edits per artifact; durable codecs bound every retained item. `metrics`, `history`, and each `editCount` retain totals without returning omitted values.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Artifact results

#### What the model sees

`annotate_artifact` renders the stable artifact id, logical name, version, content origin, curation status, title, optional caption, producer as `produced by run_python (turn N)` or `produced by run_r (turn N)` when the producing run is present in this session, media type, byte count, and bounded direct-edit summary. It never emits file bytes, an image content block, internal run id, store version id, content checksum, or project id. Its tagged client presentation value (like `run_python`/`run_r`'s) is not model-visible content — it rides `tool/result.meta`, read only by `dsh-client-ui-science`'s dedicated rows.

#### Token effect

Bounded by the artifact receipt fields and `stateHistoryLimit` recent direct edits; retained call/results are resent until compaction.

#### KV Cache effect

Append-only; newly visible result text follows the reusable request prefix.

### Tool errors

#### What the model sees

Configuration and precondition failures are normalized as `Error: <message>`. They distinguish missing initiating Agent/preset/mode/request header/Runtime, an unconfigured installer, empty source, nested mutation dispatch, duplicate `edit_of` paths, unresolved or invalid artifact inputs/edit parents/raster artifact paths, and an unknown artifact `logical_name`/`version`.

#### Token effect

Only a failing call adds these retained tokens.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **No owned composition, no default Runtime** — this package composes no preset, CLI/Web profile row, or Runtime configuration itself; the built-in `science` agent preset and Web Host's `./edit-service` row are separate application-layer composition, and `ctx.scienceRuntime` remains explicit deployment configuration every Host mounts on its own. See the [R3](../../../.agents/notes/implemented/feature/2026-08-16-dsh-science-v01-r3-science-tools.md) and [R4](../../../.agents/notes/implemented/feature/2026-08-16-dsh-science-v01-r4-science-preset.md) Agent Notes.
- **No publication workflow** — the model answers in the conversation; there is no separate Outcome editor or publication tool.
