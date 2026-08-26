# Agent Note: 在图片系列旁新增并行的 Text 附件系列

Status: implemented

[English](2026-08-18-attachment-text-family.md) | 中文

## 问题

`@deepseek-ai/dsh-attachment` 及其本地后端在每一层都是图片专属的：`ImageMediaType` 是唯一的持久化媒体类型联合类型，`AttachmentStore` 的每个方法都以 `*Image*` 命名，准入(`attachment-local/src/store.ts`)在发布引用之前会通过 `sharp` 完整解码每个候选光栅图。以文件为中心的 Science artifact 捕获需要让 `.csv`、`.json`、`.md` 和 `.txt` 文件抵达与已保存 chart 相同的内容寻址、持久引用的存储——但这些格式没有可解码的光栅头部，没有固有宽高，也没有像 PNG 头部与 JPEG 头部那样能区分不同文本格式的字节级签名。

## 决策

新增一个并行的 Text 系列，逐字段镜像图片系列，而不是把 `ImageAttachmentRef` 拓宽成一个泛化的判别式联合类型：

```ts
import type { AttachmentId } from '@deepseek-ai/dsh-attachment'

type TextMediaType = 'text/csv' | 'application/json' | 'text/markdown' | 'text/plain'
interface TextAttachmentRef { attachmentId: AttachmentId; mediaType: TextMediaType; bytes: number; name?: string }
interface TextAttachmentLimits { maxTextBytes: number; mediaTypes: readonly TextMediaType[] }
interface SaveTextAttachment { data: Uint8Array; mediaType: TextMediaType; name?: string }
interface StoredTextAttachment { ref: TextAttachmentRef; data: Uint8Array }
```

`AttachmentStore` 在图片系列方法之外新增 `abstract readonly textLimits`、`validateText`、`saveText`、`readText`。这里没有 `saveTexts` 批量入口：目前没有调用方像 `saveImages` 批量处理一条聊天消息的图片那样批量上传文本文件，因此 Science 捕获调用方会通过自己的循环、逐个调用 `saveText` 来保存每个文件——一个不批量的方法与一个批量的方法并存是有解释的不对称，不是遗漏的抽取。

`attachment-local` 的准入(`validateTextFile`/`saveTextFile`)只检查字节上限与 UTF-8 合法性(`node:buffer` 的 `isUtf8`)——不做光栅解码，不做像素上限检查，更关键的是不做内容格式校验：`TextMediaType` 由调用方声明并被信任，不与内容交叉校验，因为 CSV/JSON/Markdown/纯文本字节不像 PNG 或 JPEG 头部那样携带可区分的签名。这是相对图片路径 `IMAGE_TYPE_MISMATCH` 检查的刻意简化，不是疏漏。

存储在图片路径之间完全共享：内容寻址从不在路径中编码媒体类型，因此 `objectPath`/`root` 原样适用；底层内容寻址的发布/读取机制(`publishObject`/`readObject`，从此前 `saveImageFile`/`readImageFile` 的内联函数体中抽取而来)现在是 `attachment-local/src/store.ts` 中共享的私有辅助函数。抽取这些辅助函数属于本次改动的范围，不是顺带的重构：为文本单独编写一份对durability 敏感的发布流程(暂存文件、同步、原子硬链接、EEXIST 去重回退、目录同步、失败清理)的独立副本，会使按文件 100% 覆盖率的 gate 要求覆盖的边界用例测试翻倍——而这些代码本就与哪个媒体类型拥有这些字节无关、完全相同。这次抽取没有改变任何面向图片的行为；`attachment-local/tests/store.spec.ts` 现有的完整图片测试套件(包括精确顺序的目录同步断言)针对重构后的实现原样通过。

`LocalAttachmentStore.Config` 新增经校验的 `maxTextBytes` 字段(默认 `DEFAULT_MAX_TEXT_BYTES`，5 MiB，与 `DEFAULT_MAX_IMAGE_BYTES` 一致)，使用与图片字节字段相同的 `.step(1).min(1)` 校验形态——本包对任何准入字段(无论图片还是文本)都没有显式 `MAX_*` 上限的先例，因此这里也不添加。被接受的 `TextMediaType` 集合是固定常量(`TEXT_MEDIA_TYPES`)，不是 Loader 暴露的可配置项，与既有的 `ImageAttachmentLimits.mediaTypes` 不可配置的先例一致。

