# Agent Note: win32 上的 R locale 与非 ASCII probe argv，两者都会打断 R 的 UTF-8 无损输出检查

Status: implemented

[English](2026-09-06-win32-r-locale-and-ascii-probe-argv.md) | 中文

## 问题

R 探测结果不能依赖 Windows 控制台 code page，也不能依赖非 ASCII 源文本在 argv 转换中幸存。

## 决策

R 执行建立声明的 UTF-8 locale，并使用构造目标 code point 的 ASCII 源码探测 UTF-8 行为。分别检查探测传输、解释器行为和返回字节。源码表达式本身不包含要测量往返的非 ASCII 字符。

## 考虑过的替代方案

**把测试字符直接写入命令行源码。** 控制台或 argv 转换可能在 R 求值前损坏探测。

**把本地显示正常当作证明。** 显示解码可能隐藏错误返回字节。

**为 Windows 放宽 UTF-8 检查。** 会允许模型可见数据随平台变化。

## 后果

Locale 与 ASCII 探测避免可复发编码陷阱，但不证明所有外部库都使用 UTF-8。历史 Windows 观察仍是历史；当前平台打包和真实解释器验收须针对交付产物重跑。

## 相关决策

相关 owner：[win32-kernel-response-transport](../feature/2026-09-05-win32-kernel-response-transport.zh.md).
