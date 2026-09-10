# Agent Note: Science Runtime queues a second concurrent run instead of rejecting it

Status: implemented

[English](2026-08-25-science-runtime-queue-concurrent-runs.md) | 中文

## 问题

同一会话已有内核操作时，两个调用者仍可能请求运行。把所有竞争者都拒为 busy 会造成可避免的工具失败；同时运行又违反解释器所有权。

## 决策

Runtime 操作为确切的 Session 申请排队访问。竞争者等待时不发布 running 记录，响应取消并服从配置的调用预算；获取所有权后重新检查环境和生命周期状态。运行、安装和图形修改遵循同一 reservation 规则。每个会话最多一个操作拥有执行权，独立会话拥有独立队列。

## 考虑过的替代方案

**立即返回 busy。** 普通工具并发派发会变成模型的重试问题。

**在一个解释器中并行运行。** 共享变量、工作目录和输出捕获没有隔离。

**仅在等待前验证。** 前一个操作可能在等待期间重新绑定或关闭会话。

## 后果

排队实现串行化，不保证用户代码并发安全。取消必须移除等待任务，不能释放别的操作的租约。所有权持续到捕获及静止，因此后继任务不能复用仍在收尾的文件。

## 相关决策

相关 owner：[dsh-science-v01-r2-science-runtime](../feature/2026-08-15-dsh-science-v01-r2-science-runtime.zh.md).
