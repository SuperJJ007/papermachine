# Agent Note: `science-runtime` 只通过显式配置接受部分沙箱强制执行，并记录实际接受的级别

Status: implemented

[English](2026-09-05-science-runtime-minimum-sandbox-enforcement.md) | 中文

## 问题

Science 部署不能只因 Host provider 能启动解释器，就静默接受更弱 sandbox enforcement。

## 决策

经过验证的 `minimumEnforcement` 默认 full。所有隔离路径，包括观察、执行、安装和恢复，都请求配置的最低级别。绑定记录实际 `sandboxEnforcement`；full 与 partial 是显式观察，不是平台猜测。选择 partial 是部署决策，不能隐藏在 provider 回退中。

## 考虑过的替代方案

**接受 provider 返回的任意级别。** 不同机器会静默改变部署安全性。

**在 Runtime 硬编码平台例外。** 平台身份不证明 provider 实际能力或用户策略。

**只在正常运行要求最低级别。** 探测、安装或冷重放会绕过同一要求。

## 后果

低于配置最低级别的 provider 无法通过 admission，不能无约束运行。记录 enforcement 不会把 partial 升为 full，也不证明平台已通过真实验收。Wire 验证必须在实时及冷投影保留记录级别。

## 相关决策

相关 owner：[managed-cooperative-interruption](2026-09-09-managed-cooperative-interruption.zh.md); [science-enforcement-wire-validation](../bug-fix/2026-09-08-science-enforcement-wire-validation.zh.md).
