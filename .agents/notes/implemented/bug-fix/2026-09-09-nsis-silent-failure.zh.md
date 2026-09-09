# Agent Note: 保留 Windows 静默安装的失败退出

Status: implemented

[English](2026-09-09-nsis-silent-failure.md) | 中文

## Problem

macOS 的 UninstallerReader 路径可能生成在初始化前就无法通过自身 CRC 校验的 Windows 卸载器；Windows 原生生成避开了这条提取路径。没有静默默认选项的 NSIS 错误通知会无限阻塞无人值守安装。隐藏窗口站还可能让另一个诊断进程看不到该对话框。卸载失败必须无需交互即可通过进程失败结果被观测到。

## Decision

产物开始构建钩子拒绝在 Windows 以外的平台生成 NSIS 目标，包括预打包构建。CRC 校验保持启用。固定的 app-builder-lib 26.15.3 通过 pnpm 补丁应用[上游 PR 10034](https://github.com/electron-userland/electron-builder/pull/10034) 的 NSIS 模板修改。错误通知在静默模式下选择现有的确定操作。卸载失败处理保留退出码 2；交互式通知保持既有行为。

## Alternatives considered

禁用 CRC 会掩盖生成的可执行文件无效这一问题。已有 Windows 原生打包方式时，重新实现二进制提取器会引入不必要的维护分支。删除卸载注册信息以强制覆盖会绕过失败操作，不能证明升级正确。把全新安装当作升级验收会遗漏旧卸载器路径。这项上游模板修正无需升级整套工具链到预发布版本。

## Consequences

补丁让这条失败路径终止；它不修复旧卸载器，也不承诺每项安装器操作都有时限。移除补丁的前提是固定到包含相同修改的上游版本。应用运行时文件和 Mac 打包行为不受影响。

## Verification

实际 Electron Builder 预打包命令在 Mac 上会于创建 NSIS 产物前失败，平台测试保留 Windows 原生构建的接受路径。从真实卸载结果处理函数编译的 Windows 探针在输入退出码 2 时，未打补丁会阻塞，打补丁后立即返回 2，成功输入则返回 0。实际安装包验收分别覆盖保留用户数据、冷读历史、全新安装和覆盖安装。仅探针成功不能确定真实升级失败的原因。
