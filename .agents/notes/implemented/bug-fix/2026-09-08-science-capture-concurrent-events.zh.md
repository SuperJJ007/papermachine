# Agent Note: 在成果捕获期间保留并发会话事件

Status: implemented

[English](2026-09-08-science-capture-concurrent-events.md) | 中文

## 问题

成果捕获等待文件系统与 store 操作时，kernel 清理和会话标题修改可以向同一会话追加事件。若只把后续成果事件应用到较早的 fold，就会跳过中间的序号。严格 fold 会在成果已提交后拒绝这个缺口，调用方因而无法获得捕获统计。

## 决策

捕获从会话日志初始化一次 fold，并在每次成果追加后，把截至该事件的全部新提交事件依次应用。完整日志始终是权威来源；成果写入不代表独占会话事件流。增量回放避免了为每个文件重复折叠全部历史。

## 考虑过的替代方案

允许不连续序号会向所有 projection 使用方掩盖缺失事实。每个文件重新回放完整历史虽能恢复正确性，却引入无谓的重复工作。把所有会话写入串行排在成果 I/O 后面，会延迟无关的生命周期事实和标题修改。

## 影响

真实 kernel 在提取期间退出，其持久化退出事件被延迟到 artifact store 写入完成时才提交。捕获必须返回已保存的 PNG 与图表不可用诊断，后续 run 必须使用新 kernel epoch。可运行的 Science 快照也在 store 写入期间追加用户标题，并验证成果记录能够通过冷读历史恢复。现有 store/session 对账决策仍独立适用于持久化提交失败。

## 相关决策

相关 owner：[science-auto-capture](../feature/2026-08-19-science-auto-capture.zh.md); [artifact-store-session-reconciliation](../architecture/2026-09-01-artifact-store-session-reconciliation.zh.md).
