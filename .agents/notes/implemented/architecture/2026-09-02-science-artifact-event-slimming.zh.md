# Agent Note: `science/artifact-saved` 事件瘦身与"库是权威"的 fold

Status: implemented

[English](2026-09-02-science-artifact-event-slimming.md) | 中文

## 问题

[T1](2026-09-01-project-artifact-store-schema-v2.zh.md) 让项目 artifact store 的写事务成为一个版本全部来源事实的唯一权威——内容来源、生产者、基线版本、创建时间现在全部只活在库里。`science/artifact-saved` 当时仍携带这些来源事实的完整第二份拷贝(`producerSessionId`、`runId`、`toolCallId`、`requestHeaderSeq`、`environmentRevision`、`environmentFingerprint`、`parent`、`origin`、`byteCount`、`mediaType`、`chart`、`createdAt`),严格 fold(`transition.ts`)也仍在把它们全部对着会话自身的 run/tool-call/environment 历史重新推导并交叉校验——这正是催生 T1 的那次审计(D1–D14)诊断出的"一个事实两个家"的形状。本包需要把事件瘦身到权威规则实际留给它的东西:一个 store 引用加上模型或用户当时看到的呈现快照,并相应改写 fold。

## 决策

**事件只保留 `artifactId`、`versionId`、`version`、`logicalName`、`sha256`、`title`、`caption?`、`projectId`,以及新增的 `seenAt`。** `sha256` 作为内容 pin 保留——证明模型或用户当时看到的正是这些字节,不依赖信任 store;`title`/`caption` 是提交那一刻的呈现快照,不是 store 的当前值(后续一次元数据编辑可以改动 store 的 `version_annotations` 而不改变这条事件)。`seenAt` 取代 `createdAt`:这条事件自身的提交时刻,是模型/用户*看到*这份呈现的时刻,不是 store 提交内容的时刻,旧名字把两者混为一谈。`logicalName` 保留是因为它出现在模型请求里(工具收据、`get_science_state`);别的字段都不会。`ScienceArtifactVersion` 与 `ScienceClientArtifactVersion` 从按(现已删除的)`origin` 字段区分的 `{run, human-edit}` 判别联合类型收拢为一个扁平接口——已经没有什么可判别的了,因为内容来源现在只活在 store 的 `content_origin` 列里。`ScienceClientArtifactVersion` 还额外删掉了 `projectId`(内容读取按 session 寻址;Host 自己解析所属 project),以及通过 `toolCallId` 连接得到的事件派生 `turn`。[冷启动分页后仍保留 Science trajectory 归属](../bug-fix/2026-09-02-science-cold-trajectory-ownership.zh.md)随后从私有 Science fold 的活动 eligible call 恢复可选的客户端 `turn` 与 `step` 坐标；持久 artifact 事件仍不包含 tool-call 来源。

**`applyArtifactSaved` 只保留四条校验;其余全部搬去了这条事件提交之前先提交的 store 写事务。**

| 保留的校验 | 位置 |
|---|---|
| 一个 session 的所有 artifact 共享同一个 `projectId` | `state.artifacts[0].projectId` 与新来的事件比较 |
| 同一个 `versionId` 不能背两个已提交的版本 | 在新版本分支 push 之前检查 |
| `version` 必须严格大于本 session 已知的该 `artifactId` 最大值,或者恰好等于某个已记录的版本 | `known.at(-1)` 与 `artifact.version` 比较,沿用既有的 S3 跨会话信任推理 |
| 用 `sha256` 区分这是内容事件还是元数据快照重记录 | 与 target 的 `sha256`(以及 `versionId`)相同 → 原地替换数组条目(title/caption 前进,内容钉死不变);不同 → 拒绝,因为一个真正的新版本永远会用一个全新的 ordinal |

