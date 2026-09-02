# Science Runtime

English | [中文](science.zh.md)

The Science family owns seven required-on-read Session events, the host-local Runtime that produces environment/run/artifact facts, the model-facing Consumer, and browser transcript presentation. [`dsh-science-session`](../../packages/science/science-session) strictly validates the complete durable values, exposes a client-safe `science` Session projection, and registers artifact attachment extraction. [`dsh-science-runtime`](../../packages/science/science-runtime) owns `ctx.scienceRuntime`: it observes configured existing Conda prefixes, writes private scratch, executes Python/R, installs packages into a bound prefix through micromamba, and imports run-produced PNG files through `ctx.attachments`. [`dsh-tool-science`](../../packages/science/tool-science) binds mode/environment on first use, renders `science:environment`, registers the five Science tools without a separate publication workflow. [`dsh-client-ui-science`](../../packages/client/ui-science) renders chart and Outcome tool occurrences through the shared attachment loader, hosts the Science settings card keyed on the `science-runtime` namespace `@deepseek-ai/dsh-science-runtime/with-settings` registers, and adds the Files toggle (session-scoped by default, app-global under a `toggleScope: global` Config) plus a `conversation.details.view` Details entry registered `primary: true` — the Details column's default view for any current Session, blank or Science-unbound included, since the artifact library it renders loads through a project-wide RPC independent of that Session's own `science` projection — an artifact viewer with a tab strip over opened charts, an in-panel toolbar, a provenance drill-in (code, execution log, messages, environment) per artifact version, and, for a PNG version whose `chart` is addressable, a chart editing panel (all 13 element kinds, direct controls and preview only for title, axis label, legend position, and grid, and a precise `+`/`−` model reference for every row). The built-in non-copyable `science` preset composes the Consumer with a narrow supporting roster — including `web_search`/`web_fetch` over the shared [web capability](web.md) and plan mode — but carries no Runtime row; the shipped Web bundle mounts `with-settings` with an intentionally empty profile map alongside it, and a live-capable Host otherwise mounts explicit Runtime configuration. `run_python`/`run_r` already reach the network directly, so this preset enables `web_fetch`, which every other shipped preset leaves disabled ([`apps/cli/config/agent-presets/science/agent.cordis.yml`](../../apps/cli/config/agent-presets/science/agent.cordis.yml)). The preset also composes a deliberately restricted [`subagent`](subagent.md): the spawned child joins this preset's own composition and is narrowed back down by `toolFilter` (no package installs, no further delegation or child-messaging/listing tools) and `maxDepth: 1` (no grandchild delegation), with its own child-scoped persona; this is a first cut, not Science's later role-based Specialists design ([Agent Note](../../.agents/notes/implemented/feature/2026-09-02-science-restricted-subagent.md)).

Source: [`packages/science/science-runtime/src/index.ts`](../../packages/science/science-runtime/src/index.ts), [`packages/science/science-session/src/types.ts`](../../packages/science/science-session/src/types.ts), and [`packages/science/tool-science/src/index.ts`](../../packages/science/tool-science/src/index.ts)

Product-facing documentation for the desktop product (PaperMachine) lives under `docs/product/` and `docs/releases/`: [papermachine.md](../product/papermachine.md) describes current researcher-facing behavior by area, [device-checklist.md](../product/device-checklist.md) is the master on-device acceptance checklist, and [releases/](../releases/README.md) holds one record per shipped DMG version.

Artifact identity belongs to the producing conversation: a session's first capture of a logical name creates v1, and later captures continue that session's chain. Same-named project artifacts remain distinct by artifactId. Cross-conversation inputs name exact versions through `artifact_inputs`; `edit_of` remains session-local. Existing logs keep their recorded ordinals. The artifact library groups by producing conversation, with collapsible groups persisted in the selection store.

## Operations

