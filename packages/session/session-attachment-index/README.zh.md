# @deepseek-ai/dsh-session-attachment-index

[English](README.md) | 中文

通用的会话附件引用注册表。它拥有 `ctx.sessionAttachments`——唯一实现,把一条持久化会话事件转译为该事件所授权的完整 `ImageAttachmentRef` 值。内置扫描器覆盖当前每一种可能携带引用的模型可见内容载体(直接 content、被包裹的助手消息、每条 inserted 消息,以及一个已完成的 `assistant/chunk` 块);领域包则为自己拥有的某个事件类型注册一个带类型的提取器。`dsh-host-apiproxy` 对实时附件读取授权与会话 ZIP 导出的媒体收集都只消费这一个注册表,因此同一条被接受的领域事件能同等地授权两条路径。

## 服务:`SessionAttachmentIndex`(ctx 键:`sessionAttachments`)

### 公开 API

- `ctx.sessionAttachments.register(eventType, extractor): () => void` 为一个 extractor-required 的事件类型(本包自身未分类为 `built-in` 或 `attachment-free` 的已知类型)注册领域提取器。注册是挂在调用方 fiber 上的 effect:该 fiber 被 dispose 即移除注册。当 `eventType` 已被分类为 `built-in`/`attachment-free`,或该 key 已有另一个存活注册时,抛出。
- `ctx.sessionAttachments.extract(event): readonly ImageAttachmentRef[]` 一条持久化事件所授权的每个引用。对没有存活注册的已知 extractor-required 类型,抛出 `SessionAttachmentIndexError`(`SESSION_ATTACHMENT_EXTRACTOR_MISSING`)。
- `ctx.sessionAttachments.findReferencedImage(events, attachmentId): ImageAttachmentRef | undefined` 在一段有序事件序列中查找匹配某个不透明 id 的首个引用——即实时单引用授权读取。
- `ctx.sessionAttachments.collectReferencedImages(events): ReadonlyMap<string, ImageAttachmentRef>` 在一段有序事件序列中收集全部去重后的引用(按 attachment id 去重)——即会话导出的媒体收集读取。

### 关键类型

- `SessionAttachmentPolicy`——`'built-in' | 'attachment-free' | 'extractor-required'`,每个已知会话事件类型所携带的三分类。
- `SessionAttachmentExtractorMap`——merge-extensible 的类型表,领域包通常与自己的 `SessionEventMap` merge 并列扩展它,以放宽 `register()` 的带类型 key 集合。
- `SessionAttachmentIndexError`——携带稳定 `SESSION_ATTACHMENT_EXTRACTOR_MISSING` 错误码的带类型拒绝。

## 约定

- **穷尽且封闭的分类表。** `./policy.ts` 用两份封闭列表把当前每个已知会话事件类型分类为 `built-in` 或 `attachment-free`;不在任一列表中的已知类型即为 `extractor-required`。本包自身测试套件中的一项测试会把这两份列表与 `@deepseek-ai/dsh-session` 生成的 `KNOWN_SESSION_EVENT_TYPES` 比对:新增一个已知事件类型而未更新某份列表(或未把它计入新的 extractor-required 类型),该测试即失败。本包无需依赖任何领域包即可承载该分类——事件类型字符串本就通过仓库级生成的类型集合公开。
- **宁可大声失败,也不给出假的空结果。** 一个已知的 extractor-required 类型若没有存活注册,会抛出 `SESSION_ATTACHMENT_EXTRACTOR_MISSING`,而不是悄悄地不授权任何内容;一个未识别的类型只有在持久化读取路径已将其作为 `ignorable` 放行之后才会到达本注册表,这类类型不授权任何内容。已注册的提取器若拒绝畸形数据(用它自己领域的严格解码器),该失败会原样传播,而不会退化为空结果。
- **只返回完整引用,绝不返回裸 id。** 已注册的提取器校验该事件自身的持久化字段,并返回完整的 `ImageAttachmentRef` 值。一个引用只有出现在该会话自身日志中某个已分类/已注册的载体里才被授权——任意 JSON(工具参数、另一个会话的事件、attachment-free 或未识别的 ignorable 事件)均不授权任何内容。
- **每个 key 只允许一个安全敏感的注册。** 与读侧的投影注册表不同,同一事件类型的两个存活注册永远被拒绝,而不是按引用计数共享:这项决定授权的是字节访问,其归属的歧义是正确性问题,而非 UI 层面的不一致。
- **不是第二个附件存储。** `ctx.attachments` 仍是唯一的字节所有者与完整性校验者;本注册表只回答一个会话日志持久地命名了哪些完整引用。

## 职责

本包承担附件授权 seam 中通用注册表的角色:领域 host 插件(如 `dsh-science-session`)为自己的事件类型贡献带类型的提取器,`dsh-host-apiproxy` 则为实时附件 RPC 与会话 ZIP 导出两处消费该注册表。两侧互不相识。

## 模型体验

无，因为本包不计算任何提示词、工具 schema 或模型可见内容;它只对已经记录在别处的持久化事件做分类。

#### KV Cache 影响

无;它从不组装或发送提供方请求。

## 已知限制与暂缓事项

- **靠穷尽性测试而非构建期生成器来把关新鲜度。** 与本仓库中一些 merge-extensible 词汇所用的、由 JSDoc 标签驱动的生成器不同,这里的两份分类列表是一张手工维护的单一表格,由单元测试对照生成的已知类型集合校验;未来若某个领域包需要自己的 extractor-required 事件类型,除了调用 `register()` 之外,无需改动本包的任何内容。
- **会话导出"不产出部分 ZIP"的保证是逐工件的,而非整个归档级别的。** 若在扫描第一个工件内容时就发现提取器缺失,该失败发生在任何归档字节被写入之前;若失败出现在稍后的某个子代理后裔上,仍会使正在进行中的流报错,而不会让它完整结束——这与 `dsh-host-apiproxy` 对其他流中读取失败的既有大声失败行为一致。