`AttachmentErrorCode` 新增 `TextAdmissionErrorCode` 子集(`INVALID_TEXT`、`TEXT_TOO_LARGE`)，与 `ImageAdmissionErrorCode` 对称。没有添加 `isTextAdmissionError` 判定函数：`isImageAdmissionError` 之所以存在，是因为有两个真实的上传路径消费方(`packages/mcp/mcp-client/src/tools.ts`、`packages/acp/acp/src/content.ts`)需要为用户提交的图片区分可由调用方修正的准入失败与存储故障；目前没有近期消费方需要为文本做这种区分(Science 捕获——唯一的近期文本写入方——并不经过这两条上传路径中的任何一条)。

## 考虑过的替代方案

**把 `AttachmentStore`/`ImageAttachmentRef` 拓宽为一个按媒体系列判别的泛化联合类型。** 已否决：完整重写 `saveImage`/`readImage`/`imageLimits` 会牵动每一个与 Science 无关的图片上传消费方，而目前还没有第二个媒体系列的证据(这是第一个非图片系列)来支撑更大的抽象。并行系列的形态把影响范围限制在新增成员上。

**复制内容寻址的发布/读取逻辑，而不是抽取共享辅助函数。** 已否决：`saveImageFile` 的发布流程(持久性边界证明、暂存、原子硬链接、EEXIST 去重、目录同步、失败清理)十分精细，已经有针对顺序与崩溃安全性的专门测试；为文本单独写一份独立副本，需要为本质上并不因媒体类型而不同的代码补齐同等的测试才能达到按文件 100% 的覆盖率门槛。

**让 `TextMediaType` 与内容交叉校验，模仿 `IMAGE_TYPE_MISMATCH`。** 已否决：没有字节级签名能像光栅头部区分 PNG 与 JPEG 那样区分 `text/csv`、`text/markdown` 与 `text/plain`；任何检查都需要解析(CSV 形态的启发式规则、尝试 JSON 解析)，而这恰恰是本设计刻意避开的"不做光栅解码"简化。调用方的声明被信任，与设计明确的"只做字节上限 + UTF-8 合法性"范围一致。

**为了与 `saveImages` 对称，添加 `saveTexts` 批量方法。** 已否决：目前没有调用方像一条聊天消息批量携带多张图片那样批量上传文本文件；提前添加会造成没有当前消费方的无主接口。

## 后果

仓库中每一个既有的 `AttachmentStore` 子类都需要补上 `textLimits`/`validateText`/`saveText`/`readText` 桩成员，才能继续实现这个更宽的抽象契约：包内测试文件(`packages/llm/llm-pi-ai` 的两个测试文件、`packages/host/apiproxy`、`packages/mcp/mcp-client`、`packages/fs/tool-fs`(两个子类)、`packages/acp/acp` 的共享测试脚手架——都不属于受 gate 约束的 `pnpm run typecheck` 聚合范围，而是通过运行每个受影响的测试套件验证)，以及两个根级 `scripts/*.ts` 测试装置(`gen-tool-catalog.ts` 的 `CatalogAttachmentStore`、`test-invariants.ts` 的 `TestAttachmentStore`)——`tsconfig.host.json` 直接包含这两个文件，`pnpm run typecheck` 确实对它们加了 gate。

`docs/subsystems/attachment.md`(标题从 "Durable Image Attachments" 改为 "Durable Attachments")新增了五个 `ts type-equiv` 代码块和一个"Text attachments"小节，并登记到 `scripts/type-equiv.manifest.json`；生成的 `## Cordis API` 区块需要在 `scripts/gen-cordis-catalog.ts` 的 `linkedTypePages` 映射中补充 `TextAttachmentRef`/`SaveTextAttachment`/`StoredTextAttachment`，生成器的类型链接覆盖检查才能通过。`packages/attachment/attachment` 与 `packages/attachment/attachment-local` 的中英文 README 都记录了这个新的服务边界及其"已知限制"新增项(声明的媒体类型从不做内容校验)。

本次改动没有把更宽的 `ImageAttachmentRef | TextAttachmentRef` union 接入 `dsh-science-session` 的 `ScienceArtifactVersion.attachment`；它只是让 `TextAttachmentRef` 存在，并且能够通过 `ctx.attachments` 存储与读取。[Science Runtime auto-capture of run-written files](2026-08-19-science-auto-capture.zh.md) 是第一个在该 union 落地后真正产出携带文本附件的 artifact version 的调用方。
