# Agent Note: Project 级 artifact store —— S2 运行时接线

Status: implemented

[English](2026-08-26-project-artifact-store-s2.md) | 中文

## 问题

[S1](2026-08-26-project-artifact-store-s1.zh.md) 把 `@deepseek-ai/dsh-science-artifact-store` 交付为一个没有消费者的独立包：`science-session`、`science-runtime` 与 `tool-science` 当时仍在 `science/artifact-saved` 中内嵌完整附件引用，并通过 session 级附件存储读写字节。[S0](2026-08-25-project-artifact-store.zh.md) 把 S2 定义为把 store 接入运行时——捕获、策展、run input、artifact viewer 编辑——并把持久化事件瘦身为 store 引用的那一片。[S3](2026-08-26-project-artifact-store-s3.zh.md) 已在此切片之上交付了跨 session 接续。

## 决策

**事件瘦身与 fold 重做。** `science/artifact-saved` 的基础字段变为 `{artifactId, logicalName, version, title, caption?, projectId, versionId, sha256, mediaType, byteCount, environmentRevision, environmentFingerprint, createdAt}`，外加既有的 run/human-edit 变体字段；`width`/`height`/附件名一律消失(store 不记录它们)。旧的内嵌附件值被直接拒绝(pre-release 立场，不做兼容垫片)。严格 fold(`transition.ts`)去掉了自动的同一 turn 内容 supersede：session 的 `version` 现在就等于 store 自身的 per-artifact `ordinal`，因此内容一旦变化就一律开出下一个版本。只有模型策展(`annotate_artifact`)还能就地取代某个版本，且只能是纯元数据变更——它必须原样保留被取代版本的 `versionId`/`sha256`/`mediaType`/`byteCount`，由 fold 校验。一个 session 的所有 artifact 必须共享同一个 `projectId`(`state.artifacts[0].projectId`)，且一个 `versionId` 不能支撑一个 session 内两个已提交的版本。`SCIENCE_PROJECTION_STATE_VERSION` 因这次形状变化从 9 升到 10。`scienceRunsShareTurn`(被移除的同 turn supersede 辅助函数)已从 fold-state/fold/index 的导出中删除。

**Project 解析。** `ScienceRuntime.sessionProject(session)` 通过 store 的 `openProject` 打开(并按活跃 `Session` 用 WeakMap 缓存)`session.header.cwd` 所在的 project；没有 `cwd` 的 session 会以新的 `PROJECT_UNAVAILABLE` 错误码大声失败。解析在 `bindEnvironment` 与 `startRun` 中都是 eager 的，因此一个没有 workspace 目录的 Science session 会在第一次 Science 操作时就失败，而不是稍后悄悄出问题。

**捕获 → store。** `capture.ts` 在本地对每个合格文件计算哈希，跳过字节相同的重跑(按 sha256 去重，与 turn 无关)，然后调用 `store.createArtifact`/`store.appendVersion`，再追加引用事件——store 行先提交，因此一次被否决的事件追加会留下一个孤立但无害的 store 版本(已记录，不做垃圾回收)。`annotateVersion` 出于同样原因在其取代事件之前运行；store 无法清空 caption(`AnnotateVersionInput` 没有显式 null)，因此 fold 保留的值才是权威，caption 清空这件事由 fold 说了算。Run input(`prepareRunArtifacts`)通过 `store.readBlob(projectId, sha256)` 读取精确的先前版本，并对 `byteCount` 设有字节上限。

**Artifact viewer 编辑。** `commitStyleEdit` 直接通过 `store.appendVersion` 追加一个 human-edit 版本。`ScienceEditService.submit` 变为异步：一个 `normalized-region` target 会从 store 读取目标版本的字节，并通过 `attachments.saveImage` 铸造一条 session 消息图像(model-visible ⟺ logged)，按 `String(versionId)` 键控并去重，因此针对同一版本的重复 region target 共享同一张已铸造图像(相较此前每个 region target 各铸造一张图像，这是一处行为变化)。edit-service 的 Cordis 入口注入 `['attachments', 'scienceArtifactStore']`。

