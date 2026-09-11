# Agent Note: Web smoke fixture 遵循持久化布局与欢迎确认

Status: implemented

[English](2026-09-10-web-smoke-persistence-and-welcome.md) | 中文

## 问题

独立浏览器手势需要已知布局，而重载测试必须验证产品持久化偏好。把 reload 当作重置，会让恢复的 tab 和浮动资源进入后续用例。即使已有模型凭据，全新真实 Host 仍需要确认欢迎声明；跳过确认会阻塞工作区连接，使依赖的 smoke 步骤在目标行为开始前就失败。

## 决策

右侧栏手势 helper 在重载前仅清除当前测试会话的 `dsh.sidebar.right.v2.<sessionId>` 偏好，保留其他会话及无关浏览器偏好。真正的重载用例保留存储，检查打开的 dock、浮动文档身份和已加载内容，以及重复打开不会产生副本；完成这些断言后才重置自身 fixture。

真实 Host 的 smoke setup 通过可见英文欢迎声明的 Continue 完成确认，等待弹窗移除及应用根节点不再 inert，随后才连接工作区并执行真实模型轮次。Fixture 不删除产品声明，也不伪造 provider 成功。

## 考虑过的替代方案

**禁用侧栏持久化以保留旧断言。** 这会回退[原生侧栏决策](../architecture/2026-09-10-science-native-sidebar.zh.md)拥有的产品行为。

**每次重载都清空全部 localStorage。** 会掩盖持久化故障并删除无关偏好，而不是隔离手势 fixture。

**延长等待或强制穿透欢迎弹窗点击。** 等待不能确认声明，强制输入也绕过了 smoke 必须验证的用户交互。

## 后果

手势隔离与产品恢复分别具有断言。[Web 浏览器测试通道](2026-07-24-web-gui-browser-e2e-lane.zh.md)继续拥有组装覆盖；侧栏单测独立验证恢复后的全新 undo 历史。Setup 修正不证明后续模型或工具行为通过，两个修改的浏览器文件仍须针对构建产品运行。Fixture 修改不影响产品 runtime 代码或共享构建产物。
