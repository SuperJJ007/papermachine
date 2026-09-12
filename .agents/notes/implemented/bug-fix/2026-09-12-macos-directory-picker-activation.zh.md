# Agent Note: 激活 macOS 目录选择器

Status: implemented

[English](2026-09-12-macos-directory-picker-activation.md) | 中文

## Problem

由已安装 Desktop Host 启动的 macOS 目录选择器可能停在原生模态对话框中等待，而产品窗口仍位于前台。即使选择器进程存活，工作区操作看起来也没有响应。

## Decision

macOS 原生选择器在 `choose folder` 之前向自身 AppleScript 进程发送 `activate`。它保留所选路径结果、用户取消映射及调用方拥有的进程取消，不自动操作 Finder，也不要求另一个应用的权限。

## Alternatives considered

**让操作系统自行激活。** 后台 Node Host 创建模态面板时，无法可靠地把选择器带到前台。

**为 Desktop 选择目录增加另一套传输。** 显式激活补齐原生适配器缺失的操作，无需引入第二套 Electron 到 Host 的请求协议。

## Consequences

命令适配器回归测试固定先激活、后进入模态对话框的顺序，并保留取消与失败覆盖。安装包验收负责验证前台行为；录制 Session 无法观测窗口激活，此修复不改变 Session 事件或模型可见内容。