**Presentation 与客户端 projection。** `ScienceArtifactPresentation` 升级到 `version: 2`：每个条目的 `attachment` 字段变为 `content: {versionId, mediaType, byteCount}`。`get_science_state` 的模型可见状态保留 `mediaType`/`bytes`，去掉 `width`/`height`，且永不暴露 `versionId`/`sha256`/`projectId`——它们只留在 Host 内部，只有直接读取持久化事件的一方才能解析出来。客户端 projection 的 artifact 条目携带 `versionId`/`sha256`/`mediaType`/`byteCount`(没有 `projectId`——浏览器读取仍按 session 寻址)——`projection-schema.ts` 校验这一新形状。

**移除附件提取器。** `science-session` 不再向 `ctx.sessionAttachments` 注册 `science/artifact-saved` 的提取器；`session-attachment-index/src/policy.ts` 把它重新归类为 `attachment-free`。因此 Session export 不再收集 Science artifact 字节——这是有意为之，因为 project store 现在拥有它们，且比 session 活得更久。两个曾经把 `science/artifact-saved` 当作"真实 extractor-required 事件类型"占位符的测试套件(`dsh-host-apiproxy` 的 `api-proxy-models.spec.ts` 与 `session-export.spec.ts`)现在改为声明各自的测试专用 `SessionEventMap`/`SessionAttachmentExtractorMap` 增强，与 `session-attachment-index` 自己套件早已采用的手法一致(如今没有任何生产领域注册提取器)。

**Id 归并。** Store 的 `/ids` 子路径(`@deepseek-ai/dsh-science-artifact-store/ids`，不依赖 node)是唯一的 id 空间：`science-session` 把 `ProjectId`/`ArtifactId`/`VersionId` 重新导出为 `ScienceProjectId`/`ScienceArtifactId`/`ScienceVersionId`，并删除了自己此前的 `ScienceArtifactId` brand。

**组合。** `@deepseek-ai/dsh-science-artifact-store` 挂载在任何挂载 `@deepseek-ai/dsh-science-runtime` 的地方——`packages/bundle/web-app/cordis.patch.yml`(在 `science-runtime` 行之前)与 `examples/headless-agent/science-tools.cordis.snapshot.yml`(与 `attachment-local` 并列，后者仍为 edit-message 图像铸造所需)——Web bundle 里的 `dshHome` 保持未配置，从而跟随 `science-runtime` 自己那一行已经依赖的同一个 `$DSH_HOME` 默认值；headless 示例里则钉住 snapshot 的 scratch root，与其相邻行保持一致。

**presetId 泛化(附带项)。** `ScienceModeRef.presetId` 的类型从字面量 `'science'` 放宽为 `string`，`codec.ts` 的 schema 也从 `z.literal('science')` 改为一个有界的非空字符串——这个字段现在记录的是实际绑定 Science mode 的那个 preset，而不是在四处重复同一个硬编码字面量。`science-session/src/ids.ts` 导出一个命名常量 `SCIENCE_PRESET_ID`；`applicability.ts` 的准入检查变成自洽式的——第一条 `science/mode-bound` 事件必须记录 `SCIENCE_PRESET_ID` 并且与当前解析出的 preset 一致(对 `event.data.mode.presetId` 做一次浅层、未经类型校验的读取，与本包 invariant 已经对一条原始 `agent-preset/selected` 事件做的 `event.data.agentPreset` 读取手法一致，都发生在严格解码之前)，而之后的每一条 Science 事件都必须发现当前解析出的 preset 仍与 `state.mode.presetId` 相等——不再重复 `preset !== 'science'`。`dsh-tool-science` 的 `isScienceSession` 与 `ensureScienceBound` 引用同一个常量，并记录实际解析出的 preset id。今天的行为没有变化(只有 `'science'` 能通过任一检查)；这个附带项只是一个地基，不是一个功能——要把一个*不同的* preset id 识别为 Science family(一个真正独立的学科 preset，或是本 preset 的一份拷贝)，还需要本包尚未接入的 preset 元数据机制，因此 `apps/cli/config/agent-presets/science/preset.yml` 保持 `copyable: false`，`packages/preset/agent-presets/src/metadata.ts` 的 `PresetMetadata.copyable` JSDoc 现在精确说明了这一原因。

