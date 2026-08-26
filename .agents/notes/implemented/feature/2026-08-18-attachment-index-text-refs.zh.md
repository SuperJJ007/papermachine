# Agent Note: `SessionAttachmentIndex` 也能授权文本引用

Status: implemented

[English](2026-08-18-attachment-index-text-refs.md) | 中文

## 问题

`SessionAttachmentIndex` 是唯一的注册表，负责把一条持久化会话事件转译为它所授权的完整附件引用，被 `dsh-host-apiproxy` 同时用于实时附件读取授权与会话 ZIP 导出媒体收集。它的注册机制(`built-in`/`attachment-free`/`extractor-required` 分类、每个事件类型一个存活注册、注册缺失时大声失败)在结构上已经是通用的——无论是 dispose、重复注册拒绝，还是穷尽性分类表，都不是图片专属的。唯一固定死的是被擦除的提取器返回类型 `readonly ImageAttachmentRef[]`，这把每一个领域提取器都钉死在图片引用上，导致未来某个想要授权 `TextAttachmentRef`(Science 文件捕获，本次改动未构建)的领域提取器无法返回它。

## 决策

`ErasedExtractor` 拓宽为 `readonly (ImageAttachmentRef | TextAttachmentRef)[]`，`register()` 的带类型提取器参数与 `extract()` 的返回类型同样拓宽——现在一个已注册的提取器可以从单个事件中授权图片与文本引用的混合。`extractBuiltInAttachments`(消息内容载体的内置扫描器)仍然只处理图片：目前的 `ContentBlock` 联合类型没有文本附件载体类型，因此只有已注册的领域提取器才能返回 `TextAttachmentRef`。

两个既有的便利读取方法(`findReferencedImage`、`collectReferencedImages`)保持与之前完全相同的行为——它们现在通过一个结构化类型守卫(`isImageRef`，检测 `'width' in ref`；`ImageAttachmentRef` 与 `TextAttachmentRef` 其余共享 `attachmentId`/`mediaType`/`bytes`/可选的 `name`，因此像素尺寸字段的有无是成本最低且正确的判别方式，无需重复任何一份媒体类型字面量列表)把 `extract()` 拓宽后的结果过滤到只剩图片引用。两个新增的镜像方法 `findReferencedText` 与 `collectReferencedTexts`，通过互补的守卫(`isTextRef`)过滤到文本引用。`Array.prototype.find` 的类型谓词窄化不会穿透内联的 `&&` 布尔表达式组合，因此两个过滤器都先做一次 `.filter(isImageRef)`/`.filter(isTextRef)`，再做 id 匹配，而不是把它们合并进同一个谓词里的布尔表达式。

## 考虑过的替代方案

**让 `findReferencedImage`/`collectReferencedImages` 返回拓宽后的 union，由调用方自己窄化。** 已否决：目前每一个调用方(`dsh-host-apiproxy` 的实时附件 RPC 与 ZIP 导出)在每个调用点都只想要一种确定的引用类型；把窄化下推到每个调用方，只会让同一个 `isImageRef` 检查在每个调用点重复一遍，而不是在注册表里做一次。

**用一对泛型的 `findReferenced<T>`/`collectReferenced<T>` 取代四个具名方法。** 已否决：本注册表的公开 API 刻意按媒体类型给出具体方法(与 `AttachmentStore` 自身 `saveImage`/`saveText` 的拆分方式一致，而不是一个泛型 `save<T>`)，而泛型方法无论如何都需要一个运行时判别参数来做同样的过滤——四个方法的形态在每个调用点都能直接读出它做了什么，无需额外的类型参数。

## 后果

`docs/subsystems/session.md` 生成的 `## Cordis API` 区块(及其由生成器保持字节级一致的 `.zh.md` 对照)通过 `pnpm run gen-cordis-catalog` 自动获取了拓宽后的 `register`/`extract` 签名与两个新方法；由于该区块在生成标记之外没有任何图片专属的手写文字，无需手工修改。`packages/session/session-attachment-index` 的中英文 README 记录了拓宽后的 `extract()` 返回类型与两个新方法，并说明内置扫描器仍然只处理图片。

没有任何消费方的行为发生变化：`dsh-host-apiproxy` 的 `session-export.ts` 与 `api-proxy.ts` 仍然只调用图片专属的读取方法，其返回结果与改动前完全一致(`isImageRef` 的过滤对一个全是图片的结果集是空操作)。`packages/science/science-session` 自身已注册的提取器(`science/artifact-saved`)每个 artifact version 仍然只返回一个 `ImageAttachmentRef`：`ScienceArtifactVersion.attachment` 尚未成为以文件为中心的 artifact 捕获所需要的 `ImageAttachmentRef | TextAttachmentRef` union(参见 [`science/artifact-saved` replaces `science/chart-saved`](2026-08-18-science-artifact-saved-event.zh.md) 的 Consequences)。那个 union，以及第一个真正返回文本引用的提取器，会在 [Science Runtime auto-capture of run-written files](2026-08-19-science-auto-capture.zh.md) 中一并落地。
