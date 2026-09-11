# Agent Note: 一个可插拔的 kernel response-channel transport，让 win32 上的 Science kernel execution 成为可能

Status: implemented

[English](2026-09-05-win32-kernel-response-transport.md) | 中文

## 问题

内核协议响应需要不受用户 stdout 污染的通道，并适配各平台可用的进程及隔离机制。

## 决策

POSIX 使用带独立 reader 的 FIFO。Windows 使用认证 loopback TCP：每内核秘密只允许一个 driver 连接，拒绝其他 token 和后续连接，并将协议帧与 stdout、stderr 分离。每个接受的 socket 在启动排队、token 移交及销毁期间持续保留 error listener；请求的 stdin 缺失时在移交通道前失败。

最小 Windows OS-root 变量允许进程和 Winsock 初始化，私有 TEMP/TMP 及 Conda 可执行路径仍显式设置。受管理协作中断遵循 provider：Windows 不提供等效的保留状态 SIGINT 确认，因此取消可能升级终止并丢失内核内存。

## 考虑过的替代方案

**立即采用 Windows named pipe。** 用它替换现有认证通道前，需要真实平台证明 ACL 与 sandbox token 交互。

**也把 POSIX FIFO 替换成 TCP。** 没有相应需求却改变 POSIX 网络策略。

**把响应混入 stdout。** 原生库写入，尤其 base R，不能假定服从 Python 风格描述符重定向。

**把合成确认当成 Windows 信号支持。** Fixture 协议测试不证明原生 console 和进程组行为。

## 后果

仍须测试错误 token、重复连接、排队 reset、缺失 stdin、EOF 及清理。支持 TCP 协议不证明 Windows 打包或协作中断已验收。未来 Windows 中断机制需要明确 console/进程树设计及真实执行证据。

## 相关决策

相关 owner：[managed-cooperative-interruption](../architecture/2026-09-09-managed-cooperative-interruption.zh.md); [science-fifo-reader-isolation](../bug-fix/2026-08-31-science-fifo-reader-isolation.zh.md); [kernel-reset-exit-cause](../bug-fix/2026-09-09-kernel-reset-exit-cause.zh.md).
