# Agent Note: 显式 subprocess 目标环境

Status: implemented

[English](2026-09-09-subprocess-target-environment-base.md) | 中文

## Problem

Science 解释器探测与内核启动需要从所选运行环境构造变量，不能继承环境中的 Python、R 或代理设置。只作用于目标的选择不能清除 managed runner 启动或 E2B 通信所需的传输环境。

## Decision

每个普通 subprocess 请求选择 `scrubbed-parent` 或 `empty`。本地两条启动路径和 E2B 都在应用显式覆盖及删除标记之前执行该选择。空目标不自动注入本地代理，调用方可以显式提供代理。终端请求保留现有环境策略。

[原生进程收容](2026-08-28-subprocess-native-containment.zh.md)与[代理策略](2026-08-27-outbound-proxy-policy.zh.md)决定继续有效：runner 传输状态保持独立，清理后的本地目标环境保留上游代理归一化。进程标识仍由 provider 私有持有。

## Alternatives considered

**逐个覆盖不需要的环境变量。** 新增环境变量会悄悄进入内核，因此拒绝。

**同时清空 runner 或 E2B 控制环境。** 目标配置不能破坏 provider 启动或远端传输，因此拒绝。

## Consequences

现有消费者显式保留清理后的继承环境。测试覆盖真实本地启动、managed 目标序列化、E2B 目标与控制分离、代理覆盖、删除标记及 Windows 大小写折叠。操作系统自行加入的进程变量不属于 provider 的环境构造。

fork 补丁涉及 subprocess 请求类型、本地 spawn 与 runner 目标准备、E2B 环境序列化及其调用方，以及消费者请求声明。上游已有代理归一化和控制与目标分离，但没有空目标选项。这实现迁移审计中 subprocess 的 RE-APPLY 项；本提交尚未向上游提交报告。

补丁范围、行数和上游状态见[移栽补丁台账](../process/2026-09-09-replant-upstream-patch-ledger.zh.md)。
