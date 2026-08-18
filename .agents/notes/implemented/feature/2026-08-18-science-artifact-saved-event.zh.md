# Agent Note: `science/artifact-saved` 取代 `science/chart-saved`

Status: implemented

[English](2026-08-18-science-artifact-saved-event.md) | 中文

## 问题

`dsh-science-session` 把每一次保存的图形建模为一个 `ScienceChartVersion`，由 `science/chart-saved` 事件承载，`mediaType: z.literal('image/png')` 直接固化在持久化 codec 里。以文件为中心的 artifact 捕获(自动把 run 写出的任意 `.csv`/`.json`/`.md`/`.png`/`.txt` 导入为一个带版本的 artifact，并允许模型事后为某个版本策展 title/caption)需要一条不天然是 PNG 形状的持久化记录，其 `title` 无论是否由人类提供都始终填充，并区分无人值守的捕获与模型主导的保存。就地放宽 `chartSchema` 需要放松其 `image/png` 字面量——而该 schema 自身的文档注释早已标出这是有意为之的 v1 收窄("Science version one requires PNG")——并且会让这套词汇在未来每一个非图像 artifact 上继续叫作"chart"。

## 决策

`science/chart-saved` 被撤下，由 `science/artifact-saved` 取代，携带一个 `ScienceArtifactVersion`：

```ts
import type { ImageAttachmentRef, TextAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { CallId } from '@deepseek-ai/dsh-llm'
import type { ScienceArtifactId, ScienceRunId } from '@deepseek-ai/dsh-science-session'

export interface ScienceArtifactVersion {
  readonly artifactId: ScienceArtifactId       // was ScienceChartId / chartId
  readonly logicalName: string
  readonly version: number
  readonly title: string                        // always populated
  readonly caption?: string
  readonly origin: 'auto' | 'model'             // unattended capture vs. curated save
  readonly attachment: ImageAttachmentRef | TextAttachmentRef
  readonly runId: ScienceRunId
  readonly toolCallId: CallId
  readonly requestHeaderSeq: number
  readonly environmentRevision: number
  readonly environmentFingerprint: string
  readonly createdAt: number
}
```

science-session 的每一层都机械地跟随这次重命名：`domain.ts`(`ScienceArtifactSavedEvent`、`SessionAttachmentExtractorMap` 的 key)、`codec.ts`(以 `artifactSchema` 取代 `chartSchema`、`decodeScienceArtifact`)、`transition.ts`(`applyArtifactSaved`、`state.artifacts`/`state.artifactFacts`)、`fold-state.ts`、`projection-value.ts`(`clientArtifact`)、`projection-schema.ts`/`projection-fold-codec.ts`/`projection-private.ts`/`projection-witness.ts`，以及 `ids.ts`(`ScienceArtifactId` 品牌类型，`SCIENCE_PROJECTION_STATE_VERSION` 从 `2` 提升到 `3`，因为持久化 checkpoint 的字段名发生了变化)。`ScienceProjection.artifacts` 与 `ScienceProjectionMetrics.artifactCount`/`artifactVersionCount` 取代 `.charts`/`chartCount`/`chartVersionCount`；`ScienceClientArtifactVersion` 取代 `ScienceClientChartVersion`。

fold 本身不做任何基于内容哈希的去重：一次仅改动策展元数据的重存——`attachment` 完全相同，只是 `title`、`caption` 或 `origin` 发生变化——仍会提交下一个连续版本。是否值得为一个未变化的文件创建新版本，是未来自动捕获调用方自己的决定，不属于本包——这与 `transition.ts` 现有的模式一致：它校验来源与顺序，但从不检视附件内容。

