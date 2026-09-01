# Agent Note：在 `scienceLibrary` 与 Files 面板暴露 store↔session 对账健康状态

状态：已实现

[English](2026-09-02-science-reconciliation-surfacing.md) | 中文

## 问题

[T3a](../architecture/2026-09-01-artifact-store-session-reconciliation.zh.md) 建好了 store 侧的对账算法与一个纯读接口 `ScienceArtifactStore.getReconciliationSummary(projectId): Promise<ReconciliationSummary>`（`{ orphanCount, reconstructedCount, missingContentCount, items }`），但没有任何地方消费它：`dsh-api-proxy` 的 `scienceLibrary` RPC 只返回 `{ projectId, artifacts }`，`dsh-client-ui-science` 的 Files 面板也无从得知某个版本不健康。另外，`dsh-api-proxy` 本身对着这次迁移更早的 T1/T2 改动已经编译不过——`authorizedScienceArtifact` 的本地会话-fold 分支直接从 `science/artifact-saved` 事件读 `mediaType`/`byteCount`，而这两个字段都被 [T2a 的事件瘦身](../architecture/2026-09-02-science-artifact-event-slimming.zh.md)删掉了——这是一个真实的运行时缺陷（有一条 apiproxy 测试断言了 `undefined` 对上 `'image/png'`），不只是类型错误。

## 决定

**`scienceLibrary` 的响应新增一个 `health: { orphan, reconstructed, missingContent }` 项目级计数，外加每条 artifact 的 `latest.health` 逐项标记，两者都从同一次 `getReconciliationSummary` 调用里读出——绝不在 BFF 里重新推导对账状态。** 聚合计数就是 summary 自己的 `orphanCount`/`reconstructedCount`/`missingContentCount` 原样透传。逐项标记（`ScienceVersionHealthFlags`，`{ reconstructed?: true; missingContent?: true }`）只在 summary 的 `items` 点名了这个确切的 `latest.versionId` 时才置位——某条 artifact 的旧版本不健康、但当前 latest 没问题的话不带任何标记，因为 `scienceLibrary` 本来就只返回 latest 行。逐项标记里从不出现 `orphan`，这与 T3a 自己的设计一致：孤儿版本是一个真实、完整、只是没有会话认领的版本，是文档已接受的崩溃窗口结果，不值得在某张卡片上标出来当警告。

**`authorizedScienceArtifact` 的本地-fold 分支现在通过 `store.getVersion(local.projectId, local.versionId)` 解析 `mediaType`/`byteCount`，只从会话事件里取 `sha256`。** 这与 [T2b-2](../feature/2026-09-02-science-tool-receipts-slimming.zh.md) 已经为 `dsh-tool-science` 的模型可见字段立下的"客户端内容事实一律读 store"先例一致：事件钉住 `sha256`（可独立于 store 验证），而 `mediaType`/`byteCount` 在 T1 之后是 store 独占的内容事实。这是本包自己早已存在的编译缺陷，本任务负责修复，不是为本任务凭空新造的工作——T3b 任务书本身已把它点名列入范围，正如 T2b-2 的 Note 也曾把 `dsh-api-proxy` 列为自己任务边界之外、留给别的任务处理的缺口之一。

**Files 面板的条幅（`ReconcileBanner`，`dsh-client-ui-science`）逐字匹配 store 自己文档化的立场，从不提及 `orphan`。** 它只在 `reconstructed` 或 `missingContent` 非零时渲染，分别写出各自的计数，并提供一个基于 artifacts 数组自身 `latest.health` 标记构建的可展开清单——不是第二条 RPC。库内打开的标签页若其 `latest.health.missingContent` 被置位，会用明确的"内容已丢失"文案取代 `ReadOnlyPreview`，`ArtifactToolbar` 新增一个 `contentUnavailable` prop，用工具栏已有的"导出不可用"那套 `aria-disabled` + `Tooltip` 惯用法禁用下载，并为图片版本隐藏放大——store 自己的健康标记已经足够禁用这两个按钮，不需要专门的错误码，因为 artifact 来源权威这次迁移里的 T4 任务（本分支尚未落地）才是原始字节下载端点的归属方，其错误码留给后续改动去接。

**`ScienceDetailsInjected['loadLibrary']` 的类型现在由 `dsh-client-ui-science` 本地声明，不再原样复用 `ISession['readScienceLibrary']`（`dsh-client-runtime`），`health` 声明为可选。** `dsh-client-runtime` 不在本任务的包边界内——T4 自己的任务书已经点名会再次触碰它（新的 `scienceVersions` RPC、统一 title/caption 来源），所以放宽它手写的返回类型这件事留给那边。本地类型仍然精确对应真实的 wire 内容：`RpcResult<{ projectId; artifacts; health }>`，`health` 之所以标成可选，只是因为尚未拓宽的 `ISession['readScienceLibrary']` 返回类型（`{ projectId; artifacts }`，完全没有 `health` 字段）需要继续对它类型检查通过——一个缺少某可选字段的对象类型，可以赋值给声明了该字段的类型，所以 `session.readScienceLibrary.bind(session)` 这个真实注入值今天就能满足这个更宽的本地插槽；等 `dsh-client-runtime` 跟上、这个"实际上总是存在、但类型标成可选"的字段名副其实之后，依旧成立。

