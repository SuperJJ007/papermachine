# Agent Note: 若干预先存在的缺陷曾在 win32 kernel 启动前就拦下了它

Status: implemented

[English](2026-09-06-win32-scratch-privacy-and-probe-ordering.md) | 中文

## 问题

POSIX mode bit 和目录 fsync 不能证明 Windows scratch 隐私，ACL provider 也无法隔离尚未创建的目录。

## 决策

Windows scratch 检查保留文件种类及符号链接验证，隐私依赖继承的用户 profile ACL 和 sandbox 策略，不承诺目录项 fsync。所有平台都先创建探测目录再隔离，隔离失败走同一清理及自有会话回滚路径。配置的最低 enforcement 传到持久和隔离内核创建。

解释器发现使用平台布局；PATH 回退选择最近带 Conda history 的祖先，不假设固定深度。Driver 写捕获字节时不做 CRLF 转换：Python 同时控制原始描述符和文本包装，R 使用 binary 连接。伪进程 wrapper 必须遵循当前 subprocess 信号所有权，不重复 provider 的进程树送达。

## 考虑过的替代方案

**继续用合成 Windows mode bit 检查 POSIX 权限。** 既看不到 ACL 隐私，也不能识别真实不安全目录。

**仅在 Windows 调整探测顺序。** 先存在再隔离是共享生命周期要求。

**固定向上走几级来推断 Conda 根。** 不同构建的 R 程序深度不同。

**接受平台换行差异。** 捕获字节进入日志中的模型输入，不只是终端外观。

## 后果

Windows 的 scratch 目录项耐久性较弱，会话日志耐久性是独立机制。POSIX chmod 故障 fixture 不证明 Windows ACL 行为。平台验证必须覆盖真实 ACL 清理、解释器发现及字节一致性；可移植 fixture 修改不代表这些结果已成立。

## 相关决策

相关 owner：[science-runtime-minimum-sandbox-enforcement](../architecture/2026-09-05-science-runtime-minimum-sandbox-enforcement.zh.md); [managed-cooperative-interruption](../architecture/2026-09-09-managed-cooperative-interruption.zh.md).
