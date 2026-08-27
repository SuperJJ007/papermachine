# Agent Note: Checkpoint row admission falls back to stateSchema when checkpointStateSchema is omitted

Status: implemented

[English](2026-08-27-session-projection-checkpoint-admission-schema-fallback.md) | 中文

## Problem

`SessionProjectionRegistry.admitCheckpointState`(`packages/session/session-projection/src/index.ts`)在某单元未提供 `checkpointStateSchema` 时,会完全不校验就 admit 已持久化 checkpoint 行的 `val`——除了大多数单元同样省略的可选 `checkpointStateSeq` 水位检查。一个未提供 `checkpointStateSchema` 的单元(常见情况:大多数单元的 checkpoint 表示与其实时状态完全一致)在把某行送入 `wire.view`/`viewSchema.parse` 或用它种子化一次 fold 之前,得到的结构性校验为零。一行畸形数据(存储损坏、状态形状在 `stateVersion` 未提升的情况下漂移、手改的 fixture)会带着任意形状直接抵达 `wire.view`,直到之后才失败——以 `viewCheckpoint`/`restore` 抛出未捕获 `ZodError` 的形式,与已记录的合同相悖:包 README 写明持久化缓存"用 stateSchema 校验 val 之后才使用",[state/client-view 拆分的 Agent Note](../architecture/2026-08-19-session-projection-state-and-client-views.zh.md) 记录"缓存的行在种子化一次 fold 之前会被校验"。`packages/session/session-projection/tests/registry.spec.ts` 的 `'rejects version-matching rows whose state no longer matches the registered schema'` 测试正抓到了这一点:`viewCheckpoint` 抛出异常,而不是返回 `{}`。

## Decision

`admitCheckpointState` 现在统一用 `def.checkpointStateSchema ?? def.stateSchema` 校验 `row.val`,去掉了此前对无 schema 单元的无条件信任分支。`stateSchema` 的类型擦除形状从 `{ parse(...) }`——一个实际上本模块从未调用过的形状——加宽为 `{ safeParse(...) }`,与 `checkpointStateSchema` 既有的形状一致,因为 admission 绝不能抛出异常。`checkpointStateSchema` 仍保留其原有角色:供 checkpoint 表示形式需要与实时状态 `stateSchema` 不同校验的单元覆盖使用;省略它的单元不再在 checkpoint 边界上完全不受校验——而是继承 `stateSchema`。两个字段的 JSDoc 与包 README 现已明确写出这一回退关系。

唯一依赖旧的"两次尝试恢复"行为的既有消费方测试——`packages/session/session-projection-cache/tests/cache.spec.ts` 的 `'discards malformed persisted state and degrades to one full re-read'`——原先断言:第一次 `readFrom` 调用锚定在(被误信的)该行水位上,`restore()` 中抛出 `ZodError`,再由缓存自身的恢复逻辑发起从 `0` 开始的第二次完整重读。修复后,`restoreFloor` 自身的 admission 检查已能立即抓到畸形行,因此第一次读取时 floor 就是 `0`:只需一次 `readFrom` 调用,与相邻的 `'discards a version-mismatched row'` 测试形状完全一致。已更新为断言一次调用。

## Alternatives considered

**保留 `admitCheckpointState` 对无 schema 分支的处理,但只校验 `row.seq`(即今天 `checkpointStateSeq` 的行为)。** 已拒绝:已记录的合同与失败的测试都要求对某行状态做结构性 admission,而不只是校验其水位;单独的水位检查抓不住形状漂移。

**要求每个 `ProjectionDefinition` 都显式提供 `checkpointStateSchema`,去掉该可选字段的隐式回退。** 已拒绝:每一个现有消费方(`session-stats`、`token-meter`、`subagent`、`science-session`)都得写一份与 `stateSchema` 完全相同的重复 schema,却不会带来任何行为差异;该字段自身的 JSDoc 早已将其定位为供 checkpoint 状态需要不同处理的单元使用的覆盖项,而非强制性的重复声明。

## Consequences

现在每个单元的 checkpoint 行在能够种子化一次 fold 或抵达 `wire.view` 之前,都会先经过一个真实 schema 的校验——一行陈旧、损坏或手改的数据会被干净地拒绝 admission(`viewCheckpoint` 返回空值、`restore` 触发完整重读),而不是把未捕获的 `ZodError` 甩给 carrier。当两种形状一致时(这是当前每个消费方的常见情况),`checkpointStateSchema` 不再需要重复声明单元的 `stateSchema`。`session-projection-cache` 的 `coldSnapshot` 现在对一行畸形数据只需一次完整重读即可恢复,而非两次,与其"版本不匹配"的相邻测试保持一致。

## Verification

`packages/session/session-projection/tests/registry.spec.ts` 的 `'rejects version-matching rows whose state no longer matches the registered schema'` 现已通过:对于 `val` 未通过 `stateSchema` 的行,`viewCheckpoint` 返回 `{}`,`restore` 抛出异常。`packages/session/session-projection-cache/tests/cache.spec.ts` 的 `'discards malformed persisted state and degrades to one full re-read'` 已更新为断言从 seq `0` 开始的一次 `readFrom` 调用。`session-projection`、`session-projection-cache`、`session-stats`、`token-meter`、`subagent`、`science-session` 的完整测试套件在其余部分保持不变通过,确认当前没有任何消费方依赖过这条未经校验的回退路径。
