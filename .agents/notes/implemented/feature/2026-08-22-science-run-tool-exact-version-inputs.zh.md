# Agent Note: Science run 工具开放精确版本 input 与 edit 祖先关系

Status: implemented

[English](2026-08-22-science-run-tool-exact-version-inputs.md) | 中文

## 问题

工具必须保留精确产物版本请求及重复路径错误，直到领域验证器能够拒绝它们。

## 决策

运行工具的输入与编辑基线使用 `{ artifactId, version, path }` 类型化数组。Adapter 无损转换，并在构造 map 前拒绝重复编辑路径。Runtime 拥有路径、版本、项目访问及物化验证；工具描述不建立第二个解析器。

请求指定精确版本，而不是会移动的 latest 指针。产物库溯源拥有已提交基线。精简工具回执不承诺另存一份 parent 或编辑操作记录。

## 考虑过的替代方案

**在工具入口使用按输出路径索引的 JSON 对象。** 重复 key 可能在验证前消失。

**在 adapter 解析 latest。** 并发写入可能改变预期来源，并把领域所有权拆到工具和 Runtime 两处。

## 后果

非工具消费者可以复用 Runtime 验证。工具 schema 合法只证明表示正确，不证明引用的项目版本存在或路径安全。

## 相关决策

相关 owner：[science-runtime-input-materialization-and-edit-baselines](2026-08-22-science-runtime-input-materialization-and-edit-baselines.zh.md); [science-tool-receipts-slimming](2026-09-02-science-tool-receipts-slimming.zh.md).