## 权衡过的替代方案

**保留 fold 的同 turn 自动 supersede 规则**，并让它与 store 的 per-artifact ordinal 相互印证——被拒绝：store 没有"turn"这个概念，因此保留该规则需要 session 一侧的簿记，而这在从第二个 session 回放(S3)时无法被 store 自己的 `ordinal` 印证——另一个 session 自己的 turn 编号毫无意义。Session `version` ≡ store `ordinal` 严格来说更简单，也正是 S3 的跨 session 追加所需要的。

**现在就做完整的 preset 元数据"family"识别**(让任意学科 preset 通过一个新的 `PresetMetadata` 字段自行选择加入 Science 领域)——本附带项拒绝：这会让严格 fold 依赖于跨部署、跨版本可能不同的、活的、可变的 preset 配置，除非把这个决定在绑定时就固化为一条持久化事实(一次 Host 侧的 pre-commit 查询，把结果盖章记录下来，与 artifact 事件已经使用的 store 引用校验模式一致)，否则会破坏"回放是事件日志的纯函数"这一不变量——而这是一个尚未经过评审的真实设计。只落地字符串放宽与自洽性检查，能在不发明未经评审的跨包 schema 的前提下，让今天的行为保持完全不变，同时去掉散落各处的字面量。

**Session export 按 checksum 重新指向 project store**(继续把 Science artifact 字节收进导出的 ZIP)——被拒绝：这需要读取权限去访问不管哪个拥有这些字节的 project store，把 session export 与第二个 store 纠缠在一起；S0 note 已经把 artifact 导出/导入定为一个 project 级、留给 S3/S4 的决定。

## 后果

Session export 不再包含 Science artifact 字节；artifact 的导出/导入故事被推迟为一个 project 级、留给 S3/S4 的决定。`packages/client/ui-science`(`ArtifactContent.tsx`、`ScienceDetailsView.tsx`、`ScienceOutcomeRow.tsx`、`ScienceTurnArtifacts.tsx`)及其测试套件仍在读取已被移除的 `attachment` 字段与 `session.readAttachment`——它们在 `tsconfig.client.json` 下编译不过，产物查看功能在已交付的 Web UI 里实质性失效，直到 S4 加上一条 store 读取 RPC(S1/S2 交接文档给出的工作设想是一条形如 `sessions.scienceArtifact({sessionId, versionId})` 的 Typert 路由，通过折叠 session 日志来授权，字节则经 `store.readBlob(projectId-from-fold, sha256)` 读取)。`apps/web/tests/science-chart-outcome.e2e.ts` 与 `science-preset.snapshot.ts` 里面向 UI 的断言已更新为新的事件/presentation 形状，但它们练的仍是这同一条失效路径；它们不作为 S2 的验收证据(浏览器读取接线是 S4 的事)。`dsh-attachment-local` 目前是 `science-runtime` 一个未被使用的 devDependency(暂且保留，方便时再移除，knip 会标记它)。`science-session` 与 `tool-science` 的包 README 仍有一些为内嵌附件模型撰写、本次未逐句重写的 pre-S2 fold 机制文字(持久化词汇与严格 fold 相关小节)；本次直接触及的组合/配置要求/机制层段落(附件提取器的移除、`commitStyleEdit`/`submit` 的接线、artifact-saved 的字段列表)已是当前状态。TypeScript SDK(`examples/jsonrpc-agent/tests/snapshots/`)与 Python SDK(`scripts/snapshots/python-sdk-single-exe/`)都没有 Science 场景，因此本片的 schema 变动无需改动任何 SDK 的期望输出——这一点已通过对 TypeScript SDK snapshot 的一次真实 keyless refresh 执行确认(零差异)，以及对 Python SDK 自身源码、测试与 snapshot 语料的一次静态检索确认(零引用)；`python/sdk-runtime/package.json` 新增了 `dsh-science-artifact-store` 这一 workspace 依赖，与其已有的 `dsh-science-runtime`/`dsh-science-session` 条目并列，和它的姊妹行 `dsh-sandbox-local`/`dsh-subprocess-local` 保持对称。
