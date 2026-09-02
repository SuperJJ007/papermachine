# @deepseek-ai/dsh-science-artifact-store

[English](README.md) | 中文

Project 级 Science artifact 注册表与内容寻址版本存储。Session 只是某个 artifact 的生产者、消费者与溯源来源——从不拥有它:同一 Project 内的第二个 Session 可以读取、引用并追加第一个 Session 创建的 artifact,artifact 的生命周期不随产生它的 Session 结束。设计依据:[project artifact store Agent Note](../../../.agents/notes/implemented/architecture/2026-08-25-project-artifact-store.zh.md);schema v2 的权威规则(库是 version 全部来源事实的唯一权威,session 日志从不是)见 [project artifact store schema v2 Agent Note](../../../.agents/notes/implemented/architecture/2026-09-01-project-artifact-store-schema-v2.zh.md)。

加载服务不会加载 SQLite。引擎仅在打开项目数据库时导入 `node:sqlite`,空闲 Web Host 不会触发数据库启动工作或 SQLite 实验性功能告警。

## Project 身份

一个 Project 就是一个工作区目录。`openProject(workspacePath)` 通过工作区下的标记文件 `<workspace>/.papermachine/project.json`(`{projectId, createdAt}`)解析其身份,首次使用时创建该文件。存储自身在 `<storeRoot>/project.json` 保留一份记录(`{projectId, createdAt, workspacePath, workspaceUpdatedAt}`),每次打开时刷新——这份记录本身就是注册表,不存在另外的全局索引文件。

当存储记录的 `workspacePath` 与本次打开的路径不同时,身份解析规则如下:

- 记录路径已不存在,或已不再携带指向本 Project 的标记 → **move(移动)**:id 不变,存储记录的路径被更新。
- 记录路径仍然存在且仍携带指向本 Project 的标记 → **copy(复制)**:本次打开的目录是一份副本,获得全新 id;其标记被重写。
- 本次打开的目录内完全没有标记 → **created(新建)**:全新 Project。
- 标记文件仍在,但存储侧丢失或从未生成 → **reopened(重新打开)**:在相同 id 下重新生成存储侧内容。

`openProject` 会在返回值中携带该结果(`ProjectIdentityOutcome`),以及解析出的 `projectId` 与 `storeRoot`。

## 存储布局

除 `openProject` 外的每个方法都直接接收 `projectId`,并且是自给自足的——它会打开(或复用已缓存的连接到)该 Project 的存储,不要求同一进程内先调用过 `openProject`;因此 Host 重启后,或已经知道某个 project id 的第二个 Session,都能立即继续工作。存储目录根植于 harness home(`@deepseek-ai/dsh-home-paths` 的 `resolveDshHome`,绝不硬编码路径),位于 `<harnessHome>/projects/<projectId>/`,包含:

- `project.json` —— 身份与最近一次已知的工作区路径(见上文)。
- `store.sqlite` —— 下文所述各表,使用 `node:sqlite` 的 `DatabaseSync` 打开,配置了 `sqlite3_busy_timeout()`,默认 journal 模式为 `wal`。
- `store.sqlite.v<N>.bak` —— schema migration 触碰 `store.sqlite` 之前写下的升级前快照(见下文「Schema migration」)。保留份数可配置。
- `blobs/sha256/<hh>/<hash>` —— 内容寻址的原始字节:先写入 `blobs/tmp` 下的临时文件,再重命名到最终路径。重命名会原子地替换已存在的目标文件,而相同摘要下目标文件必然字节相同,因此写入按哈希天然幂等,无需预先检查是否存在。blob 从不受 schema migration 影响——它们是内容寻址的,不在 `store.sqlite` 之内。

## Artifact、Version 与侧表记录

一条 **Artifact** 记录(主键 `artifact_id`,`UNIQUE(owningProjectId, logicalName)`):`owningProjectId`、`originSessionId`(创建它的 Session)、`logicalName`、`kind`(`'figure' | 'dataset' | 'document' | 'job-output'`)、`latestVersionId`、`createdAt`。

一条 **Version** 记录(主键 `version_id`,`UNIQUE(artifact_id, ordinal)`)除一列指针外全部不可变:

