# Agent Note: 确定性 Science 会话状态

Status: implemented

[English](2026-08-15-dsh-science-v01-r1-science-session.md) | 中文

## 问题

Science 状态必须可在不读取活跃解释器的情况下重放，不能用最终 preset 追溯改变早期事件的适用性。

## 决策

`science-session` 拥有确定性事件 fold；Host 观察环境并追加事实。适用性按事件所在位置的 preset 和环境 revision 判断。稀疏请求见证证明相关请求关系，不复制整份对话。运行时租约和可变解释器对象不进入耐久投影。

九种 Science 事件均为读取必需事件。原生 V3 引用保持不变；历史 Science 恢复遵循必读事件 owner，不能借 ignorable 绕过。Checkpoint admission 使用共享的 `stateSchema` 与 checkpoint 水位解析器，使冷重放和缓存恢复一致。

## 考虑过的替代方案

**从当前进程推断状态。** 冷读取没有进程，重启后的解释器也无法重建早期观察。

**把最新 preset 应用于全部历史。** 后续 preset 切换会改变早期运行当时是否合法。

**把完整对话复制进 Science 状态。** 稀疏见证既保留关系，也避免第二份对话及同步成本。

## 后果

纯 fold 让实时和冷读取都能拒绝错误的耐久关系。Checkpoint 只有通过 admission 才是优化，不能抵消缺失事件或超前水位。环境能力和包清单是观察结果，不保证后续运行仍使用完全相同的字节。

## 相关决策

相关 owner：[science-required-session-events](../architecture/2026-09-10-science-required-session-events.zh.md); [projection-checkpoint-watermark-admission](../architecture/2026-09-09-projection-checkpoint-watermark-admission.zh.md).
