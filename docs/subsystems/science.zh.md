# Science Runtime

[English](science.md) | 中文

Science 家族拥有七种 required-on-read Session 事件、产生 environment/run/artifact 事实的 host-local Runtime、面向模型的 Consumer，以及浏览器会话记录展示。[`dsh-science-session`](../../packages/science/science-session) 严格校验完整 durable 值，暴露客户端安全的 `science` Session projection，并注册 artifact 附件提取。[`dsh-science-runtime`](../../packages/science/science-runtime) 拥有 `ctx.scienceRuntime`：观测已配置的既有 Conda prefix、写入私有 scratch、执行 Python/R、通过 micromamba 把包安装进已绑定的 prefix，并通过 `ctx.attachments` 导入 run 生成的 PNG。[`dsh-tool-science`](../../packages/science/tool-science) 在首次使用时绑定 mode/environment，渲染 `science:environment`，注册五个 Science 工具，不提供独立发布流程。[`dsh-client-ui-science`](../../packages/client/ui-science) 通过共享附件加载器渲染 chart 与 Outcome tool occurrence，持有以 `@deepseek-ai/dsh-science-runtime/with-settings` 注册的 `science-runtime` 命名空间为键的 Science 设置卡片，并加入文件 toggle（默认 session 级，`toggleScope: global` 时应用全局）以及一个以 `primary: true` 注册的 `conversation.details.view` Details 条目——对任何当前 Session（含空白、含 Science 未绑定）都是 Details 列的默认视图，因为它渲染的产物库经由一条项目级 RPC 加载，与该 Session 自身的 `science` 投影无关——一个 artifact viewer：已打开图表的标签栏、面板内工具栏、每个图表版本的溯源下钻（代码、执行日志、消息、环境），以及当某个 PNG 版本的 `chart` 可寻址时的图表编辑面板（全部 13 类元素；只有标题、轴标签、图例位置与网格具备直接控件和预览；每行都可加入精确的 `+`/`−` 模型引用）。内置不可复制的 `science` preset 把 Consumer 与受限支持 roster 组装起来——包括基于共享 [web capability](web.zh.md) 的 `web_search`/`web_fetch` 与 plan mode——但不携带 Runtime 行；已发布的 Web bundle 会以有意留空的配置档案映射在旁挂载 `with-settings`，具备实时能力的 Host 则另行挂载显式 Runtime 配置。`run_python`/`run_r` 本就直接访问网络，因此该 preset 启用了 `web_fetch`，而其余所有内置 preset 都将其保持禁用（[`apps/cli/config/agent-presets/science/agent.cordis.yml`](../../apps/cli/config/agent-presets/science/agent.cordis.yml)）。 该 preset 还组装了一个刻意受限的 [`subagent`](subagent.zh.md)：被派生的子 agent 加入本 preset 自身的组合，再由 `toolFilter`（不装包、不能再往下派、没有子 agent 消息/列表工具）与 `maxDepth: 1`（不能有孙 agent）收窄回去，并携带自己的子 agent persona；这是先挂的半成品，不是 Science 后续基于角色的 Specialists 设计（[Agent Note](../../.agents/notes/implemented/feature/2026-09-02-science-restricted-subagent.zh.md)）。

来源：[`packages/science/science-runtime/src/index.ts`](../../packages/science/science-runtime/src/index.ts)、[`packages/science/science-session/src/types.ts`](../../packages/science/science-session/src/types.ts) 与 [`packages/science/tool-science/src/index.ts`](../../packages/science/tool-science/src/index.ts)

产物身份属于产生它的对话：会话首次捕获逻辑名时创建 v1，后续捕获延续本会话的链。项目中的同名产物通过 artifactId 区分。跨对话输入通过 `artifact_inputs` 指定精确版本，`edit_of` 仍限于本会话。已有日志保留已记录的版本号。产物库按产生它的对话分组，分组可折叠，折叠状态随选择存储持久化。

## 操作

`bindEnvironment` 要求精确的活 Science Session 对象，观测一个允许列表中的 profile，并追加一条完整的 `science/environment-bound` 值。`startRun` 写入精确源码，通过经过校验的附件读取解析可选的 artifact-version input，把它们物化到保留的 `inputs/` 目录下，在 `science/run-started` 上追加完整映射，并返回只包含 `runId`、`done` 与幂等 `cancel()` 的 `ScienceRunHandle`。可选 edit baseline 命名一个显式声明的内容基线（追加到 store 行上的 `base_version_id`/`base_explicit`），绝不用 latest 兜底，包括陈旧分支与跨 artifact 分支。项目 artifact store 的写事务是一个 version 全部来源事实的唯一权威——`contentOrigin`、完整 producer 组、`baseVersionId`/`baseExplicit` 与 `createdAt`；Session event 只携带 `versionId`/`sha256`，以及提交那一刻模型或用户所见的标题/caption 呈现快照。同一活 Session 上的第二项 Runtime 操作返回 `RUNTIME_BUSY`。Runtime 在创建 owner marker、scratch 或 Session 事件之前，拒绝 remote subprocess 世界以及无法报告 full enforcement 的 sandbox。

