# Agent Note: Mac 本地安装包验收

Status: implemented

[English](2026-09-12-local-macos-package-acceptance.md) | 中文

## Problem

交互式安装、环境准备、原生剪贴板与目录对话框、Session 恢复都需要通过已安装应用验证。每次本地运行都要求正式签名凭据，会阻止开发 Mac 收集这些证据。

## Decision

PaperMachine 的 Mac 本地验收允许 ad-hoc 临时签名，不反复索要正式发布凭据。明确启用的 `DSH_DESKTOP_LOCAL_ACCEPTANCE=1` 打包模式构建相同产品、内置运行时和离线 seed，保留 Host 健康检查以及原生代码签名后的 pnpm 摘要重写。本地资源和安装包使用独立目录，不生成更新配置或发布完成记录，且不能进入上传流程。正式签名、公证和更新验证仍由[桌面打包](../architecture/2026-08-25-electron-desktop-packaging-and-updates.zh.md)规则负责。

## Alternatives considered

**本地验收也要求 Developer ID 和公证。** 这些机制建立分发信任，但不是在已授权开发 Mac 上验证安装后行为的前提。

**使用源码启动器。** 工作区链接和开发启动绕过打包 seed 与已安装 profile 的激活，无法证明安装包验收通过。

## Consequences

本地包无需发布凭据即可提供安装和交互证据，但不证明 Gatekeeper 分发或签名更新已就绪。本地模式拒绝生产更新和不支持的目标；定向打包测试覆盖目录隔离、无发布配置、拒绝上传以及正式发布凭据要求不变。验收期间保留现有用户数据。