- 同一 artifact 内连续、从 1 开始的 `ordinal`。
- `baseVersionId`(可空,可以指向*另一个* artifact 的某个 version)+ `baseExplicit`:这个 version 显式基于哪个内容基线构建(模型的 `edit_of`、查看器编辑、或 `save_artifact_as`)。普通的链式续写(常见情况——第二次 `run` 覆盖同名文件)会让 `baseVersionId` 保持 `undefined`;链式前驱永远可从 `(artifactId, ordinal - 1)` 推导,从不单独入列。`appendVersion` 从不用 artifact 当前的 latest 版本兜底 `baseVersionId`。
- `sha256`、`mediaType`、`byteCount` —— 内容地址。
- `contentOrigin`(`'run-auto' | 'human-edit' | 'import'`)—— 这些字节怎么产生的。写入后不可变。
- 生产者溯源,写入时定死、curation 从不改写:`producerSessionId`、`producerRunId`、`producerToolCallId`、`producerRequestHeaderSeq`、`producerTurn`、`environmentRevision`、`environmentFingerprint`(全量 64 位十六进制摘要,不是 preview)。
- `createdAt` —— 内容提交时刻;创建后永不改变。
- `latestAnnotationId` —— 唯一可变的一列,指向 `version_annotations`(见下文)的指针。

一条 **VersionAnnotation** 记录(`version_annotations`,主键 `annotation_id`)是一次元数据修改,只追加不原地更新:`title`/`caption`(各自独立可空)、`actor`(`'capture' | 'model' | 'human'`——谁写下**这次**修改,与 `contentOrigin` 是两回事)、`sessionId`/`toolCallId`/`requestHeaderSeq`(这次修改自己的授权调用)、`derived`(`true` 表示这一行是 v1→v2 migration 推导出来的,不是实时记录)、`createdAt`(这次修改自己的时间戳,与 version 的 `createdAt` 是两回事)。`VersionRecord.latestAnnotation` 携带最新一行;`VersionRecord.title`/`caption` 是 `latestAnnotation?.title`/`caption` 的便捷读法。

一条 **FigureState** 记录(`figure_state`,主键 `version_id`)保存某个 version 的活图对象状态——`figureKey`、`dpi`,以及一段本包原样存取、不做解析的不透明 `stateJson` 字符串(其结构归 `dsh-science-runtime` 所有)。

一条 **ArtifactNote** 记录(`artifact_notes`,主键 `note_id`)是用户写的注释,可选择性地钉在某个 version 上,通过 `removedAt` 软删除(从不硬删除)。

一条 **VersionHealth** 记录(`version_health`,主键 `version_id`)记录由**调用方**算出的对账状态——`orphan`、`reconstructed`、`missingContent`、`checkedAt`。本包只存 `setVersionHealth` 被告知的结果,不自己跑对账。

### 写入与 curation

`createArtifact`/`appendVersion` 不携带 `title`/`caption`——事后用 `annotateVersion` 来 curate 一个 version 的元数据,其 `actor`/`sessionId`/`toolCallId`/`requestHeaderSeq` 指明这次修改自己的来源。每次调用都会**追加**一条新的 `version_annotations` 行并前移 `latestAnnotationId`;从不原地更新一行,因此一个 version 的元数据修改历史完全可重建。`title`/`caption` 各自独立三态:省略即原样带到新行、传 `null` 显式清空、传字符串即设置。

`listNotes`/`putNote`/`removeNote` 管理 `artifact_notes`;`getFigureState` 读取 `figure_state`(通过 `createArtifact`/`appendVersion` 的 `figureState` 参数写入);`setVersionHealth` 是本包对 `version_health` 唯一的写方法——构建调用它的对账算法是消费方的工作。

## 并发追加的线性化

`appendVersion` 的写事务(`BEGIN IMMEDIATE` … `COMMIT`)就是线性化点:读取该 artifact 当前的 `latestVersionId` 只是为了算出下一个 `ordinal`,插入新 version,再更新 `latestVersionId`。SQLite 的 `sqlite3_busy_timeout()`(`busyTimeoutMs` 连接选项)会让第二个写入者在 `BEGIN IMMEDIATE` 上阻塞重试,而不是直接失败;因此两个 Session——包括两个独立的操作系统进程——并发追加时会在这个事务上串行化:后提交者成为 latest,链条永不自动分叉。

