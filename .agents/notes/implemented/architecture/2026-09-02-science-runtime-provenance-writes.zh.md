# Agent Note: `science-runtime` 把来源事实写进库，不再写进事件

Status: implemented

[English](2026-09-02-science-runtime-provenance-writes.md) | 中文

## 问题

会话本地产物投影可能落后于项目库，元数据整理也不能覆盖最初生产者或重复执行工具重试。

## 决策

Runtime 在创建或延伸链前解析当前库身份和 head。库事务裁决并发创建，并为整理操作消费完整工具调用身份。捕获记录内容生产者，后续注释追加自己的作者及显式清空语义，不替换生产者。显式输入基线与 ordinal 前驱保持区分。

会话产物事件引用已提交结果。库提交后若追加失败，孤立处理保留原始错误，并由库与日志对账 owner 处理后续一致性。

## 考虑过的替代方案

**只按会话本地最大版本分配。** 另一会话可能已推进共享链。

**预扫历史判断调用是否已消费。** 无法原子裁决并发写入或尚未出现在日志中的提交。

**用户整理元数据时替换生产者字段。** 会把已有内容错误归因给注释者。

## 后果

SQLite 事务是唯一性权威。会话日志不能追溯回滚已提交项目版本。删除会话后溯源仍有意义，而来源字节缺失和事件追加失败仍是明确失败情况。

## 相关决策

相关 owner：[project-artifact-store-schema-v2](2026-09-01-project-artifact-store-schema-v2.zh.md); [science-artifact-receipts-restoration](../bug-fix/2026-09-02-science-artifact-receipts-restoration.zh.md); [artifact-store-session-reconciliation](2026-09-01-artifact-store-session-reconciliation.zh.md).
