# @deepseek-ai/dsh-tool-science

English | [中文](README.zh.md)

The **model-facing Science mode Consumer**: first-use mode/environment binding, the `science:environment` dynamic context, and five tools: `get_science_state`, `run_python`, `run_r`, `annotate_artifact`, and `publish_outcome`. [`dsh-science-session`](../science-session) owns the durable vocabulary, strict fold, projection, and invariant; [`dsh-science-runtime`](../science-runtime) owns environment observation, private scratch, direct execution, terminal classification, auto-capture of run-written files, and metadata-only artifact curation. This package never spawns a process, writes run source, classifies termination, or manages Conda. It appends `science/outcome-published` directly after durable evidence validation because Outcome publication needs no Host operation; Runtime appends the remaining environment, run, and artifact facts.

A composition stacks, in order: `@deepseek-ai/dsh-session`, `@deepseek-ai/dsh-system-prompt`, `@deepseek-ai/dsh-tools`, `@deepseek-ai/dsh-science-session` plus its `/invariant`, a host-local subprocess and sandbox provider, `@deepseek-ai/dsh-science-runtime` (configured with `dshHome` and `profiles`) plus its `/invariant`, then this package (configured with `profileId`, `modeRevision`, and `stateHistoryLimit`) plus its own `/invariant`.

`ctx.scienceRuntime` is optional from this package's own `inject` — it statically injects only `tools` and `systemPrompt`, and reads `ctx.get('scienceRuntime')` at the first operation that needs it (first-use binding, each `run_python`/`run_r` call, and `annotate_artifact`). A deployment that omits the Runtime still loads this package; assembly for a `science`-preset session then rejects with a clear error instead of silently degrading. `publish_outcome` remains usable over already-durable evidence without Runtime access.

## Config

All three keys are required; none has a default or an environment-discovered value. This package supplies no shipped production identity or history policy.

| Key | Meaning |
|---|---|
| `profileId` | Selects one allowlist entry in the composed `ctx.scienceRuntime`'s `profiles` config. Validated against the durable Science safe-ID grammar (`^[A-Za-z0-9][A-Za-z0-9._-]*$`, ≤128 characters). |
| `modeRevision` | Deployment-owned revision of the Science mode contract, persisted in every session's `ScienceModeRef`. Trimmed, non-empty, ≤128 characters. |
| `stateHistoryLimit` | Positive safe-integer maximum applied independently to the recent runs and artifact versions returned by each `get_science_state` call. |

## First model request

On the first real Science prompt assembly for an Agent whose session currently resolves to the `science` preset (`@deepseek-ai/dsh-agent-presets`'s `resolveSessionPreset`: the session's creation header, overridden by the last `agent-preset/selected` event — a session switched to `science` while blank qualifies even though its header still names the preset it was created with), this package replays the session. If `science/mode-bound` is absent, it appends one before any `step/start`, `request/header`, or `tool/call` — the durable Science Session applicability rule enforces that ordering independently. An existing mode's revision must equal the configured `modeRevision`; a mismatch rejects assembly before a request is built. If no durable environment exists, it calls `ctx.scienceRuntime.bindEnvironment({ session, profileId, signal })`; a durably applied or `invalid` result is a model-visible value either way, while a missing Runtime, cancellation, timeout, Host I/O failure, or confinement failure rejects assembly instead. A matching resumed session performs no automatic rebind — replay alone confirms both facts already hold. Diagnostic prompt assembly with no initiating Agent, or a non-`science`-preset session, performs no Host I/O and never appends a Science event.

After binding, this package re-renders the `science:environment` context from the just-committed projection and replaces that one named entry inside the assembly already in progress, before delegating exactly once through the `system-prompt/assemble` waterfall. The agent loop then records that current context as a `user/message` before `request/header`, so the first request — and every retried request within the same step — remains reconstructable from the session log.

## Tools

| Tool | Arguments | Behavior |
|---|---|---|
| `get_science_state` | none | Returns a sanitized, bounded view of the session's durable Science projection: mode, model-safe environment facts, recent run and artifact-version histories, omitted counts, outcome, and total metrics. Rejects if Science mode is not yet bound. |
| `run_python` | `code` (non-empty string), optional `artifact_inputs`, optional `edit_of` | Runs `code` in this session's persistent Python kernel through `ctx.scienceRuntime.startRun`, forwarding the tool's cancellation signal. `artifact_inputs` materializes exact `{artifactId, version}` values at paths below `SCIENCE_INPUT_DIR`; `edit_of` maps capture-relative output paths to exact parent versions. Its result lists any files auto-capture durably saved from this run (§ Run result). |
| `run_r` | `code` (non-empty string), optional `artifact_inputs`, optional `edit_of` | Applies the same exact-version input and edit-parent behavior to this session's persistent R kernel. |
| `annotate_artifact` | `logical_name`, optional `version`, `title`, optional `caption` | Adds a title/caption to an artifact `dsh-science-runtime`'s auto-capture already durably saved, through `ctx.scienceRuntime.annotateArtifact`; metadata-only, so it retitles the version it names rather than committing a version whose bytes repeat their predecessor's. Returns a text receipt, never file bytes. |
| `publish_outcome` | `title`, `summary_markdown`, non-empty `evidence` | Appends the next contiguous Outcome revision after resolving unique prior run/artifact/message references and deriving their environment revisions. |

