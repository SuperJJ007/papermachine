# @deepseek-ai/dsh-science-session

[English](README.md) | 中文

Science Session 领域：持久化的 required-on-read Session 事件、严格确定性的 Host 重放、一个 pre-commit invariant、可选且客户端安全的 `science` Session projection，以及 `science/chart-saved` 附件提取器。本包不暴露变更服务，不启动进程，不观测解释器，不注册面向模型的工具或提示词，也不渲染客户端 UI。`@deepseek-ai/dsh-science-runtime` 追加 environment、run 与 chart 事件；`@deepseek-ai/dsh-tool-science` 绑定 mode 并发布 Outcome。

## 持久化词汇

六个 `science/*` Session 事件，各自 `version: 1`、无损 JSON、携带完整领域值而非补丁，且 required on read（永不 `ignorable`）：`science/mode-bound`、`science/environment-bound`、`science/run-started`、`science/run-finished`、`science/chart-saved`、`science/outcome-published`。`science/mode-bound` 只能对 `agentPreset` 为 `science` 的 Session 合法绑定一次，且必须早于 Science preset 的首个 `step/start`、`request/header` 或 `tool/call` 事实。Chart version 保留完整 `ImageAttachmentRef`；Outcome 保留对先前成功 run、精确 chart version 和/或 message fact 的非空引用。

## 严格 fold 与 invariant

`replayScience(events)` 把一段完整连续的日志确定性地重放为完整的 Host 侧 `ScienceProjection`，在有效 mode 绑定之前为 `null`。该 fold 拒绝不连续的序列、格式错误的值、非法转移、逆向来源证明（`requestHeaderSeq`/`toolCallId` 必须指向 mode 绑定之后同类事实中最新的一个）、被复用或已 settle 的 tool call、非单调的 revision 或时间，以及外来证据。只有 `session/end-seed` 才会为一个未匹配的运行中 run 派生 `interrupted`；不会追加任何合成的 Science 终态事件。包自带的 invariant（`./invariant`）在每次提交前应用同一条适用性规则与严格 fold，因此被拒绝的候选事件不会向持久化日志追加任何内容。

## Projection

仅当 `ctx.sessionProjections` 注册表被组合时才注册可选的 `science` key（`ctx.inject(['sessionProjections'], …)`）；未组合该注册表的宿主，或 Standard（非 Science）会话，永远不会携带该 key。公开的 `ScienceClientProjection` 保留 mode、无 path 的 environment capability/version 摘要、run status/history、chart 附件引用、最新 Outcome 与 metrics。它省略 configured/canonical prefix、executable path 与 identity、完整 environment fingerprint、source/scratch fact、授权 tool/request identity，以及 Runtime 自由文本失败。持久化私有状态是 `stateVersion: 2` 的纯 JSON：已观测事件水位线、编码后的严格 fold，以及稀疏脱敏 witness。`checkpointStateSchema` 只在重放 witness 能重建编码 fold 且与外层 `seq` 一致时接纳状态；`checkpointStateSeq` 绑定同一水位线；`viewChanged` 只在真正移动 `lastScienceEventSeq` 时发布公开变化，因为支持性事件可能推进私有水位线却不改变公开值。

## 附件授权

组合 `ctx.sessionAttachments` 时，本包注册 `science/chart-saved` 的唯一提取器。它严格解码事件并返回完整 chart 附件引用。Owner 缺失或事件格式错误时，授权与 Session export 会失败，而不会返回虚假的空集合。

## 模型体验

无，因为本包只校验并投影已经写入日志的会话事实，不触碰任何提示词、消息、schema、流或工具结果；Science 工具 Consumer 是独立包。

#### KV Cache 影响

无；本包从不组装或发送提供方请求。

## 已知限制与暂缓事项

- **稀疏的 projection witness 保留的是证据链，而非有界窗口。** 它会随保留的 Science 事实增长；不做常数时间或有界历史的承诺，这与通用 `session-projection` 注册表自身 checkpoint 约定中已被接受的取舍一致。
- **没有设置或当前状态 Details UI。** `@deepseek-ai/dsh-client-ui-science` 渲染 chart 与 Outcome 的会话记录 occurrence；设置和当前状态 Details 条目仍属于后续产品工作。
