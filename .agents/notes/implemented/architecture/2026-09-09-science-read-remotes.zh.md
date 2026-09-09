# Agent Note: Science 读取 Remote 与文件准入

Status: implemented

[English](2026-09-09-science-read-remotes.md) | 中文

## 问题

应用代理 RPC 接口移除后，Science 读取仍须保持会话授权。

## Decision

Science 读取方法属于领域，而非 Host 代理聚合。生成的 Remote 服务通过 SessionQuery 解析实时或持久化会话，以会话 header.cwd 所属项目作为读取授权边界（cwd 缺失即拒绝），本会话产物使用事件坐标，同项目其他版本经存储核实后可读，并从产物存储读取当前元数据。connection 服务负责精确 GET/HEAD 字节路由的认证。两种读取路径使用同一个授权函数。

## Consequences

文件附件使用上游原字节文件引用。V3 载体扫描确立引用归属；文件名媒体策略和严格 UTF-8 解码共同约束文本预览。图像编辑通过显式原字节图像准入保留经验证的原始字节。仅面向用户的笔记写入采用必需事件和独立投影；完整历史格式迁移仍为独立工作包。本树没有拥有已删除 Host 代理实现的活动记录。

## 考虑过的替代方案

把领域读取放入通用会话控制器会让其发布和依赖与 Science 耦合。字节路由使用独立授权实现可能与 Remote 读取产生分歧。

补丁范围、行数和上游状态见[移栽补丁台账](../process/2026-09-09-replant-upstream-patch-ledger.zh.md)。
