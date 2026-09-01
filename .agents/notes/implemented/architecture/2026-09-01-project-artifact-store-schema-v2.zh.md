# Agent Note:项目 artifact store —— schema v2 与它的 migration

Status: implemented

[English](2026-09-01-project-artifact-store-schema-v2.md) | 中文

## 背景

对 Science artifact 两个持久化面——project 级 SQLite store(`@deepseek-ai/dsh-science-artifact-store`)与 session event log——的一次审计发现了 14 条具体分歧(即促成本次改动的审计报告里的 D1–D14;完整列表与复现步骤见协调任务的 `audit.md`)。两个面各自持有同一批事实的部分、有时互相矛盾的副本:curation 之后 `createdAt` 两边不同(D1),curation 之后授权的 `toolCallId` 两边不同(D2),`parent`/基线用了两套寻址方式和两套默认规则(D3),一个 `origin` 列同时承担两件不相关的事实并被原地覆写(D4),环境指纹在库里被截成 12 字符 preview 而事件里保留全量(D5),活图对象状态只存在于 event log(D6),同一个 `logicalName` 冲突会悄悄把一个 artifact 拆成两行(D7),`caption` 一旦设置就永远无法清空(D8),Files 面板与会话作用域的详情视图对同一个 version 的标题给出不同答案(D9),用户注释只存在于 event log(D10)。而在这一切之下,`PROJECT_ARTIFACT_STORE_SCHEMA_VERSION` 自打这个包发布以来从未真正 bump 过:`schema.ts` 会拒绝任何既不是 `0` 也不是当前值的磁盘值,完全没有升级路径(D14)——发布后的第一次 DDL 变更就会让每一个现有用户的 store 直接打不开。

## 决定

**权威规则:project store 的写事务是一个 version 来源事实的唯一权威;session event log 只记录 `versionId` + `sha256` + 模型当时看到的呈现快照。** artifact 的生命周期按设计要长于任何单个 session(项目作用域,不是 session 作用域),而 session log 是用户可删除的载体——可删除的载体不能是一个生命周期更长的对象的权威。具体地:`versionId`/`artifactId`/`ordinal`、`contentOrigin`、完整的 `producer{sessionId,runId,toolCallId,requestHeaderSeq,turn}` 一组、`baseVersionId`/`baseExplicit`、`createdAt` 只活在库里——事件不再携带它们。`sha256` 仍然留在事件上(内容 pin,让读者无需重新信任库就能校验模型当时看到的字节)。**当前**的 `title`/`caption` 活在库里最新的 `version_annotations` 行里;事件仍然携带模型**那次调用**看到的 title/caption 快照——这是一个呈现事实,不是来源事实,把它当成逐次调用的历史记录而不是一个活指针才是对的。

**元数据修改是追加一行,`versions` 本身只有一列可变。** 每次 `annotateVersion` 调用都会在 `version_annotations` 新增一行;`versions.latestAnnotationId` 是这张不可变 version 表上唯一会变的列,而且它是一个可以从 `version_annotations` 重新推导的缓存指针,即使错了也能修。理由有三条,不是一条:

1. 元数据修改有它自己的来源(谁改的、何时、哪次调用),与内容的来源是两回事。原地更新没有地方放这三件事,要么丢失(今天库里的情况),要么被塞进内容生产者的列里污染它(今天事件里的情况,即 D2 的根因)。
2. 真实数据证明原地更新会不可挽回地毁掉事实:`mimic_iii_overview.png` v1 的库行显示 `origin='model'`、中文标题——它曾经是一次自动捕获、标题是 basename 这件事,在库里已经永久丢失,只能从一个可能已经被删除的 session log 里找回。
3. 追加天然支持清空 caption(新行写 `caption: null`——D8),也让一次人工编辑和一次模型 curation 能作为两条**不同**的行共存,而不会有一方悄悄覆盖另一方的来源。

**`content_origin` 与 `actor` 是给两件不同事实用的两个不同枚举(修 D4)。** `versions.content_origin`(`'run-auto' | 'human-edit' | 'import'`)不可变——这些字节是怎么产生的。`version_annotations.actor`(`'capture' | 'model' | 'human'`)——谁写下**这一次**元数据修改——每新增一行就可能不同。v1 里单一的 `origin` 列把这两件事糅在一起;把它拆开正是 D4 的修法。

