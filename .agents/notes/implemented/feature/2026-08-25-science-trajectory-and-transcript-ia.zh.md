# Agent Note：Science 轨迹与会话记录信息架构

Status: implemented

[English](2026-08-25-science-trajectory-and-transcript-ia.md) | 中文

## 问题

Science 把语义泳道作为工程 Trajectory 账本的平级会话视图，在泳道中复制 Assistant 散文，在 Chat 中直接展开执行输出，并在各个工具调用旁放置 artifact 卡。因此，同一 turn 的回答、过程输出与文件可能在多个表面重复出现。独立 Outcome Details 目的地还把已发布结论当成常驻对象，尽管它的持久语境已存在于会话记录中。

## 决定

Trajectory 拥有 session scope 的 `trajectory.view` 扩展 slot 和 `TrajectorySubviewRegistry`。内置 `detailed` 条目包含原生时间线与账本。Science 以更低 order 贡献 `swimlane` 并注册响应式可见性 source，因此泳道是 Science Session 的轨迹默认项，而非 Science Session 仍只有「详细」。选择按 Session 隔离，访问过的条目隐藏时仍保持挂载，因此切换视图不会丢弃局部检查状态。slot、可见性、locale、卸载与热更新变化通过稳定的 external-store 快照使外层失效。

泳道是权威会话与 Science 投影事实的可视索引。每个生成 turn 只有一张卡，并严格由三个展示行组成：单行用户要求、单行语言次数与失败摘要，以及不换行的精确 artifact 版本小标签。超长或无断点文本会被限制在卡片内。Assistant 散文与 Agent 结语不进入该投影。结构化运行摘要在「详细」中打开对应调用，artifact 小标签则在 Science Details 中打开所选版本。

Chat 保持 Assistant 散文不变，并折叠过程细节。`run_python`、`run_r`、`annotate_artifact` 与 `publish_outcome` 使用单行单元格，其代码、输出或证据只在展开后挂载。单元格展开是组件本地状态，不进入 Session 日志或模型请求。

Science 注册一个 turn scope 的 conversation Definition，用于聚合有效的 `science/artifact` 工具结果 presentation 值。它为每个逻辑 artifact 保留一个条目，仅在相同或更高版本出现时替换。Turn-tail 贡献在 Assistant 回复后渲染最终集合，因此 artifact 卡每轮只出现一次，而不在每个生成或标注调用旁出现。打开卡片会把精确 artifact id 与版本写入现有共享选择存储。产物数 ≤ 6 时该组渲染全部卡片；≥ 7 时渲染前 5 张加一个「+N 更多」按钮原地展开其余产物，对齐 `CS-TURN-RENDERING-SPEC.md` 的 GENERATED 托盘规则。标题计数始终是本轮总数，不是可见数；展开选择是组件本地视图状态，刷新后恢复默认。

侧边栏与 Details 列只公开文件。已发布 Outcome 保留在折叠的会话单元格中；不存在 Outcome-only Details 目的地，artifact 落地视图也没有 Outcome 小节。

## 考虑过的替代方案

**把泳道保留为平级会话标签。** 已拒绝，因为语义与工程轨迹是同一因果记录的两种表示。内层扩展点为它们提供一个稳定目的地，同时使通用 Trajectory 包不依赖 Science。

**卸载非活跃 Trajectory 子视图。** 已拒绝，因为从「详细」返回会丢弃局部折叠、时间线聚焦与检查状态。外壳在子视图首次访问后挂载它，之后只改变可见性。

**在每个工具调用处渲染 artifact 卡。** 已拒绝，因为同一逻辑 artifact 可能在一轮中被捕获和标注多次。Turn scope 聚合为会话记录提供唯一的最终、版本感知文件组。

**从当前 Science 投影派生轮末 artifact。** 已拒绝，因为投影作用于整个 Session，并且可以独立于已加载 turn 继续前进。append-surface 工具结果已携带与该 turn 关联的 presentation 值。

**持久化单元格展开状态。** 已拒绝，因为展开是展示偏好，不是持久会话事实或模型输入。

## 后果

需要另一种轨迹表示的插件可注册 `trajectory.view` 及可选的对应可见性 source，无需修改 `ui-trajectory`。Science Session 在「详细」之前展示泳道，所有外层会话导航仍只定址一个 `trajectory` 视图。

会话记录仍是唯一的完整散文账本。泳道卡是有界的事实摘要，执行细节按需展开，每个 turn 至多有一个最终 artifact 组。如果工具结果没有有效的标签化 artifact presentation 元数据，即使 Session 投影稍后包含相关 artifact，该结果也不会贡献轮末卡。

本决定收紧了 [Science 工作台 UI 收敛](2026-08-23-science-workbench-ui-convergence.zh.md) 中的 Trace 与 Outcome 放置。该 Note 对文件舞台、composer 选择、设置、内核状态、浅色 composition 与桌面 toggle 放置的决定仍然有效。
