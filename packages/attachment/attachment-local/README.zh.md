# @deepseek-ai/dsh-attachment-local

[English](README.md) | 中文

这是 [`@deepseek-ai/dsh-attachment`](../attachment) 的私有本地实现。对象存放在 `<DSH_HOME>/attachments/v1/objects/<sha256-prefix>/<sha256>`，并通过不透明的 `sha256:` 标识符寻址；存储在各媒体系列之间完全共享——内容寻址从不在路径中编码媒体类型，因此字节相同的图片与文本文件会发布到同一个对象。每个进程都会通过将每个祖先目录项逐级同步到文件系统根目录，为某个 home 一次性证明其持久性，因此绝不会把另一个进程已经创建但尚未同步的目录误认为安全边界。随后，写入过程使用私有暂存目录、仅所有者可访问的文件、经过同步的临时文件、原子且排他的硬链接发布，并对发布路径执行目录同步（适用于 POSIX；Windows 依赖文件系统元数据日志），确保已报告的引用能够在崩溃后继续存在。图片的写入准入与读取都会完整解码光栅图片，之后才接受其格式和尺寸；读取还会重新校验摘要和已记录的元数据。文本的写入准入只检查字节上限与 UTF-8 合法性——不做类似光栅解码的处理，也不做内容格式校验——读取会重新校验摘要与字节长度。字节和像素限制属于写入时的准入策略，因此后续收紧限制不会导致已经接纳的历史记录变得不可读。

`DSH_HOME` 按共享路径策略解析：显式配置、`$DSH_HOME`，最后是 `~/.dsh`。会话日志只包含引用和经过校验的元数据，绝不包含这个宿主路径。`readImage` 与 `readText` 会把可选取消信号传入文件系统读取、在校验前后观察该信号，并保留取消语义，而不会将其包装成 `ATTACHMENT_READ_FAILED`。`Config.maxTextBytes`(默认 `DEFAULT_MAX_TEXT_BYTES`，5 MiB，与 `DEFAULT_MAX_IMAGE_BYTES` 一致)是文本准入唯一的界限；被接受的 `TextMediaType` 集合(`text/csv`、`application/json`、`text/markdown`、`text/plain`)是固定常量，不是 Loader 暴露的可配置项，与 `imageLimits.mediaTypes` 对称。

## 模型体验

该包通过重启和 fork 后对历史用户图片与结构化模型图片输出的持久回放间接影响模型。

#### KV 缓存影响

除发起请求的适配器所持有的图片块外，不产生其他影响。

## 已知限制与待完成工作

- 对象会无限期保留；基于引用的垃圾回收尚未实现。
- 本地后端假定宿主与提供方适配器共享同一个文件系统服务。
- 动态 GIF 的元数据根据逻辑屏幕进行校验；逐帧解码策略由提供方持有。
- 文本文件声明的 `mediaType` 从不与其内容交叉校验：`text/csv`、`application/json`、`text/markdown` 和 `text/plain` 都不像 raster 头部那样携带可区分的字节级签名，因此准入信任调用方的声明。
