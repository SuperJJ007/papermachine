# Agent Note: Science Runtime 观察与执行所有权

Status: implemented

[English](2026-08-15-dsh-science-v01-r2-science-runtime.md) | 中文

## 问题

解释器发现、隔离、耐久观察和工具呈现需要各自的 owner；工具私有子进程会绕过会话生命周期与重放。

## 决策

`ScienceRuntime` 通过共享 subprocess 和 sandbox 服务观察配置的解释器 profile，记录规范化解释器身份、Conda history 与包摘要、能力观察及实际 enforcement。身份和包清单回答不同问题：可执行文件路径稳定并不证明包未变化。

Reservation 属于确切的 Session 对象，而不只是文本 id。Runtime 串行化修改，等待后重新检查状态，并在子进程静止及捕获完成后才释放租约。准备工作不等于已发布运行；准备失败须清理，不能伪造耐久执行。消费者转换工具请求和结果，Runtime 拥有 admission、执行及耐久事实。

## 考虑过的替代方案

**各工具自行启动进程。** 会重复隔离、取消和环境观察，并使非工具消费者行为不一致。

**把 session id 当成活跃租约。** 不同 Session 对象可能共享 id，却拥有不同生命周期。

**收到 terminal 通知即释放。** Terminal 事件不证明流、内核清理和产物捕获已结束。

## 后果

工具和查看器直接操作可以共用 Runtime，无需把执行搬进 agent loop。环境绑定是观察结果，不是包锁，也不保证外部不会修改 prefix。协作中断由 subprocess provider 拥有；Runtime 必须按实际结果处理并在升级终止期间继续持有所有权。

## 相关决策

相关 owner：[managed-cooperative-interruption](../architecture/2026-09-09-managed-cooperative-interruption.zh.md); [science-shared-prefix-drift](../bug-fix/2026-09-06-science-shared-prefix-drift.zh.md).