| 被删掉的校验 | 新家 |
|---|---|
| `parent` 血缘校验(自引用、"未指向一个已提交的 artifact 版本"、"parent 必须是当前已提交版本"、"必须保留 parent 的 logicalName"、"取代版本不能改写它的 parent") | T1 的 `base_version_id`/`base_explicit` 列与外键;human-edit 特有的"必须是当前最新版本"这条策略是 `commitStyleEdit` 自己对着一次新鲜的 store 读取做的前置检查(science-runtime,T2b) |
| human-edit 的 parent 必须是 PNG | `commitStyleEdit` 的调用点在允许编辑前从 store 读取源版本的媒体类型(science-runtime,T2b) |
| human-edit 必须复制 parent 的 `environmentRevision`/`environmentFingerprint` | `commitStyleEdit` 直接把 `environmentFingerprint` 赋值为 parent 自己从 store 读到的值——是一次赋值,不是 fold 校验的相等性(science-runtime,T2b) |
| `createdAt` 区间检查(human-edit 的 parent-to-commit、run 的 finish-to-commit、"时间倒退") | `versions.created_at` 在 store 的 `INSERT` 事务那一刻一次性定死;时间顺序是那次事务本身的属性,字段一旦离开事件,replay 就无法独立验证它了 |
| 源 run 必须存在且已到达终态 | runtime 只会为它自己已经观察到完成的 run 调用 `store.appendVersion`/`store.annotateVersion`——这是 `capture.ts`/`index.ts` 里的调用点不变量(science-runtime,T2b),而不是 `runId` 离开事件之后 replay 还能校验的事实 |
| 按 `origin` 门控的授权(为 `annotate_artifact` 调 `requireToolCall`、"只有模型策展才能取代"、自动捕获必须携带其源 run 自己的 `toolCallId`/`requestHeaderSeq`) | `version_annotations.actor`/`sessionId`/`toolCallId`/`requestHeaderSeq` 由 runtime 的 `annotateVersion` 调用直接记录(science-runtime,T2b);这个 fold 已经没有 `origin` 字段可供门控,任何保留了 target 的 `versionId`/`sha256` 的重记录现在都被接受为元数据快照,无论是谁在做这次记录——这是一处有意的放宽,由 store 自己的 actor 列吸收掉了 |
| 一次策展调用的 `toolCallId`/`requestHeaderSeq` 恰好被消费一次(`consumedToolCallSeqs`) | 未搬迁——`science/artifact-saved` 现在完全不消费 tool call 了,所以它过去与 run/kernel/outcome 事实共享的"没有两个 Science 事实共用一个授权调用"这条不变量对策展不再适用。今天没有任何东西阻止一次 `annotate_artifact` 调用的 id 通过 store 自己的 append 路径被引用两次;如果这点重要,这是留给 T2b 的一处残留缺口(store 按每条 annotation 行记录 actor 的 `toolCallId`,但不会跨 Science 事实种类交叉检查重用) |
| 同一个 `artifactId` 被另一个 `logicalName` 复用("一个 artifactId 不能命名两个逻辑 artifact") | T1 的 `UNIQUE(owningProjectId, logicalName)` 约束让这对一个正常工作的 store 在结构上就不可能发生;事件自己的 `logicalName` 现在只是为模型请求用途保留的逐事件快照,不再是 fold 校验的不变量 |
| 元数据重记录时 `mediaType`/`byteCount` 必须原样保留 | 随字段本身一起删掉——现在唯一记录它们的地方是 store 的不可变版本行 |
| artifact 版本上的 `chart` 状态,且只对 `image/png` 放行 | 搬去了 store 的 `figure_state` 侧表(T1 按 `kind` 分侧表的设计),由 runtime 与版本行一起直接写入(science-runtime,T2b) |

`science/outcome-published` 的 chart-evidence 分支作为直接后果丢掉了一项附带能力:它不再能给 `citedEnvironmentRevisions` 贡献一个 `environmentRevision`,因为 artifact 版本的环境来源已经不在事件上了。`ScienceOutcomePublication.environmentRevisions` 现在的自述是"由所引用的 run 证据使用;chart 证据从不贡献",而不是"run 或 chart 证据"——一个只有 chart 证据的 outcome 发布时 `environmentRevisions` 是空数组。

**本次变更把 `SCIENCE_PROJECTION_STATE_VERSION` 从 16 升到 17**(fold 语义变了:保留的校验清单、元数据快照的分派方式,以及 `ScienceArtifactVersion`/`ScienceClientArtifactVersion` 上被删掉的 `chart`/环境来源字段,都改变了一份持久化投影 checkpoint 的含义)。上述冷启动分页修复随后因 turn/call trace 与派生 artifact 坐标把它升到 18。

