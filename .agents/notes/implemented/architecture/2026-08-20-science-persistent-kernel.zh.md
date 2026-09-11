# Agent Note: 持久化的按语言 kernel 取代一次性 Python/R 执行

Status: implemented

[English](2026-08-20-science-persistent-kernel.md) | 中文

## 问题

一次性解释器无法保留分析变量，而不受管理的持久进程会使取消和会话关闭不安全。

## 决策

每个会话与语言拥有带 epoch 的受管理内核。重新绑定、过期、进程丢失及协作中断失败会结束该 epoch；后续运行创建新状态。Python 与 R 使用小型 driver，不增加 notebook server 或 RPC 依赖。协议响应与用户 stdout、stderr 分离。

共享 subprocess provider 拥有协作中断。Runtime 取消在配置的宽限期内等待确认，必要时升级终止，并一直持有租约直至静止。Windows provider 不提供 POSIX SIGINT 语义，不能假设它保留状态。FIFO 与经过认证的 TCP transport 分别承担平台职责。

## 考虑过的替代方案

**每次运行启动新进程。** 会丢弃交互分析状态并重复承担解释器启动。

**引入 notebook kernel server。** 会增加超出两种语言 driver 的部署和协议体系。

**发送信号即宣布取消完成。** 送达不等于确认，仍存活的代码可能继续写文件。

## 后果

持久状态只在 epoch 内尽力保留，不是耐久会话状态。重启必须体现在结果中。用户输出不能伪装成 driver 响应，关闭错误也不能覆盖最初故障原因。平台执行验收与这些生命周期规则是不同工作。

## 相关决策

相关 owner：[managed-cooperative-interruption](2026-09-09-managed-cooperative-interruption.zh.md); [science-kernel-scoped-inline-installs](2026-08-22-science-kernel-scoped-inline-installs.zh.md); [win32-kernel-response-transport](../feature/2026-09-05-win32-kernel-response-transport.zh.md).
