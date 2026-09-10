# Agent Note: 可恢复的栅格声明与 Desktop Host 诊断

Status: implemented

[English](2026-09-02-raster-capture-recovery-and-host-diagnostics.md) | 中文

## 问题

失败分析可能留下有用的已声明栅格；失败的 Host 或 provisioning 进程也需要在最终错误出现前保留诊断。

## 决策

执行失败后，捕获仍可恢复符合条件的已声明 PNG，并保留失败运行结果。缺失或无效文件产生捕获诊断，不替换主要执行错误。产品 provisioning 实时写入尝试输出，原生桌面设置通过当前 Host 和 IPC 传递相关诊断。

恢复不把栅格接纳扩大到工作区所有图片。捕获结果和 Host 诊断与模型可见成功保持区分。

## 考虑过的替代方案

**执行失败就丢弃全部输出。** 会失去有助于解释失败的诊断图。

**只持久化最终错误字符串。** 进程崩溃或前一个源尝试失败可能抹去有用输出。

**把恢复字节视为分析成功。** 文件存在不证明请求计算已完成。

## 后果

部分捕获和实时日志改善诊断，但不保证恢复每个输出。尝试保留和运行时输出预算仍为有界配置；桌面诊断不代表平台打包验收。

## 相关决策

相关 owner：[science-auto-capture](../feature/2026-08-19-science-auto-capture.zh.md); [provisioning-attempt-logs](2026-09-07-provisioning-attempt-logs.zh.md).
