# Agent Note: 托管进程协作中断

Status: implemented

[English](2026-09-09-managed-cooperative-interruption.md) | 中文

## 问题

Science 内核需要可恢复的中断，同时由提供者持有进程标识和清理职责。

## Decision

Science 需要在取消操作后保持解释器流打开。终止会销毁可复用内核，因此不能替代中断。托管 subprocess 所有者向 POSIX 进程范围发送 SIGINT，不启动终止，也不关闭流。Windows 直接返回，不改变取消状态。E2B 仅在远端进程组身份发布后发送信号。目标身份由提供方私有持有，完成后不再中断。

## Consequences

约束实现提供的必需环境项在调用者覆盖项之后应用。Science 从空环境开始，并使用沙箱声明的运行器失败证据。Windows 原生控制台、进程约束与代理环境的既有决定各自独立，继续有效。测试包装器若转发 SIGINT，会让已经收到进程组信号的子进程再次收到信号；因此夹具仅接收自身信号，不再转发。

## 考虑过的替代方案

暴露目标 PID 会让消费者绕过进程所有权。终止不能表示可恢复的内核中断。
