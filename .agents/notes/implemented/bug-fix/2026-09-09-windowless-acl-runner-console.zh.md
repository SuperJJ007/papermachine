# Agent Note: 无窗口 ACL runner 的控制台归属

Status: implemented

[English](2026-09-09-windowless-acl-runner-console.md) | 中文

## Problem

在原生 Windows 上，detached 无窗口父进程使用上游 `spawnInheritedJobProcess` 创建的受限 Node 子进程，会在输出内容之前以 `0xC0000142` 退出。附着控制台时，同一受限启动成功。进程创建和 Job 分配并不能建立受限后代所需的控制台。

## Decision

ACL runner 在创建受限子进程之前检查 `GetConsoleCP`。已有控制台（包括无窗口控制台）保持不变。否则分配控制台，隐藏其窗口，并恢复三个继承的标准句柄。控制台由 runner 进程持有至退出。令牌限制、挂起创建进程和关闭即终止的 Job 归属继续由上游 Win32 原语负责。

[ACL 沙箱决定](../feature/2026-08-08-windows-acl-restricted-token-sandbox.zh.md)继续有效；此补充为其既有受限令牌启动器提供控制台归属。不相关的 Python 控制台入口 spawn-and-wait 修复保持不变。

## Alternatives considered

**只依赖上游 Job 原语。** 原生 Windows 在 detached 启动下复现 `0xC0000142`，所以 Job 收容并不足够。

**用窗口是否存在判断控制台附着。** 无窗口控制台仍是已有控制台，必须保留，因此拒绝。

## Consequences

捕获的管道与 NUL 句柄在分配后保持有效。原生调用失败会明确报错，子进程不会退回非受限执行。探针使用 Windows Server、Node 24.19.0 和 Koffi 3.1.1：未修复时附着场景成功、detached 场景失败；修复后两者均成功。单测覆盖分配、恢复、已有附着和原生失败。这不代表已完成 Electron 安装包或 Science 内核验收。

迁移审计允许此 RE-APPLY 补丁。上游改动为 ACL runner 的控制台辅助模块、五个 FFI 绑定及 runner 调用；`win32-process` 保持不变。本提交尚未向上游提交报告。

补丁范围、行数和上游状态见[移栽补丁台账](../process/2026-09-09-replant-upstream-patch-ledger.zh.md)。
