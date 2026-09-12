# Agent Note：Windows 本地安装包验收

状态：已实施

[English](2026-09-12-local-windows-package-acceptance.md) | 中文

## 问题

Windows 已安装应用验收需要 NSIS 安装包，但发布打包要求 SafeNet 令牌。开发机可能已经具有适用于本地执行的测试 Code Signing 证书。

## 决策

将显式本地验收模式扩展到 Windows，通过指纹选择现有 `LocalMachine\\My` 证书。PowerShell 应用 SHA-256 Authenticode 签名，不导出私钥，也不更改信任存储。普通可执行文件和临时 NSIS 引导程序均使用此签名器，并保留生成 PE 文件的证书表修复。证书选择、私钥可用性、Code Signing 用途、签名者身份和签名状态不符合要求时均拒绝。只有有效签名或证书不受信任的签名符合本地打包要求。

PowerShell 可能将不受信任的自签名证书报告为 `UnknownError`。原生 [WinVerifyTrust](https://learn.microsoft.com/en-us/windows/win32/api/wintrust/nf-wintrust-winverifytrust) 返回值可区分特定的 `CERT_E_UNTRUSTEDROOT` 失败、无效摘要及其他信任失败，无需解析本地化消息。本地打包仅允许这一信任失败和零返回值，不会将证书标记为受信任。每次验证都会关闭提供方状态。签名者身份取自内嵌证书，因为 PowerShell 可能优先选择目录签名。Windows 证书实测对一次性的 Node 和具有目录签名的系统可执行文件副本签名，然后验证修改签名覆盖的字节后会产生 `TRUST_E_BAD_DIGEST`。

## 考虑过的替代方案

**每次本地运行都要求发布凭据。** 已安装应用的本地行为不需要发布分发身份。所选测试证书即可满足要求，不更改 SafeNet 发布流程。

**关闭签名或应用控制。** 这会遗漏 NSIS 引导程序的签名行为，或削弱主机保护。本地模式保留签名，不改变 Windows 的执行决策。

## 影响

Windows 本地产物使用已有的隔离目标目录和本地文件名，不生成更新配置或发布完成记录，也不能进入上传流程。测试覆盖证书选择、SHA-256 强制要求、子进程凭据移除、以数据传递目标路径、签名失败和打包隔离。真实 Windows 签名与已安装 UI 验收仍是不同的证据。没有 Session 输出变化，因此录制会话快照不能验证此打包行为。
