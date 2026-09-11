# Agent Note: Science preset 获得一个受限 subagent

Status: implemented

[English](2026-09-02-science-restricted-subagent.md) | 中文

## 问题

委托 Science 任务需要有用分析工具，但不能递归委托、继承父内核变量或绕过父任务的受限工具策略。

## 决策

Science 子 preset 拥有较窄 persona 与工具集，禁止再次派发 subagent，并把委托深度限制为一。子任务通过自己的 Python/R 执行读取或重算所需数据，不假设父任务内存对象存在。产物交换使用精确项目引用。

父任务负责整合子结果。Runtime 与 preset 隔离同时约束子执行和直接调用。

## 考虑过的替代方案

**给子任务完整父工具集。** 递归委托和无关工具会在没有 Science 需求时扩大行为权限。

**共享父任务活跃解释器。** 子工作会在没有独立所有权时修改分析状态。

**立即创建大量专家 preset。** 独立角色需要实际独立工具或指令需求，而不只是不同标签。

## 后果

委托可让不同会话并行开展独立工作，不允许同时修改一个内核。新增专家角色需要明确能力和策略决策；深度限制本身不是文件系统或进程隔离。

## 相关决策

相关 owner：[science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.zh.md); [project-artifact-store-s3](../architecture/2026-08-26-project-artifact-store-s3.zh.md).
