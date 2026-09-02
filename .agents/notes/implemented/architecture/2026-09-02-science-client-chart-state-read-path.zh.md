# Agent Note: 给 `ScienceChartState` 补一条客户端可用的读路径

Status: implemented

[English](2026-09-02-science-client-chart-state-read-path.md) | 中文

## 问题

[T1/T2](2026-09-01-project-artifact-store-schema-v2.zh.md) 把一个 version 的实时图表对象状态(`ScienceChartState`:可寻址元素、直接编辑操作日志、像素级命中区域)搬进了项目 artifact store 的 `figure_state` 表,按 `versionId` 索引。`ArtifactContent.tsx` 的实时图表编辑面板原本从 session projection 自己的 `ScienceClientArtifactVersion.chart` 字段同步读取这份状态;这次迁移删掉了该字段,也没有哪个 RPC 改从库里读它——[原始字节读取 Note](2026-09-01-science-artifact-raw-byte-reads.zh.md)(它自己的「ui-science 读路径迁移」一节)在其确切调用点记录了由此产生的回归,而不是绕过它:面板从不挂载,`previewChartOps` 也不能替代一次专门的读取,因为它拒绝空的操作列表。

## 决定

**新增单版本 RPC `sessions.scienceChartState(sessionId, versionId)`,与 `scienceArtifact`/`scienceVersions` 并列进 `SessionsApi`,鉴权复用同一个 `authorizedScienceArtifact` 三条证明路径函数。** 它答复 `{ chart: ScienceChartState | null }`:非 PNG 版本给 `null`,`figure_state` 行缺失的 PNG 版本(导入或历史内容)也给 `null`——调用方分不清这两种情况,反正都不给编辑入口,所以 wire 上也不做区分。和批量的 `scienceVersions` 读不同,一个本会话 fold 无法证明或不存在的 `versionId` 会直接失败,报 `science-artifact-error`/`VERSION_NOT_REFERENCED`,而不是静默省略:这个 RPC 每次都只指名一个版本——已打开的某个 artifact 标签正在渲染的那一个,不是一批里部分可见属于正常情况的场景。实现直接复用 tool-science `edit-message.ts` 的 `submit` Remote 自己那套 `figureState` 解析(`store.getVersion` → 判断 `mediaType === 'image/png'` → `store.getFigureState` → `decodeScienceChartState(JSON.parse(...))`)作为读路径的真正实现,而非另起一套机制。

**wire 响应 schema 是结构性的,不是把 `dsh-science-session` 自己那套 `decodeScienceChartState` 交叉字段校验(元素/命中区域 id 互相引用、bbox 有序、字节数上限)再实现一遍**——Host 写 `figure_state` 行之前已经跑过那套校验,所以 `sessions.scienceChartState` 的 wire schema 只负责勾出解析后客户端值的形状,与同一份 schema 文件里 `sessionProjectionsBlockSchema`、`toolEventViewSchema` 那两处「Host 已校验过,直接透传」的先例一致。`ScienceChartState` 本身直接从 `@deepseek-ai/dsh-science-session/types` 导入,而不是逐字段重新声明(`ScienceContentOrigin` 那种做法是给 `dsh-science-artifact-store` 用的,那个包没有浏览器安全的子路径)——`dsh-science-session/types` 本来就是零 Node 依赖的纯类型子路径,`sessions.ts` 早就用同样的方式导入过 `ScienceArtifactMediaType`。`packages/host/apiproxy/src/api/index.ts` 直接从这个子路径重新导出这个名字(不是从 `./sessions.ts`——那边从没声明过它),这样 `dsh-client-runtime` 不用新增对 `dsh-science-session` 的依赖就能引用到它——`ScienceChartState` 完全经由 `dsh-client-runtime` 对 `dsh-host-apiproxy` 既有的 peer 依赖到达 `ISession.readScienceChartState` 的返回类型。

**`ArtifactContent.tsx` 在某个 PNG 版本的内容挂载时取一次图表状态,而不是等一个单独的「展开面板」动作——这个组件压根没有这个动作。** `ScienceChartEditPanel` 从来都是一张常显表单,标签一打开就渲染(面板本身没有折叠/展开开关,只有 annotation 溢出这类更小的内部折叠),所以「PNG 标签打开」是这个组件唯一真实存在的挂载时机。新增的 `ChartEditSlot`(在 `ArtifactContent.tsx` 里)包一层 `useLoadedChartState` hook(仿照 `useLoadedText` 的 loading/ready/error 三态,按 `content.versionId` 做键)在 `ScienceChartEditPanel` 外面,加载中、读取失败、或读到 `chart === null` 时都不渲染任何东西。这次请求每打开一个版本只发一次:`ArtifactContent` 自己的调用点(`ScienceDetailsView.tsx` 的 `ArtifactTab`)已经靠 `key={artifactId:version}` 在每次切标签或步进版本时整体重新挂载,所以这个唯一消费者的读取不需要再加一层去重或缓存——`science-chart-state-loader.ts` 自己的文档注释点名了 `loadImage`/`loadText` 的 memoization 是未来如果需要缓存该抄的模板。

