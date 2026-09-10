# Agent Note: `saveArtifactAs` —— 把一个已提交的 artifact version 复制进一个新逻辑 artifact

Status: implemented

[English](2026-09-02-science-save-artifact-as.md) | 中文

## 问题

用户可能希望由精确现有版本建立独立产物链，但不能假装重新执行了原始分析。

## 决策

另存读取经过授权的精确项目版本，复制字节并保留显式来源，创建新的逻辑产物身份，不冒充最初生产运行。库规则验证新名称并裁决项目级唯一性；调用会话记录自己对已提交结果的引用。另一会话的来源仍为项目库引用，不虚构本地运行。

操作在入口捕获用户动作归属，并使用共享提交、追加及孤立处理。

## 考虑过的替代方案

**重命名原链。** 会改变已有引用身份，而不是创建独立结果。

**复制原生产者，声称它生成了新产物。** 会抹去用户另存动作。

**等待后才解析移动的 latest 来源。** 并发写入可能改变用户所选字节。

## 后果

新链可独立演化并保留显式来源关系。另存不是通用跨项目导入，库提交成功与会话事件送达仍是两个操作。

## 相关决策

相关 owner：[project-artifact-store-schema-v2](../architecture/2026-09-01-project-artifact-store-schema-v2.zh.md); [science-viewer-write-turn-attribution-and-data-loading-guidance](../bug-fix/2026-09-03-science-viewer-write-turn-attribution-and-data-loading-guidance.zh.md).
