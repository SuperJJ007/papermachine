# Agent Note: store 权威迁移后 `dsh-tool-science` 的模型可见 artifact 字段

Status: implemented

[English](2026-09-02-science-tool-receipts-slimming.md) | 中文

## 问题

大型重复工具回执消耗上下文，而精确产物身份已足以在需要时请求其余信息。

## 决策

Science 工具结果在适用时保留简洁产物身份、版本、内容来源、整理状态、媒体类型及字节数。完整溯源和图形状态通过授权读取按需查询项目库，不把编辑操作列表重复写入日常结果。回执仍区分创建、注释、未变化结果和失败操作。

## 考虑过的替代方案

**连同细节一起删除产物身份。** 模型将无法引用精确结果。

**每次回执保留所有溯源及操作。** 重复上下文会复制已有耐久 owner 的信息。

**为缩短输出而隐藏失败。** 更小的结果会误报工作是否提交。

## 后果

精简回执减少重复上下文，不改变库权威或恰好一次身份。细节仍可显式读取。缩短输出不授权省略会话日志中的模型可见事实。

## 相关决策

相关 owner：[science-read-remotes](../architecture/2026-09-09-science-read-remotes.zh.md); [science-artifact-receipts-restoration](../bug-fix/2026-09-02-science-artifact-receipts-restoration.zh.md).