**不 bump `SESSION_FORMAT_VERSION`;codec 容忍并忽略被退役的字段(T2 任务书里的决定 (i))。** `science/artifact-saved` 是一个领域事件,不是 [`SESSION_FORMAT_VERSION` 管辖](2026-08-10-session-log-version-mechanism.zh.md)的 header/envelope/surface 机制——按那篇笔记自己的规则,一个事件 payload 内部普通的字段集合/形状变化,只要旧 runtime 不会因此误读一份新日志,就不需要 bump 版本号。这里真正要紧的是反方向:一个*新* runtime 读一份*旧*日志,不能仅仅因为旧事件仍带着这个 build 已经不再写的字段就拒绝它。`codec.ts` 里的 `artifactSchema` 特意不用 `.strict()`:`z.object` 的默认(非 strict)解析行为会静默剥掉 schema 未声明的任意 key,这正是一个"pre-release 立场失效之后"的读者所需要的那种容忍度。`seenAt` 是 `.optional()` 的;一条完全没有 `seenAt` 的老事件会转而读取旧的 `createdAt` 字段,靠一个 `.transform()` 兜底,只有在*两者都不存在*时才会响亮失败。这只是一次读取兼容性兜底——这个 build 从不写 `createdAt`,而且这两个名字语义上并不等价(`createdAt` 是内容提交时刻,`seenAt` 是呈现快照时刻)——但对一条不是这个 build 自己产生的日志来说,这是能拿到的最接近的事实;而一条这个 build 自己产生却缺 `seenAt` 的事件,不是这个 codec 需要接受的情形。

## 备选方案

**把 `SESSION_FORMAT_VERSION` 从 0 bump 到 1,写第一个真正的 upgrader**(任务书里的选项 (ii))——本次变更不选:去掉被删字段、把 `createdAt` 改名成 `seenAt`,这种近乎恒等的转换正是版本机制那篇笔记说"拿不准就 bump"时所指的那种"几乎免费"的 upgrader,但在这条链路上写出并测试第一个真正的 upgrader,是一块比这次瘦身本身需要的更大、可以独立拆分出去的工作。codec 容忍这条路径用一处函数改动就达到了同样的读取兼容效果,并且被一条针对 v1 形状事件的解码+fold 往返测试完整覆盖。如果将来 header/envelope/surface 机制的某次结构性变化终究逼出第一次真正的 bump,这条事件的形状变化可以并入那次 upgrader 自己的删字段逻辑,不需要单独再走一步。

**在 fold 里保留 `parent`/血缘校验,只靠事件自身解析基线版本的血缘** ——拒绝:这恰好是 T1 权威规则要关闭的 D1–D3 那种形状。`baseVersionId`/`baseExplicit` 是 store 写事务一次性定死的声明事实;从一个只存在于 session log 的 `parent` 字段重新推导或交叉校验它们,会把整个 T1/T2 工作要清除的"一个事实两个家"问题重新引进来。

**靠在事件上保留一个瘦身版 `origin` 字段来维持按 `origin` 门控的取代授权**——拒绝:`origin`/`content_origin` 正是 T1 设计里划给 store 的 `versions.content_origin` 列(不可变,内容提交那一刻一次性设定)与 `version_annotations.actor`(谁写了这次元数据编辑)的事实——在事件上以任何形式保留它,都会为"只有模型策展才能取代"这条检查重新打开一份可能漂移的第二拷贝,而这条检查真正要做的事——判断某个 actor 是否*被允许*重记录一个版本的元数据——本就该在 store 写事务那一刻决定,而不是在一次连谁调用了 `annotateVersion` 都看不到的 session log replay 时靠 fold 判断。

## 后果

这是 T2a:范围只有 `packages/science/science-session`。`packages/science/science-runtime`、`packages/science/tool-science`、`packages/extensions/tool-cordis`(它生成的 `api-catalog.ts`),以及每一个消费了现已删除的 `ScienceRunArtifactVersion`/`ScienceHumanEditArtifactVersion`/`ScienceClientRunArtifactVersion`/`ScienceClientHumanEditArtifactVersion` 类型的地方,在后续任务(T2b)更新它们的写路径去匹配之前都会编译失败:`capture.ts` 必须把完整的 `environmentFingerprint`/`producerTurn`/`figureState` 写进 store 而不是事件,`commitStyleEdit` 必须从 `store.getFigureState` 而不是 session 投影解析 `parent.chart`,`annotateArtifact` 必须停止重建一整个版本值,改为调用 T1 store 的 `annotateVersion` 并附加瘦身后的事件,`tool-science` 里每一条模型可见的收据都要删掉这条事件不再携带的字段。`science-session` 自己的测试套件(13 个文件共 108 条测试)已全部更新且通过,每文件 100% 覆盖率;有几条测试的唯一作用就是练到现已删除的 fold 校验(human-edit 血缘、按 `origin` 门控的取代、自动捕获的 toolCallId/requestHeaderSeq 匹配、artifact 上的 chart 校验),按"测试描述行为,不是正确性"的规则被直接删除而不是修补——它们描述的行为在本包里已经不存在了。