**`ReadOnlyPreview`(Files 面板的工作区文件预览,以及 library artifact 的预览弹层)传的是一个不发请求、直接答 `null` 的惰性 `loadChartState`,不是真正的 loader。** 这两处调用点都是靠 `previewChart()` 拼出自己的 `ScienceRenderableVersion`:一处(`WorkspaceFilePreview`)把工作区相对路径当成假的 `versionId`,RPC 一定会拒绝它;另一处(在自己的实时会话标签之外打开的 library 行)可能带一个真的 store `versionId`,但在这次改动之前,`previewChart()` 的这两个调用点都从没往里填过 chart 状态(迁移前 `ScienceClientArtifactVersion.chart` 字段从未被这两处填充过)。按老行为对齐——只读预览从不显示编辑面板——只需要一个惰性闭包,不用发一个这个版本早就知道不会有结果的请求。

## 考虑过的方案

**把这次读并进 `sessions.scienceVersions` 批量接口,给 `ScienceVersionSummary` 加一个 `chart` 字段**——否决。那个 RPC 的整个设计(`2026-09-01` 自己的 Decision)就是给调用方挑一批版本,部分可见是正常情况,而且它现有每个字段都不大(标题、caption、几个标量);`ScienceChartState` 带着最多到 `MAX_CHART_STATE_BYTES` 的 `elements`/`ops`/`hitmap` 数组,批量调用(版本步进器一次看到的整批)每次都要为此付出代价,即便真正需要它的永远只有当前打开的这一个版本。只想要一批轻量事实的调用方也会被迫顺带付出图表状态解析的成本。

**用一次空 `ops` 数组的 `previewChartOps` 冒充读取**——上一篇 Note 已经否决过,这里再确认一次:该 Remote 明确拒绝空操作列表,而且就算不拒绝,preview 调用的设计目的是渲染一张假设性的编辑后 PNG,不是回答「当前可寻址状态是什么」——硬拿来复用会把一个不相关能力的约定和这次读取的需求绑在一起。

**像 `useScienceVersionSummaries` 累积版本事实那样,给图表状态跨渲染缓存**——推迟,不是否决:`ChartEditSlot` 今天只有一个消费者(当前打开的这个 PNG 标签),会话生命周期缓存这种数据结构现在没什么可共享的。`science-chart-state-loader.ts` 自己的文档注释已经点名,等真出现第二个消费者时该抄哪种 memoization 模式。

## 影响

范围:`packages/host/apiproxy`(`src/api/sessions.ts`、`src/api/sessions.schema.ts`、`src/api/rpc-map.ts`、`src/api/index.ts`、`src/api-proxy.ts`、`src/fetch/handler.ts`、`src/fetch/client.ts`)、`packages/client/connection`(`src/client/fixture.ts` 的 `FixtureApiClient`/fixture world 桩)、`packages/client/runtime`(`src/client/contract/session.ts` 的 `ISession.readScienceChartState`、`src/client/sessions/session.ts` 的实现)、`packages/test-support/client-runtime`(`src/sessions.ts` 的 `FixtureSession` fail-loud 桩——顺带修了这个文件里一个和本任务无关、任务开始前就存在的缺失 `readScienceVersions` 桩,它本来就挡着这个包自己的 `tsc`)、以及 `packages/client/ui-science`(新增 `src/client/science-chart-state-loader.ts`;`ArtifactContent.tsx` 的 `ChartEditSlot`/`useLoadedChartState`;`ScienceDetailsView.tsx` 的 `ArtifactTab` 恢复 `applyChartOps`/`previewChartOps` 接线、`previewSrc`/`hasPendingChartEdits` 状态,以及 `ReadOnlyPreview` 的惰性桩;`index.ts` 的 `loadChartState` 注入)。

每一处实现完整 `sessions`/`ApiProxy['sessions']` 面的测试替身(`packages/host/apiproxy/tests/client-handler.spec.ts`、`packages/client/connection/tests/fake-api.client.ts`、`packages/client/runtime/tests/fake-api.client.ts`)都在正式接线之外补了一个 `scienceChartState` 桩,风格照抄各自文件里已有的 `scienceVersions` 桩。
