# Agent Note: 恢复 Science artifact 血缘、编辑摘要与策展授权

Status: implemented

[English](2026-09-02-science-artifact-receipts-restoration.md) | 中文

## 问题

重试必须识别已经提交的产物修改，不能只依赖当前会话投影重建的回执。

## 决策

产物库在注释或创建事务中消费完整工具调用身份。重试返回已提交结果，不增加第二条元数据或产物版本。元组包含 session id、tool-call id 和 request-header sequence；不完整身份不能宣称恰好一次。纯捕获溯源不消费无关模型调用。

回执暴露调用者所需的最小已提交身份和状态。完整图形操作及溯源留在库中，不扩回每次工具响应。

## 考虑过的替代方案

**预扫当前投影寻找回执。** 库中可能已有其他会话提交，或日志追加失败后的提交。

**只用 tool-call id。** 其作用域不足以保证项目级唯一。

**每次重试都构造新写入。** 会把响应丢失变成重复耐久修改。

## 后果

修改恰好一次取决于完整元组及库事务，不取决于响应送达。库提交与日志追加仍可能分歧并需要对账；最初已提交记录仍为权威。

## 相关决策

相关 owner：[science-runtime-provenance-writes](../architecture/2026-09-02-science-runtime-provenance-writes.zh.md); [science-tool-receipts-slimming](../feature/2026-09-02-science-tool-receipts-slimming.zh.md); [artifact-store-session-reconciliation](../architecture/2026-09-01-artifact-store-session-reconciliation.zh.md).
