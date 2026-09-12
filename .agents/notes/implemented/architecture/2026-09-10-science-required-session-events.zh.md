# Agent Note: Science 必读事件与历史 Session 拒绝

Status: implemented

[English](2026-09-10-science-required-session-events.md) | 中文

## Problem

跳过 artifact note 会丢失持久化用户状态，即使 note 不进入模型消息。PaperMachine 0.1.0 还将 Science 事件保存在 V0 日志中；若没有 Science 专属重映射，其序号引用无法安全通过上游相邻迁移。

## Decision

全部九种 Science 事件都声明在 `SessionEventMap` 中；Science 不扩展 `IgnorableSessionEventMap`。Note 添加/删除使用普通 Session append，不携带 `ignorable` 标记，仍是由独立 `scienceArtifactNotes` 投影折叠的非 surface 事件。Science 重放拒绝带 ignorable 标记的已知 Science 事件。七种模型状态事件保留既有严格折叠与 preset 适用规则。

生成的当前事件目录识别全部九种类型。原生 V3 持久化原样保留其载荷与序号引用。已发布的 V0、V1、V2 codec 和相邻迁移不增加 Science disposition 或载荷改写。持久化 provider 在读、写打开时均拒绝旧 Science 日志；拒绝时既不改变原字节，也不发布迁移后继文件。这遵循[已发布代际规则](2026-08-31-released-session-format-migrations.zh.md)。

## Alternatives considered

**继续将 note 标为 ignorable。** Note 缺失不改变模型历史，却丢失用户撰写的状态，因此不能依据模型可见性让读者选择跳过事件。

**为历史迁移添加 opaque disposition。** V1 到 V2 的 chunk 压缩和 V2 到 V3 的改写会重新编号事件。Opaque Science 载荷保留旧 `requestHeaderSeq` 与 `noteSeq`，因此格式转换成功不能证明重放有效。

**在移栽中恢复旧 Science 会话。** 已批准的 D1 决定延后该工作。恢复需要 disposition、三条相邻迁移边上的 Science 引用重映射，以及真实旧日志的重放验证；计划估算为两到三天，不承诺交付时间。

## Consequences

PaperMachine 0.1.0 Science 会话在移栽版本中不可读。其文件保持完整，新会话使用 V3。[发布说明](../../../../docs/user/papermachine-0.1.2-release-notes.zh.md)明确这一限制。只读取 header 的列表展示不能证明会话正文可打开。不含 Science 事件的普通上游 V0 会话保留上游迁移支持；该决定不增加全面禁止 V0 的规则。

[存储回归测试](../../../../packages/science/science-session/tests/persistence.spec.ts)对全部九种类型进行普通与 Zstandard V3 读写往返，并在读写时拒绝各旧类型，同时保留字节与文件身份。Note Remote 测试验证必读 envelope 且不产生 agent follow-up。[P3 验收](../../../migrations/0.1.5/P3.md)记录真实 V0 证据和两个 SDK 投影的刷新。P3 不修改上游运行时包；持久化目录输出来自自有 Science JSDoc。
