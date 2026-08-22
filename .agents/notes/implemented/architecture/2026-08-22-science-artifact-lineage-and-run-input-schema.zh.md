# Agent Note: Science artifact 谱系与 run input 是 session 事实

Status: implemented

[English](2026-08-22-science-artifact-lineage-and-run-input-schema.md) | 中文

## Problem

Science artifact version 记录了生产来源证明，却无法说明一次编辑继承自哪个精确版本。Run 同样记录了代码与执行环境，却没有记录其消费的 artifact version。文件名推断无法弥补任一缺口：两个 artifact 可以同名，一个 version 可以分支出多次编辑，而一次 run 也可以把某个 version 物化到不同的 input path。

更广泛的 [artifact 领域与图像编辑提案](../../proposed/architecture/2026-08-22-science-artifact-domain-and-image-edit.zh.md)需要先具备这些关系，Runtime 物化、工具参数或 viewer 编辑才能依赖它们。

## Decision

`ScienceArtifactVersion` 携带可选的 `parent: { artifactId, version }`。这一对 identity 精确指明产出该 version 的操作所命名的内容基线。数字 version 顺序仍表示提交顺序；只有 `parent` 记录谱系，包括跨 artifact 分支，或从较旧 version 分支。

`ScienceRunIdentity` 携带可选的 `inputs` 数组，每项为 `{ artifactId, version, path }`。字段存在时，`science/run-started` 固定该数组，`science/run-finished` 再随其它由 start 固定的 identity 字段原样重复，因此用 terminal 值替换 projection 中的 running 值时不会丢失依赖来源证明。Fold 把字段缺失与空数组视为同一个 run identity，在不改写事件值的前提下保留该字段引入前写入的日志。`path` 是 run 保留的 `inputs/` 目录下规范的正斜杠位置；同一次 run 内路径唯一。

只有当指定 artifact version 已在同一 Session 中更早提交时，严格 fold 才接受 parent 或 input。Parent 不能指名正在提交的 version，一次就地取代也不能改写该 version 既有的 parent。Terminal run 事实必须逐项、按序原样重复 input 数组。包 invariant 在 commit 前执行这些规则，客户端 projection 与由 witness 验证的 checkpoint 则无损保留两种关系。

`ScienceRuntime.startRun` 通过独立的 [input 物化与 edit baseline 决策](../feature/2026-08-22-science-runtime-input-materialization-and-edit-baselines.zh.md)产生这些关系。面向模型的工具参数与 receipt 仍是本 schema 决策以外的 Consumer 职责。

## Alternatives considered

**从 logical name 或 path 推导关系。** 名称是展示与 workspace 坐标，不是不可变 identity。它们无法区分两个同名 artifact、保留已改名 input，或表示同一基线的多个子分支。

**把依赖与谱系 edge 存入独立 graph。** 既有 artifact 与 run 事件已经拥有每条 edge 所限定的事实。在项目级 catalog 出现之前，第二套存储会额外要求一次 transaction、另一条 replay 路径，以及新的同步规则。

**只在 `science/run-started` 携带 inputs。** Fold 会用 terminal 完整值替换 running 记录。若 inputs 不属于 `ScienceRunIdentity`，每个已 settle run 的 projection 都会丢失它们，或系统必须保留第二套 start-record authority。

**把 `inputs` 设为必填，并在解码时把缺失字段补成空数组。** 这种规范化会改变旧事件的重放值，并要求当前所有生产方在 Runtime 物化尚不存在时先增加字段。保持字段可选既保留了既有日志，也避免把本次 schema 变更扩展到 Runtime、Web fixture 与面向模型的状态决策。

**允许未解析引用，随后再修复。** 这样一来，持久化 replay 将依赖日志顺序之外的事件到达，并可能投影出节点缺失的 graph。Science 引用继续与 Outcome evidence 一样只允许向后，并明确失败。

## Consequences

Artifact 谱系与 run 依赖都可以从 Session log 重建，能够跨过 terminal 替换与 projection checkpoint，并在未来的 transcript、viewer、export 与 tool 入口之间共用同一种可序列化 `{artifactId, version}` identity。

Runtime 已能产生非空 input 与 artifact parent，而该 schema 仍是两者明确失败的持久化 authority。面向模型的工具参数与 receipt 仍属于独立的 Consumer 变更。

## Testing

`science-session` 测试覆盖不带 inputs 的旧事件、严格 codec path、同一基线的多个子版本、合法的跨 artifact 谱系、非空 input projection、未解析、未来与自引用、同 parent 与不同 parent 的就地取代、terminal 对 input 的改写、由 witness 验证的 checkpoint round trip，以及 pre-commit invariant 拒绝。
