# Agent Note: `science-runtime` 把来源事实写进库，不再写进事件

Status: implemented

[English](2026-09-02-science-runtime-provenance-writes.md) | 中文

## 问题

[T1](2026-09-01-project-artifact-store-schema-v2.zh.md) 让项目 artifact store 的写事务成为一个 version 全部来源事实的唯一权威,[T2a](2026-09-02-science-artifact-event-slimming.zh.md) 相应把 `science/artifact-saved` 及其 fold 瘦身。`science-runtime` 那时仍在写老形状:`capture.ts` 直接把 12 字符的 `environmentFingerprintPreview`、`title`/`origin` 一对传给 `createArtifact`/`appendVersion`,为事件重建一个带 `origin`、`chart`、`mediaType`、`byteCount`、`parent`、`runId` 的完整旧式 `ScienceArtifactVersion`;`annotateArtifact` 伪造 `createdAt: Date.now()`,并让 curation 调用自己的 `toolCallId` 冒充内容的生产者(D1/D2);`performChartEdit` 的人工编辑提交路径直接从 session projection 读 `parent.chart`/`parent.mediaType`/`source.runId`——这些字段 T1 早已搬进库。这一切都无法对着 T1/T2a 的新接口编译。

## 决定

**`capture.ts` 把全量来源写进库,给事件的只是一份呈现快照。** `producerTurn` 每次 walk 只从本地 fold 自身的 `state.toolCalls` 索引里按授权 run 的 `toolCallId` 查一次(而非逐文件查)——`tool/call` 事件不受本次事件瘦身影响。`environmentFingerprint` 原样透传(全量 64 位十六进制摘要;12 字符 preview 连同它存在的那个库列一起消失了)。被捕获 PNG 的 chart 状态变成 `figureState: { figureKey, dpi, stateJson: JSON.stringify(chart) }` 这个写入参数,不再是事件上的 `chart` 字段。`baseVersionId` 只在 `editBaselines` 命中时才传(从不用 latest 兜底——库侧本来也已经删掉了这个兜底)。标题(文件 basename)写成内容提交之后单独一条 `actor: 'capture'` 的 annotation,不再是 `versions` 表的一列(T1 已删掉该列)。事件本身只带新字段集(`artifactId`/`versionId`/`version`/`logicalName`/`sha256`/`title`/`caption?`/`projectId`/`seenAt`)。

**恢复跨会话续写(D7),连带它自然带出的并发创建竞态一并处理。** `b0524e2c64` 曾删掉 capture 在决定 create 还是 append 前那次懒查找的 `store.listArtifacts` 调用,为的是绕开彼时严格 fold 带来的歧义——如今 T2a 放宽后的校验加上 T1 的 `UNIQUE(owningProjectId, logicalName)` 约束,已经能诚实地解决这个歧义。它被恢复了:本会话自身 fold 从未记录过的逻辑名,仍会先对着一次项目级 `listArtifacts` 快照(每次 walk 只懒查一次并缓存)解析,查不到才落到 `createArtifact`。由于现在库——而非本地 session 历史——才是一个 version 的 `sha256`/`contentOrigin` 的真正权威,同内容跳过判定与人工编辑陈旧跳过判定都直接读 `store.getLatestVersion`/`store.listVersions`,而不是 session 自身(更瘦、已不带来源信息)的 projection;这严格强于 D7 被删除前的旧实现——旧实现仍可能被一个本地过时的 head 骗过。恢复这条路径带出的直接后果——两个会话在一次 walk 的 `listArtifacts` 快照与自己的 `createArtifact` 调用之间,竞争同一个全新逻辑名——通过专门捕获 `ProjectArtifactStoreError('LOGICAL_NAME_CONFLICT')`、重新解析出胜出者、向其追加版本来处理,而不是让该文件失败;任何其他 store 错误照常向外传播。

**`annotateArtifact` 改为调用 `store.annotateVersion`,不再重建一个 version 值。** 它仍按 `logicalName`/可选 `version` 对着 session 自身 projection 解析目标(不变),读库当前的 `contentOrigin` 来拒绝人工编辑目标(`ARTIFACT_NOT_CURATABLE`——这个事实 T2a 之后已不在 session projection 里,因此现在是一次库读,不是字段判断),然后追加一条 `version_annotations` 行:`annotateVersion({ actor: 'model', sessionId, toolCallId, requestHeaderSeq, title, caption: request.caption ?? null })`。`caption ?? null` 用库的三态输入(省略=沿用、`null`=清空、字符串=设置)复现了旧的"整体替换"语义(一次 annotate 调用对两个字段都是权威的;省略 `caption` 会清空此前的值——修 D8)。`createdAt`(D1)与 curation 调用自身的身份(D2)现在都不会碰到 version 行——因为 curation 根本不再触碰 version 行;只有 annotation 自己的 `sessionId`/`toolCallId`/`requestHeaderSeq` 记录是谁做的 curation。

