# Agent Note: 新增的 `session.textAttachment` RPC 与 `readTextAttachment`

Status: implemented

[English](2026-08-18-attachment-text-rpc.md) | 中文

## 问题

`dsh-host-apiproxy` 的 `sessions.attachment` RPC、`ISession.readAttachment`，以及 `imageLimits` projection 单元，在每一层都只按 `ImageAttachmentRef` 定型：协议 schema、`SessionsApi` 接口、浏览器端 client 契约，以及让客户端预检查准入上限的常量单元。`dsh-attachment` 与 `dsh-session-attachment-index` 已经在端到端携带一套并行的 `TextAttachmentRef` 系列，但线上没有任何入口能把一个文本附件的字节读回来，也没有 projection 告诉客户端该部署的文本准入上限。

## 决策

在 `session.attachment` 旁新增 `session.textAttachment` 作为一个**新**的 RPC 方法，而不是拓宽既有方法的返回类型：拓宽一个已发布方法的返回类型，会让线上契约对任何按旧契约构建的客户端处于中途不一致的状态。`session.textAttachment` 在每一层都镜像 `session.attachment`：`SessionsApi.textAttachment`(请求/响应形状)、`sessions.schema.ts` 里的 `sessionTextAttachmentRequestSchema`/`sessionTextAttachmentValueSchema`/`textAttachmentRefSchema`/`textMediaTypeSchema`、一条 `RpcMethodMap['session.textAttachment']` 条目、fetch handler 与 client 里的一行 `UNARY_ROUTES`/`UNARY_VALUE_SCHEMAS`，以及一个 `ApiProxy.sessions.textAttachment` 实现——它先通过 `ctx.sessionAttachments.findReferencedText`(在 [`SessionAttachmentIndex` authorizes text references too](2026-08-18-attachment-index-text-refs.zh.md) 中新增的查找器)完成授权，再通过 `ctx.attachments.readText` 读取字节。

线上的 `data` 是一个纯 UTF-8 字符串，而非 base64：`saveText`/`readText` 的准入检查已经证明了存储字节是合法 UTF-8(`dsh-attachment-local` 的 `checkTextValidity`)，因此不需要二进制传输编码，这与图片路径的 base64 不同(光栅字节不是文本安全的)。Host 端用 `Buffer.from(stored.data).toString('utf8')` 编码；浏览器端 client(`Session.readTextAttachment`)把字符串原样传递，无需 `readAttachment` 那样的 `atob`/`Uint8Array.from` 解码步骤。

`SessionProjectionMap` 新增一个与 `imageLimits` 并列的姊妹字段 `textLimits: TextAttachmentLimits`，而不是重命名：重命名 `imageLimits` 会牵动每一个既有的图片上传读取方，却对本次改动没有任何好处。`textLimits` 以与 `imageLimits` 完全相同的启动期常量形状注册(`apply: state => state`、`view: () => projectionCtx.attachments.textLimits`)，紧跟在 `imageLimits` 自己的 `ctx.inject(['sessionProjections', 'attachments'], ...)` 代码块之后，用它自己的代码块注册。

`ISession.readTextAttachment(attachmentId)` 加入浏览器侧契约，与 `readAttachment` 并列，在 `Session`(`packages/client/runtime/src/client/sessions/session.ts`)中实现，并在 `test-support` 的测试替身里给出 fail-loud 桩实现，完全镜像 `readAttachment` 既有的模式。

## 考虑过的替代方案

**把 `sessions.attachment` 的响应拓宽为 `attachment: ImageAttachmentRef | TextAttachmentRef`。** 否决：一个被拓宽的既有方法，会在每一个依赖层(客户端解码、UI 分发)都落地之前，先对外发布一个服务端还答不全的类型，让线上契约在整个技术栈范围内处于半实现的中途状态。用一个新方法名，则意味着 `session.attachment` 从始至终保持不变，而 `session.textAttachment` 从诞生起就是一个独立的可加单元。

**为了与 `attachment` 对称而把 `textAttachment` 的 `data` 也编成 base64。** 否决：图片线上之所以要 base64，是因为光栅字节不能安全地内嵌为 JSON 字符串；而文本字节在准入检查之后本就已经是安全的。把一个字符串编码成 base64 再在客户端解回同一个字符串，只会多一次没有正确性收益的往返。

## 后果

每一个实现 `SessionsApi`/`IApiClient` 的实现体都需要补上 `textAttachment` 成员才能继续实现被拓宽的接口：`api-proxy-projections.spec.ts`/`fetch-carrier.spec.ts`/`client-handler.spec.ts` 里的两个脚本化测试替身、`packages/client/connection/src/client/fixture.ts`(浏览器开发/演示用的 fixture，新增了一个空的 `texts` map，因为目前没有任何 fixture 场景会上传文本文件——`textAttachment` 仍照样镜像 `attachment` 的授权/查找机制)，以及 `packages/client/connection/tests` 与 `packages/client/runtime/tests` 下两份 `fake-api.client.ts` 副本。

`packages/host/apiproxy/tests/api-proxy-projections.spec.ts` 里既有的 `imageLimits` 常量单元测试此前用了一个一次性的 `textLimits = { maxTextBytes: 0, mediaTypes: [] }` 桩(在本次改动之前，它只需要满足 `AttachmentStore` 的抽象成员即可，因为没有任何代码会读取它)——如今真正注册了一个 `textLimits` projection 单元后，每次 `session.history` 调用都会用 `textLimitsProjectionSchema` 的 `.positive()` 校验这个值，于是 `0` 这个桩值开始校验失败。已修正为一个合法的代表值，并合并进同一个测试，同时断言 `imageLimits` 与 `textLimits` 一起发布，这与它们共享同一个 `AttachmentStore` 组合的事实相符。新增的 `api-proxy-models.spec.ts` 测试(`authorizes text attachment bytes only when the session event stream references the id`)以与既有图片测试验证 `attachment` 相同的方式，验证了 `textAttachment` RPC 的授权/未被引用两条路径，测试针对 `science/artifact-saved`(session-attachment-index 目前唯一已合并的、需要 extractor 的 key)注册了一个合成的 extractor，因为目前没有任何内置的消息内容载体能承载一个文本文件附件。

`packages/extensions/cordis-client-runner/src/client/api-catalog.ts` 通过 `pnpm run gen-cordis-inspect-catalog`(它真正的生成器——该文件的横幅文字写的是 `gen-cordis-api.ts`，那是 `packages/extensions/tool-cordis` 里另一套服务端 `ctx.<service>` 目录的兼容入口，与本文件无关)拾取了 `ISession.readTextAttachment`。`packages/host/apiproxy` 的双语 README 记录了网关现在拥有三个而非两个 projection 单元。

重新设计的 Science 查看器面板、`annotate_artifact` 的工具入口，以及运行时自动捕获均不受影响：本次改动只涉及线上契约、是可加的，目前也没有任何调用方会真正产出一个带文本附件的 artifact 版本。
