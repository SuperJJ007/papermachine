# Science Runtime

English | [中文](science.zh.md)

The Science family owns seven required-on-read Session events, the host-local Runtime that produces environment/run/artifact facts, the model-facing Consumer, and browser transcript presentation. [`dsh-science-session`](../../packages/science/science-session) strictly validates the complete durable values, exposes a client-safe `science` Session projection, and registers artifact attachment extraction. [`dsh-science-runtime`](../../packages/science/science-runtime) owns `ctx.scienceRuntime`: it observes configured existing Conda prefixes, writes private scratch, executes Python/R, installs packages into a bound prefix through micromamba, and imports run-produced PNG files through `ctx.attachments`. [`dsh-tool-science`](../../packages/science/tool-science) binds mode/environment on first use, renders `science:environment`, registers the five Science tools without a separate publication workflow. [`dsh-client-ui-science`](../../packages/client/ui-science) renders chart and Outcome tool occurrences through the shared attachment loader, hosts the Science settings card keyed on the `science-runtime` namespace `@deepseek-ai/dsh-science-runtime/with-settings` registers, and adds the Files toggle (session-scoped by default, app-global under a `toggleScope: global` Config) plus a `conversation.details.view` Details entry registered `primary: true` — the Details column's default view for any current Session, blank or Science-unbound included, since the artifact library it renders loads through a project-wide RPC independent of that Session's own `science` projection — an artifact viewer with a tab strip over opened charts, an in-panel toolbar, a provenance drill-in (code, execution log, messages, environment) per artifact version, and, for a PNG version whose `chart` is addressable, a chart editing panel (all 13 element kinds, direct controls and preview only for title, axis label, legend position, and grid, and a precise `+`/`−` model reference for every row). The built-in non-copyable `science` preset composes the Consumer with a narrow supporting roster but carries no Runtime row; the shipped Web bundle mounts `with-settings` with an intentionally empty profile map alongside it, and a live-capable Host otherwise mounts explicit Runtime configuration.

Source: [`packages/science/science-runtime/src/index.ts`](../../packages/science/science-runtime/src/index.ts), [`packages/science/science-session/src/types.ts`](../../packages/science/science-session/src/types.ts), and [`packages/science/tool-science/src/index.ts`](../../packages/science/tool-science/src/index.ts)

Artifact identity belongs to the producing conversation: a session's first capture of a logical name creates v1, and later captures continue that session's chain. Same-named project artifacts remain distinct by artifactId. Cross-conversation inputs name exact versions through `artifact_inputs`; `edit_of` remains session-local. Existing logs keep their recorded ordinals. The artifact library groups by producing conversation, with collapsible groups persisted in the selection store.

## Operations

`bindEnvironment` requires the exact live Science Session object, observes one allowlisted profile, and appends one complete `science/environment-bound` value. `startRun` writes the exact source, resolves optional artifact-version inputs through verified attachment reads, materializes them below the reserved `inputs/` directory, appends the complete mapping on `science/run-started`, and returns a `ScienceRunHandle` with only `runId`, `done`, and idempotent `cancel()`. Optional edit baselines assign exact `parent` refs during the post-terminal capture walk, including stale and cross-artifact branches. `commitChart` accepts one successful run started locally in the exact Session, resolves a regular non-symlink PNG inside its artifact directory, persists it through `ctx.attachments`, and appends the next immutable logical artifact version with `origin: 'model'` without publishing a Host path. A second live-Session Runtime operation returns `RUNTIME_BUSY`. The Runtime refuses a remote subprocess world and a sandbox that cannot report full enforcement before it creates owner markers, scratch, or Session events.

An `image/png` artifact version may carry `ScienceChartState`: its `runtime`, capture-relative `figureKey`, saved pixel dimensions and DPI, bounded `elements`, cumulative `ops`, `hitmap`, and `hitmapStatus`. The Python and R kernels produce this projection only for captured paths registered through matplotlib savefig or ggplot2 ggsave. A missing or unavailable chart projection never invalidates the PNG; `hitmapStatus: 'unavailable'` requires an empty hit map while preserving any extracted elements. Chart state belongs to the Session event and client projection, while the project artifact store retains the PNG bytes and ordinary version metadata.