## Schema migration

`PROJECT_ARTIFACT_STORE_SCHEMA_VERSION`(目前是 `2`)是本 build 能写的最高磁盘 `PRAGMA user_version`;更旧的磁盘版本能不能打开,取决于 `STORE_MIGRATIONS` 有没有一条通向它的完整链,不由版本号的形状决定。打开时按磁盘值分支:

| 磁盘值 | 行为 |
|---|---|
| `0` | 新建数据库:先建目标 DDL,最后才 stamp `user_version`(前面任何失败都让介质保持未 stamp 状态,重试打开会从头重新生成)。 |
| `= 当前值` | 直接使用(目标 DDL 会作为幂等的安全网再跑一遍)。 |
| `< 当前值` 且链条完整 | 先给 `store.sqlite` 做一次 checkpoint 并复制成 `store.sqlite.v<N>.bak`(见下文),再让链上每一步各自跑在自己的写事务里,重建期间 `PRAGMA foreign_keys = OFF`,每一步跑完后统一 `ON`。每一步的事务在自己的 `PRAGMA user_version = <to>` 与 `COMMIT` 之前先跑 `PRAGMA foreign_key_check`;不通过就抛 `SCHEMA_UPGRADE_UNAVAILABLE` 并回滚该事务——因为检查在提交之前,这是一次真正的 SQL `ROLLBACK`,不是文件还原。 |
| `< 当前值` 但链条缺某一步 | 抛 `SCHEMA_UPGRADE_UNAVAILABLE`,消息指出磁盘路径,不改动任何东西。 |
| `> 当前值` | 抛 `SCHEMA_VERSION_NEWER`——这个 store 是被更新的 harness 写的;它的 blob 目录仍然是内容寻址的,可以手工取回。 |

v1→v2 migration(`STORE_MIGRATIONS` 目前唯一的一步)在一个事务里做六件事:建四张新表;按目标 DDL 重建 `artifacts`/`versions`,`kind` 按每个 artifact 最新版本的 `mediaType` 推导(`image/png`→`figure`,`text/csv`→`dataset`,其余→`document`——本 build 的任何生产者都不会写出别的媒体类型);把 v1 的 `origin` 搬进 `contentOrigin`(`'human-edit'` 保留,`'auto'`/`'model'` 都变成 `'run-auto'`),把 `parent_version_id` 搬进 `baseVersionId`,**但 `baseExplicit` 一律标 `false`**(v1 分不清显式基线和自动兜底的链式前驱,这次 migration 不猜);从 v1 的 `title`/`caption`/`origin` 为每个 version 推导一条 `version_annotations` 行(v1 的 `origin` 是 `'model'` 时 `actor: 'model'`,否则 `'capture'`),标 `derived: true`;解决 v1 从未强制过的 `UNIQUE(owningProjectId, logicalName)` 冲突——保留创建时间最早的 artifact 的名字,其余改名为 `<name>#<短 artifactId>` 并写一条说明用的 `artifact_notes`(版本链从不合并);最后跑一步**可选**步骤:调用方注入的 `backfillProvenance` 钩子(见「配置」)可以从该 project v1 时代的 session 日志里回填 `environmentFingerprint`/`producerTurn`/`figureState`/推导出的那条 annotation 真实的 `toolCallId`/`createdAt`——这是本包唯一一处允许调用方把 session 日志派生的事实喂回库里的地方,因为在 v1 里这些事实没有别的家。钩子未提供、被拒绝、或对某个 version 没返回结果,该 version 就停在已迁移的默认值上,并通过 `onWarning` 报一条警告;从不让 migration 失败。

### 备份

`storeBackupRetention`(Config,默认 `1`)控制每个 project 保留几份 `store.sqlite.v<N>.bak`,每次升级后按版本号从小到大剪掉多余的。列出备份目录失败会静默降级(尽力而为的剪枝);拷贝前的 WAL checkpoint 失败同样是尽力而为——备份仍然可用,只是可能缺最近的一点写入。