**同一个 toolCallId 不能为两次 `annotate_artifact` curation 授权,校验放在写库那一刻。** T2a 的瘦身删掉了 `science/artifact-saved` 自身的 `toolCallId` 字段,fold 层"没有两条 Science 事实共享一次授权调用"的校验因此对 curation 已无字段可查(该 note 已把这记成一处残留缺口)。`assertAnnotateToolCallUnused` 在写库前把可达的那部分补上:对本会话 projection 已知的每个不同 `artifactId`,读一次 `store.listVersions`,若任一 version 当前的 `latestAnnotation.toolCallId` 匹配则拒绝。这是持久的(库读经得起 Host 重启;Runtime 内存里的 `Set` 经不起),范围也收紧到 curation 调用现实中可能瞄准的目标(其 `logicalName` 必须已在本会话 projection 里)。它刻意不是全项目扫描——两处收窄都记在包 README 里而非悄悄丢弃:被后续 annotation 取代的 `toolCallId` 不再可见(库的公开 API 只暴露每个 version 当前的一条 annotation,不暴露完整历史),本会话从未加载过的 artifact 不在扫描范围内。

**`commitStyleEdit`(`performChartEdit` 的人工编辑分支)把 `parent.chart`/`parent.mediaType`/`source.runId` 用到的每一件事实都改成从库读。** `store.getVersion`/`store.getFigureState` 取代了 parent 的 `mediaType`/`chart` 字段;最近的 run 来源祖先("source")通过扫描 `store.listVersions(projectId, artifactId)` 找到最后一行 `contentOrigin !== 'human-edit'`(该 artifact 的完整 ordinal 历史,不只是本会话 fold 恰好知道的那部分——库现在才是 `contentOrigin` 的权威,所以这次扫描其实是任何跨会话感知的搜索本来就需要的同一次库往返),而不是按一个已被删除的 `origin` 字段过滤 session 本地的 `versions` 数组。新追加的人工编辑版本,其 `environmentRevision`/`environmentFingerprint` 是从被编辑版本自身的库行赋值而来(从不重新推导或做 fold 校验——库行本来就是事实),`baseVersionId` 显式命名被编辑版本(`baseExplicit: true`,与其他每一个 editBaselines 调用方一致),不设任何 producer run/tool-call 字段(人工编辑没有授权 run),唯一例外是 `producerTurn`——会话最后一次已开始的 turn,在 `applyChartEdit` 被调用时读取一次(见[producer.turn 归属](../bug-fix/2026-09-03-science-viewer-write-turn-attribution-and-data-loading-guidance.zh.md))。标题/caption 通过单独一条 `actor: 'human'` 的 annotation 继承被编辑版本的当前值,呼应 `capture.ts` 的 basename annotation 与 `annotateArtifact` 的 curation annotation——三个不同的 actor、三处不同的调用点,一个机制。

**`backfillProvenance` 钩子(T1 v1→v2 migration 的第 4 步)推迟未实现,但已找到可复用的读取器。** 钩子签名是 `(projectId: string, rows) => Promise<Map<versionId, BackfillProvenanceValue>>`——没有 `workspacePath`。从 `projectId` 单独反解"这个项目对应哪些 session 日志"需要 `dsh-science-artifact-store` 自己(未导出)的 `resolveProjectIdentity`,而本任务范围禁止碰那个包。正确的绕法——根本不需要那次反解——是每条 `BackfillProvenanceRow` 本来就自带 `producerSessionId`:按这个字段把 rows 分组,直接用 `@deepseek-ai/dsh-session-persistence` 的、与后端无关的 `SessionPersistence.inspect(sessionId)`(不是 JSONL 后端自己的内部实现,那不属于它编译后的公开面)去读每个 session,拿到的每条事件的 `data` 是原始存盘值,没经过 `dsh-science-session` 的 codec 处理——正是 T2a 那个宽容 codec 现在读的时候会悄悄丢弃的那些老字段(`environmentFingerprint`、`toolCallId`、`origin`、`createdAt`、`chart`)。`producerTurn` 可以用 capture.ts 现场恢复它的同一种办法找回:扫描该 session 自己的 `tool/call` 事件(通用的、与 Science 无关的事件形状)找到 annotate/producer 调用的 `turn`。这是一个真实、可实现的设计,不是死路——之所以留在这里没做,是因为它是本包写路径迁移之外的额外范围,需要新增一个对 `@deepseek-ai/dsh-session-persistence` 的 peer 依赖,而且库自身的 migration 早已把"没有钩子"当成一种有文档、非致命的降级(`onWarning`,从不让 migration 失败)。本任务触及的每一处组合都没有配置 `ScienceArtifactStore` 的 `backfillProvenance`。

## 权衡过的替代方案