`applyChartEdit` applies the closed `set_title`, `set_subtitle`, `set_axis_label`, `set_legend_position`, `toggle_grid`, and `set_font` operations to an exact current addressable version and appends a child `origin: 'human-edit'` PNG. It uses the live figure when registered; otherwise it privately replays the source run, exact materialized inputs, and prior operations without appending run events. Successful operations accumulate on the new chart state, partial target failures return as indexed `failedOps`, and stale, unaddressable, invalid, or wholly unresolved requests retain distinct stable error codes. A font operation checks exact availability without enumerating installed families, reports `font_not_found` without mutating the figure when resolution fails, and never changes matplotlib's global `rcParams`. The `scienceEdits.applyChartOps` Remote translates the chart-specific Runtime errors for browser clients. `get_science_state` and artifact receipts expose only each operation name and element target plus the edit count, never operation values. Element references carry id, kind, axes, label, and a bounded current-value summary; the Host requires every field to match the exact addressed chart catalog entry.

A single-axes figure with no figure-level title (`fig.suptitle()`/no ggplot2 equivalent) extracts its one axes title as `kind: 'title'` in both runtimes; matplotlib keeps it `kind: 'subtitle'` only when a suptitle exists or the figure has more than one axes. `set_legend_position`'s shared enum maps straight through to matplotlib's own `loc`, but ggplot2 4's `theme(legend.position = ...)` has no matching corner/edge vocabulary — an unmapped string silently drops the legend rather than erroring — so the ggplot2 adapter maps each value deterministically to `"right"` or to `"inside"` plus a normalized coordinate ([full table](../../packages/science/science-runtime/README.md)); an unmapped `position` fails the operation instead.

The registered client projection is distinct from complete Host replay. It retains path-free environment summaries, run status/history with exact artifact-version inputs when recorded, artifact attachment references with optional exact parent identities, the latest Outcome, and metrics while omitting prefix/executable paths, full fingerprints, source/scratch facts, authorizing request identities, and Runtime free-text failures. The strict fold and pre-commit invariant require every recorded parent and input to resolve to an earlier committed artifact version; self-parenting and terminal rewrites of start-owned inputs fail loud.

A run-produced artifact version's client projection also carries `turn`: the authorizing tool call's agent turn, resolved from the fold's own `tool/call` facts (`toolCallTurnsOf`) rather than reconstructed by a client from raw session events; a human-edit version has no authorizing tool call and so no `turn`. `turn` counts per producing session, so the viewer folds a same-turn intermediate draft — a version superseded by a later, non-human-edit version of the same artifact sharing both `turn` and `producerSessionId` — out of its version stepper's default walk, and shows an artifact's latest-version curated title (not the exact open version's own title) everywhere it names an artifact outside a version-scoped detail; both are client-side presentation over this data, detailed in [`dsh-client-ui-science`](../../packages/client/ui-science).

Every probe and run uses direct argv, `environmentBase: 'empty'`, a fixed allowlist, owned cwd, and full `workspace-write` confinement. Python uses frozen isolated UTF-8 flags. R version discovery uses standalone `Rscript --version`; UTF-8 probes and runs use `--vanilla --encoding=UTF-8`. File-write confinement is not confidentiality: it does not isolate reads, network, syscalls, or scientific correctness.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxscienceartifactstore--scienceartifactstore"></a>

### `ctx.scienceArtifactStore` — `ScienceArtifactStore`

The project artifact store service. Registers as `ctx.scienceArtifactStore`; every method is self-sufficient given a `projectId` (no prior `openProject` call is required in the same process), so a Host restart or a second session in the same project can resume work against a project it already knows the id of.

