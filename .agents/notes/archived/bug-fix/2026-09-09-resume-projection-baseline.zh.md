# Agent Note: 冷 Session 挂载时发布投影基线

Status: implemented
Archived: 2026-09-10

[English](2026-09-09-resume-projection-baseline.md) | 中文

## 问题

历史检查不会恢复 Session。如果浏览器先收到冷历史，随后另一个请求才恢复该 Session，历史投影就早于构造器追加的 `session/end-seed`。构造种子不会发布 `session/event`，因此即使 Host 已从新标记派生 `interrupted`，浏览器仍可能保留内核的 `started` 记录。

## 决策

Session 在 mux 流打开后挂载时，ApiProxy 紧接 `session/subscribed` 发送当前客户端投影快照：使用普通 `session/projection` 帧，序号取快照的 `asOfSeq`。客户端按更高序号优先保存，较旧的在途历史响应不能覆盖该基线。快照序列化不包含仅供 Host 使用的投影状态，遵循[投影状态与视图的决策](../architecture/2026-08-19-session-projection-state-and-client-views.zh.md)。

## 考虑过的替代方案

发布构造种子事件会破坏 Session 的种子与发布事件之分。每次元数据查询后重新读取全部历史会增加冗余读取，且遗漏其他恢复入口。在 UI 推断内核死亡会让历史值依赖浏览器生命周期，而非持久日志。

## 结果

延迟挂载会刷新全部已注册的客户端投影，不改变线格式，也不为了读取历史而恢复 Session。内核栏仍展示历史记录，不承担进程健康探测。没有既有 Agent Note 被取代：此改动在现有投影载体内补齐缺失的基线。

## 验证

ApiProxy 回归验证构造派生值能够送达，且不发布种子事件。可运行的 Science 浏览器快照暂缓会话级请求，先要求冷历史显示 `started`，再放行恢复，并要求无需用户额外操作即显示 `interrupted`。