**让 `producerTurn` 保持可选、像其他可选 producer 字段一样条件展开** — 否决:授权 run 的 `tool/call` 事件在 capture 运行时必然已存在于 `state.toolCalls` 里(该 run 自己的 `science/run-started` 早已要求校验过同一个 `toolCallId` 才能提交),把它当作"可能不存在"只会把一个真实的不变式违反悄悄藏进一个被省略的字段,而不是大声失败,而且这个对象字面量里也会留下一条最终无法覆盖到的分支。

**把 toolCallId 复用检查的范围定为全项目 `listArtifacts` 扫描,而不是本会话已知的 artifact** — 否决:`annotate_artifact` 只能命名本会话 projection 已经能解析出的 `logicalName`(`resolveAnnotateTarget` 强制要求),该集合之外的 version 根本不可能是这次调用的真实目标;扫描项目里的每一个 artifact 会为不存在的额外威胁面(同一次授权调用为同一会话的两次 curation 背书)付出无上限的 `listVersions` 调用代价。

**为保留 `prepareRunArtifacts` 的 `declaredBytes` 预检,给每个已解析的 input 单独向库取一次 `byteCount`** — 否决:这会为保留一个优化(在读任何 blob 之前就快速失败)而重新引入该函数自己 JSDoc 明确说"同会话引用不该需要"的那次库往返,而这个优化本来就已经被现有的、逐 blob 累加的 `actualBytes` 校验变得多余;丢掉的只是提前退出的时机,字节上限本身从未丢失。

**当本地 `sha256` 看起来未变时,只针对具体那个 artifact 单独查,而不是每次都读库当前 head 来恢复人工编辑陈旧跳过判定的库权威** — 否决:本地 `latest.sha256` 单独一项分不清"确实未变"和"另一个会话已经把这个 artifact 推进到了本地未知的地方",只要本地信息看起来够用就跳过库读,会悄悄重新引入 D7 本就是为了防止的那种陈旧性。

## 后果

范围:仅 `packages/science/science-runtime`,遵循 T2 自己的包边界(`packages/science/science-artifact-store`、`packages/science/science-session`、`packages/science/tool-science`、`examples/` 是别的任务的地盘)。`packages/science/tool-science` 目前还无法对着本包新的 `ScienceArtifactVersion`/store 输入形状编译(`annotate-artifact.ts`、`artifact-schema.ts`、`edit-message.ts`、`run.ts`、`state.ts` 都还引用着已删除的字段——`origin`、`chart`、`mediaType`、`byteCount`、`parent`、`runId`、`environmentRevision`、`environmentFingerprint`);那次迁移属于 T2b-2。

[2026-08-30 的按会话划分产物身份](../../rejected/architecture/2026-08-30-science-artifact-identity-per-session.zh.md)提案被本次改动否决:它的核心机制(即便逻辑名相同,每个会话也各开一个新 artifact)正是本次改动要逆转的 D7 回归,被 T1 的库级 `UNIQUE(owningProjectId, logicalName)` 约束加上本 note 恢复的跨会话懒查找取代。

`science-runtime` 自身的测试套件已全部更新:`capture.spec.ts`、`annotate.spec.ts`、`chart-edit.spec.ts` 现在断言的是库读到的来源事实(`content_origin`、producer 字段、`base_version_id`/`base_explicit`、`figure_state`),而不是已删除的事件字段;两个跨会话测试从断言 D7 缺失改成断言 D7 已恢复(新内容延续、相同内容跳过),并新增一条专门的创建竞态恢复测试与一条"同为 store 错误但 code 不同"的反例测试;`inputs.spec.ts` 的聚合字节预检测试去掉了 `declaredBytes` 那个子用例。`real-acceptance.ts`、`chart-kernels.real.spec.ts`、`chart-fidelity.spec.ts`(真实解释器套件,由 `DSH_SCIENCE_RUNTIME_PYTHON_PREFIX`/`DSH_SCIENCE_RUNTIME_R_PREFIX` 或独立的 `test:real-acceptance` 脚本门控)也用同样方式从库读 figure state 与内容来源,靠各文件里的小型 `chartOf`/`contentOriginOf` 辅助函数。

**`/* v8 ignore */` 注释放在一个三元表达式变量初始化(`const x = cond ? a : b`)的上方,在这个版本的 `@vitest/coverage-v8` 自己的阈值检查里不生效,即便每一份 istanbul 重映射报告(`text`、`html`、本仓库自己的 `uncoveredLocationsReporter`)都正确地把它显示为已覆盖。** 把同样的不可达分支判断改写成 `if (cond) { throw … }` 语句、放在一次无条件访问之前——与本文件里其他每一处不变式判断的写法一致——阈值检查就与报告一致了。`pnpm run test:coverage` 的 v8 provider 在架构上比 istanbul 多隔了一层(V8 自身字节码级别的分支计数器,经 `v8-to-istanbul` 重映射),本仓库自己的 `coverage-final.json` 分支计数数据证实了这次分歧确实只出在三元表达式这一种写法上,不是 ignore 注释的普遍失效,也不是按包 `--coverage.include` 划分运行的产物。
