# Agent Note：`saveArtifactAs` —— 把一个已提交的 artifact version 复制进一个新逻辑 artifact

状态：已实现

[English](2026-09-02-science-save-artifact-as.md) | 中文

## 问题

这次 artifact 来源权威迁移的验收标准里点名了一条"另存"路径——artifact viewer 把一个已提交的 version 复制到一个新的逻辑名下——但代码库里哪儿都不存在：没有 Runtime 方法、没有 Remote、没有请求类型。现有每一条产生 artifact 的路径都假定了一个这个新 version 确实拥有的 producer 身份（一次 run 自己的 `producerRunId`/`toolCallId`、一次 curation 自己的授权调用、一次样式编辑自己的 kernel 往返）；一次由 viewer 发起的复制这些都没有，而 T1 store schema 的 `baseVersionId`/`baseExplicit` 拆分（一个显式声明的内容基线，绝不默认）恰好给了它一个可以声明的事实，形状与现有三条写路径都不完全一样：基线命名的是完全*另一个* artifact，不是同一个 artifact 的某个前驱 version。

## 决定

**`ScienceRuntime.saveArtifactAs({ session, sourceVersionId, newLogicalName, signal })` 是第四个变更 artifact 的 Runtime 操作，与 capture、`annotateArtifact`、`commitStyleEdit` 并列，遵循同样的取锁/`assertPrepublication`/追加事件形状。** 它通过调用会话解析所属 project（`sessionProject`，与其余每个 mutator 用的解析方式相同），从 store 读取源 `VersionRecord` 及其所属的 `ArtifactRecord`（为了取 `kind`），然后用一个全新的 `artifactId`、ordinal 从 1 开始、`baseVersionId: source.versionId`（这里 `baseExplicit` 永远是 `true`——另存按构造就是在声明一个显式基线）、源自身的 `contentOrigin`/`mediaType`/`environmentRevision`/`environmentFingerprint`，以及源的 `figure_state` 行（若存在，通过 `getFigureState` 读取，作为 `createArtifact` 的 `figureState` input 传入）调用 `store.createArtifact`。`producerSessionId` 是*调用方*会话，不是源自身的 producer——这是*本次复制*产生的一个新事实，不是源 version 自身 producer 身份的拷贝，与"来源在内容提交时刻一次性定死，另存是它自己的一次提交"这条通用规则一致。不设置任何 `producerRunId`/`producerToolCallId`/`producerRequestHeaderSeq`——一个 viewer 操作，从来不是模型工具，没有授权调用可记。但*会*设置 `producerTurn`，取自 `saveArtifactAs` 被调用那一刻、会话最后一次已开始的 turn（见[producer.turn 归属](../bug-fix/2026-09-03-science-viewer-write-turn-attribution-and-data-loading-guidance.zh.md)），因此客户端 trace 能把这个新 version 归属到保存那一刻正打开的 turn，而不是靠 store 时间去猜。一条独立的 `actor: 'human'` annotation 把源当前的标题/caption 原样复制过来，与 `commitStyleEdit` 自己的标题继承 annotation 手法一致（`capture`、`model`、`human` 三个 actor、三个调用点、一套机制，正如 `2026-09-02-science-runtime-provenance-writes.md` 已经为前两个立下的先例）。

**blob 复用的意思是通过普通的 `createArtifact` 写重新准入源自身的字节，不是跳过这次写。** `admitBlob` 的"改名到一个内容寻址路径上"按 SHA-256 幂等（`blobs.ts` 自己的文档写明："对同一摘要总是字节完全相同，因此按哈希准入是幂等的，不需要预先检查是否存在"）——重新准入项目 blob store 里已经存在的字节，代价只是一次改名到一个未变化的目标上，不是第二份拷贝。这让 `saveArtifactAs` 只是对 store 既有写路径的一次普通调用，而不是需要一套 store 本来没有的专用 blob 链接机制的特例捷径。

**`sourceVersionId` 是针对该 project 的 store 解析的，不是针对调用会话自己的 projection。** 其余每个 mutator（`annotateArtifact`、`applyChartEdit`）都从 `this.assertSession(request.session)` 的 live projection 里解析自己的目标，因为它们的目标本来就是那个 session 自己的 fold 已经知道的东西（一个该 session 捕获过的 `logicalName`、一个该 session 历史里点过名的 `artifactId`）。一次由 viewer 发起的另存没有这种限制——它操作的 artifact library 本来就是整个 project 范围的（T1 自己的 `listArtifacts`/D7 跨会话续写推理），因此该 project 里任一 session 产生的一个源 version 都是合法目标，用一次直接的 `store.getVersion(projectId, sourceVersionId)` 读取来校验。

