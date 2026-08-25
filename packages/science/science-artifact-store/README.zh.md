# @deepseek-ai/dsh-science-artifact-store

[English](README.md) | 中文

Project 级 Science artifact 注册表与内容寻址版本存储。Session 只是某个 artifact 的生产者、消费者与溯源来源——从不拥有它:同一 Project 内的第二个 Session 可以读取、引用并追加第一个 Session 创建的 artifact,artifact 的生命周期不随产生它的 Session 结束。设计依据:[project artifact store Agent Note](../../../.agents/notes/proposed/architecture/2026-08-25-project-artifact-store.zh.md)。

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
- `store.sqlite` —— `artifacts` 与 `versions` 两张表(见下文),使用 `node:sqlite` 的 `DatabaseSync` 打开,配置了 `sqlite3_busy_timeout()`,默认 journal 模式为 `wal`。
- `blobs/sha256/<hh>/<hash>` —— 内容寻址的原始字节:先写入 `blobs/tmp` 下的临时文件,再重命名到最终路径。重命名会原子地替换已存在的目标文件,而相同摘要下目标文件必然字节相同,因此写入按哈希天然幂等,无需预先检查是否存在。

## Artifact 与 Version 记录

一条 **Artifact** 记录(主键 `artifact_id`):`owningProjectId`、`originSessionId`(创建它的 Session)、`logicalName`、`latestVersionId`、`createdAt`。

一条 **Version** 记录(主键 `version_id`,`UNIQUE(artifact_id, ordinal)`):同一 artifact 内连续、从 1 开始的 `ordinal`;可为空的 `parentVersionId`(可以指向*另一个* artifact 的某个 version——即显式的 `editBaselines` 分支起点);`sha256`、`mediaType`、`byteCount`;`origin`(`'auto' | 'model' | 'human-edit'`);`title`/`caption`;生产者溯源信息(`producerSessionId`、`producerRunId`、`producerToolCallId`、`producerRequestHeaderSeq`、`environmentRevision`、`environmentFingerprintPreview`);`createdAt`。

`annotateVersion` 只对其指定的 version 做元数据修补:`title`/`caption`/`origin` 原地更新;字节内容、`sha256`、`ordinal` 永不改变。

## 并发追加的线性化

`appendVersion` 的写事务(`BEGIN IMMEDIATE` … `COMMIT`)就是线性化点:读取该 artifact 当前的 `latestVersionId`,以该值(或显式传入的 `editBaselines`)为 parent 插入新 version,再更新 `latestVersionId`。SQLite 的 `sqlite3_busy_timeout()`(`busyTimeoutMs` 连接选项)会让第二个写入者在 `BEGIN IMMEDIATE` 上阻塞重试,而不是直接失败;因此两个 Session——包括两个独立的操作系统进程——并发追加时会在这个事务上串行化:后提交者成为 latest,链条永不自动分叉。

## 删除边界

`deleteProject(projectId)` 永久删除 `<storeRoot>/`——索引与全部 blob——这是本包唯一执行的级联删除。本包没有 Session 级别的删除操作:删除某个 Session 的日志是 `dsh-session` 的职责,本包对此不可见;无论生产者 Session 是否仍然存在,每条存储记录都保留其 `sessionId` 作为溯源信息。

## 配置(schemastery)

```ts
interface Config {
  dshHome?: string           // explicit harness-home override; omitted follows DSH_HOME, then ~/.dsh
  journalMode?: 'wal' | 'delete' | 'truncate' | 'persist'   // journal_mode pragma; default 'wal'
  busyTimeoutMs?: number     // sqlite3_busy_timeout() for every project connection; default 5000
}
```

## Model Experience

None, as the package persists project-owned artifact bytes and metadata; model-facing consumers such as `dsh-science-runtime` and `dsh-tool-science` own any prompt, schema, or request rendering of what it stores.

#### KV Cache effect

None — this package never assembles or sends provider requests; it has no live-request presence to invalidate or preserve.

## Known Limitations and Deferred Work

- **没有未引用 blob 的垃圾回收** —— 一次 append 若在 artifact 存在性校验失败前已经写入了 blob(字节的写入发生在事务校验目标 artifact 之前),该 blob 不会被回收;内容寻址使其成为无害的孤儿数据,而非正确性问题。
- **工作区身份使用 `resolve()` 而非 `realpath()`** —— 通过两条不同的符号链接路径到达同一目录不会被识别为同一目录;只有字面路径相等才能区分「重新打开」与「移动/复制」。
- **复制检测在打开时是启发式的** —— 若原目录在打开副本时不可达(例如磁盘未挂载),该情况与移动无法区分,id 会被保留,这是设计 note 中已接受的 v1 风险。
- **不支持跨 Project 读写、保留策略或依赖 DAG** —— 本包只实现了 [project artifact store Agent Note](../../../.agents/notes/proposed/architecture/2026-08-25-project-artifact-store.zh.md) 机制第 1/2/5/6/10 条;跨 Project 访问、版本保留策略与依赖追踪明确延后。
- **尚未接入 science-runtime 或 tool-science** —— 本包目前只是存储本体;消费它的 session 事件、捕获与工具解析等环节属于同一设计的后续切片。
