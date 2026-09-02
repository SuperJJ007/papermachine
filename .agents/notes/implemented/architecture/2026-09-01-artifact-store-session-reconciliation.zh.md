# Agent Note: store ↔ session 对账,以及每个追加点上的 W2/W3 收窄

Status: implemented

[English](2026-09-01-artifact-store-session-reconciliation.md) | 中文

## 问题

[T1](2026-09-01-project-artifact-store-schema-v2.zh.md) 的权威规则让项目 artifact store 成为一个 version 来源事实的唯一权威,促成它的那次审计(`audit.md` D12)同时发现,"blob → SQLite 事务 → session.append" 这条写序上存在五个中断窗口,而**全仓不存在任何对账代码**(`grep -rn "reconcil" packages/science packages/host/apiproxy/src` 只命中三处无关注释):store 行提交后其 `science/artifact-saved` 追加被拒,会留下一个 Files 面板会列出、却没有任何 session 能解释的孤儿行(W1/W2);一次 `annotateVersion` 写入之后 curation 事件被拒,会让两边永久分歧(W3,T1 自己的 JSDoc 里已经记为可接受);自动捕获周围还有两个窗口(run 已终态但从未尝试捕获;捕获遍历本身跑到一半崩溃)会让文件永久漏捕,既无重试也无报告(W4/W5)。T2 自己的改动已经修掉了其中一些的**成因**(T1 的 schema、T2a 的事件瘦身、T2b 的库权威读);但没有一个修掉"这个不同步一旦发生,压根没有任何一趟对账去发现并修复它"这件事本身。

## 决定

**库的写事务仍然是唯一权威;对账永远只修库,不碰 session 日志。** session 日志是只追加的,它的重放契约就建立在这一点上——为了"修"一条陈旧事件而重写历史,会破坏每一个信任按 seq 顺序重放的消费方。具体地,`dsh-science-artifact-store` 新增的 `reconcile.ts` 模块,把库里持有的每个 version 拿去跟调用方已经读出并归并好的 `science/artifact-saved` 事件比对分类,而且只会调用库自己的 `setVersionHealth`/`reconstructVersion`——它从不调用任何会向 session 追加的东西。

**按 version 分类，共七种情况，靠比对 `sha256` 与当前 annotation 快照判定，从不依赖哪一边先提交：**

| 情况 | 判定条件 | 处理 |
|---|---|---|
| 一致 | 库行与事件都命名了这个 `versionId`,`sha256` 相同,title/caption 相同 | 不写 |
| 无法验证 | 存储行存在，没有事件命名这个 `versionId`，且调用方的事件集不完整 | 保留既有 orphan 标志，因为部分读取中的缺失不能证明任何结论；仍刷新内容缺失状态 |
| 孤儿库行（W1/W2） | 存储行存在，没有事件命名这个 `versionId`，且调用方的事件集完整 | `version_health.orphan = 1`；行与其字节不动，这是一个真实、完整的 version，只是没有任何 session 声明是它的生产者 |
| 悬空事件 | 某事件命名的 `versionId` 在库里没有对应行 | `reconstructVersion` 用事件的兜底字段重建一个 version 行(以及缺失的所属 artifact 行);`version_health.reconstructed = 1` |
| 内容冲突 | 同一个 `versionId`、`sha256` 不同 | 正常写入路径不可能产生;记为诊断信息,库行标 `orphan`,事件不动 |
| 元数据分歧(W3) | 同一个 `versionId`/`sha256`,事件的 title/caption 快照已经过期 | 不写——库的最新 annotation 本身就是当前事实;一条过期的事件是模型当时看到内容的正确历史记录,不是一个错误 |
| blob 丢失 | 行存在,`blobs/sha256/…` 不存在 | `version_health.missingContent = 1`;行不会被删除 |

值得明确指出的一处与任务书的出入:任务书的表格把元数据分歧的"库赢,事件不动"描述成一次*修复*;但实际上两边都没有需要修复的东西——库的 `latestAnnotation` 本身就是当前事实,事件本身也已经是对某个时间点的正确记录——所以这种情况只是被分类出来供可见性使用(测试、`ReconcileResult.outcomes`),完全不产生任何库写入,这才是"库赢"的正确读法,而不是一处缺口。

