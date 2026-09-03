# Agent Note：store 权威迁移后 `dsh-tool-science` 的模型可见 artifact 字段

状态：已实现

[English](2026-09-02-science-tool-receipts-slimming.md) | 中文

## 问题

[T1](../architecture/2026-09-01-project-artifact-store-schema-v2.zh.md) 把项目 artifact store 的写事务定为一个 version 全部来源事实的唯一权威，[T2a](../architecture/2026-09-02-science-artifact-event-slimming.zh.md) 把 `science/artifact-saved` 与 `ScienceArtifactVersion` 瘦身成一个扁平的呈现快照（`artifactId`、`logicalName`、`version`、`title`、`caption?`、`projectId`、`versionId`、`sha256`、`seenAt`），不再保留 `origin`、`mediaType`、`byteCount`、`parent`、`runId`、`createdAt`、`chart` 字段。`dsh-tool-science` 里每一个面向模型的 artifact 值（`get_science_state`、`run_python`/`run_r` 的捕获产物清单、`annotate_artifact` 的收据）都直接读这些被删掉的字段，因而无法编译：`artifact-schema.ts`、`state.ts`、`run.ts`、`annotate-artifact.ts`，以及校验 viewer 编辑目标媒体类型与活图状态的 `edit-message.ts`，全都在读已经搬进 store 的事实。

## 取代关系

2026-09-02 的[收据恢复决定](../bug-fix/2026-09-02-science-artifact-receipts-restoration.zh.md)取代了本笔记关于删除血缘、producer 文案与直接编辑摘要的决定。这些模型可见事实现在从 artifact store 重建，但不会恢复到 session 事件。本笔记的共用 store resolver 与其余隐藏字段决定仍然有效。

## 决定

**两个新的 store 归属事实到达模型面：`contentOrigin` 与 `curated`；本包之前暴露的其余来源字段全部不再暴露。** `packages/AGENTS.md` 的"从模型视角编写面向模型的约定"规则，以及 T1 设计本身写明的原则（`get_science_state` 只暴露 `content_origin` 与一个布尔化的 curated，绝不暴露 `actor`），定死了哪两个事实值得暴露。`scienceArtifactSchemaProperties`/`scienceArtifactValueFields`（`artifact-schema.ts`）成为每个工具共用的一个构建函数：`artifactId`、`logicalName`、`version`、`title`、`caption?`、`contentOrigin`（`'run-auto' | 'human-edit' | 'import'`，读自 store 的 `VersionRecord.contentOrigin`）、`curated`（`store.latestAnnotation !== undefined && store.latestAnnotation.actor !== 'capture'`——一旦有模型或人工的 annotation 替换过自动捕获时的标题就为 true，绝不暴露具体是哪个 actor）、`mediaType`、`bytes`（这两项现在也归 store 所有）与 `seenAt`（session event 自身的呈现时刻字段，替代被删掉的 `createdAt`）。`versionId`/`sha256`/`projectId`/annotation `actor` 不会被加进任何 schema。

**`parent`（血缘）与 `runId`（producer）被彻底从模型可见文本中删除，而不是靠一次 store 读取重建。** 这两个都是 T1 设计明确排除在模型可见状态之外的来源事实（"模型从来不完整看到是谁产的、基于哪一版"）；为了一个设计上就该隐藏的事实，把 `baseVersionId`/`producerRunId` 从 `VersionRecord` 串进每条收据并不划算。`run.ts` 的捕获产物清单文本删掉了 `edited from <artifactId> v<version>` 血缘后缀；`annotate_artifact` 收据删掉了 `curated from run <runId>`。

