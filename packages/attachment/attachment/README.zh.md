# @deepseek-ai/dsh-attachment

[English](README.md) | 中文

持久附件服务边界。`ctx.attachments` 校验并持久提交不可变图片与文本字节，随后返回可序列化的 `ImageAttachmentRef` 或 `TextAttachmentRef`；消费方绝不会在会话事件中持久保存浏览器路径、对象 URL、提供方 URL 或 base64。

未发送的输入区图片仍是由浏览器持有的临时草稿。`validateImage` 运行相同的准入策略，但不执行持久化。`saveImages` 负责批次图片数量和总字节限制，先校验全部成员，再按顺序提交，并且只在完整批次成功后返回引用。后续存储失败不会返回部分引用，但较早写入的不可变内容寻址对象可能保持不可达，直至具备按引用感知的垃圾回收。`AttachmentError.code` 使用封闭的 `AttachmentErrorCode` 字符串联合类型。其 `ImageAdmissionErrorCode` 子集标记可由调用方修正的图片输入失败；`isImageAdmissionError` 在运行时识别该子集，使每个协议适配器可以映射自己的错误词汇。`saveImage` 会在发布任何模型可见的会话事件前提交一张已接受的图片，`readImage` 则根据已记录的元数据校验内容寻址对象。调用方可以取消 `readImage`；实现会在后端读取与校验工作的边界观察取消，并保留取消语义，而不会将其转换为存储失败。

文本系列(`validateText`、`saveText`、`readText`、`textLimits`)逐字段镜像图片系列，但只按字节上限与 UTF-8 合法性准入——不做内容格式校验，因为 `TextMediaType`(`text/csv`、`application/json`、`text/markdown`、`text/plain`)不像 raster 头部那样携带字节级签名；调用方声明的媒体类型不会与内容交叉校验，原样透传。这里没有 `saveTexts` 批量入口：目前没有调用方像 `saveImages` 批量处理一条聊天消息的图片那样批量上传文本文件。`TextAdmissionErrorCode`(`INVALID_TEXT`、`TEXT_TOO_LARGE`)标记可由调用方修正的文本输入失败，与 `ImageAdmissionErrorCode` 对称。

## 模型体验

该包通过角色无关的核心 `ImageBlock`，以及解析其持久引用的提供方适配器，间接影响模型。

#### KV 缓存影响

添加图片会改变提供方请求，因此会使受影响的请求后缀失效。

## 已知限制与待完成工作

- 第一版接受 PNG、JPEG、WebP 和 GIF 图片，以及 CSV、JSON、Markdown 和纯文本文件。
- 保留策略与垃圾回收尚未实现，因为恢复和 fork 后的会话可能共享不可变对象。
- 通用二进制文件、音频、视频和持久的未发送草稿需要单独的生命周期与提供方契约。