## 删除边界

`deleteProject(projectId)` 永久删除 `<storeRoot>/`——索引与全部 blob——这是本包唯一执行的级联删除。本包没有 Session 级别的删除操作:删除某个 Session 的日志是 `dsh-session` 的职责,本包对此不可见;无论生产者 Session 是否仍然存在,每条存储记录都保留其 `sessionId` 作为溯源信息。

## 对账

`reconcile.ts` 把存储里自己的 version 行拿去和调用方已经从该 project 的 session 日志读出、按 `versionId` 归并（后写覆盖）后的 `science/artifact-saved` 事件比对，本包自己从不读 session 日志。`ScienceArtifactStore.reconcileProject(projectId, events, eventSetComplete, cursor?)` 执行比对并修复存储；`eventSetComplete` 表明调用方是否读完了每条相关 session 日志和事件，返回的 cursor 用于在同一稳定事件集上继续有界工作。`getReconciliationSummary(projectId)` 是对上一次对账结果的纯读取。硬规则：**对账只写存储，绝不写 session 日志**；日志是仅追加的，重写其历史会破坏回放约定。

按 version 分类，共七种情况：

| 情况 | 判定条件 | 处理 |
|---|---|---|
| 一致 | 库行与事件都命名了这个 `versionId`,`sha256` 相同,title/caption 相同 | 不写 |
| 无法验证 | 存储行存在，没有事件命名这个 `versionId`，且 `eventSetComplete` 为 false | 不写 orphan；部分读取无法证明或排除 orphan，因此保留既有 orphan 值，但仍刷新 `missingContent` |
| 孤儿库行（W1/W2） | 存储行存在，没有事件命名这个 `versionId`，且 `eventSetComplete` 为 true | `version_health.orphan = 1`；行与其字节原样保留，孤儿是一个真实、完整的 artifact version，只是没有任何 session 声明是它的生产者 |
| 悬空事件 | 某事件命名的 `versionId` 在库里没有对应行(库行丢失,事件却留存下来) | `reconstructVersion` 用事件的兜底字段重建一个 version 行(以及缺失的所属 artifact 行),`content_origin` 固定为 `'import'`(`ContentOrigin` 里唯一一个不声称真实来源的值,因为这次重建本来就无法恢复真实来源);`version_health.reconstructed = 1` |
| 内容冲突 | 同一个 `versionId` 两边都有,`sha256` 不同 | 正常写入路径不可能产生这种情况;记为诊断错误,库行标记 `orphan`,事件不动 |
| 元数据分歧 | 同一个 `versionId`、同一个 `sha256`,但事件的 title/caption 快照与库当前的 annotation 不同 | 不写——库的最新 annotation 本身就是当前事实;事件是模型当时看到的呈现快照,保持原样是正确的 |
| blob 丢失 | version 行存在,但其 blob 在 `blobs/sha256/` 下不存在 | `version_health.missingContent = 1`;行不会被删除 |

对账是幂等的：在存储和事件集都不变的情况下重复运行会得到相同的 `version_health` 状态，因为每次确定性写入都从当前比对结果重新计算而非累加，不完整事件集则保留无法确定的 orphan 状态。内容冲突、悬空事件重建、元数据比较和 `missingContent` 刷新仍会在事件集不完整时运行；只有从“缺少事件”推断 orphan 的操作会被跳过。工作量由 `reconcileMaxVersions`（见下方配置）设上限：`ReconcileResult.cursor` 为下一次调用保留尚未完成的 version 与悬空事件工作；失败项会轮转到未处理项之后，不能固定占住有界前缀。cursor 仍有工作时，`truncated` 保持 true。`reconstructVersion` 重建出的行对自己无法恢复的信息保持明确：`mediaType` 从悬空事件的 `logicalName` 扩展名推断（无法识别的扩展名回退到 `application/octet-stream`）；`byteCount` 在 blob 存在时是其真实磁盘大小，在 blob 也丢失时是 `0`，这是哨兵值而非声称的真实大小（此时 `missingContent` 也会被置位，调用方应先检查这个标记再信任字节数）。