## 被否决的替代方案

**直接拓宽 `dsh-client-runtime` 里的 `ISession['readScienceLibrary']`，从而把 `health` 声明为必填** ——否决：超出本任务明确的包边界（只限 `dsh-api-proxy` 与 `dsh-client-ui-science`）；T4 的任务书已经认领了 `dsh-client-runtime` 上与 `scienceLibrary` 相邻的工作，在这里动它有和那份设计撞车的风险。

**条幅的聚合计数改为客户端对每条 artifact 自己的 `latest.health` 标记求和，不设专门的响应级 `health` 字段** ——否决：`scienceLibrary` 只为每条 artifact 返回一行 *latest*，而 `getReconciliationSummary` 的计数覆盖项目 store 里的每一个版本；一个较旧、非 latest 的不健康版本会在客户端求和里被悄悄漏掉，条幅报出的计数会偏低。

**给 Files 面板里 missing-content 的卡片一个独立的缩略图处理（跳过图片加载、显示"内容已丢失"贴片）** ——推迟，未做：本任务的范围只点名了条幅（项目级）与详情面板文案（针对已打开的版本）；卡片级缩略图改动不在要求之列，且会新增一个没有证据表明确实需要的分支。`dsh-client-ui-science` 的 `ScienceArtifactImage` 组件本身在加载失败时已经有自己的重试呈现，所以一张未标记的卡片今天不会悄悄坏掉——只是在打开之前和健康卡片没有区分。

## 影响

范围：`packages/host/apiproxy`（`src/api/sessions.ts`、`src/api/sessions.schema.ts`、`src/api/index.ts`、`src/api-proxy.ts`、`tests/api-proxy-models.spec.ts`、`tests/client-handler.spec.ts`、`tests/fetch-carrier.spec.ts`）与 `packages/client/ui-science`（`src/client/library-artifact.ts`、`src/client/ScienceDetailsView.tsx`、`src/client/ScienceDetailsView.module.css`、`src/client/locales.ts`、`tests/ScienceDetailsView.client.spec.tsx`）。两包的 README（+ `.zh.md`）都记录了新的 `health` 字段、逐项标记、条幅与内容缺失的详情处理；两者都已录入 `verify-translation-pairing` 各自包下的 `.i18n.yaml` sidecar。

`dsh-api-proxy` 现在能干净编译（`npx tsc -p packages/host/apiproxy/tsconfig.json --noEmit`），完整测试套件（392 条）通过，`packages/host/apiproxy/src` 达到逐文件 100% 语句/分支/函数/行覆盖。`dsh-client-ui-science` **不能**干净编译，`npx tsc -b packages/client/ui-science/tsconfig.json` 与类型感知的 `oxlint` 都不过——两者都卡在一个本任务没有引入、也没有修复的大范围既有缺口上：`ScienceClientArtifactVersion`（`dsh-science-session`）在促成本任务这次 apiproxy 修复的同一次 T2a 事件瘦身里丢掉了 `mediaType`/`byteCount`/`origin`/`parent`/`runId`/`producerSessionId`/`createdAt`/`chart`，而本分支上还没有任何改动把 `dsh-client-ui-science` 对这些字段的消费改接到 store（正是 T4 任务书点名的"读路径统一"工作）。逐条检查过的错误行都能追溯到本任务未曾触碰的代码（在本任务第一次改动前用 `git show HEAD:...` 核对过）；本任务自己新增的代码经人工审查确认只读取 `ScienceClientArtifactVersion` 仍然拥有的字段（`artifactId`、`logicalName`、`version`、`title`、`caption`、`versionId`、`sha256`、`seenAt`）以及本任务自己定义的 `ScienceLibraryArtifact`/`ScienceLibraryHealth` 类型，并有 543 条通过的 `dsh-client-ui-science` 测试作证（vitest 的 esbuild 转译不做类型检查）。本任务自己改动的文件 `ScienceDetailsView.tsx` 覆盖率 100%；整包运行会看到一处不在本任务 diff 里的既有缺口（`src/client/index.ts:354`，来自一个更早、已落地、与对账无关的提交）。

## 测试

`packages/host/apiproxy/tests/api-proxy-models.spec.ts` 新增一条测试，断言 `scienceLibrary` 的 `health` 计数，并确认逐项标记只在 `reconstructed`/`missingContent` 时出现、从不出现 `orphan`；另有三条既有测试补上了它们缺失的 `getReconciliationSummary`（或修复本地-fold 分支用的 `getVersion`）mock。`packages/client/ui-science/tests/ScienceDetailsView.client.spec.tsx` 新增一组 `T3 store↔session reconciliation health` 测试：条幅在两类计数同时出现时显示并可展开清单（含一条没有 `title` 的 artifact 回退到 `logicalName`）、仅有 orphan 时条幅从不出现，以及详情面板明确的内容缺失文案，加上一个点击后不产生新 `loadImage` 调用的禁用下载按钮。
