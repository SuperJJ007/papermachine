# Agent Note：Artifact 身份稳定性与光栅捕获策略

Status: implemented

[English](2026-08-27-artifact-identity-stability-and-raster-capture-policy.md) | 中文

## Problem

助手流式输出期间，Science 右侧面板中的每个 artifact 都在持续闪烁。session projection 会在每个 session 事件上重建；`toClientScienceProjection` 在每次重建时都会为每个 artifact 生成一个全新的 `ScienceClientArtifactVersion` 对象，而客户端又用 `useSession(s => s)` 订阅了整个 session snapshot，这同样在每个流式事件上触发。下游的图片与文本加载 effect 把依赖数组键控在重建出的对象身份上，于是一个无关事件（一个流式 token、一次心跳）就会把每个已打开的 artifact 重置为 loading 状态并重新拉取字节。

另外，一份 session 日志显示：模型被要求生成一张 Python 图表和一张 R 图表，却产出了四个图表 artifact——Python spec 被重新保存为第二个版本，仅仅是为了匹配 R spec 的小数位舍入；再加上安装 `vl-convert` 后为"视觉 QA"而在 `SCIENCE_ARTIFACT_DIR` 下保存的两张 PNG 渲染图。自动捕获无法区分一张交付图表和一次自我检查渲染；两者在 `SCIENCE_ARTIFACT_DIR` 下都是合格文件。

## Decision

### 身份稳定的 artifact 加载

`projection-value.ts` 用一个以源 `ScienceArtifactVersion` 对象为键的 `WeakMap` 记忆化 `clientArtifact`。fold state 在每次 transition 时都会浅拷贝其 `artifacts` 数组（`fold-state.ts`），但从不就地修改未变化的版本，因此一个版本的源对象在被编辑或新版本取代之前，跨多次 projection 保持引用稳定；以该身份为键做缓存，让派生出的 client 对象身份在流式 session 频繁的重新 projection 之间保持稳定。

`ScienceArtifactImage.tsx` 与 `ArtifactContent.tsx` 的 `useLoadedText` 把加载 effect 键控在 `content.versionId` 而非 `content` 对象本身——这是版本自身持久的身份，与当前是哪个包装对象在命名它无关，始终稳定。`science-attachment-loader.ts` 进一步把两个 loader 都按 `versionId` 记忆化到一个有界（64 条，按插入顺序淘汰最旧）的 `Map<string, Promise<T>>` 中：一个版本的字节一旦写入就不可变，因此一次成功的读取会在 loader 生命周期内被缓存，针对同一个进行中版本的并发调用者共享同一次读取；一次被拒绝的读取会被立即淘汰，因此重试仍会重新拉取。

`ScienceDetailsView.tsx` 把 `useSession(s => s)` 替换为 `useSession(s => s, eq)`，只比较 `nodes` 与 `chat`——artifact viewer 子树实际读取的两个 snapshot 字段——因此一个无关的流式事件（composer 状态、队列、某个进行中调用的字节计数）不会被报告为变化。派生出的 `sessionTitles` 记录使用同样的 selector 加 `shallowEqual` 模式。`ProjectLibrary` 的 React `key` 去掉了 `libraryPage`，只保留 artifact 列表内容：在 Artifacts 与 Project files 两个页面之间切换现在是一次 prop 变化，而不是重新挂载，因此搜索/排序/路径状态在切换后仍然保留。

### 光栅捕获声明

自动捕获不再无条件捕获每一个 `.png`。`science-runtime` 的 `Config.rasterCapture`（`'declared' | 'always'`，默认 `'declared'`）对此做出裁决：在 `'declared'` 下，一个原本合格的 `.png` 只有在写入它的那次 run 通过 `StartScienceRunRequest.rasterArtifacts` 指名其相对捕获路径时才会被捕获；在 `'always'` 下，每个合格的 `.png` 都无条件捕获，与此前的行为以及其他所有已接受扩展名保持一致。`tool-science` 的 `run_python`/`run_r` 新增了可选参数 `raster_artifacts: string[]`，使用与 `edit_of`/`artifact_inputs` 相同的 `safeRelativePath` 规则校验（`inputs.ts`），并通过 `StartScienceRunRequest` 一路传入捕获遍历（`capture.ts` 的 `isRasterCaptureAllowed`）。一个未声明的合格 `.png` 会被列入捕获结果的 `skippedRasterPaths`，并作为 `runOutputSchema` 的 `skippedRaster` 字段与一行渲染出的 `formatRunResult` 文本呈现给模型，指名被跳过的路径——不需要新的 session 事件：渲染出的文本本就是既有工具分发机制记录的 durable `tool/result` 消息的一部分，与此前无需专属事件就承载了 `captureSkippedOversizedCount`/`captureTruncatedPerRun` 的机制相同。

`STATIC_GUIDANCE` 新增两句：把自我检查用的渲染、预览或调试转储写到 `SCIENCE_ARTIFACT_DIR` 之外，使其永远不会被捕获为 artifact；以及不要为了迎合用户未曾要求的外观差异而开出新的 artifact 版本。曾考虑并放弃了第三句（"一张图表对应一个 artifact；不要为已存为 spec 的图表再存一份光栅副本"）：声明机制已经直接强制了这一点——模型未声明的光栅渲染永远不会被捕获，因此要为一张已保存为 Vega-Lite 图表的图另存一份重复 PNG，需要主动在 `raster_artifacts` 中指名它，这不太可能是无心之举。

## Alternatives considered

**用启发式方法检测自我检查渲染**（文件命名约定、"debug" 目录、检查是否已存在同名 `.vl.json`）——已拒绝。启发式方法从偶然信号猜测模型意图，且在两个方向上都会静默失败（假阳性：一张合法的纯 PNG 图表永远不会被捕获；假阴性：一次不匹配任何启发式规则的调试渲染仍会成为 artifact）。声明是无歧义的，而模型已经以同样方式声明 `edit_of`/`artifact_inputs`。

**用陈旧度上限代替按身份键控 effect**（在 artifact 重置为 loading 之前加一个防抖或最小重新渲染间隔）——已拒绝。防抖在流足够慢时依然会闪烁，还引入了一个没有天然默认值的可调参数；按版本自身持久的身份（`versionId`）键控则直接消除了这次虚假重置，而不只是把它变慢。

## Consequences

一个已打开 artifact 的图片或文本加载能在流式过程中的每个无关 session 事件下存活；只有真正的新版本（不同的 `versionId`）才会触发重新加载。project-store attachment loader 的缓存在生命周期上无界，但在条目数上有界（64 条），因此一个含有大量不同版本的长 session 会淘汰最旧的条目，而不会无限增长。

想要捕获一张 PNG 的模型必须在 `raster_artifacts` 中声明它；既有的写入了 `.png` 却未声明的 session 日志或 fixture 现在会看到该文件被跳过（`packages/science/science-runtime/tests/capture.spec.ts`、`examples/headless-agent/tests/fixtures/science-mock-llm.ts` 以及 `apps/web/tests/science-preset.snapshot.ts` 都已更新为在 fixture 本就意图捕获该 PNG 的地方声明它）。想要此前无条件行为的部署可以在 `cordis.yml` 中设置 `rasterCapture: 'always'`。