The four mutation tools require direct top-level dispatch, the latest `request/header`, and the exact tool-call ID; nested Code Mode dispatch rejects before Runtime lookup or Session mutation. A durably committed run terminal state is a structured canonical value with bounded output. Artifact and Outcome success values render useful text for every client; `run_python`/`run_r` and `annotate_artifact` additionally preserve one tagged, versioned presentation value per captured or curated artifact (any accepted media type) for the dedicated Web rows. All five tools use generic render intent with no editor locations.

## Model Experience

### Static tool guidance

#### What the model sees

This package contributes one fixed static section describing the run tools' process model, state-persistence rule, and failure/error distinction, quoted verbatim below; each of `run_python`/`run_r`'s own tool description carries the same persistence rule in language-specific terms — the restart causes, the "next run result says so" pointer to the run-result kernel fact described under Run Result, and the inline-install/environment-install distinction (`pip install`/`install.packages()` live and die with the kernel; installing into the environment is a separate, longer-lived operation the desktop-provisioning track owns).

##### Science tool guidance

```markdown
Use run_python or run_r to execute source in the session's bound Science environment. Each language has one persistent kernel per session: variables, imports, and definitions stay in memory across calls to that language's run tool until the kernel restarts (idle timeout, environment re-bind, interrupt escalation, crash, or session end). A run result names the reason right after a restart. Store anything that must survive a kernel restart under SCIENCE_STATE_DIR; store final output files under SCIENCE_ARTIFACT_DIR; artifact_inputs materialize under SCIENCE_INPUT_DIR. A terminal program failure (exception, error condition, timeout) is a result to inspect in the returned stdout/stderr, not a tool malfunction. A tool error result means no trustworthy run occurred: nothing executed, or its outcome could not be confirmed. Use get_science_state to read the current mode, environment, kernel state, and run history without starting a run. A run's eligible written files (csv/json/md/png/txt under SCIENCE_ARTIFACT_DIR) are durably captured automatically as versioned artifacts; no separate save step is needed. Use annotate_artifact to give the artifact that best demonstrates your result a human-readable title and optional caption, so it is highlighted for the reader. Use publish_outcome to publish the current result as a titled, cited Outcome revision once evidence (successful runs, saved artifact versions, and/or prior messages) supports it.
```

#### Token effect

Fixed guidance cost per request while the plugin is active; this section and the two run-tool descriptions grew by the persistence rule's sentences relative to the prior one-shot-process wording, a one-time fixed increase, not a per-run one.

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

The model sees the generated [`get_science_state`, `run_python`, `run_r`, `annotate_artifact`, and `publish_outcome` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-science). They are registered unconditionally by this package whenever it is composed; the built-in `science` agent preset (`apps/cli/config/agent-presets/science`) is the shipped composition that does so.

#### Token effect

Fixed schema cost on every request in this plugin's registration scope.

#### KV Cache effect

Prefix-stable while the visible tool definitions and order are unchanged. Plugin lifecycle may invalidate reuse from the first changed schema token.

### Run result

#### What the model sees

