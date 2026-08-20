# Science Runtime

[English](science.md) | 中文

Science 家族拥有七种 required-on-read Session 事件、产生 environment/run/artifact 事实的 host-local Runtime、面向模型的 Consumer，以及浏览器会话记录展示。[`dsh-science-session`](../../packages/science/science-session) 严格校验完整 durable 值，暴露客户端安全的 `science` Session projection，并注册 artifact 附件提取。[`dsh-science-runtime`](../../packages/science/science-runtime) 拥有 `ctx.scienceRuntime`：观测已配置的既有 Conda prefix、写入私有 scratch、执行 Python/R，并通过 `ctx.attachments` 导入 run 生成的 PNG。[`dsh-tool-science`](../../packages/science/tool-science) 在首次使用时绑定 mode/environment，渲染 `science:environment`，注册五个 Science 工具，并在 evidence 校验后发布 Outcome。[`dsh-client-ui-science`](../../packages/client/ui-science) 通过共享附件加载器渲染 chart 与 Outcome tool occurrence，持有以 `@deepseek-ai/dsh-science-runtime/with-settings` 注册的 `science-runtime` 命名空间为键的 Science 设置卡片，并加入一个 session-header action 以及一个只读的 `conversation.details.view` Details 条目——一个 artifact viewer：已打开图表的标签栏、面板内工具栏，以及每个图表版本的溯源下钻（代码、执行日志、消息、环境），加上位于无标签落地视图上的最新 Outcome。内置不可复制的 `science` preset 把 Consumer 与受限支持 roster 组装起来，但不携带 Runtime 行；已发布的 Web bundle 会以有意留空的配置档案映射在旁挂载 `with-settings`，具备实时能力的 Host 则另行挂载显式 Runtime 配置。

来源：[`packages/science/science-runtime/src/index.ts`](../../packages/science/science-runtime/src/index.ts)、[`packages/science/science-session/src/types.ts`](../../packages/science/science-session/src/types.ts) 与 [`packages/science/tool-science/src/index.ts`](../../packages/science/tool-science/src/index.ts)

## 操作

`bindEnvironment` 要求精确的活 Science Session 对象，观测一个允许列表中的 profile，并追加一条完整的 `science/environment-bound` 值。`startRun` 写入精确源码，在 spawn 前追加 `science/run-started`，并返回只包含 `runId`、`done` 与幂等 `cancel()` 的 `ScienceRunHandle`。`commitChart` 只接受由精确 Session 本地启动且已成功的 run，解析其 artifact directory 内的普通非 symlink PNG，通过 `ctx.attachments` 持久化，并在不公开 Host path 的前提下追加带有 `origin: 'model'` 的下一条不可变 logical artifact version。同一活 Session 上的第二项 Runtime 操作返回 `RUNTIME_BUSY`。Runtime 在创建 owner marker、scratch 或 Session 事件之前，拒绝 remote subprocess 世界以及无法报告 full enforcement 的 sandbox。

注册给客户端的 projection 与完整 Host replay 分离。它保留无 path 的 environment 摘要、run status/history、artifact 附件引用、最新 Outcome 与 metrics，同时省略 prefix/executable path、完整 fingerprint、source/scratch fact、授权 request identity，以及 Runtime free-text failure。

每次 probe 和 run 都使用 direct argv、`environmentBase: 'empty'`、固定 allowlist、owned cwd 与 full `workspace-write` confinement。Python 使用冻结的 isolated UTF-8 标志。R 版本发现使用独立的 `Rscript --version`；UTF-8 probe 与 run 使用 `--vanilla --encoding=UTF-8`。file-write confinement 不是保密性：它不隔离 read、network、syscall 或科学正确性。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
 * Acquire this run's persistent kernel (D3/D6), publish its run start,
 * then settle exactly one matching terminal fact through the acquired
 * kernel's own RUN/DONE protocol exchange (D5/D10).
 * @param request - Exact live Session, source, authorization facts, and cancellation.
 * @returns A handle exposed only after `science/run-started` committed.
 */
async startRun(request: StartScienceRunRequest): Promise<ScienceRunHandle>

/**
 * Re-commit an existing artifact version's exact attachment reference with
 * a curated title and caption: metadata-only, so it never reads or writes
 * the filesystem and never calls the attachment store, and it supersedes
 * the version it names rather than opening a new one whose bytes would
 * repeat their predecessor's. A committed event is never rolled back
 * because a later step fails; there is no later step here that can fail
 * after the append.
 * @param request - Exact live Session, target logical artifact (and optional version), title/caption, and cancellation.
 * @returns The durable curated version this operation committed.
 */
annotateArtifact(request: AnnotateScienceArtifactRequest): Promise<ScienceArtifactVersion>
```

Source: [`packages/science/science-runtime/src/index.ts:231`](../../packages/science/science-runtime/src/index.ts)
<!-- END GENERATED cordis-surface -->
