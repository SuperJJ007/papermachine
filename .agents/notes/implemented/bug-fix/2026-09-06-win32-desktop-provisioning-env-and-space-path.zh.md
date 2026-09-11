# Agent Note: win32 桌面端 provisioning 拿到 ambient environment，含空格的 Harness home 有了恢复页

Status: implemented

[English](2026-09-06-win32-desktop-provisioning-env-and-space-path.md) | 中文

## 问题

Provisioning 子进程需要足够 Windows 环境来初始化 OS 服务并查找 Conda DLL，但不能获得桌面进程所有凭据。

## 决策

Provisioner 过滤凭据形态环境变量，保留固定 Windows OS-root 与进程变量。TEMP 和 TMP 指向私有 provisioning scratch。Windows PATH 查找忽略大小写，并只输出一个规范 PATH key。健康检查前置已安装 prefix 的可执行文件及 DLL 目录；创建操作不依赖尚未填充的 prefix。

桌面与 Runtime 保持等效环境要求，但桌面不链接独立 Science Host 实现。源码一致性检查保护重复列表。ProductEnvironment 与原生设置拥有当前调用者，共享安装隔离拥有根目录选择。

## 考虑过的替代方案

**转发全部环境。** 凭据可能进入子输出和诊断日志。

**假设 Electron 目录提供 micromamba CRT DLL。** 原调查已证伪；app-local CRT 分发需要打包证据。

**同时输出 Path 与 PATH。** Windows 忽略大小写，会产生不明确优先级。

**创建时使用健康检查 prefix 路径。** 安装完成前这些目录可能不存在。

## 后果

OS 初始化变量不授权继承任意秘密。私有 scratch 与显式 Conda PATH 顺序仍必要。本 note 不恢复已移除桌面 space-free resolver，也不宣称当前 CRT 打包就绪；这些决策须依赖当前 owner 和实际产物。

## 相关决策

相关 owner：[papermachine-installation-isolation](../architecture/2026-09-10-papermachine-installation-isolation.zh.md); [desktop-owns-its-environment](../feature/2026-09-01-desktop-owns-its-environment.zh.md); [win32-kernel-response-transport](../feature/2026-09-05-win32-kernel-response-transport.zh.md).
