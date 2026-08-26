# Agent Note: Project-level artifact store

Status: proposed

[English](2026-08-25-project-artifact-store.md) | 中文

## 问题

今天的 Science artifact 是单个 session 日志的投影:`science/artifact-saved` 内嵌完整附件引用,字节存在 session 作用域的附件存储里,删除 session 就删掉了它产出的全部 artifact。Claude Science 的模型——2026-08-25 对产品调研得到的十一条 project/session 机制 spec,被引用条目均在下文内联重述——让 artifact 归 project 所有:session 只是 producer、consumer 和 provenance,从不拥有 artifact,因此同一 project 的第二个 session 可以读取、引用并追加第一个 session 创建的 artifact,artifact 也在 session 删除后存续。路线图(S1–S4)决定 v1 落实该 spec 的第 1/2/5/6/10 条;本 note 是各切片所实现的 S0 设计。

## 提议

**Project 身份。** Project 就是一个 workspace 目录。其身份由标记文件 `<workspace>/.papermachine/project.json` 承载,内含生成的 branded `projectId` 与 `createdAt`;未标记 workspace 里的第一个 Science session 负责创建它。标记随目录走,因此移动或改名 workspace 不换 id。harness home 为每个 project 保存一个 store 目录(见下);store 自身的 `project.json` 记录最近已知的 workspace 路径并在打开时刷新,store 树本身即注册表——不设独立的全局索引文件。打开时的复制检测:当 store 记录的路径仍存在、与本次打开路径不同、且仍带有相同 id 的标记时,本次打开的目录是副本——为其铸造新 id 并重写标记;移动(旧路径消失或无标记)保持原 id。

**Store 布局。** artifact 的权威数据位于 `~/.papermachine/projects/<projectId>/`(harness home,绝不在 workspace 内):`project.json`(身份 + 最近已知路径)、`store.sqlite`(索引,按 pre-release 立场使用单调 `SCHEMA_VERSION`——旧 schema 直接拒绝,不做迁移)、`blobs/sha256/<hh>/<hash>`(内容寻址的原样字节,temp-then-rename 写入,按哈希幂等准入)。

**Artifact 与 Version 记录**(spec 第 2 条)。Artifact 行:`artifactId`(branded、生成)、`owningProjectId`、`originSessionId`、`logicalName`、`latestVersionId`、`createdAt`。Version 行:`versionId`、`artifactId`、artifact 内连续的 `ordinal`、`parentVersionId`(可空;可指向另一 artifact 的版本,保留今天 `editBaselines` 的跨 artifact 派生)、`sha256`、`mediaType`、`byteCount`、`origin`(`auto` | `model` | `human-edit`)、`title`/`caption`、producer 溯源(`sessionId`,run 产出的 origin 另有 `runId`/`toolCallId`/`requestHeaderSeq`,以及 session 事件已携带的环境 revision 与指纹预览)、`createdAt`。策展(`annotate_artifact`)仍是对其命名版本的元数据更新——title/caption/origin 原地变更,字节与 ordinal 永不变。

**Session 日志与 store 的分工。** model-visible ⟺ logged 规则在双权威下的重述:session 日志记录*事件与引用*——`science/artifact-saved` 从内嵌附件瘦身为 `{artifactId, versionId, ordinal, sha256, mediaType, origin, parent, title, caption}`——store 拥有*字节与跨 session 索引*。模型见过的一切仍可由日志 + store 重建:事件按校验和锁定内容,store 负责解析。严格 fold 仍只对日志确定性:同 session 引用照旧在 fold 内校验;跨 session 或跨 project 引用在产出事件提交*之前*对 store 校验(Host 侧 pre-commit invariant 可查 store;replay 不可),已提交事件携带校验通过的结果作为事实。Session 导出的附件抽取按校验和改指向 project store。

**并发追加的线性化**(spec 第 5 条)。一个 SQLite 写事务即线性化点:读取 artifact 的 `latestVersionId`,插入 `parent = latest` 的新版本(或显式命名的 `editBaselines` parent——在 `parentVersionId` 里记录可见分支而不使链分叉),更新 `latestVersionId`。两个 session 的并发追加在该事务上串行;后提交者成为 latest;链从不自动分叉。SQLite 已是本仓库的耐久索引选择(`storage-sqlite`、`session-persistence-sqlite`),而跨进程串行化正是 JSON 索引必须用锁文件手搓的东西。

**删除边界**(spec 第 10 条)。删除 session 只移除其日志;store 行保留 producer `sessionId` 作为可能悬空的溯源 id,并如实文档化。删除 project 整体移除 `~/.papermachine/projects/<projectId>/`——唯一的级联。artifact 级删除/改名仍延后到 P1 的 artifact 轻功能批次。

**三层存储**(spec 第 6 条)。Files = 所属 project 的 artifact/latest 从 store 投影(S3/S4);session workspace 仍是执行与暂存目录(`science-runtime` 的私有树,不变);host 文件系统访问仍由现有 fs policy 治理(spec 第 7 条映射其上——v1 不新建 grant 机制)。

**无兼容垫片。** fold 对旧的内嵌附件式 `science/artifact-saved` 值直接拒绝(pre-release 立场);任何读者、写者、测试都不为旧格式续命。`SESSION_FORMAT_VERSION` 保持 0。

## 考虑过的替代方案

**session 拥有字节之上加 project 级索引**——附件原地不动,只加跨 session 索引。丢掉目标:artifact 仍随产出 session 一起死,导出/读取路径永远横跨两个权威。

**无 workspace 标记、按 realpath 键注册**——用户目录里不落文件,但每次移动或改名都断身份,而用户明确要求身份在移动改名后存续。

**JSON 索引替代 SQLite**——更易读,但线性化点变成跨进程手搓文件锁,且仓库已有带 `SCHEMA_VERSION` 惯例的 SQLite 基础设施。

**并发追加即分叉(版本 DAG)**——CS spec 本身就线性化(后提交者为 latest);dependency DAG 是 spec 第 11 条,随之延后。

**store 放进 workspace**——可移植性最高,但把 blob 树放进用户数据目录,备份与同步工具会反复搅动;标记文件承载身份,harness home 承载数据。

## 验收标准

- S1:创建、重开、移动、复制 workspace 得到文档化的 id 行为;追加/读取/latest 可用;两个独立进程的并发追加产生线性链且后提交者为 latest;删 session store 完好;删 project store 移除;旧 schema 的 `store.sqlite` 被响亮拒绝。
- S2:捕获把字节写入 store 并给事件瘦身;fold、投影、`get_science_state` 与全部 keyless 快照按引用重放;旧事件值被清晰报错拒绝。
- S3:同 project 的第二个 session 可读取、引用(`artifact_inputs`)并向第一个 session 的 artifact 追加版本;Files 每个 artifact 一行显示 latest;Host 重启后链可继续。

## 风险

- session 删除后 producer `sessionId` 悬空,是接受并文档化的溯源衰减——消费溯源的 Reviewer 必须容忍。
- 复制检测是打开时的启发式;原目录不可达(磁盘未挂载)时打开副本与移动不可区分,会保持原 id。v1 接受。
- S2 一片内触及全部 transcript 快照与导出路径;切片天然偏大,必须原子落地。
- workspace 标记是用户目录里可见的点文件表面;剥离点文件的工具会破坏身份(退化为新 id,数据在 harness home 完好)。
