# Agent Note: 为共享 Conda prefix 在会话运行期间发生的漂移做逐次运行检测

Status: implemented

[English](2026-09-06-science-shared-prefix-drift.md) | 中文

## 问题

共享 Conda prefix 的会话在其中一个安装包后可能观察到不同包状态。继续使用旧绑定会误述实际执行环境。

## 决策

运行前 Runtime 比较已记录 Conda history 摘要与当前普通、非符号链接 history 文件。缺失、不可读、目录或符号链接均视为漂移。匹配时无需解释器探测；不匹配时先物化 scratch，再完整观察后执行。

成功的漂移观察可以重新绑定并替换空闲内核。不可用观察以 ENVIRONMENT_NOT_READY 拒绝运行，不追加会困住会话的 invalid 绑定。用户请求安装则另行记录其修改结果。Runtime 不在会话中途重新绑定时同步桌面 applied-state 文件。

## 考虑过的替代方案

**要求每个修改者追加产品事件。** 手工 Conda 命令不会配合产品。

**只在绑定时建立监视。** 每次运行检查更简单，也不随会话增加长期 watcher。

**每次运行都探测解释器。** 即使 history 未变也付出子进程成本。

**追加 invalid 漂移 revision。** 暂时忙碌的 prefix 会在绑定规则下使后续恢复不可能。

**在这里新增安装审批或更新桌面 applied 状态。** 它们是独立策略及持久化决策，不是检测漂移必需后果。

## 后果

每个绑定语言付出一次 history 读取，检测 Conda/micromamba 事务，不检测 Conda history 以外的手工 pip 或 R 包变化。这是逐次运行观察，不是防止执行期间修改的锁。摘要读取失败绝不能视为允许使用旧状态。

## 相关决策

相关 owner：[science-package-install](../feature/2026-09-01-science-package-install.zh.md); [science-persistent-kernel](../architecture/2026-08-20-science-persistent-kernel.zh.md).