**`baseVersionId` 是一个显式声明的事实,从不被默认填充(修 D3)。** `base_version_id`(可空,可以指向另一个 artifact 的某个 version)+ `base_explicit`(`0`/`1`)取代 `parent_version_id`。链式前驱永远可以从 `(artifactId, ordinal - 1)` 推导,因此故意不入列——把它存下来正是 D3 文档记录的那种"没有基线到底是没有基线,还是模型默认填充的基线"的歧义的成因。`appendVersion`/`createArtifact` 根据调用方是否传了 `baseVersionId` 来决定 `baseExplicit`;不存在一个可以与"是否传了基线"互相矛盾的独立"显式"标志位。

**migration 机制:一条有序的 upgrader 链,照抄 session log 的方向感知机制**([`2026-08-10-session-log-version-mechanism.md`](2026-08-10-session-log-version-mechanism.zh.md)),取代 store 原来"除了 0 和当前值一律拒绝"的做法。`STORE_MIGRATIONS: readonly StoreMigration[]` 持有一串 `{from, to, apply}` 步骤;`resolveMigrationChain` 从磁盘版本走向目标版本,在第一个缺失的步骤处抛 `SCHEMA_UPGRADE_UNAVAILABLE`(这是一个与模块级导出无关的纯函数,因此不用真的在已发布的链里制造缺口就能单测这条路径)。打开时按磁盘 `user_version` 分支:`0` 新建并最后 stamp(幂等 DDL 作为安全网);`= 当前值` 直接使用(幂等 DDL 再跑一遍作为安全网);`< 当前值` 且链条完整,先对 `store.sqlite` 做一次 checkpoint 并复制成 `store.sqlite.v<N>.bak`(保留份数由新的、经校验的 `storeBackupRetention` Config 字段控制,默认 1——这是一个随部署变化的选择,不是 `DEFAULT_*` 常量),然后让每一步各自跑在自己的写事务里,重建期间 `PRAGMA foreign_keys = OFF`,在这一步自己的 `PRAGMA user_version = <to>` 与 `COMMIT` **之前**跑 `PRAGMA foreign_key_check`(不通过就抛错,该事务真的 `ROLLBACK`——比提交后再做文件还原更强,因为一个不合法的状态从未被真正提交过),整条链跑完后统一 `ON`;`> 当前值` 抛 `SCHEMA_VERSION_NEWER`,并指出 blob 目录仍然可以手工取回。

**v1 → v2 的六个步骤诚实地映射老数据,不去发明它并不具备的确定性:**

| v1 事实 | v2 落点 | 映射方式 |
|---|---|---|
| `artifacts`(无 `kind`,无唯一性) | `artifacts` + `kind`、`UNIQUE(owningProjectId, logicalName)` | `kind` 按该 artifact 最新版本的 `mediaType` 推导(`image/png`→`figure`,`text/csv`→`dataset`,其余→`document`——本 build 任何生产者会写出的媒体类型就这三种)。同名冲突保留创建时间最早的 artifact 的名字,其余改名为 `<name>#<短 artifactId>`,并写一条说明用的 `artifact_notes`;版本链从不合并(合并会伪造出一段假的 ordinal 历史)。 |
| `versions.parent_version_id` | `base_version_id` + `base_explicit` | 直接搬进 `base_version_id`;`base_explicit` **一律是 `0`**,从不是 `1`——v1 没有任何一列能区分"显式的 `edit_of`"和"`store.ts` 旧代码默认填充为 latest"(D3 的根因),因此这次 migration 不去猜哪些迁移过来的行"其实"是显式的。 |
| `versions.origin` | `content_origin` + 一条推导出的 `version_annotations` 行 | `'human-edit'` 保留;`'auto'`/`'model'` 都变成 `content_origin: 'run-auto'`(origin 旧的含义把内容来源和元数据来源糅在一起——即 D4)。为每个 version 推导一条 annotation 行:v1 的 `origin` 是 `'model'` 时 `actor: 'model'`,否则 `'capture'`;`title`/`caption` 原样搬过来;`derived: true`;`createdAt` = 该 version 自己的 `createdAt`(v1 唯一有的时间戳)。 |
| `versions.environment_fingerprint_preview`(12 位十六进制) | `versions.environment_fingerprint`(64 位十六进制) | **不提升**——一个 12 字符的 preview 没法诚实地变成一个全量摘要,所以这一列先置 `NULL`,只能靠步骤 4 回填。 |
| `versions.environment_revision`(`TEXT`) | `versions.environment_revision`(`INTEGER`) | 用 `Number()` 解析——每个已知生产者写入时都是某个真实整数的 `String(revision)`,所以这个转换总能正确往返;这同时修了一个既有的类型不匹配——每一个别的 Science 包一直都把 `environmentRevision` 当 `number` 处理。 |
| (无——v1 没有这一列) | `versions.producer_turn`、`figure_state`,以及推导出的那条 annotation 真实的 `toolCallId`/`createdAt` | **可选的步骤 4,"store 从不读 session 日志"这条规则唯一的例外:** 调用方可以注入一个 `backfillProvenance(projectId, rows) => Promise<Map<versionId, {...}>>` 钩子,从该 project v1 时代的 session 日志里回填这些事实——那是这些事实仅存的地方。钩子未提供、被拒绝、或对某个 `versionId` 没返回结果,该数据都会停在已迁移的默认值上,并记一条 `onWarning`;三种情况都不会让 migration 失败。 |

