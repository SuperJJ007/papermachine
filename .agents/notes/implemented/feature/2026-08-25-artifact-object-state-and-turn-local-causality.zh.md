# Agent Note: Artifact 对象状态与逐轮因果

Status: implemented

[English](2026-08-25-artifact-object-state-and-turn-local-causality.md) | 中文

## Problem

Science artifact stage 在对象状态旁累积了因果信息：差异与溯源 mode、嵌套的代码/日志/消息/审阅/环境 tabs，以及通往 session-wide Trace 与 Trajectory view 的链接。同一份生成回答同时出现在聊天、语义 group 与 Agent 结语卡中。这让 artifact panel 同时回答“这个对象现在是什么”和“这一轮如何产出它”，而用户 annotation 没有持久、私有的归属位置。

## Decision

Conversation 拥有时间与因果。每个产出 artifact 的 assistant 轮次获得一个紧凑 turn-tail 条目与就地三行轨迹：一行截断的用户要求、一行结构化事实和一行 run/artifact 操作。Run 操作可展开代码、执行输出与环境事实；artifact 操作打开精确版本。轨迹绝不复制 assistant 散文。缺少权威持久化来源的事实——包括安装包与人工操作类别——保持缺失，不从代码或输出文本推断。

Artifact stage 拥有对象状态。它保留预览、精确版本导航、纯用户备注，以及跳到产出所选版本的 assistant 消息。差异与顶级溯源 mode 不再存在。代码、日志与环境 renderer 只作为消息侧 run details 保留。审阅、Agent 结语以及常驻轨迹/语义泳道控件被删除。

Artifact 备注持久化但不对模型可见。`science/artifact-note-added` 与 `science/artifact-note-removed` 是 merge-extensible Session events，声明为可安全跳过并携带 `ignorable: true` 追加；`SESSION_FORMAT_VERSION` 保持 `0`。独立的 `scienceArtifactNotes` projection 按 logical artifact fold 活跃备注。Host Remote 在追加前校验精确 artifact version 与活跃 note sequence。备注绝不进入 `ScienceClientProjection`、prompt assembly 或 `Agent.followup()`。

`Session.append()` 只对合并进 `IgnorableSessionEventMap` 的 event type 接受 ignorable marker，并要求这些类型提供 literal marker。这样可防止调用方误把 required runtime fact 标成旧 reader 可选。

本决策只取代 [Science 工作台 UI 收敛](2026-08-23-science-workbench-ui-convergence.zh.md)中的 artifact-view mode 与 session-wide Trace placement。其 shell、navigation、composer 与直接编辑决策仍然有效。

## Alternatives considered

**在 artifact stage 保留溯源并增加逐轮 shortcut。** 拒绝，因为两个因果归属位置会漂移，也会让对象 panel 的永久导航依赖对象如何产出。

**保留 Agent 结语卡但进行截断。** 拒绝，因为相邻 assistant 消息已经是完整来源，截断仍会制造第二份可能误导的副本。

**把备注保存在浏览器状态。** 拒绝，因为备注会在 reload 与跨设备时消失，也无法参与 session export 或 restore。

**把备注加入主 Science projection。** 拒绝，因为 runtime 与 model-facing consumer 会读取该 projection；独立 projection 让纯用户保证明确且可审查。

**通过通用 append option 把所有 non-surface event 标为 ignorable。** 拒绝，因为 required lifecycle 与 runtime fact 可能因此被误标。Merge-extensible allowlist 让 skip safety 成为有 owner 的声明。

## Consequences

Viewer 只有一种内容 mode，selection store 更小。逐轮轨迹贴在其产出聊天上下文上，并通过组件结构、CSS 截断与窄宽度测试强制三行预算。Run details 可在紧凑卡片下方扩展，不改变该预算。

备注适用于所有已接受 artifact media type，持久保存在 session log，且不进入模型请求。旧 build 会跳过两种备注 event type，而不是拒绝日志；既有 Science domain event 仍全部 required on read。聚焦 projection、Remote、viewer、turn-tail、assembled-client 与 keyless snapshot coverage 固定这些属性。
