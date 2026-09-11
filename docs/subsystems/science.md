# Science

English | [中文](science.zh.md)

Science services own interpreter execution, project artifacts, and artifact-edit admission. The [Science Runtime](../../packages/science/science-runtime/README.md), [artifact store](../../packages/science/science-artifact-store/README.md), and [tool package](../../packages/science/tool-science/README.md) define their configuration and persistence responsibilities. The [Science application bundle](../../packages/bundle/science-app/README.md) controls activation; an unavailable method rejects execution explicitly.

The Science client uses the native right Sidebar: a project-library guide, stable artifact-identity resources and exact-version navigation. Process is a sibling of Trajectory. Public conversation slots handle input targets, turn-end artifacts and tool views; upstream Files owns workspace browsing. See the [client package](../../packages/client/ui-science/README.md) and [decision](../../.agents/notes/implemented/architecture/2026-09-10-science-native-sidebar.md).

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

<a id="ctxsciencereads--sciencereadservice"></a>

### `ctx.scienceReads` — `ScienceReadService`

Read-only Remote service over a session's project and durable attachment references.

```ts cordis-catalog
/**
 * Read one session-authorized immutable version.
 * @param sessionId - Authorizing session.
 * @param versionId - Exact version.
 * @returns Verified bytes encoded as base64.
 */
@Remote async scienceArtifact(sessionId: SessionId, versionId: VersionId): Promise<{ versionId: VersionId; mediaType: string; byteCount: number; data: string }>

/**
 * Read an exact version's editable chart state.
 * @param sessionId - Authorizing session.
 * @param versionId - Exact version.
 * @returns Chart state or null for non-chart versions.
 */
@Remote async scienceChartState(sessionId: SessionId, versionId: VersionId): Promise<{ chart: ScienceChartState | null }>

/**
 * Read a referenced UTF-8 file.
 * @param sessionId - Authorizing session.
 * @param attachmentId - Durable file identity.
 * @returns Validated text with its reference.
 */
@Remote async textAttachment(sessionId: SessionId, attachmentId: AttachmentId): Promise<{ attachment: FileAttachmentRef; data: string }>

/**
 * Read current project metadata.
 * @param sessionId - Authorizing session.
 * @returns Current authorized store facts.
 */
@Remote async scienceLibrary(sessionId: SessionId): Promise<{ projectId: string; artifacts: ScienceLibraryArtifact[]; health: ScienceLibraryHealth }>

/**
 * Read current project metadata.
 * @param sessionId - Authorizing session.
 * @param versionIds - Exact versions to resolve.
 * @returns Current authorized store facts.
 */
@Remote async scienceVersions(sessionId: SessionId, versionIds: readonly VersionId[]): Promise<{ versions: ScienceVersionSummary[] }>
```

Types: [FileAttachmentRef](attachment.md) · [SessionId](core.md)

Source: [`packages/science/tool-science/src/read-service.ts`](../../packages/science/tool-science/src/read-service.ts)

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
 * then, only on a successful install, re-observe the whole profile —
 * exactly the operation `bindEnvironment`'s own post-first-run guard
 * refuses. A re-observation that differs from the session's current
 * binding appends a fresh whole-value `science/environment-bound`
 * revision; one that matches it exactly appends none and returns the
 * existing binding, since every requested package was already present (or
 * an earlier attempt this session retried after a `'timed-out'`
 * misclassification had, in fact, already finished — see
 * `runMicromambaInstall`). A live kernel serving a superseded revision is
 * left running: the next `startRun` for either language finds the
 * revision mismatch and ends it (`environment-rebound`) before starting a
 * fresh one, the same path an out-of-band rebind already takes (`kernel-set.ts`).
 * @param request - Exact live Session, target language, package specs, and cancellation.
 * @returns The install's terminal classification, output tails, and — on
 *   success — the environment as it now stands plus whether this call
 *   appended it as a fresh revision.
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
 * committed; the new version's `producerTurn` is the session's last
 * started turn at the moment this method was called, so a save-as
 * during an idle gap between turns attributes to the turn that was
 * current then, never to whichever turn is newest by the time the store
 * write commits.
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
