# Agent Note: Science run 工具开放精确版本 input 与 edit 祖先关系

Status: implemented

[English](2026-08-22-science-run-tool-exact-version-inputs.md) | 中文

## Problem

Science Runtime 已能物化已提交的产物版本并为捕获结果指定显式父级，但面向模型的 run 工具无法请求这两项操作。模型还需要从捕获回执获得稳定产物 id 与祖先关系，使一次 run 结果可以授权后续精确版本 input，而无需从文件名推断身份。

更广泛的 [artifact domain 与 image edit 提案](../../proposed/architecture/2026-08-22-science-artifact-domain-and-image-edit.zh.md)把这项消费方行为交给 run 工具，同时让校验与文件系统权威继续属于 [Science Runtime](2026-08-22-science-runtime-input-materialization-and-edit-baselines.zh.md)。

## Decision

`run_python` 与 `run_r` 接受相同的可选 `artifact_inputs` 和 `edit_of` 数组。每项都使用模型可见的 `{artifactId, version, path}` 字段。`artifact_inputs` 的 path 相对于 run 保留的 `inputs/` 目录；`edit_of` 的 path 相对于 `SCIENCE_ARTIFACT_DIR`，并为该 output 命名精确父版本。消费方为不透明 id 添加品牌类型，并把两个数组转换为 `StartScienceRunRequest.artifactInputs` 与 `.editBaselines`；Runtime 仍是版本解析、path 安全、字节/数量上限、物化与捕获归属的唯一所有者。

重复的 `edit_of` path 会在 run 发布前拒绝，因为把模型数组转换为 Runtime 按 path 键控的记录时绝不能静默覆盖 baseline。其它无效或无法解析的值会原样交给 Runtime，并保留其稳定错误分类。

每条被捕获产物的结果记录都携带其可选 `parent`。纯文本回执会命名当前产物的稳定 id，并在存在时命名精确父级 id 与版本。渲染器从有界 canonical result 派生两者，而不会回放实时 session state。

无密钥 Science headless 示例会执行真实 Loader、agent loop、工具 runtime、Science Runtime、附件提供方、持久化 Session 路径与 fake kernel protocol。模型从先前捕获回执读取精确图片 id 与版本，再在第二次 `run_python` 调用中把该版本同时用作 `artifact_inputs` 与 `edit_of`；快照固定工具 schema、已记录的 run input、捕获分支父级与最终模型可见的祖先回执。

## Alternatives considered

**用逻辑名代替产物 id。** 逻辑名可以推进或分支，因此无法标识调用方消费或编辑的不可变版本。

**把 `edit_of` 开放为按 path 键控、无类型约束的 JSON 对象。** 工具 schema 子集无法校验每个动态属性的值，重复键也会在 JSON 解析时消失。类型化数组可以校验每条引用，并让消费方在转换前拒绝重复 output path。

**在消费方校验 path 与版本是否存在。** 这会复制 Runtime 策略，并允许直接 Runtime 调用方发生偏差。工具只防止有损的数组到记录转换；Runtime 执行操作有效性校验。

**渲染时从实时 projection 读取祖先关系。** 工具渲染是参数与 canonical result 的纯函数。回放可变 session state 可能让保留的 output 偏离其最初描述的持久化结果。

## Consequences

模型可以把精确既有证据送入任一持久化 kernel，并用一次普通 run 调用为编辑后 output 标记显式祖先关系。捕获回执提供下一次调用所需的不透明身份，而不会暴露附件句柄或文件字节。

两个可选数组会给 Science preset 的每次请求增加固定 schema token。每条编辑捕获会给保留结果增加一个父级引用；不带 input 或祖先关系的 run 保持既有执行与回执行为。
