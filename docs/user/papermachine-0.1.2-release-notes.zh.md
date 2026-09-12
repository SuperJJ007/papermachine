# PaperMachine 0.1.2 发布说明（草稿）

[English](papermachine-0.1.2-release-notes.md) | 中文

## 桌面行为

Windows Science 执行默认使用部分沙箱，无需额外确认或设置环境变量。macOS 保持完整强制隔离。部分沙箱限制写入，但不提供完整的文件读取或网络隔离；详见 [Windows 沙箱限制](../../packages/sandbox/sandbox-windows-acl/README.zh.md#known-limitations-and-deferred-work)。

环境准备在解压和复制内置依赖时保持应用响应。macOS 目录选择会将原生选择器置于前台。macOS arm64 与 Windows x64 安装包检查覆盖 Python/R 执行、产物、历史和重启恢复。

## 会话兼容性

**PaperMachine 0.1.0 Science 会话在此版本中不可读。** 打开不受支持的旧会话会报错。原会话文件保持字节不变；应用不会静默丢弃其中的 Science 记录，也不会用部分转换的日志覆盖旧文件。旧会话仍可能出现在会话列表中，因为列表只读取其 header。

请新建会话继续工作。新会话使用 V3 格式，重启后保留 Science 运行记录、产物引用、Outcome 与用户笔记。0.1.0 Science 会话的恢复工作已延后，尚无承诺的发布日期。请保留原会话文件，以供未来可能的恢复使用。