**`reconstructVersion` 的 `contentOrigin` 固定为 `'import'`,从不猜成 `'run-auto'`。** 一个被重建的行,其真实内容来源(一次 run,还是一次人工编辑)正是这次重建无法恢复的事实——`'import'` 是 `ContentOrigin` 里唯一一个不声称别的来源的值,这与 T1 自己在 v1→v2 迁移里已经确立的"库的诚实"立场(从不凭空捏造它没有的确定性)一致。`mediaType` 从悬空事件的 `logicalName` 扩展名推断(T2a 瘦身之后事件已经不再携带 `mediaType`),无法识别的扩展名回退到 `application/octet-stream`;`byteCount` 在 blob 存在时是其真实大小,在 blob 也丢失时是一个显式的哨兵值 `0`(与 `missingContent: true` 配对,调用方应先检查这个标记,而不是被悄悄地骗到一个假的字节数)。

**`reconcileMaxVersions`（store 包，默认 2000）与 `reconcileMaxSessions`（runtime 包，默认 500）是两个独立的上限，因为它们限定不同包拥有的工作。** store 每次 `reconcileProject` 调用最多处理上限数量的 version 行与悬空事件；返回的 cursor 保留未完成工作，失败项会轮转到未处理项之后。runtime 每次 `collectProjectArtifactEvents` 调用最多读取上限数量的 session 日志；成功的逐 session 结果按列举顺序累积，不可读或含格式错误事件的 session 会轮转到未访问尾部之后。两个上限都让每次 fire-and-forget 尝试保持有限，同时让后续 project 解析最终推进每个有限尾部；两者都不会创建后台任务或自主重试循环。

**不完整的 session 事件集绝不会把缺少事件转成 orphan 健康状态。** session 列举失败、仍有待处理或不可读的匹配日志，或任一目标事件格式错误，都会让 `CollectProjectArtifactEventsResult.complete` 变成 false。此时，`reconcileProject` 把没有匹配事件的存储行分类为 `unverified`，并在健康状态 patch 中省略 orphan 字段，保留已经记录的任一值，因为部分读取既无法证明它，也无法排除它。内容冲突、元数据比较、悬空事件重建和内容缺失刷新仍会根据已有证据执行。累积事件集发生变化或首次变完整时，store 分页会从头开始，使曾按部分事件检查的行用新证据再检查一次。只有完整事件收集以及无 cursor、无错误的 store 对账运行才会进入 `reconciledProjects`；其他结果仍可在后续 project 解析发生时重试，且距上次尝试至少经过已校验的 `reconcileRetryDelayMs`（默认 1000）。这种由触发点驱动的重试会避免永久误报、固定前缀饥饿以及自主热循环。

**runtime 只在一个地方读 session 日志，并把同进程的类型化值及其完整性一起交给存储；store 包从不接触 session 日志格式。** `dsh-science-runtime/reconcile-trigger.ts` 的 `collectProjectArtifactEvents` 列出每一个 header `cwd` 解析后等于该 project 规范工作区路径（`OpenedProject.workspacePath`）的 session，通过 `@deepseek-ai/dsh-session-persistence` 的 `SessionPersistence.inspect()` 逐个读取。按 T2b-1 Note 的发现，该方法返回每条事件原始、未解码的 `data`，绕过 `dsh-science-session` 的 codec；该 codec 刻意非严格，会静默丢掉悬空事件重建所需的兜底字段。因为这是真正的 durable/file 边界，而非同进程的类型化值，`extractReconcileEvent` 校验原始字段，不信任 `SessionEventMap` 的静态类型；格式错误的数据会被跳过、记录 warning，并把收集标记为不完整。`sessionPersistence` 通过 `ctx.get('sessionPersistence')` 取用（可选），从不加入 `ScienceRuntime` 的必需 `inject` 数组；否则，不挂载 persistence 后端但需要运行 Science 的部署，会为一项 Runtime 自身并不依赖的自愈过程直接加载失败。