`bindEnvironment` requires the exact live Science Session object, observes one allowlisted profile, and appends one complete `science/environment-bound` value. `startRun` writes the exact source, resolves optional artifact-version inputs through verified attachment reads, materializes them below the reserved `inputs/` directory, appends the complete mapping on `science/run-started`, and returns a `ScienceRunHandle` with only `runId`, `done`, and idempotent `cancel()`. Optional edit baselines name an exact declared content baseline (`base_version_id`/`base_explicit` on the appended store row), never latest-defaulted, including stale and cross-artifact branches. The project artifact store's write transaction is the sole authority for a version's provenance — `contentOrigin`, the full producer group, `baseVersionId`/`baseExplicit`, and `createdAt`; the Session event carries only `versionId`/`sha256` and the title/caption presentation snapshot the model or user saw when it committed. A second live-Session Runtime operation returns `RUNTIME_BUSY`. The Runtime refuses a remote subprocess world and a sandbox that cannot report full enforcement before it creates owner markers, scratch, or Session events.

An `image/png` artifact version may carry `ScienceChartState` in the store's `figure_state` side table: its `runtime`, capture-relative `figureKey`, saved pixel dimensions and DPI, bounded `elements`, cumulative `ops`, `hitmap`, and `hitmapStatus`. The Python and R kernels produce this projection only for captured paths registered through matplotlib savefig or ggplot2 ggsave. A missing or unavailable chart projection never invalidates the PNG; `hitmapStatus: 'unavailable'` requires an empty hit map while preserving any extracted elements.

`applyChartEdit` applies the closed `set_title`, `set_subtitle`, `set_axis_label`, `set_legend_position`, `toggle_grid`, and `set_font` operations to an exact current addressable version and appends a child `content_origin: 'human-edit'` PNG. It uses the live figure when registered; otherwise it privately replays the source run, exact materialized inputs, and prior operations without appending run events. Successful operations accumulate on the new chart state, partial target failures return as indexed `failedOps`, and stale, unaddressable, invalid, or wholly unresolved requests retain distinct stable error codes. A font operation checks exact availability without enumerating installed families, reports `font_not_found` without mutating the figure when resolution fails, and never changes matplotlib's global `rcParams`. The `scienceEdits.applyChartOps` Remote translates the chart-specific Runtime errors for browser clients. `get_science_state` and artifact receipts expose only `contentOrigin` and whether the version has been curated, never operation names, element targets, or operation values — those live only in the store's `figure_state` row. Element references carry id, kind, axes, label, and a bounded current-value summary; the Host requires every field to match the exact addressed chart catalog entry.

A single-axes figure with no figure-level title (`fig.suptitle()`/no ggplot2 equivalent) extracts its one axes title as `kind: 'title'` in both runtimes; matplotlib keeps it `kind: 'subtitle'` only when a suptitle exists or the figure has more than one axes. `set_legend_position`'s shared enum maps straight through to matplotlib's own `loc`, but ggplot2 4's `theme(legend.position = ...)` has no matching corner/edge vocabulary — an unmapped string silently drops the legend rather than erroring — so the ggplot2 adapter maps each value deterministically to `"right"` or to `"inside"` plus a normalized coordinate ([full table](../../packages/science/science-runtime/README.md)); an unmapped `position` fails the operation instead.

The registered client projection is distinct from complete Host replay. It retains path-free environment summaries, run status/history with exact artifact-version inputs when recorded, the latest Outcome, and metrics while omitting prefix/executable paths, full fingerprints, source/scratch facts, authorizing request identities, and Runtime free-text failures. An artifact version's client projection carries only its identity, the title/caption presentation snapshot as committed, `versionId`, `sha256`, and `seenAt` — content origin, producer, and declared baseline are project artifact store facts (`content_origin`, the producer group, `base_version_id`/`base_explicit`), not session-log facts, and are read from the store rather than replayed from the fold. The strict fold and pre-commit invariant require every recorded artifact-input reference to resolve to an earlier committed artifact version; a declared baseline's own validity is a store write-time concern (a foreign-key reference plus the call-site checks in `dsh-science-runtime`), not a fold-time one.

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
 * @param input - the first version's bytes, kind, provenance, and optional explicit baseline.
 * @returns the created artifact and its first version.
 */
createArtifact(projectId: ProjectId, input: CreateArtifactInput): Promise<{ artifact: ArtifactRecord; version: VersionRecord }>

