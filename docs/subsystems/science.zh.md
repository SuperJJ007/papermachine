# Science Runtime

[English](science.md) | 中文

Science 家族拥有七种 required-on-read Session 事件、产生 environment/run/artifact 事实的 host-local Runtime、面向模型的 Consumer，以及浏览器会话记录展示。[`dsh-science-session`](../../packages/science/science-session) 严格校验完整 durable 值，暴露客户端安全的 `science` Session projection，并注册 artifact 附件提取。[`dsh-science-runtime`](../../packages/science/science-runtime) 拥有 `ctx.scienceRuntime`：观测已配置的既有 Conda prefix、写入私有 scratch、执行 Python/R，并通过 `ctx.attachments` 导入 run 生成的 PNG。[`dsh-tool-science`](../../packages/science/tool-science) 在首次使用时绑定 mode/environment，渲染 `science:environment`，注册五个 Science 工具，并在 evidence 校验后发布 Outcome。[`dsh-client-ui-science`](../../packages/client/ui-science) 通过共享附件加载器渲染 chart 与 Outcome tool occurrence，持有以 `@deepseek-ai/dsh-science-runtime/with-settings` 注册的 `science-runtime` 命名空间为键的 Science 设置卡片，并加入文件 toggle（默认 session 级，`toggleScope: global` 时应用全局）以及一个 `conversation.details.view` Details 条目——一个 artifact viewer：已打开图表的标签栏、面板内工具栏、每个图表版本的溯源下钻（代码、执行日志、消息、环境），以及当某个 PNG 版本的 `chart` 可寻址时的图表编辑面板（完整元素列表；每行内联其 kind 对应的属性控件；每行的 `+`/`−` 元素引用；经 `applyChartOps` 放弃修改/保存为新版本）——加上位于无标签落地视图上的最新 Outcome。内置不可复制的 `science` preset 把 Consumer 与受限支持 roster 组装起来，但不携带 Runtime 行；已发布的 Web bundle 会以有意留空的配置档案映射在旁挂载 `with-settings`，具备实时能力的 Host 则另行挂载显式 Runtime 配置。

来源：[`packages/science/science-runtime/src/index.ts`](../../packages/science/science-runtime/src/index.ts)、[`packages/science/science-session/src/types.ts`](../../packages/science/science-session/src/types.ts) 与 [`packages/science/tool-science/src/index.ts`](../../packages/science/tool-science/src/index.ts)

## 操作

`bindEnvironment` 要求精确的活 Science Session 对象，观测一个允许列表中的 profile，并追加一条完整的 `science/environment-bound` 值。`startRun` 写入精确源码，通过经过校验的附件读取解析可选的 artifact-version input，把它们物化到保留的 `inputs/` 目录下，在 `science/run-started` 上追加完整映射，并返回只包含 `runId`、`done` 与幂等 `cancel()` 的 `ScienceRunHandle`。可选 edit baseline 会在 terminal 之后的捕获遍历中指定精确 `parent` 引用，包括陈旧分支与跨 artifact 分支。`commitChart` 只接受由精确 Session 本地启动且已成功的 run，解析其 artifact directory 内的普通非 symlink PNG，通过 `ctx.attachments` 持久化，并在不公开 Host path 的前提下追加带有 `origin: 'model'` 的下一条不可变 logical artifact version。同一活 Session 上的第二项 Runtime 操作返回 `RUNTIME_BUSY`。Runtime 在创建 owner marker、scratch 或 Session 事件之前，拒绝 remote subprocess 世界以及无法报告 full enforcement 的 sandbox。

一个 `image/png` artifact version 可以携带 `ScienceChartState`：其 `runtime`、捕获相对 `figureKey`、保存时的像素尺寸与 DPI、有界 `elements`、累计 `ops`、`hitmap` 及 `hitmapStatus`。Python 与 R kernel 只为经 matplotlib savefig 或 ggplot2 ggsave 登记且被捕获的路径生成此投影。缺失或不可用的 chart 投影绝不会使 PNG 无效；`hitmapStatus: 'unavailable'` 要求空 hit map，同时保留已抽取的 elements。chart 状态归 Session event 与 client projection 所有，project artifact store 只保留 PNG 字节与普通版本元数据。

`applyChartEdit` 把有类型的操作施加到确切的当前可寻址 version，并追加一个 `origin: 'human-edit'` 的子 PNG。图对象仍有登记时直接使用活对象；否则会私下重放源 run、确切物化输入与先前操作，且不追加 run event。成功操作累计到新 chart 状态，部分 target 失败以带索引的 `failedOps` 返回，陈旧、不可寻址、无效或全部无法解析的请求保留各自稳定错误码。`scienceEdits.applyChartOps` Remote 为 browser client 转换 chart 专用 Runtime 错误。`get_science_state` 与 artifact receipt 只公开每项操作的名称、元素 target 与编辑数量，绝不公开操作值。

注册给客户端的 projection 与完整 Host replay 分离。它保留无 path 的 environment 摘要、run status/history（包括存在时的精确 artifact-version input）、带可选精确 parent identity 的 artifact 附件引用、最新 Outcome 与 metrics，同时省略 prefix/executable path、完整 fingerprint、source/scratch fact、授权 request identity，以及 Runtime free-text failure。严格 fold 与 pre-commit invariant 要求每个已记录的 parent 和 input 都解析到更早提交的 artifact version；自 parent 与 terminal 对 start-owned input 的改写会明确失败。

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
 * element target names an addressable chart element by id and never reads
 * the store or mints an attachment.
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
