# Agent Note: 每次 provisioning 源尝试都把完整的 micromamba 日志写到磁盘

Status: implemented

[English](2026-09-07-provisioning-attempt-logs.md) | 中文

## 问题

前一个源可能失败、后一个源却成功；若日志只保留最终错误或小型共享环形缓冲，就没有有用证据。

## 决策

Provisioning 为每个源尝试实时写入独立追加文件，并串行化 stdout、stderr 写入。每次尝试以状态结束，下一轮 provisioning 清除前轮日志。诊断通道初始化失败时禁用日志，不使安装失败；后续写入失败也不替换主要 provisioning 结果。内联近期日志缓冲只属于最后一次尝试。

完整日志路径放进失败 message，因为 Electron 抛错 IPC 保留 message 而非任意属性。Progress 可以提到前次失败，但瞬时进度不是耐久日志。尝试文件不设字节上限，也不扫描输出内容做脱敏；子环境的凭据名称过滤不等于扫描任意打印秘密。

## 考虑过的替代方案

**只扩大环形缓冲。** 回退成功后早期失败仍消失。

**只在全部失败时写文件。** 成功回退会抹去正要诊断的失败。

**依赖自定义 Error 属性跨 IPC。** Renderer 不能依赖它们被保留。

**永久保留所有轮次。** 重复重试会无界积累文件。

## 后果

本轮日志保留到下一次 provisioning，包括用户立即重试；它们是尽力诊断，不是保证崩溃 fsync 的记录。以下缺口仍独立延后：现有 prefix 清理之外的残留、每次重试前容量检查、撤销检查离线时的重试策略，以及环境 proxy 变量之外的 Windows 系统代理发现。保留本 note 不表示已修复它们。

## 相关决策

相关 owner：[desktop-owns-its-environment](../feature/2026-09-01-desktop-owns-its-environment.zh.md); [win32-desktop-provisioning-env-and-space-path](2026-09-06-win32-desktop-provisioning-env-and-space-path.zh.md).
