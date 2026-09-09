# Agent Note: 投影 checkpoint 水位准入

Status: implemented

[English](2026-09-09-projection-checkpoint-watermark-admission.md) | 中文

## 问题

结构合法的检查点可能描述比其封套声明更早的事件前缀。

## Decision

类型合法的 checkpoint 仍可能在较新的外层序号下携带旧状态。按外层序号跳过事件会丢失持久化事实。投影定义可通过 checkpointStateSeq 公开状态水位。同一个解析器在缓存视图、回放种子或热恢复使用该行前，验证 stateSchema 以及水位与行序号相同。

## Consequences

无效行不发布缓存视图；提供的日志后缀不足时，必须完整回放。这项正确性检查不需要独立 checkpoint schema 或通知比较器。实时视图通知频率遵循上游引用比较行为。既有只读会话迁移准备记录处理日志格式转换，并未被此决定取代。

## 考虑过的替代方案

只在恢复时检查会让冷读取和水合接受不一致状态。另设检查点 schema 会重复验证。

补丁范围、行数和上游状态见[移栽补丁台账](../process/2026-09-09-replant-upstream-patch-ledger.zh.md)。