/**
 * Append a new version onto an existing artifact, linearized against every
 * other concurrent append to the same artifact.
 * @param projectId - the owning project.
 * @param artifactId - the artifact to append to.
 * @param input - the new version's bytes, provenance, and optional explicit baseline.
 * @returns the appended version.
 */
appendVersion(projectId: ProjectId, artifactId: ArtifactId, input: AppendVersionInput): Promise<VersionRecord>

/**
 * Append one metadata edit onto a version.
 * @param projectId - the owning project.
 * @param versionId - the version to annotate.
 * @param patch - the edit's author and the fields to change.
 * @returns the version, reflecting the newly appended annotation.
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
 * List one artifact's active (non-removed) notes, oldest first.
 * @param projectId - the owning project.
 * @param artifactId - the artifact whose notes to list.
 * @returns every note that has not been removed.
 */
listNotes(projectId: ProjectId, artifactId: ArtifactId): Promise<readonly ArtifactNoteRecord[]>

/**
 * Add a new note.
 * @param projectId - the owning project.
 * @param input - the artifact (and optional version) to attach the note to, its text, and its author.
 * @returns the created note.
 */
putNote(projectId: ProjectId, input: PutNoteInput): Promise<ArtifactNoteRecord>

/**
 * Soft-delete a note.
 * @param projectId - the owning project.
 * @param noteId - the note to remove.
 */
removeNote(projectId: ProjectId, noteId: NoteId): Promise<void>

/**
 * Look up one version's live-figure-object state.
 * @param projectId - the owning project.
 * @param versionId - the version whose figure state to fetch.
 * @returns the figure state, or `undefined` when this version carries none.
 */
getFigureState(projectId: ProjectId, versionId: VersionId): Promise<FigureStateRecord | undefined>

/**
 * Apply a reconciliation-status patch to one version.
 * @param projectId - the owning project.
 * @param versionId - the version whose health to update.
 * @param patch - fields to overwrite; an omitted field keeps its current value.
 * @returns the updated health row.
 */
setVersionHealth(projectId: ProjectId, versionId: VersionId, patch: VersionHealthPatch): Promise<VersionHealthRecord>

/**
 * Read one version's bytes by content address.
 * @param projectId - the owning project.
 * @param sha256 - the digest from an already-resolved version row.
 * @returns the verified bytes.
 */
readBlob(projectId: ProjectId, sha256: string): Promise<Uint8Array>

/**
 * Reconcile one project's store against session-log events a caller has
 * already read and folded — see the package README's Reconciliation
 * section for the seven-case table this decides. This package never reads
 * session logs itself; `dsh-science-runtime` reads them (bounded by its
 * own `reconcileMaxSessions` Config) and folds duplicate events per
 * `versionId` (last write wins) before calling this. Never throws for one
 * bad item — see `ReconcileResult.errors` — and never writes a session
 * log; the store is the sole write target.
 * @param projectId - the project to reconcile.
 * @param events - every `science/artifact-saved` event the caller read from
 * this project's session logs, folded per `versionId`.
 * @param eventSetComplete - whether the caller read every relevant session
 * log and event; when false, an absent event cannot mark or clear orphan health.
 * @param cursor - prior bounded-walk progress over this stable event set.
 * @returns what this call checked, reconstructed, and could not fully reconcile, bounded by the configured `reconcileMaxVersions`.
 */
reconcileProject( projectId: ProjectId, events: ReadonlyMap<VersionId, ReconcileArtifactSavedEvent>, eventSetComplete: boolean, cursor?: ReconcileCursor, ): Promise<ReconcileResult>

/**
 * Read project-wide reconciliation health — the read interface a Host
 * BFF (`dsh-api-proxy`) surfaces to a client's Files panel: aggregate
 * `orphan`/`reconstructed`/`missingContent` counts plus the per-version
 * list backing them. A pure read of whatever the last `reconcileProject`
 * call recorded; it never itself compares the store against a session log.
 * @param projectId - the owning project.
 * @returns aggregate counts and the unhealthy version list, most recently checked first.
 */