谁来调用 `reconcileProject`、事件集如何构建，由消费方负责。`dsh-science-runtime` 的 `sessionProject` 每次解析 project id 时都可触发一次有界对账，并通过 `@deepseek-ai/dsh-session-persistence` 的 `SessionPersistence.inspect()` 读取该 project 自己的 session 日志（由它自己的 `reconcileMaxSessions` 配置设上限）。Runtime 会在符合条件的尝试之间保留逐 session 累积的事件与 store cursor。完整事件收集之后，只有 store 运行既无 cursor 又无错误，才会在当前 Host 生命周期内抑制该 project 的后续尝试；否则，之后的 project 解析可在 `reconcileRetryDelayMs` 后重试。触发机制以及它在 `annotateArtifact`、`performChartEdit`、`saveArtifactAs` 追加点上对 W2/W3 崩溃窗口的收窄，见该包的 README。

## 配置(schemastery)

```ts
// BackfillProvenanceHook's own row/value shapes are exported from this
// package's `.` entry point; see "Schema migration" above for their fields.
type BackfillProvenanceHook = (
  projectId: string,
  rows: readonly { versionId: string; artifactId: string; producerSessionId: string }[],
) => Promise<ReadonlyMap<string, {
  environmentFingerprint?: string
  producerTurn?: number
  figureState?: { figureKey: string; dpi: number; stateJson: string }
  annotationToolCallId?: string
  annotationCreatedAt?: number
}>>

interface Config {
  dshHome?: string           // explicit harness-home override; omitted follows DSH_HOME, then ~/.dsh
  journalMode?: 'wal' | 'delete' | 'truncate' | 'persist'   // journal_mode pragma; default 'wal'
  busyTimeoutMs?: number     // sqlite3_busy_timeout() for every project connection; default 5000
  storeBackupRetention?: number   // pre-upgrade .bak files kept per project; default 1
  reconcileMaxVersions?: number   // version rows + dangling events one reconcileProject call processes; default 2000
  backfillProvenance?: BackfillProvenanceHook   // see Schema migration; omitted skips step 4 with a warning
}
```

`backfillProvenance` 是一个函数值,像本仓库里其他被注入实例的 config 字段(例如 `dsh-session-telemetry-otel` 的 `exporter`/`processor`)一样用 `z.any()` 校验——它是编程方式传入的,不是从 `cordis.yml` 来的。本包从不自己读 session 日志格式;需要读的消费方(例如 `dsh-science-runtime`)提供这个钩子。

## Model Experience

None, as the package persists project-owned artifact bytes and metadata; model-facing consumers such as `dsh-science-runtime` and `dsh-tool-science` own any prompt, schema, or request rendering of what it stores.

#### KV Cache effect

None — this package never assembles or sends provider requests; it has no live-request presence to invalidate or preserve.

## Known Limitations and Deferred Work

- **没有未引用 blob 的垃圾回收** —— 一次 append 若在 artifact 存在性校验失败前已经写入了 blob(字节的写入发生在事务校验目标 artifact 之前),该 blob 不会被回收;内容寻址使其成为无害的孤儿数据,而非正确性问题。
- **工作区身份使用 `resolve()` 而非 `realpath()`** —— 通过两条不同的符号链接路径到达同一目录不会被识别为同一目录;只有字面路径相等才能区分「重新打开」与「移动/复制」。
- **复制检测在打开时是启发式的** —— 若原目录在打开副本时不可达(例如磁盘未挂载),该情况与移动无法区分,id 会被保留,这是设计 note 中已接受的 v1 风险。
- **不支持跨 Project 读写、保留策略或依赖 DAG** —— 本包只实现了 [project artifact store Agent Note](../../../.agents/notes/implemented/architecture/2026-08-25-project-artifact-store.zh.md) 机制第 1/2/5/6/10 条;跨 Project 访问、版本保留策略与依赖追踪明确延后。
- **`reconstructVersion` 恢复出的 `mediaType`/`kind` 是推断值,不是核实过的事实** —— 悬空事件的 `logicalName` 扩展名不在固定的五种类型集合里时,会回退到 `application/octet-stream`/`document`;一旦库行与事件都不再携带真实值,就没有办法再把它找回来。