```ts cordis-catalog
/**
 * Resolve a workspace directory's project identity and ensure its store is open.
 * @param workspacePath - the workspace directory to resolve.
 * @returns the resolved identity, store root, and how it was resolved.
 */
openProject(workspacePath: string): Promise<OpenedProject>

/**
 * Create a new artifact and its first version.
 * @param projectId - the owning project.
 * @param input - the first version's bytes, media type, origin, and metadata.
 * @returns the created artifact and its first version.
 */
createArtifact(projectId: ProjectId, input: CreateArtifactInput): Promise<{ artifact: ArtifactRecord; version: VersionRecord }>

/**
 * Append a new version onto an existing artifact, linearized against every
 * other concurrent append to the same artifact.
 * @param projectId - the owning project.
 * @param artifactId - the artifact to append to.
 * @param input - the new version's bytes, media type, origin, and metadata.
 * @returns the appended version.
 */
appendVersion(projectId: ProjectId, artifactId: ArtifactId, input: AppendVersionInput): Promise<VersionRecord>

/**
 * Apply a metadata-only patch to one version in place.
 * @param projectId - the owning project.
 * @param versionId - the version to curate.
 * @param patch - fields to overwrite; an omitted field keeps its current value.
 * @returns the updated version.
 */
annotateVersion(projectId: ProjectId, versionId: VersionId, patch: AnnotateVersionInput): Promise<VersionRecord>

/**
 * Look up one artifact by id.
 * @param projectId - the owning project.
 * @param artifactId - the artifact to look up.
 * @returns the artifact, or `undefined` when no such artifact exists.
 */
getArtifact(projectId: ProjectId, artifactId: ArtifactId): Promise<ArtifactRecord | undefined>

/**
 * Look up one version by id.
 * @param projectId - the owning project.
 * @param versionId - the version to look up.
 * @returns the version, or `undefined` when no such version exists.
 */
getVersion(projectId: ProjectId, versionId: VersionId): Promise<VersionRecord | undefined>

/**
 * Look up an artifact's current latest version.
 * @param projectId - the owning project.
 * @param artifactId - the artifact whose latest version to fetch.
 * @returns the latest version, or `undefined` when the artifact does not exist.
 */
getLatestVersion(projectId: ProjectId, artifactId: ArtifactId): Promise<VersionRecord | undefined>

/**
 * List every artifact in a project, oldest first.
 * @param projectId - the owning project.
 * @returns every artifact currently in the project's store.
 */
listArtifacts(projectId: ProjectId): Promise<readonly ArtifactRecord[]>

/**
 * List one artifact's versions in ordinal order.
 * @param projectId - the owning project.
 * @param artifactId - the artifact whose versions to list.
 * @returns every version of the artifact, oldest first.
 */
listVersions(projectId: ProjectId, artifactId: ArtifactId): Promise<readonly VersionRecord[]>

/**
 * Read one version's bytes by content address.
 * @param projectId - the owning project.
 * @param sha256 - the digest from an already-resolved version row.
 * @returns the verified bytes.
 */
readBlob(projectId: ProjectId, sha256: string): Promise<Uint8Array>

/**
 * Permanently delete a project's entire store. The one cascade boundary:
 * session deletion never calls this, and never removes artifact rows.
 * @param projectId - the project to delete.
 */
deleteProject(projectId: ProjectId): Promise<void>
```

Source: [`packages/science/science-artifact-store/src/index.ts`](../../packages/science/science-artifact-store/src/index.ts)

<a id="ctxscienceedits--scienceeditservice"></a>

### `ctx.scienceEdits` — `ScienceEditService`

Remote service admitting browser edit gestures into the addressed live agent.

```ts cordis-catalog
/**
 * Validate exact current artifact selections and queue one structured edit
 * message. A region target's raster is read back from the project artifact
 * store and admitted as an ordinary session message attachment, so the
 * model-visible image stays reconstructable from the session log alone; an
 * element target must match one addressable chart entry's id, kind, axes,
 * label, and current-value summary, and never reads the store or mints an
 * attachment.
 * @param agent - exact live agent resolved by the Remote lookup policy.
 * @param request - selected versions, targets, and shared user instruction.
 * @returns durable-inbox admission receipt.
 */
@Remote('submit') async submit(agent: Agent, request: ScienceEditRequest): Promise<ScienceEditReceipt>

/**
 * Apply deterministic operations to one exact current addressable chart.
 * @param agent - Agent whose session owns the chart.
 * @param request - Exact chart version and ordered operations.
 * @param signal - Client-owned cancellation for the Runtime operation.
 * @returns the committed direct-edit version and unresolved operation targets.
 */
@Remote('applyChartOps') async applyChartOps( agent: Agent, request: ScienceChartEditRequest, signal: AbortSignal, ): Promise<ScienceChartEditReceipt>

/**
 * Render chart operations through the Runtime for live preview without
 * committing a new artifact version: the preview PNG rides back as base64
 * and no store or session state is published.
 * @param agent - exact live agent whose session owns the chart artifact.
 * @param request - exact target artifact/version and operations to preview.
 * @param signal - caller-owned cancellation for the kernel round-trip.
 * @returns the base64 preview PNG, its re-extracted chart state, and any operations whose targets could not be resolved.
 */
@Remote('previewChartOps') async previewChartOps( agent: Agent, request: ScienceChartEditRequest, signal: AbortSignal, ): Promise<import('./types.ts').ScienceChartPreviewReceipt>

/**
 * Add one user-only note after validating its exact visible artifact version.
 * @param agent - Agent whose session owns the artifact.
 * @param request - Exact artifact version and plain note text.
 * @returns acceptance receipt after the note event commits.
 */
@Remote('addArtifactNote') addArtifactNote(agent: Agent, request: ScienceArtifactNoteAddRequest): ScienceArtifactNoteReceipt

/**
 * Remove one active user-only note owned by the named logical artifact.
 * @param agent - Agent whose session owns the note.
 * @param request - Logical artifact and add-event sequence identifying the note.
 * @returns acceptance receipt after the removal event commits.
 */
@Remote('removeArtifactNote') removeArtifactNote(agent: Agent, request: ScienceArtifactNoteRemoveRequest): ScienceArtifactNoteReceipt
```

