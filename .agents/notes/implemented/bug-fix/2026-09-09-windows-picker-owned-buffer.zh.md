# Agent Note: Windows 选择器使用自有缓冲区

Status: implemented

[English](2026-09-09-windows-picker-owned-buffer.md) | 中文

## 问题

PaperMachine 0.1.1 在选择文件夹后仍于 `readUtf16` 崩溃（[issue #5](https://github.com/SuperJJ007/papermachine/issues/5)）。精确限定分配长度可以防止越界读取，但无法使 `koffi.view` 兼容 Electron 的 [V8 内存笼](https://www.electronjs.org/blog/v8-memory-cage)，后者拒绝外部 ArrayBuffer。

## 决策

Windows 选择器使用 `RtlMoveMemory` 将 COM 分配的内存复制到 `Buffer.alloc` 创建的内存，再解码 UTF-16。`lstrlenW` 将复制范围限制为字符串及其结尾 NUL。COM 内存的所有权和释放流程保持不变。

## 考虑过的替代方案

**精确长度的外部视图：** 在 Electron 43.4.1 中仍以 `FATAL ERROR: Error::New napi_get_last_error_info` 中止，包括合法的两字节空字符串分配。

**仅使用应用内浏览组合：** 能绕过崩溃，但改变了原生交互，且原生后端仍然损坏。

## 验证

绑定测试拒绝所有外部视图，覆盖空字符串、ASCII、中文、含空格和代理对的路径。在已安装的 Electron 43.4.1 中运行原生 `CoTaskMemAlloc` 探针，视图实现退出码为 134，复制实现为 0。通过重新构建的安装包进行交互式选择仍需单独验收。

## 后果

每次选择增加一次有界缓冲区分配和内存复制。选择器兼容 Electron 内存笼，无需关闭运行时保护或改变交互协议。