**两个新的 `ScienceRuntimeErrorCode` 值，一个由 store 错误翻译而来，一个 store 错误直接透传。** `ARTIFACT_VERSION_NOT_FOUND`（源查找返回 `undefined`）与 `ARTIFACT_LOGICAL_NAME_CONFLICT`（store 自己那个带 `LOGICAL_NAME_CONFLICT` 错误码的 `ProjectArtifactStoreError`，被捕获后重新抛成一个 `ScienceRuntimeError`）是这个操作特有的仅有两种拒绝；其余任何 store 或基础设施故障都走每个 mutator 已经在用的同一套 `prepublicationError` 分类。Remote（`dsh-tool-science` 的 `ScienceEditService.saveArtifactAs`）把这两个翻译成自己的 `SAVE_AS_SOURCE_NOT_FOUND`/`SAVE_AS_NAME_CONFLICT` 这两个 `ScienceEditErrorCode` 值，其余错误原样透传——与 `translateChartRuntimeError` 已经为 `applyChartOps`/`previewChartOps` 使用的形状相同，这里保留为一段独立的内联翻译而不是并进那个共享 helper，因为这两个操作的错误词汇互不重叠。

**不开模型工具。** `saveArtifactAs` 只作为一个 Typert `@Remote` 方法注册在既有的 `ScienceEditService`（`edit-message.ts`）上，只能通过 Web Host 的 `./edit-service` 入口——artifact viewer 调用的那个——到达；`dsh-tool-science` 面向模型的工具名单（`get_science_state`、`run_python`、`run_r`、`annotate_artifact`、`install_science_packages`）不变。viewer 自己的另存按钮与 UI 流程是 T4 的范围；本任务只交付 Runtime 方法、Remote 及其测试。

## 考虑过的替代方案

**完全跳过 `createArtifact` 写，直接插入一行 `versions` 记录，让它别名指向源的 blob 路径**——被拒绝：这需要一条与 `createArtifact` 自身并行的、专门的第二写路径（事务纪律、ordinal 分配、`UNIQUE(owningProjectId, logicalName)` 冲突检查），只为了省下 `admitBlob` 自身幂等改名设计已经免费给出的字节成本。

**把 `producerSessionId` 默认成源 version 自己的 producer，把另存当成对既有来源的重新盖章**——被拒绝：这正是 T1 权威规则与 T2b-1 来源写入笔记为 curation 拒绝的那种形状（D2——一次元数据操作自己的 actor 绝不能冒充内容原始的 producer）。另存是本次会话产生的一个新事实；把它记成源自身的 producer，会让一次另存把与新字节相关的元数据归到一个从未接触过这个全新 artifact 的会话头上。

**按 `annotateArtifact` 的模式，针对调用会话自己的 live projection 解析 `sourceVersionId`**——被拒绝：一次由 viewer 驱动的复制没有理由被限制在某一个 session 恰好捕获过的东西范围内，一个 project 范围的 artifact library（T1 的 `listArtifacts`、D7 的跨会话续写）的意义就在于任何正在查看该 project 的 session 都能对其中任意一个 version 采取行动。

## 影响

范围：仅 `packages/science/science-runtime`（该方法、其请求/错误码类型）与 `packages/science/tool-science`（`ScienceEditService.saveArtifactAs`、其请求/收据类型）。`packages/science/science-runtime/tests/save-as.spec.ts`（新增）以及 `packages/science/tool-science/tests/tool-science.spec.ts` 里的 `scienceEdits saveArtifactAs` 用例，在两个包的 `src` 上都是逐文件 100% 覆盖率。artifact viewer 的另存按钮、它通过生成的 Typert client 的请求接线，以及任何端到端跑通它的 keyless snapshot，都是 T4/T5 的范围——本任务不加任何 UI，也不碰任何 example bundle。

`pnpm run duplication` 把这个新方法的 `assertPrepublication`/append/`catch`/`finally` 尾部（`saveArtifactAs` 与 `annotateArtifact` 收尾的约 9 行）标记为一处 clone。这与本文件里另外两对既有、从未被抽取过的相同形状一致（`bindEnvironment` 与 `installPackages` 的 revision-append 尾部；`startRun` 与 `applyChartEdit` 的 pre-publication 守卫代码块）——每个 Runtime mutator 都把真正不同的逻辑包在同一套 lease/prepublication/append/release 模板里，这个文件此前的作者们一贯把这层包装留着不抽取，而不是把它参数化去容纳不同的主体。本任务沿用既有惯例，不单方面引入新惯例；若确实想做一次共享尾部的抽取，那是横跨全部四对既有实例的一次全仓风格决定，不是局限于这一次新增的改动。

**T4b-2 交付了 viewer 自己的另存按钮**（`packages/client/ui-science/src/client/ScienceDetailsView.tsx` 的 `ArtifactToolbar`/`SaveAsForm`）：工具栏一个切换按钮打开一个内联命名输入框，用当前打开版本的 `versionId` 调用注入的 `saveArtifactAs` Remote，`SAVE_AS_SOURCE_NOT_FOUND`/`SAVE_AS_NAME_CONFLICT` 在表单里各有专门的本地化文案，成功调用后把当前标签页切到收据里的新 `artifactId`/`version`——Files 面板靠自己下一次挂载时重新拿取来看到新 artifact，而不是靠一个显式的失效信号。
