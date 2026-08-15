# @deepseek-ai/dsh-science-session

[English](README.md) | 中文

Science Session 领域：持久化的 required-on-read Session 事件、严格确定性重放、一个 pre-commit invariant，以及可选的 `science` session projection。本包不暴露任何变更服务，不启动进程，不观测解释器，不注册任何面向模型的工具或提示词，也不渲染任何客户端 UI——`@deepseek-ai/dsh-science-runtime` 追加 environment 与 run 事件；后续工具 Consumer 才会追加本包校验与投影的其余事件。

## 持久化词汇

六个 `science/*` Session 事件，各自 `version: 1`、无损 JSON、携带完整的领域值而非补丁，且 required on read（永不 `ignorable`）：`science/mode-bound`、`science/environment-bound`、`science/run-started`、`science/run-finished`、`science/chart-saved`、`science/outcome-published`。`science/mode-bound` 只能对 `agentPreset` 为 `science` 的 Session 合法绑定一次，且必须早于 Science preset 的首个 `step/start`、`request/header` 或 `tool/call` 事实。图表与 Outcome 类型作为持久化词汇存在，即便其生产方（工具）属于后续切片。environment 与 run 事实由 `@deepseek-ai/dsh-science-runtime` 追加。

## 严格 fold 与 invariant

`replayScience(events)` 把一段完整连续的日志确定性地重放为公开的 `ScienceProjection`，在有效 mode 绑定之前为 `null`。该 fold 拒绝不连续的序列、格式错误的值、非法转移、逆向来源证明（`requestHeaderSeq`/`toolCallId` 必须指向 mode 绑定之后同类事实中最新的一个）、被复用或已 settle 的 tool call、非单调的 revision 或时间，以及外来证据。只有 `session/end-seed` 才会为一个未匹配的运行中 run 派生 `interrupted`；不会追加任何合成的 Science 终态事件。包自带的 invariant（`./invariant`）在每次提交前应用同一条适用性规则与严格 fold，因此被拒绝的候选事件不会向持久化日志追加任何内容。

## Projection

仅当 `ctx.sessionProjections` 注册表被组合时才注册可选的 `science` key（`ctx.inject(['sessionProjections'], …)`）；未组合该注册表的宿主，或 Standard（非 Science）会话，永远不会携带该 key。持久化的私有状态是 `stateVersion: 2` 的纯 JSON：一个已观测事件水位线、经编码的严格 fold，以及一个稀疏的脱敏见证（witness）。`checkpointStateSchema` 只在重放某行的 witness 能重建出与之编码一致的 fold、且与该行外层 `seq` 一致时才 admit 这行持久化状态；`checkpointStateSeq` 把每一份状态都绑定到同一个水位线上，使一份合法但陈旧的状态永远不能被拼接到更新的水位线下；`viewChanged` 把公开变更通知收窄到真正移动了 `lastScienceEventSeq` 的转移上，因为支持性事件（tool call、request header）可能推进私有水位线却不改变公开值。

## 模型体验

无，因为本包只校验并投影已经写入日志的会话事实，不触碰任何提示词、消息、schema、流或工具结果；后续的 Science 工具 Consumer 是独立的包。

#### KV Cache 影响

无；本包从不组装或发送提供方请求。

## 已知限制与暂缓事项

- **尚无 mode、图表或 Outcome 事件的生产方。** `@deepseek-ai/dsh-science-runtime` 追加 environment 与 run 事实；追加其余事件的工具 Consumer 属于后续切片。本包仍只校验并重放这份持久化词汇。
- **稀疏的 projection witness 保留的是证据链，而非有界窗口。** 它会随保留的 Science 事实增长；不做常数时间或有界历史的承诺，这与通用 `session-projection` 注册表自身 checkpoint 约定中已被接受的取舍一致。
- **没有 Science 专属的客户端 UI、设置或侧边栏。** 那些属于后续、受产品决策约束的切片；本包的 `ScienceProjection` 是一个不带渲染主张的纯协议值。
