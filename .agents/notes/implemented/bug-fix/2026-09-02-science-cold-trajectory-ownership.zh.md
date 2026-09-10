# Agent Note: 冷启动分页后仍保留 Science trajectory 归属

Status: implemented

[English](2026-09-02-science-cold-trajectory-ownership.md) | 中文

## 问题

即使另一活跃会话正在流式输出或拥有更新环境，冷 Science 轨迹仍须使用选中的历史会话。

## 决策

Process 和 Trajectory 视图消费所选会话已通过 admission 的投影及必读事件，不借用全局活跃 Runtime 或另一对话的最新环境卡片。原生侧栏与会话注册拥有位置，Science 提供从投影派生的内容。

环境与运行关系按记录位置解释，因此后来重新绑定不会改写早期轨迹事实。

## 考虑过的替代方案

**冷面板读取全局活跃状态。** 会显示另一会话的环境或运行任务。

**创建第二份轨迹历史。** 需要另一套同步与 admission 规则。

**从最新绑定推断历史状态。** 会改变早期运行含义。

## 后果

冷视图不需要活跃内核也可用，但不因此支持旧 Science 会话格式；呈现前仍须通过必读事件 admission。原生布局所有权与确定性 Science 状态保持分开。

## 相关决策

相关 owner：[science-native-sidebar](../architecture/2026-09-10-science-native-sidebar.zh.md); [science-required-session-events](../architecture/2026-09-10-science-required-session-events.zh.md).