## 被否决的替代方案

**让 event log 继续(共同)充当来源权威,把 store 降级为可重建的缓存**——否决:这是审计报告里的方案 (b)。它天然满足"模型可见 ⟺ 已记录",但除非删除时先把事实"固化"进库(那其实就是方案 (a) 多了一个容易被遗忘的迁移步骤),否则满足不了"删除生产会话后 artifact 仍可解释"(即 S0 的真实要求——项目级 artifact 要活得比 session 长)。它也保留了 D1/D2/D3 真正的成因(一个事实两个家),而不是修掉它。

**原地更新元数据,但让 patch 支持显式 null(只修 D8,不追加行)**——否决:仍然丢失元数据修改自己的来源(谁改的、何时、哪次调用),而且根据 `mimic_iii_overview.png` 的真实数据,仍然会不可挽回地毁掉内容原本的 curation 历史。追加不是这里的额外仪式——它是唯一一种有地方安放那些原地版本根本无处安放的事实的表示方式。

**永久保持单调拒绝(维持 D14 现状,只是把文档写得更清楚)**——直接否决:产品今晚就要发布,下一次 DDL 变更就会让每一个现有用户的 store 直接打不开,而他们的 blob 原封不动地躺在打不开的 store 底下够不着。这是审计报告里唯一被评为"数据不可用"而不仅仅是"不一致"的一条,而且这个代码库已经有一套验证过的、方向感知的升级机制(session log 的那一套)可以照抄,没必要重新发明一套更弱的。

**在普通续写时把 `baseVersionId` 默认填成 artifact 当前的 latest 版本(恢复旧的 `store.ts:241` 行为)**——否决:这**就是** D3。拆分的全部意义就在于"没有声明基线"和"基线被默认填成 latest"是两件不同的事实,一个可空列区分不了;而每一个读 `baseVersionId` 的消费方(版本步进器的血缘线、`get_science_state` 的合法引用集)都需要区分它们。

## 后果

本任务(T1)只交付 store 包本身——新表、migration,以及调整过的公开接口(`createArtifact`/`appendVersion` 去掉 `title`/`caption`,加上 `kind`/`baseVersionId`/`producerTurn`/`environmentFingerprint`/`figureState`;`annotateVersion` 加上 `actor`/`sessionId`/`toolCallId`/`requestHeaderSeq` 并改为追加语义;新增 `listNotes`/`putNote`/`removeNote`/`getFigureState`/`setVersionHealth` 方法)——暂时没有接线的消费方,形态与 S1 当初一致。`science-runtime`、`science-session`、`tool-science` 在后续任务更新之前,仍然按旧的 `origin`/`title`/`caption`/`editBaselines` 形态写入;那次更新也要负责实现 `backfillProvenance` 钩子(本包只定义并调用它)、调用新 `setVersionHealth` 的 store↔session 对账算法,以及 `science/artifact-saved` 瘦身后 payload 对 `SESSION_FORMAT_VERSION` 是 bump 还是容忍的决定。figure/dataset/document/job-output 三分的 `kind` 划分,以及 `figure_state`/未来 `dataset_schema`/`jobs` 侧表的形状,是设计来让 Figure/DataAsset/Jobs 这类对象以后能够挂上去而不用再来一次权威规则迁移的——新对象的来源事实进库的侧表,对话事实进 session log,两边都不得再各存一份来源。
