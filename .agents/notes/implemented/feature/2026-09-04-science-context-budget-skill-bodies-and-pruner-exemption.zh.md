# Agent Note: Science 上下文预算——豁免 skill 修剪、收缩内置 skill 正文

Status: implemented

[English](2026-09-04-science-context-budget-skill-bodies-and-pruner-exemption.md) | 中文

## 问题

包含指令的技能结果可能被普通结果裁剪删除，但保留所有大结果又会耗尽上下文。

## 决策

Science 部署策略按名称豁免技能加载工具，并在 effective policy 记录所选工具名。技能正文保持简洁，详细参考移到按需读取的资源。豁免和正文体积控制解决不同问题：前者保留已读指令，后者降低最初成本。

## 考虑过的替代方案

**提高全局裁剪阈值。** 大数据和日志输出也会与指令一起保留。

**按结果大小或猜测内容豁免。** 大小不标识指令所有权，内容启发式可能误判任意输出。

**依赖豁免而不精简技能。** 超大指令被保留后仍消耗同样上下文。

## 后果

工具名策略是显式可配置项，不是通用 pruner 的隐藏特例。精简技能必须保留工作流及必要细节链接；豁免不意味着所有资源正文都适合上下文预算。

## 相关决策

相关 owner：[science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.zh.md); [science-context-churn-and-run-directory-guidance](../bug-fix/2026-09-04-science-context-churn-and-run-directory-guidance.zh.md).
