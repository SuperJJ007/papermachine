# Agent Note：Windows Science 子进程环境

Status: implemented

[English](2026-09-11-win32-science-child-environment.md) | 中文

## 问题

解释器探测和包安装进程从空环境启动，却遗漏了持久内核已有的 Windows 系统变量。Windows 原生验收复现了 Node 模拟解释器在 CSPRNG 初始化时中止，探测尚未执行就已退出，导致可用的环境绑定被判为无效。

## 决策

探测、内核和包安装进程共用 [execution.ts](../../../../packages/science/science-runtime/src/execution.ts) 中 `windowsEnvironment` 的固定 Windows 系统变量白名单。每个操作将 `TEMP` 和 `TMP` 指向自己的 scratch 临时目录。其他宿主变量仍被排除，POSIX 环境保留原有条目。sandbox 所需变量仍具有覆盖优先级。

## 考虑过的替代方案

继承整个宿主环境还会暴露无关凭据和配置。仅在模拟测试进程中补充变量，会让真实解释器启动继续依赖缺失的系统设置。

## 后果

Windows 原生探测和安装测试验证启动及 scratch 路径。持久内核测试继续覆盖缺失变量和平台白名单。已有录制会话输出仍是判定依据：此修复恢复解释器可用性，不改变会话格式。[scratch 隐私与顺序决策](2026-09-06-win32-scratch-privacy-and-probe-ordering.zh.md) 仍独立管辖 ACL 所有权和目录创建。
