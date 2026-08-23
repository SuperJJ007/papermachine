# Agent Note: Science 工作台 UI 收敛

Status: implemented

[English](2026-08-23-science-workbench-ui-convergence.md) | 中文

## Problem

Science artifact 可以通过会话 Details 操作进入，但外围产品仍把对话当作主要工作区。项目文件与结论没有稳定入口，模型辅助编辑在 artifact viewer 内使用第二个指令输入框，而工程用途的 Trajectory 是对话视图标签环里唯一的事件级记录。这些分裂造成导航重复，也让选中的图表元素离开用户的主请求上下文。

## Decision

仅在当前为 Science Session 时，Web 外壳才在会话浏览器上方展示相互独立的 Science 文件与结论入口。设置固定在侧栏底部。文件打开 artifact 舞台；结论打开仅展示 Outcome 的独立路径。完整的三栏 Science 工作台即使在应用偏好为深色时也使用浅色文档配色；非 Science Session 不会出现任何 Science 目的地、Trace 标签、composer accessory 或 kernel dock。

Science Details 条目继续作为 [Science artifact viewer panel](2026-08-18-science-artifact-viewer-panel.zh.md) 定义的权威 artifact 舞台：打开的 artifact 使用标签页，每个标签页拥有版本、溯源、下载和按媒体类型分派的内容，数据视图只读。Vega-Lite 元素行把人工样式选择与模型选择分开：点击名称或图表会打开样式面板，行内独立的 `+` 控件则把确切路径及可选元素备注暂存到主 composer。移除 composer chip 会立即恢复该行的 `+` 状态。带 chip 的发送会形成一条持久 `science-edit` 用户消息，其中有一个有序 `targets` 数组；每个 target 都指明确切 artifact 版本，并可携带各自经过校验的备注。Host 在把任何内容加入队列前，先针对完整折叠的会话逐项校验，错误会指出失败项的位置。发送成功后清空所有 chip；普通图片附件不能与这种结构化编辑一起发送。

Vega-Lite 直接样式控件保留在舞台中，并在不请求模型的情况下提交一个 human-edit 版本。artifact 内嵌的指令输入框和发送操作不存在，因此模型辅助 artifact 修改只有一个 composer 和一条可见请求路径。

仅限 Science 的对话标签环包含一个从已加载真实 Session node 与客户端安全 Science 投影生成的用户 Trace 视图。每一轮是一个意图组，汇总运行尝试、失败、运行耗时、artifact 增量、委派与杂项工具；标题只由结构化运行和 artifact 字段决定。用户消息、结构化选择与直接人工编辑位于中轴的用户侧，agent 任务组与结语位于另一侧。artifact 溯源先展示生成轮次中紧凑的用户请求与 agent 结论；显式 `call:` 与 `turn:` 按钮分别打开 Trajectory 和语义 Trace，`artifact:` 操作则打开确切 artifact 舞台。持久内核的语言、epoch 和生命周期状态也在主 composer 下方的一个固定读数中出现。

对话服务拥有按视图划分的 Session 可见性注册表与已挂载视图打开器。Science 根据所选 preset 或实时投影注册 Trace 可见性，因此普通对话不会出现 Science 标签，而溯源仍能在确切的 `turn:` 锚点打开 Trace。target chip 通过 Science locale 取文案，不内嵌英文。导出实现不属于本决策；C4 提供实际操作前，artifact 工具栏保留一个已禁用的本地化占位按钮。

## Alternatives considered

**保留 artifact 舞台中的第二个 composer。** 已拒绝：两条发送路径会把同一请求分裂到 artifact 局部状态与对话历史中，而且无法表达一条指令作用于多个 artifact 的目标。

**每个选中 target 发送一条消息。** 已拒绝：用户指令作用于整个选择集合；独立准入允许部分接受，也会丢失模型需要协调这些编辑的要求。

**仅把工程 Trajectory 账本作为 trace。** 已拒绝：它的原始事件检查与计时控件服务于调试。紧凑语义投影支持用户阅读因果关系，同时保留直达工程账本的路径。

**在 artifact 舞台重复显示内核状态。** 已拒绝：生命周期状态属于整个会话而非某个 artifact，两份副本会违反单一权威位置规则。

## Consequences

文件与结论解析为不同的 Details 目的地；文件落地视图仍保留最新 Outcome 作为上下文，而结论目的地不包含 artifact 导航。跨 artifact 选择在用户编写一条指令时保留，但只存在于浏览器本地，并且只在准入成功后清空。多目标消息扩大了持久 `science-edit` source 和模型可见文本，而每个 target 的确切版本准入与 `edit_of` 祖先规则不变。Trace 有意保持为线性语义投影：DAG 与 kernel epoch 分隔线留在工程检查中，委派只作为意图组内的一条折叠行，而不是独立泳道。

聚焦后端测试固定带备注 target 的有序文本与全有或全无校验。客户端组合测试固定仅限 Science 的目的地、accessory、kernel 与 Trace 可见性，以及双向元素暂存；keyless Science 场景通过真实可运行配置固定组装后的多目标消息。
