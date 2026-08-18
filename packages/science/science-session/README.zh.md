# @deepseek-ai/dsh-science-session

[English](README.md) | 中文

Science Session 领域：持久化的 required-on-read Session 事件、严格确定性的 Host 重放、一个 pre-commit invariant、可选且客户端安全的 `science` Session projection，以及 `science/artifact-saved` 附件提取器。本包不暴露变更服务，不启动进程，不观测解释器，不注册面向模型的工具或提示词，也不渲染客户端 UI。`@deepseek-ai/dsh-science-runtime` 追加 environment、run 与 artifact 事件；`@deepseek-ai/dsh-tool-science` 绑定 mode 并发布 Outcome。

## 持久化词汇

六个 `science/*` Session 事件，各自 `version: 1`、无损 JSON、携带完整领域值而非补丁，且 required on read（永不 `ignorable`）：`science/mode-bound`、`science/environment-bound`、`science/run-started`、`science/run-finished`、`science/artifact-saved`、`science/outcome-published`。`science/mode-bound` 只能对 `agentPreset` 为 `science` 的 Session 合法绑定一次，且必须早于 Science preset 的首个 `step/start`、`request/header` 或 `tool/call` 事实。`science/artifact-saved` 把持久化模型从 chart 泛化开来：一个 artifact version 携带始终填充的 `title`、可选的 `caption`、`origin`（`'auto'` 表示无人值守捕获，`'model'` 表示模型策展）、以及完整的 `ImageAttachmentRef | TextAttachmentRef`；`logicalName` 是一个以正斜杠分隔的路径(每个 segment 遵循与其它持久化 id 相同的安全语法)，因此被捕获文件相对其 run artifact 目录的路径可以直接作为合法的逻辑名。它可以引用任何到达终态的 run——success、failed、timed-out 或 cancelled——不再局限于成功的 run，因为失败 run 的部分输出同样有资格被捕获。Outcome 保留对先前成功 run、精确 artifact version 和/或 message fact 的非空引用。

## 严格 fold 与 invariant

`replayScience(events)` 把一段完整连续的日志确定性地重放为完整的 Host 侧 `ScienceProjection`，在有效 mode 绑定之前为 `null`。该 fold 拒绝不连续的序列、格式错误的值、非法转移、逆向来源证明（`requestHeaderSeq`/`toolCallId` 必须指向 mode 绑定之后同类事实中最新的一个）、被复用或已 settle 的 tool call、非单调的 revision 或时间，以及外来证据。一次仅改动策展元数据的重存——`attachment` 完全相同，只是 `title`、`caption` 或 `origin` 发生变化——仍会提交下一个连续 version；fold 本身不做任何基于内容哈希的去重，调用方若想跳过未变化的文件，需要自行在追加前比较内容哈希。一个 `origin: 'auto'` 的 artifact version，其 `toolCallId`/`requestHeaderSeq` 必须与其来源 run 自身的值相等(该值在 run 启动时已被证明)，因为无人值守捕获并非一次独立的模型发起调用，也从不重复消费某次调用——从同一个 run 捕获的多个文件共用该 run 的调用。`origin: 'model'` 的 version 则一如既往，每次都独立消费一次全新的 tool call。只有 `session/end-seed` 才会为一个未匹配的运行中 run 派生 `interrupted`；不会追加任何合成的 Science 终态事件。包自带的 invariant（`./invariant`）在每次提交前应用同一条适用性规则与严格 fold，因此被拒绝的候选事件不会向持久化日志追加任何内容。

## Projection

仅当 `ctx.sessionProjections` 注册表被组合时才注册可选的 `science` key（`ctx.inject(['sessionProjections'], …)`）；未组合该注册表的宿主，或 Standard（非 Science）会话，永远不会携带该 key。公开的 `ScienceClientProjection` 保留 mode、无 path 的 environment capability/version/package-inventory 摘要、run status/history、artifact 附件引用、最新 Outcome 与 metrics。run 与 artifact 记录保留其授权用的 `toolCallId` 与 `requestHeaderSeq`——浏览器已经持有的 session-log identity——因此客户端无需额外的 Host 路由即可将一次 run 或 artifact version 与其会话记录中的 tool call 关联起来。run 记录还完整保留其 `codeSha256`，与环境指纹不同：它是对同一条会话记录调用已经逐字复述过的源代码文本求的摘要，因此不携带任何 Host 基础设施事实，而溯源需要这一持久化锚点保持精确、不能只留预览。它省略 configured/canonical prefix、executable path 与 identity、完整的 environment 与 package-inventory fingerprint（仅保留十二字符预览）、source/scratch fact，以及 Runtime 自由文本失败。持久化私有状态是 `stateVersion: 3` 的纯 JSON：已观测事件水位线、编码后的严格 fold，以及稀疏脱敏 witness。`checkpointStateSchema` 只在重放 witness 能重建编码 fold 且与外层 `seq` 一致时接纳状态；`checkpointStateSeq` 绑定同一水位线；`viewChanged` 只在真正移动 `lastScienceEventSeq` 时发布公开变化，因为支持性事件可能推进私有水位线却不改变公开值。

## 附件授权

组合 `ctx.sessionAttachments` 时，本包注册 `science/artifact-saved` 的唯一提取器。它严格解码事件并返回完整 artifact 附件引用。Owner 缺失或事件格式错误时，授权与 Session export 会失败，而不会返回虚假的空集合。

## 模型体验

无，因为本包只校验并投影已经写入日志的会话事实，不触碰任何提示词、消息、schema、流或工具结果；Science 工具 Consumer 是独立包。

#### KV Cache 影响

无；本包从不组装或发送提供方请求。

## 已知限制与暂缓事项

- **稀疏的 projection witness 保留的是证据链，而非有界窗口。** 它会随保留的 Science 事实增长；不做常数时间或有界历史的承诺，这与通用 `session-projection` 注册表自身 checkpoint 约定中已被接受的取舍一致。
- **没有设置或当前状态 Details UI。** `@deepseek-ai/dsh-client-ui-science` 渲染 chart 与 Outcome 的会话记录 occurrence；设置和当前状态 Details 条目仍属于后续产品工作。