**图表编辑摘要（`edits`/`editCount`，"N direct edits: op (target)"）从所有面向模型的值里删除，而不是从 store 的 `figure_state` 表重建。** T2a 已经把喂给这段文本的活图对象状态从 session event 搬进了 store 的 `figure_state` 侧表（按产物、只限 `image/png`）。为模型文本重建它需要给每个被列出的产物再多一次 `getFigureState` store 读取加一次 `decodeScienceChartState` 解码，而这项事实真正的受众是 viewer 自己的图表编辑面板，不是模型——模型在产生每次 `annotate_artifact`/编辑消息的那一轮本就已经看到了。这是推迟到未来某个仅 Web 行使用的呈现层，不是被默默丢弃：已在包 README 和本笔记里点明。

**每个列出 artifact 的工具都通过一个共用的 resolver 按产物读取一次 `VersionRecord`。** `ResolveArtifactStoreVersion = (artifact: ScienceArtifactVersion) => Promise<VersionRecord>`（`artifact-schema.ts`）是每个面向模型的 artifact 清单都接受的一个参数：`runValueFromResult(result, resolveStore)`、`stateValueFromProjection(projection, historyItemLimit, resolveStore)`。真正的 resolver 实现 `resolveArtifactStoreVersion(ctx, artifact)`（`run.ts`）只有一份，每个工具的 `execute()` 都通过 `resolveArtifactStoreVersion.bind(undefined, ctx)` 绑定它——这是一个绑定引用，不是一个包装用的箭头函数，因此调用点不会新增一个还需要独立覆盖率的函数字面量，覆盖范围仍是 `resolveArtifactStoreVersion` 自身已单测的那两条路径（找到 `VersionRecord`；`VersionRecord` 缺失，一个 durable invariant violation）。`requireArtifactStore(ctx)` 读取可选的 `ctx.get('scienceArtifactStore')` 而不是 `ctx.scienceArtifactStore` 这个属性代理：`scienceArtifactStore` 不在本包自己的 `inject` 里（只有 `dsh-science-runtime` 要求它），`packages/AGENTS.md` 的"可选 service 用 `ctx.get`"规则直接适用——只挂载了 `ctx.scienceRuntime`（间接要求 store）时本包的工具依然能工作。

**`edit-message.ts` 的 viewer 编辑准入通过一个注入的异步 resolver 读取同样两个 store 事实（`mediaType`、活图状态），而不是从 artifact 上同步读取。** `resolveScienceEdit`/`resolveSelection` 变成 `async`，接受一个 `ReadArtifactTargetFacts = (artifact) => Promise<TargetMatchFacts>`（`{ mediaType, chart: ScienceChartState | undefined }`）resolver；`assertTargetMatches` 仍是对已解析事实的同步纯校验，与本包其余 Science 校验的"先解析、再校验"拆分一致。`ScienceEditService.submit` 提供真正的 resolver：用 `store.getVersion` 取 `mediaType`，只在 `mediaType === 'image/png'` 时才调 `store.getFigureState` 加 `decodeScienceChartState`——非图片 target 绝不读 `figure_state`，因为只有 PNG version 才可能有它。

## 考虑过的替代方案

**只暴露 `contentOrigin`/`curated`，把 `mediaType`/`bytes` 也跟 `parent`/`runId` 一起挡在模型面之外**——被拒绝：与 producer/血缘不同，一个文件的媒体类型与大小是模型写出该文件时本就已经推理过的事实（`raster_artifacts` 声明一个 PNG；被捕获的 `.csv`/`.json` 由自己的写操作定型），去掉它们会拿掉模型准确描述自己产出所需的信息，却没有换来任何隐私或来源泄漏方面的好处——反正本包已经在为 `contentOrigin`/`curated` 对每个产物做一次 store 读取，多读一个字段代价很小。

**既然为 `contentOrigin`/`curated` 已经要对每个产物读一次 store，干脆从 `store.getFigureState` 重建 `edits`/`editCount`**——被拒绝：这会给每次受限的 `get_science_state`/run 结果清单里的每个 PNG 产物再加一次 store 读取（`getFigureState`，仅 PNG）加一次解码，而这项事实的主要消费者是 viewer 的图表面板；模型早已从产生这次编辑的那次 `annotate_artifact`/编辑消息里得知了这次编辑，边际的 token/延迟成本换不来任何新的模型能力。