`science-runtime` 的 `commitChart` 现在构造一个 `ScienceArtifactVersion` 并以 `origin: 'model'` 追加 `science/artifact-saved`(`save_chart` 导入始终是一次策展的、模型主导的保存)；它自身的名字、请求/响应形状与错误码在这里保持不变——`commitChart` 与 `save_chart` 由 [retire `save_chart`, add metadata-only `annotate_artifact`](2026-08-19-science-annotate-artifact.md) 退役，由 `annotateArtifact`/`annotate_artifact` 取代。`tool-science` 与 `ui-science` 在内部读取重命名后的持久化/projection 字段，但保持每一个模型可见与用户可见的名字不变：`get_science_state` 的输出仍然返回 `charts`/`chartId`/`chartCount`/`chartVersionCount`，`publish_outcome` 的 evidence schema 仍然接受 `{kind: "chart", chart_id, version}`，`ui-science` 自身的 selection-store 词汇(`ScienceOpenArtifact.chartId`、`activeChartId`、`openTab({chartId, version})`)未被触碰——只有每个字段所携带的品牌类型从 `ScienceChartId` 变成了 `ScienceArtifactId`。`ScienceChartEvidenceRef`(`publish_outcome` 的 evidence 引用形状)出于同样的原因保留其 `kind: 'chart'` / `chartId` 字段名：引用词汇是一个独立的、未被重命名的概念，与它所指向的 artifact 记录不同；它的 `chartId` 字段的类型跟随 `ScienceArtifactId` 重命名，但字段本身不改名。

`SESSION_FORMAT_VERSION` 保持 `0`：这是一次 Science 领域事件词汇的变化，不是通用 session-log 信封结构的变化。

## 考虑过的替代方案

**就地扩宽 `chartSchema` 的 `mediaType` union，而不是引入新事件类型。** 已否决：该 schema 自身的 `image/png` 字面量是刻意为之的 v1 收窄，而 `chart`/`ScienceChartVersion` 这些名字会永久附着在一个不再意味着"chart"的概念上。

**在冻结的 `chart-saved` 旁引入并行的 `science/file-saved` 事件。** 已否决：这会为两个仅在媒体类型与策展字段上不同的概念永久重复 fold/codec/projection/checkpoint 代码，代价是永久性的，只为省下一次性的 fixture 重新生成成本。

**在同一改动中重命名面向模型的工具接口(`save_chart` 的 schema、`get_science_state` 的 `charts` 字段、`publish_outcome` 的 evidence `kind`)。** 已否决：持久化模型重命名与工具接口重命名是两个独立的决定，各有独立的 snapshot 成本。在此保持每个模型可见字符串不变，意味着这个决定不携带任何需要 snapshot 的模型可见行为变化；`save_chart` 的退役与 `annotate_artifact` 的引入记录在 [retire `save_chart`, add metadata-only `annotate_artifact`](2026-08-19-science-annotate-artifact.md)。

**把 `ScienceChartEvidenceRef` 的 `kind`/`chartId` 重命名为 `'artifact'`/`artifactId`。** 已否决：`publish_outcome` 的 evidence 引用词汇是一份独立于 artifact 记录本身的、面向工具的契约；重命名它会强制为一个并不在本次改动实际范围内的引用形状更新 `publish_outcome` 的 snapshot 与测试，而该字段的类型本就已经正确跟随了 `ScienceArtifactId` 的重命名。

## 后果

每一份内嵌 `science/chart-saved` 的 fixture 都需要在同一改动中重新生成：`science-session/tests`(11 个测试文件)、`science-runtime/tests`、`tool-science/tests`、`ui-science/tests`(6 个测试文件)、`session-attachment-index/tests`、`host/apiproxy/tests/session-export.spec.ts`、`apps/web` 的 Science e2e/snapshot fixture，以及 `examples/headless-agent` 的 keyless snapshot 期望值(通过 `DSH_SNAPSHOT=refresh` 刷新，无需模型 key，因为该场景运行的是脚本化 mock LLM)。生成的 `docs/persistence-catalog.md`、`docs/tool-catalog.md`，以及 `docs/subsystems/science.md` 的 `## Cordis API` 区块(连同它们的 `.zh.md` 对照文件)都需要重新生成；`scripts/gen-tool-catalog.ts` 在其 catalog 行配置里硬编码了一个 `'science/chart-saved'` 字符串(并非从源码派生),需要相应手工修改；`scripts/gen-cordis-catalog.ts` 的 `linkedTypePages` 映射也需要把 `ScienceChartVersion` 重命名为 `ScienceArtifactVersion`，生成器的类型链接覆盖检查才能通过。

本笔记最初推迟的 `attachment: ImageAttachmentRef | TextAttachmentRef` union，连同 `applyArtifactSaved` 原本仅限成功来源 run 的校验、以及每次保存都消费一次全新 tool call 的做法，一并在 runtime 自动捕获中落地；参见 [Science Runtime auto-capture of run-written files](2026-08-19-science-auto-capture.md)。
