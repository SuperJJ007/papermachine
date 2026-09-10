# Agent Note: 环境 health check 改用声明自己的超时，不再是一个隐藏的 120 秒上限

Status: implemented

[English](2026-09-08-health-check-timeout-follows-declaration.md) | 中文

## 问题

健康的全新环境在冷加载原生库或二进制转译时，可能需要超过固定两分钟的健康检查上限。

## 决策

健康检查与环境创建使用相同 `declaration.timeoutMs`，取消仍独立于 deadline 可用。因此声明表达两个阶段的实际最大时长，不静默截断其中一阶段。历史 Rosetta 测量中同一 Python 健康命令冷启动约 230 秒、热启动约两秒；这解释为何拒绝固定上限，不是当前性能承诺。

## 考虑过的替代方案

**新增必需 healthCheckTimeoutMs 字段。** 现有字段已能表达该上限，却要修改全部持久化声明。

**选择更大的固定常量。** 隐藏上限仍无法适配部署相关冷启动成本。

## 后果

缓慢但有效的健康检查可以在声明预算内完成。Timeout 仍限制挂起进程，用户取消不必等待它。当前代码须向创建和健康检查传递声明值；历史设备计时不证明当前包已通过平台验收。

## 相关决策

相关 owner：[desktop-general-environment](../feature/2026-09-01-desktop-general-environment.zh.md); [provisioning-attempt-logs](2026-09-07-provisioning-attempt-logs.zh.md).