## 影响

范围：仅 `packages/science/tool-science`，符合 T2 自身的包边界。`artifact-schema.ts` 里的 `ScienceArtifactEditSummary`/`scienceArtifactEdits`/`formatScienceArtifactEdits`/`chartEditSchema` 及其 `ScienceChartOp` 引用，连同它们构建的模型文本一起被删除——这是刻意的移除，不是留着腐烂的代码。`formatArtifactReceipt` 的文本从 `curated from run <runId>` 变为 `<contentOrigin>, curated`/`<contentOrigin>, auto-captured`；`formatRunResult` 的捕获产物行去掉了 `edited from …` 后缀；`get_science_state` 每个产物的 JSON 去掉了 `origin`/`parent`/`runId`/`createdAt`/`environmentRevision`/`environmentFingerprintPreview`/`edits`/`editCount`，新增了 `contentOrigin`/`curated`/`seenAt`。以上每一处都是稳定的模型可见文本变化，由本包自己更新过的单测钉住（`packages/science/tool-science/src` 逐文件 100% 覆盖率）；把 keyless snapshot 定装件（`examples/headless-agent`）与 Python/TypeScript SDK 的期望输出跟上这段文本，归 T5。

`packages/host/apiproxy`、`apps/web` 的 e2e/snapshot 定装件、`examples/headless-agent` 的 Science driver fixture，以及 `packages/science/science-runtime` 自己的 `persistent-kernels.real.spec.ts`/`real-acceptance.ts`，仍在构造或读取 T2a 之前的 `ScienceArtifactVersion` 形状（`origin`、`mediaType`、`chart`、`producerSessionId`、`requestHeaderSeq` 字段），使 `pnpm run doc-typecheck` 的完整 host/apps 构建失败；这些都不在本任务的包边界内（`packages/host`、`apps/`、`examples/` 是 T3/T4/T5 的地盘，两个 `science-runtime` 真解释器套件是该包自己在 T2b-1 写路径迁移里留下的欠账）。`pnpm run verify-cordis-catalog`/`verify-doc-graphs` 各自因一个既有的、与本迁移无关的类型链接覆盖缺口而失败（`ctx.scienceRuntime.installPackages` 的 `InstallScienceEnvironmentPackagesRequest`/`Result` 类型，来自包安装功能，不是这次迁移引入的）；`verify-client-catalog`/`verify-module-graph` 是本分支更早提交遗留的过期状态；`verify-package-readme-model-experience` 在一个无关包（`dsh-client-ui-brand-papermachine`）上失败。四者都不是本改动引起的；跑 `pnpm run doc-sync` 是为了确认这一点，不是把它当作本任务自己要通过的门禁。

## 测试

`packages/science/tool-science/tests/tool-science.spec.ts` 与 `tests/edit-message.spec.ts` 已完整更新：每个原来构造带判别式联合类型的 `ScienceArtifactVersion`/`ScienceRunArtifactVersion` 的 fixture，现在都构造扁平的 session 级形状加一个配套的 `VersionRecord`/`TargetMatchFacts` fixture；`resolverFor`/`singleFacts`/`factsFor` 测试辅助函数把这些 store 事实注入现在是 `async` 的 `runValueFromResult`/`stateValueFromProjection`/`resolveScienceEdit`。新增的直接测试覆盖了 `requireArtifactStore` 缺失 service 时的抛出、`resolveArtifactStoreVersion` 找到/store 行缺失两条分支、`edit-message.ts` 的非图片 target 与悬空 store 引用分支，以及被删掉的 `artifactReceiptFromArtifact` human-edit 守卫的替代方案（该检查现在只存在于 `dsh-science-runtime` 的 `annotateArtifact` 里，符合 DRY——本包永远不会从该调用拿回一个 human-edit version）。跑过一次 `pnpm run doc-sync` 以确认它的失败都不追溯到本改动（见"影响"）；它不是本任务重跑的门禁之一。