Types: [Agent](core.md)

Source: [`packages/science/tool-science/src/edit-message.ts`](../../packages/science/tool-science/src/edit-message.ts)

<a id="ctxscienceruntime--scienceruntime"></a>

### `ctx.scienceRuntime` — `ScienceRuntime`

Folded local Science Runtime provider with public types free of Host paths.

```ts cordis-catalog
/**
 * Observe one configured existing Conda profile and append its whole-value
 * environment revision. Static unusability becomes an honest `invalid`
 * revision; capability, cancellation, and I/O failures append nothing.
 * @param request - Exact live Session, profile identity, and caller signal.
 * @returns The accepted durable environment revision.
 */
async bindEnvironment(request: BindScienceEnvironmentRequest): Promise<ScienceEnvironmentBinding>

/**
 * Resolve and materialize exact artifact inputs, acquire this run's
 * persistent kernel, publish its run start, then settle exactly one
 * matching terminal fact and baseline-attributed capture walk.
 * @param request - Exact live Session, source, authorization facts, optional artifact inputs and edit baselines, and cancellation.
 * @returns A handle exposed only after `science/run-started` committed.
 */
async startRun(request: StartScienceRunRequest): Promise<ScienceRunHandle>

/**
 * Apply one direct-edit request and commit its successful operations as a new PNG version.
 *
 * @param request - The exact chart version, operations, and cancellation context.
 * @returns The committed artifact and any operations whose targets could not be resolved.
 */
async applyChartEdit(request: ScienceChartEditRequest): Promise<ScienceChartEditResult>

/**
 * Render one direct-edit request without publishing store or session state:
 * the shared warm/replay path exports a PNG and re-extracts its chart, but
 * no artifact version or `science/artifact-saved` event is committed.
 * Cold recovery uses an isolated interpreter and the operation's cancellation/deadline.
 * @param request - Exact session, target artifact/version, and operations to render for preview.
 * @returns The rendered preview PNG bytes, its re-extracted chart state, and any operations whose targets could not be resolved.
 */
async previewChartEdit(request: ScienceChartEditRequest): Promise<ScienceChartPreviewResult>

/**
 * Re-commit an existing artifact version's exact store content reference
 * with a curated title and caption: metadata-only, so it supersedes the
 * version it names rather than opening a new one whose bytes would repeat
 * their predecessor's. The store row's metadata is curated in place first
 * (`annotateVersion`), then the superseding event commits; a vetoed append
 * after the store update leaves the store curated with no matching event —
 * accepted metadata decay, resolved by the fold's own value staying the
 * projection authority. A committed event is never rolled back because a
 * later step fails; there is no later step here that can fail after the
 * append.
 * @param request - Exact live Session, target logical artifact (and optional version), title/caption, and cancellation.
 * @returns The durable curated version this operation committed.
 */
async annotateArtifact(request: AnnotateScienceArtifactRequest): Promise<ScienceArtifactVersion>
```

Source: [`packages/science/science-runtime/src/index.ts`](../../packages/science/science-runtime/src/index.ts)
<!-- END GENERATED cordis-surface -->
