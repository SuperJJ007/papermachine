# Agent Note: Science 工作台 UI 收敛

Status: implemented

[English](2026-08-23-science-workbench-ui-convergence.md) | 中文

## Problem

Science artifact 可以通过会话 Details 操作进入，但外围产品仍把对话当作主要工作区。项目文件与结论没有稳定入口，模型辅助编辑在 artifact viewer 内使用第二个指令输入框，而工程用途的 Trajectory 是对话视图标签环里唯一的事件级记录。这些分裂造成导航重复，也让选中的图表元素离开用户的主请求上下文。

## Decision

Web 外壳在会话浏览器上方展示当前项目的固定入口：会话、文件和结论。设置固定在侧栏底部。扣除侧栏后，中间对话列与右侧 artifact 舞台默认平分宽度；没有选择会话时舞台仍然可见，并说明选择后会展示真实项目 artifact。

Science Details 条目继续作为 [Science artifact viewer panel](2026-08-18-science-artifact-viewer-panel.zh.md) 定义的权威 artifact 舞台：打开的 artifact 使用标签页，每个标签页拥有版本、溯源、下载和按媒体类型分派的内容，数据视图只读。舞台可以选择 Vega-Lite 路径或归一化 raster 区域，并把它们作为可单独移除的 chip 添加到主 composer。带 chip 的发送会形成一条持久 `science-edit` 用户消息，其中有一个有序 `targets` 数组；每个 target 都指明确切 artifact 版本。Host 在把任何内容加入队列前，先针对完整折叠的会话逐项校验，错误会指出失败项的位置，并为每个 raster target 附加一个 image block。发送成功后清空所有 chip；普通图片附件不能与这种结构化编辑一起发送。

Vega-Lite 直接样式控件保留在舞台中，并在不请求模型的情况下提交一个 human-edit 版本。artifact 内嵌的指令输入框和发送操作不存在，因此模型辅助 artifact 修改只有一个 composer 和一条可见请求路径。

对话标签环包含一个只从已加载真实 Session node 投影的用户 Trace 视图。它按轮次组织意图、推理、动作与证据泳道，并把工具检查交给既有 Trajectory 工程账本。持久内核的语言、epoch 和生命周期状态只在主 composer 下方的一个固定读数中出现。

首版组合在所有对话中注册 Trace 与 Science 外壳席位，因为这些注册点还没有 Science 会话判定。target chip（包括归一化区域标签）通过 Science locale 取文案，不内嵌英文。导出实现不属于本决策；C4 提供实际操作前，artifact 工具栏必须保留一个已禁用的本地化占位按钮。

## Alternatives considered

**保留 artifact 舞台中的第二个 composer。** 已拒绝：两条发送路径会把同一请求分裂到 artifact 局部状态与对话历史中，而且无法表达一条指令作用于多个 artifact 的目标。

**每个选中 target 发送一条消息。** 已拒绝：用户指令作用于整个选择集合；独立准入允许部分接受，也会丢失模型需要协调这些编辑的要求。

**仅把工程 Trajectory 账本作为 trace。** 已拒绝：它的原始事件检查与计时控件服务于调试。紧凑语义投影支持用户阅读因果关系，同时保留直达工程账本的路径。

**在 artifact 舞台重复显示内核状态。** 已拒绝：生命周期状态属于整个会话而非某个 artifact，两份副本会违反单一权威位置规则。

## Consequences

在首个单项目版本中，文件与结论共享 Science 舞台；结论仍是落地视图中的一个小节，不获得伪 artifact 标签页。跨 artifact 选择在用户编写一条指令时保留，但只存在于浏览器本地，并且只在准入成功后清空。多目标消息扩大了持久 `science-edit` source 和模型可见文本，而每个 target 的确切版本准入与 `edit_of` 祖先规则不变。Trace 有意保持为线性语义投影：DAG、subagent 泳道与 kernel epoch 分隔线留在工程检查中，而不进入用户视图。

聚焦后端测试固定有序多目标文本、raster block 顺序和全有或全无校验。客户端组合测试固定目的地、accessory、kernel 与 Trace 注册；keyless Science 场景通过真实可运行配置固定组装后的多目标消息。
