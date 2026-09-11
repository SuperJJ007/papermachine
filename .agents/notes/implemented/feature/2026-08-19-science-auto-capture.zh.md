# Agent Note: Science Runtime 自动捕获 run 写出的文件

Status: implemented

[English](2026-08-19-science-auto-capture.md) | 中文

## 问题

代码失败的运行仍可能生成有用文件。在捕获前释放执行所有权，也会让下一次运行修改正在检查的目录。

## 决策

捕获在执行终止之后、租约释放之前进行。符合条件的字节先提交到项目产物库，再由会话事件引用。运行失败本身不丢弃已产生输出。捕获拥有独立的数量和字节限制，记录部分失败，不把已结束的解释器结果伪装为成功。

栅格接纳遵循显式输出声明。晚到捕获更新耐久状态，不能追溯改写已经发给模型的工具结果，也不能伪造模型通知。每次 await 后，事件 fold 追齐同时追加的会话事件。

## 考虑过的替代方案

**只捕获成功运行。** 失败分析的诊断图和部分结果会丢失。

**先释放租约再读取输出。** 后续运行可能修改相同文件。

**只使用一个进程输出预算。** 流输出与产物字节消耗不同资源，需要分别配置上限。

## 后果

产物库提交与会话追加是两个操作；追加失败可能留下需对账的孤立记录。捕获有界且可能部分完成。它不从文件名推断科学意图，也不保证收集声明策略以外的文件。

## 相关决策

相关 owner：[artifact-identity-stability-and-raster-capture-policy](2026-08-27-artifact-identity-stability-and-raster-capture-policy.zh.md); [science-capture-concurrent-events](../bug-fix/2026-09-08-science-capture-concurrent-events.zh.md); [artifact-store-session-reconciliation](../architecture/2026-09-01-artifact-store-session-reconciliation.zh.md).
