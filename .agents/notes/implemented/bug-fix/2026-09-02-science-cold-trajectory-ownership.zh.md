# Agent Note: 冷启动分页后仍保留 Science trajectory 归属

Status: implemented

[English](2026-09-02-science-cold-trajectory-ownership.md) | 中文

## 问题

Science Process 视图曾通过当前已加载 conversation node 中的 tool-call block 将 run 关联到 turn。冷启动 Session 最初只加载最新一页消息，而 Science projection 已经包含完整的 run 与 artifact 历史。因此，页外调用会丢失 turn 与 step，尽管严格 Science fold 已从持久化 `tool/call` 事件索引这些坐标。视图会把这些记录放进 Unassigned history，从摘要中漏掉相应 step 与早期 turn，只有用户加载更早消息后才自行修复。一份复现用的十二 turn 日志保留了全部十九个 run 与四个 artifact，却在初次渲染时只显示九个 turn 和二十九个调用中的二十一个；缺失的八个调用包含七个 Science run 与一个非 run 工具调用。

## 决策

Science projection 是 trajectory 结构的权威。严格 fold 在稀疏 checkpoint witness 中保留每个 turn 的生命周期，以及 mode 绑定后每个 tool call 的 identity、time、turn、step 与 name。浏览器安全 projection 通过 `trace` 发布这些字段，在 run 上重复授权坐标，并把当前打开的 run 或 annotation 调用坐标，作为每个新提交 artifact 版本的 trace 锚点。同一版本之后的纯元数据重录——`annotate_artifact` 在其产出调用已经 settle 之后再修改 title 或 caption——保留原产出调用的坐标；只有全新内容版本才能获得新锚点，重录永远不能，因此修改一张图表的元数据不会把 Process 视图的归属 chip 挪到正在修改元数据的调用上。对应 node 已加载时，conversation node 为 projected call 补充参数与结果；它不再决定某个 call、turn 或 run 是否存在。请求 node 缺失时使用既有的 unavailable-request placeholder。只要缺少 projection 归属坐标，UI 就优先使用版本在 store 上记录的 `producerTurn`（`ScienceVersionSummary.producer.turn`），而不是靠 store 时间去猜：`saveArtifactAs` 与一次直接改图的人工编辑提交都会在该 viewer 操作被调用的那一刻，从会话最后一次已开始的 turn 写入这个字段，因此在两个 turn 之间的空闲间隙里创建的版本会归属到当时正当前的 turn，而不是 store 写入提交那一刻恰好最新的 turn（见[producer.turn 归属](../bug-fix/2026-09-03-science-viewer-write-turn-attribution-and-data-loading-guidance.zh.md)）。既没有 projection 归属坐标、也没有 store `producerTurn` 的版本——这次修复之前就存在的直接人工编辑或 import，或是 trace 为空的兼容 projection——会回退到最后一个起始时间早于该版本 `createdAt` 的已知 turn；`createdAt` 早于所有已知 turn 的版本会加入 unassigned-history 区域，而不是硬猜一个 turn。本决策部分取代[轨迹中的 Science 过程步骤](../feature/2026-08-30-science-trace-process-view.zh.md)依赖分页的归属规则，以及[`science/artifact-saved` 事件瘦身](../architecture/2026-09-02-science-artifact-event-slimming.zh.md)所记录的客户端 artifact 坐标缺失；两份笔记仍保留各自的独立决策。

私有 projection cache 的 state version 提升到 18，因为 turn 记录与 artifact 坐标改变了编码 fold 和 witness 语义。即使没有 `science/*` 事件改变 `lastScienceEventSeq`，turn 与 call transition 也会通知 projection reader；mode 绑定前的 turn start 在 Science mode 绑定之前保持私有。

## 考虑过的替代方案

**渲染 Process 前加载完整 conversation。** 拒绝，因为这会把 trajectory 正确性绑定到无界 transcript 获取，延迟冷启动，并重复 Science fold 已经接纳的事实。

**根据 run 时间戳推断缺失 turn。** 拒绝，因为时间戳无法恢复非 run 调用、并行 step identity，也无法在时间窗口重叠或缺失时恢复精确的授权 turn。

**在用户加载更早消息前保留 unassigned 记录。** 拒绝，因为分页是一项呈现选择，不代表持久化归属未知。

## 后果

冷启动与实时 Process 摘要使用同一份完整 turn/call 索引，因此加载更早消息只会补充可用的请求文本与调用详情，不会改变 trajectory 归属或总数。projection 与 checkpoint 会为每个 turn 和 tool call 增加一条紧凑记录；不会增加参数、结果、消息文本、Host path 或 artifact-store 来源。单元覆盖固定 checkpoint replay、wire 坐标与仅含尾页的 UI 组装。一个合成浏览器 fixture 在不包含事故数据的前提下固定十二个 turn、二十九个调用、十九个 run、四个 artifact 与零条 unassigned 记录。
