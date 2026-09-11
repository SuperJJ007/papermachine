# Agent Note: 从 store 生产者事实恢复 Science 同轮中间稿折叠

Status: implemented

[English](2026-09-02-science-same-turn-draft-folding-restoration.md) | 中文

## 问题

同 turn 中间草稿应降低显著性，但不能删除不可变版本，也不能把另一会话的 turn 计数当作当前会话。

## 决策

经过授权的版本摘要批次提供精确内容来源、生产会话与生产 turn。只有同一产物存在严格更晚、且生产会话和 turn 相同的版本时才折叠。Human-edit 始终豁免；有生产坐标的 run-auto 和 import 使用相同身份规则。摘要或 turn 缺失时版本仍可遍历。

原生产物 pane 只从默认 stepper 遍历中移除折叠版本。直接打开的折叠版本仍留在自己的遍历中，使相邻控制可离开它。Fold 只返回版本号，不修改存储。

## 考虑过的替代方案

**把生产者字段复制进会话投影。** 会产生第二个溯源权威。

**使用查看会话及其 turn 计数。** 项目链可能包含多个生产会话的版本。

**删除折叠版本或使其不可达。** 精确链接和历史分析会丢失目标。

## 后果

折叠仅影响呈现，不需要中间草稿开关。测试需要跨会话 turn 冲突、缺失元数据、人工编辑、任意输入顺序及直接打开折叠版本；单会话正常路径不能证明所有权规则。

## 相关决策

相关 owner：[science-native-sidebar](../architecture/2026-09-10-science-native-sidebar.zh.md); [science-read-remotes](../architecture/2026-09-09-science-read-remotes.zh.md).