When this run is the first one recorded under a kernel epoch that followed an earlier epoch for the same language, a leading line states the fact: `kernel restarted (<reason>): variables from earlier runs are gone`, `<reason>` one of `idle timeout`, `environment re-bind`, `interrupt escalation`, `kernel crash`, `session end`, or the two internal-failure phrases for `protocol`/`service-disposed` — the only kernel fact a run result states, and only when it is informative (a language's very first epoch, and every later run reusing its own kernel, add nothing here). Every run then renders `status: <status>`, then `failureCode`/`failureMessage` lines when present, then `--- stdout ---`/`--- stderr ---` sections each showing the captured text or `(empty)`, with a `(stdout truncated)`/`(stderr truncated)` line when the Runtime's capture bound was reached. When capture ran synchronously and produced new versions, a trailing line lists each artifact's logical name, version, stable artifact id, media type, optional dimensions, and byte count: `` Captured 2 artifacts: `summary.csv` v1 (artifact-a; text/csv, 4.1 KB), `plots/loss.png` v4 (artifact-b; image/png, 812x600, edited from artifact-b v2). `` An artifact with explicit ancestry also names its exact parent id and version. An `edit_of` entry whose named output path the run did not actually write, or whose written bytes are byte-identical to that artifact's current version, is silently dropped: capture commits no new version for that path, so neither this receipt nor the durable log records the declared parent. A skipped-oversized count and per-run/per-session truncation flags render as further trailing lines when set. A non-success run status is a first-class result to read, not an error; the receipt derives entirely from the run's own bounded output fields, so it cannot drift from the durable `science/artifact-saved`/`science/kernel-state` events it describes.

#### Token effect

Bounded by the Runtime's stdout/stderr capture limits plus `captureMaxFilesPerRun` captured-artifact entries, plus one short line on the rare run that follows a kernel restart; the retained call and result are resent until compaction.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Science state result

#### What the model sees

`get_science_state` JSON-renders a sanitized, bounded view of the replayed projection: `mode`; model-safe `environment` identity, status, capabilities, versions, and fingerprint previews; the most recent `runs` with path-bearing Runtime-owned free text removed (each carrying its own `kernelEpoch`, the provenance fact that two runs sharing an epoch shared the kernel's in-memory state); the most recent `kernels`, each with `language`, `kernelEpoch`, `state` (`running`/`exited`/`interrupted`, model vocabulary for the durable `started`/`exited` transition plus the replay-derived interruption), `reason` (present only when `exited`, the same restart-cause vocabulary as the run-result kernel fact), and `startedAt`; the most recent `artifacts` (every captured media type, `origin: 'auto' | 'model'`, `width`/`height` present only for an image); `outcome`; `metrics`; `history.runsOmitted`, `history.kernelsOmitted`, and `history.artifactVersionsOmitted`; and `lastScienceEventSeq`. It never returns configured/canonical prefixes, executable paths or identity, Conda history hashes, Runtime-owned free-text reasons, credentials, source, stdout, or stderr. Artifact titles/captions and Outcome text remain model- or capture-authored durable content, not Host observation fields. `metrics` is an explicit field selection over the durable projection's counters (`runCount`, `successfulRunCount`, `artifactCount`, `artifactVersionCount`, `outcomeRevision`), not a verbatim passthrough — a deliberate choice so a future Host-side counter needs a reviewed addition here before it reaches the model. The durable `kernelCount` counter is intentionally not selected: `kernels`/`history.kernelsOmitted` already state the same fact per-kernel, in model vocabulary, and in full; a redundant raw count would spend tokens without adding information and could read inconsistently against a `kernels` list bounded by a smaller `stateHistoryLimit`.

#### Token effect

Bounded independently to `stateHistoryLimit` recent run, kernel, and artifact-version items; durable codecs bound every retained item. `metrics` and `history` report total and omitted counts without returning the omitted values.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Artifact and Outcome results

#### What the model sees

`annotate_artifact` renders the stable artifact id, logical name, version, title, optional caption, source run, media type, dimensions when the curated version is an image, byte count, and creation time as text; it never emits file bytes or an image content block. `publish_outcome` renders the revision, title, Markdown summary, and each run/artifact/message evidence reference. Neither tool's tagged client presentation value (nor `run_python`/`run_r`'s) is model-visible content — it rides `tool/result.meta`, read only by `dsh-client-ui-science`'s dedicated rows.

#### Token effect

Bounded by the artifact receipt fields and the durable Outcome title, summary, and evidence limits; retained call/results are resent until compaction.

#### KV Cache effect

Append-only; newly visible result text follows the reusable request prefix.

### Tool errors

#### What the model sees

Configuration and precondition failures are normalized as `Error: <message>`. They distinguish missing initiating Agent/preset/mode/request header/Runtime, empty source or publication fields, nested mutation dispatch, duplicate `edit_of` paths, unresolved or invalid artifact inputs/edit parents, an unknown artifact `logical_name`/`version`, and invalid or duplicate Outcome evidence.

#### Token effect

Only a failing call adds these retained tokens.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **No owned composition, no default Runtime** — this package composes no preset, CLI/Web profile row, or Runtime configuration itself; the built-in `science` agent preset that ships with `apps/cli` (`apps/cli/config/agent-presets/science`) is a separate application-layer composition, and `ctx.scienceRuntime` remains explicit deployment configuration every Host mounts on its own. See the [R3](../../../.agents/notes/implemented/feature/2026-08-16-dsh-science-v01-r3-science-tools.md) and [R4](../../../.agents/notes/implemented/feature/2026-08-16-dsh-science-v01-r4-science-preset.md) Agent Notes.
- **No chart specification or Outcome editor** — the model produces output files in Python/R and publishes immutable evidence-backed Outcome revisions; this package does not provide a plotting grammar or mutable report document.