**W2/W3 收窄把已有的 capture 侧模式扩展到"库先提交、再追加事件"的每一个别的站点。** T2 已经让 `capture.ts` 在自己的 `science/artifact-saved` 追加在库行提交之后被拒时,立刻标 `orphan`。本任务把同样的行为——通过一个共享的 `appendArtifactSavedOrMarkOrphan` helper——扩展到 `annotateArtifact`(库的 annotation 已经提交)、`performChartEdit` 的人工编辑提交,以及 `saveArtifactAs`(第三个站点,任务书没点名,但结构上完全一样——为了对称补上,而不是留一处不一致)。追加已经失败之后,标记健康状态本身再失败,只记日志并吞掉,不抛出:调用方需要看到的是追加自己的错误,而未标记的行无论如何都还能被下一趟完整对账追上。

## 考虑过的替代方案

**检测 W4（一次 run 到达终态但零个已捕获 version）以及 W5 里“捕获在写任何东西之前就崩溃了”的残留情形**，任务书圈定了范围，但**没有实现**：两者都需要读 `science/run-started`／`science/run-finished` 事件，并把终态的 `runId` 与每个 version 的 `producerRunId` 交叉比对；这与本任务构建的七种 version-vs-event 情况在结构上不同（run 事实与 artifact 事实），而且在存储和事件两边都完全没留下痕迹的情形下（scratch 已清理、没有捕获、没有可重建内容）确实无法检测。这里明确记录这项范围裁剪；`dsh-science-runtime` README“已知限制”中描述 W4／W5 的两条保持不变，不声称已覆盖它们。

**让 `reconstructVersion` 猜 `content_origin: 'run-auto'`(常见情况)而不是 `'import'`**——被否决:一个悬空事件自己的生产者 session 是已知的(承载它的那份日志所属的 session),但原始提交究竟是一次 run 还是一次人工编辑,在 T2a 瘦身之后已经完全无法从事件本身恢复;猜常见情况等于悄悄捏造一个这次重建无法证明的事实,恰恰是 T1 整个权威规则的努力想要停止去做的事。

**把 `sessionPersistence` 加进 `ScienceRuntime` 的必需 `inject` 数组**——被否决:本 Runtime 自己的测试 harness(以及任何被限定为不带 durable session persistence 就跑 Science 的部署)会因此直接加载服务失败,而不是优雅降级;`ctx.get` 是本仓库对同一个后端在别处(`agent-loop`、`apiproxy`、`subagent`、`hooks-*`)已经确立的可选服务惯例。

## 后续影响

范围：`packages/science/science-artifact-store`（`reconcile.ts`；engine 与 Cordis service 上的 `reconstructVersion`／`blobByteCount`／`getReconciliationSummary`／`reconcileProject`；从 `annotateVersion` 拆出并以 `derived: true` 复用的 `insertAnnotation`；`RECONCILE_ORDINAL_CONFLICT`；`reconcileMaxVersions`）以及 `packages/science/science-runtime`（`reconcile-trigger.ts`；`sessionProject` 触发点及其完整运行抑制与延迟的后续解析重试；`appendArtifactSavedOrMarkOrphan`；`reconcileMaxSessions` 和 `reconcileRetryDelayMs`；对 `@deepseek-ai/dsh-session-persistence` 的 peer/dev 依赖）。两个包在改动代码上均保持逐文件 100% coverage。

T3b 的 `dsh-api-proxy`／`ui-science` 透传所需公开读接口已经就位：`ScienceArtifactStore.getReconciliationSummary(projectId): Promise<ReconciliationSummary>`（`{orphanCount, reconstructedCount, missingContentCount, items}`，对上一次记录的 `version_health` 状态做纯读取）与 `ScienceArtifactStore.reconcileProject(projectId, events, eventSetComplete, cursor?): Promise<ReconcileResult>`（带 cursor 的写入口方法，由 `dsh-science-runtime` 调用，不由 BFF 直接调用）。T3b 自己的范围，即 `scienceLibrary` 响应的 `health` 字段、Files 面板提示条，以及“`orphan` 从不在 UI 中出现”规则，除了消费概述读接口外，不受本 Note 的其他决定影响。

`packages/science/science-artifact-store/tests/*.spec.ts` 与 `.../fixtures/concurrent-append-worker.ts` 里每一处直接 `new ProjectArtifactStoreEngine(…)` 的构造点都补上了 `reconcileMaxVersions: 2000`(该字段在 `ProjectArtifactStoreOptions` 上变成了必需项);这是一处纯机械的、只为保持对称的改动,对这些测试套件没有任何行为含义。