getReconciliationSummary(projectId: ProjectId): Promise<ReconciliationSummary>

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
 * message. Media type and live-figure-object state — the store's, since
 * the T1/T2 artifact-authority migration — gate each target: a region
 * target's raster is read back from the project artifact store and
 * admitted as an ordinary session message attachment, so the model-visible
 * image stays reconstructable from the session log alone; an element
 * target must match one addressable chart entry's id, kind, axes, label,
 * and current-value summary, read from the store's `figure_state` row and
 * never minting an attachment.
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

/**
 * Duplicate one exact committed artifact version into a brand-new logical
 * artifact in the same project. A viewer-only operation — never exposed
 * as a model tool.
 * @param agent - Agent whose session owns the new artifact's origin.
 * @param request - Store version id to duplicate and the new logical name.
 * @param signal - Client-owned cancellation for the Runtime operation.
 * @returns the new artifact's identity and first version.
 */
@Remote('saveArtifactAs') async saveArtifactAs( agent: Agent, request: ScienceSaveArtifactAsRequest, signal: AbortSignal, ): Promise<ScienceSaveArtifactAsReceipt>
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
 * Install packages into one language's applied prefix through micromamba,
 * then, only on a successful install, re-observe the whole profile and
 * append a fresh whole-value `science/environment-bound` revision —
 * exactly the operation `bindEnvironment`'s own post-first-run guard
 * refuses. A live kernel serving the superseded revision is left running:
 * the next `startRun` for either language finds the revision mismatch and
 * ends it (`environment-rebound`) before starting a fresh one, the same
 * path an out-of-band rebind already takes (`kernel-set.ts`).
 * @param request - Exact live Session, target language, package specs, and cancellation.
 * @returns The install's terminal classification, output tails, and — on success — the fresh environment revision.
 */
async installPackages(request: InstallScienceEnvironmentPackagesRequest): Promise<InstallScienceEnvironmentPackagesResult>

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
 * with a curated title and caption: metadata-only, appending one new
 * `version_annotations` row (`annotateVersion`) rather than opening a new
 * version whose bytes would repeat their predecessor's. The store's
 * annotation write is the sole authority for this metadata edit's own
 * provenance (`actor: 'model'`, `sessionId`, `toolCallId`,
 * `requestHeaderSeq`) — this operation never rebuilds a full version value
 * and never lets the curating call's identity stand in for the content's
 * own producer. A vetoed append after the store update leaves the store
 * curated with no matching event — accepted metadata decay, resolved by
 * the fold's own value staying the projection authority. A committed
 * event is never rolled back because a later step fails; there is no
 * later step here that can fail after the append.
 * @param request - Exact live Session, target logical artifact (and optional version), title/caption, and cancellation.
 * @returns The durable curated version this operation committed.
 */
async annotateArtifact(request: AnnotateScienceArtifactRequest): Promise<ScienceArtifactVersion>

/**
 * Duplicate one existing artifact version into a brand-new logical
 * artifact in the same project. Content-addressed bytes are reused (the
 * store's blob admission is idempotent by digest, so re-admitting the
 * source's own bytes never duplicates them on disk); provenance is a
 * fresh fact this session originates, not a copy of the source's own
 * producer — `baseVersionId` names the source explicitly instead. A
 * viewer operation: no authorizing tool call, so `session.append` records
 * only the store reference and the presentation snapshot the store just
 * committed.
 * @param request - Exact Session, the store version to duplicate, and the new logical name.
 * @returns The durable new artifact version this operation appended.
 * @throws {@link ScienceRuntimeError} (`ARTIFACT_VERSION_NOT_FOUND`) when
 *   `sourceVersionId` does not identify a committed version in the
 *   session's owning project, or (`ARTIFACT_LOGICAL_NAME_CONFLICT`) when
 *   `newLogicalName` is already used in that project.
 */
async saveArtifactAs(request: SaveScienceArtifactAsRequest): Promise<ScienceArtifactVersion>
```

Source: [`packages/science/science-runtime/src/index.ts`](../../packages/science/science-runtime/src/index.ts)
<!-- END GENERATED cordis-surface -->