一个 `image/png` artifact version 可以在 store 的 `figure_state` 侧表里携带 `ScienceChartState`：其 `runtime`、捕获相对 `figureKey`、保存时的像素尺寸与 DPI、有界 `elements`、累计 `ops`、`hitmap` 及 `hitmapStatus`。Python 与 R kernel 只为经 matplotlib savefig 或 ggplot2 ggsave 登记且被捕获的路径生成此投影。缺失或不可用的 chart 投影绝不会使 PNG 无效；`hitmapStatus: 'unavailable'` 要求空 hit map，同时保留已抽取的 elements。

`applyChartEdit` 把封闭的 `set_title`、`set_subtitle`、`set_axis_label`、`set_legend_position`、`toggle_grid` 与 `set_font` 操作施加到确切的当前可寻址 version，并追加一个 `content_origin: 'human-edit'` 的子 PNG。图对象仍有登记时直接使用活对象；否则会私下重放源 run、确切物化输入与先前操作，且不追加 run event。成功操作累计到新 chart 状态，部分 target 失败以带索引的 `failedOps` 返回，陈旧、不可寻址、无效或全部无法解析的请求保留各自稳定错误码。字体操作检查精确可用性但不枚举已安装字体族；解析失败时返回 `font_not_found`，不修改图对象，也不改变 matplotlib 的全局 `rcParams`。`scienceEdits.applyChartOps` Remote 为 browser client 转换 chart 专用 Runtime 错误。`get_science_state` 与 artifact receipt 只公开 `contentOrigin` 与该 version 是否已被策展，绝不公开操作名称、元素 target 或操作值——这些只存在于 store 的 `figure_state` 行里。元素引用携带 id、kind、axes、label 与有界当前值摘要；Host 要求每个字段与被寻址 chart catalog 的确切条目一致。

当一张图没有图级标题（`fig.suptitle()`；ggplot2 没有对应机制）且只有一个 axes 时，两个 runtime 都把该唯一 axes 的标题抽取为 `kind: 'title'`；matplotlib 只在存在 suptitle 或多个 axes 时才把 axes 标题保留为 `kind: 'subtitle'`。`set_legend_position` 的共享枚举可直接映射到 matplotlib 自身的 `loc`，但 ggplot2 4 的 `theme(legend.position = ...)` 没有对应的角/边词汇——未映射的字符串会静默丢弃图例而不报错——因此 ggplot2 adapter 把每个值确定性地映射到 `"right"` 或 `"inside"` 加一个归一化坐标（[完整对照表](../../packages/science/science-runtime/README.zh.md)）；未映射的 `position` 会使操作失败而不是静默处理。

注册给客户端的 projection 与完整 Host replay 分离。它保留无 path 的 environment 摘要、run status/history（包括存在时的精确 artifact-version input）、最新 Outcome 与 metrics，同时省略 prefix/executable path、完整 fingerprint、source/scratch fact、授权 request identity，以及 Runtime free-text failure。一个 artifact version 的客户端 projection 只携带其身份、提交时的标题/caption 呈现快照、`versionId`、`sha256` 与 `seenAt`——内容来源、producer 与显式声明的基线是项目 artifact store 的事实（`content_origin`、producer 组、`base_version_id`/`base_explicit`），不是 session log 事实，从 store 读取而非由 fold 重放。严格 fold 与 pre-commit invariant 要求每个已记录的 artifact-input 引用都解析到更早提交的 artifact version；显式声明基线自身的有效性是 store 写入时的关切（一个外键引用加上 `dsh-science-runtime` 里的调用点校验），而不是 fold-time 的关切。

每次 probe 和 run 都使用 direct argv、`environmentBase: 'empty'`、固定 allowlist、owned cwd 与 full `workspace-write` confinement。Python 使用冻结的 isolated UTF-8 标志。R 版本发现使用独立的 `Rscript --version`；UTF-8 probe 与 run 使用 `--vanilla --encoding=UTF-8`。file-write confinement 不是保密性：它不隔离 read、network、syscall 或科学正确性。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [Agent](core.zh.md)

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
