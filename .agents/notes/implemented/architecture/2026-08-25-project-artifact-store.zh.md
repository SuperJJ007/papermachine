# Agent Note: Project-level artifact store

Status: implemented

[English](2026-08-25-project-artifact-store.md) | 中文

## 问题

Science artifact 曾经是单个 session 日志的投影:`science/artifact-saved` 内嵌完整附件引用,字节存在 session 作用域的附件存储里,删除 session 就删掉了它产出的全部 artifact。Claude Science 的模型——2026-08-25 对产品调研得到的十一条 project/session 机制 spec,被引用条目均在下文内联重述——让 artifact 归 project 所有:session 只是 producer、consumer 和 provenance,从不拥有 artifact,因此同一 project 的第二个 session 可以读取、引用并追加第一个 session 创建的 artifact,artifact 也在 session 删除后存续。本 note 是 [S1](2026-08-26-project-artifact-store-s1.zh.md)、[S2](2026-08-26-project-artifact-store-s2.zh.md) 与 [S3](2026-08-26-project-artifact-store-s3.zh.md) 所实现的设计,对应 v1 落实该 spec 的第 1/2/5/6/10 条;每个切片 note 拥有自己交付的细节、替代方案与后果,本 note 不重复。

## 决定

**Project 身份。** Project 就是一个 workspace 目录。其身份由标记文件 `<workspace>/.papermachine/project.json` 承载,内含生成的 branded `projectId` 与 `createdAt`;未标记 workspace 里的第一个 Science session 负责创建它。标记随目录走,因此移动或改名 workspace 不换 id。harness home 为每个 project 保存一个 store 目录(见下);store 自身的 `project.json` 记录最近已知的 workspace 路径并在打开时刷新,store 树本身即注册表——不设独立的全局索引文件。打开时的复制检测:当 store 记录的路径仍存在、与本次打开路径不同、且仍带有相同 id 的标记时,本次打开的目录是副本——为其铸造新 id 并重写标记;移动(旧路径消失或无标记)保持原 id。

**Store 布局。** artifact 的权威数据位于 `~/.papermachine/projects/<projectId>/`(harness home,绝不在 workspace 内):`project.json`(身份 + 最近已知路径)、`store.sqlite`(索引,按 pre-release 立场使用单调 `SCHEMA_VERSION`——旧 schema 直接拒绝,不做迁移)、`blobs/sha256/<hh>/<hash>`(内容寻址的原样字节,temp-then-rename 写入,按哈希幂等准入)。

**Artifact 与 Version 记录**(spec 第 2 条)。Artifact 行:`artifactId`(branded、生成)、`owningProjectId`、`originSessionId`、`logicalName`、`latestVersionId`、`createdAt`。Version 行:`versionId`、`artifactId`、artifact 内连续的 `ordinal`、`parentVersionId`(可空;可指向另一 artifact 的版本,保留今天 `editBaselines` 的跨 artifact 派生)、`sha256`、`mediaType`、`byteCount`、`origin`(`auto` | `model` | `human-edit`)、`title`/`caption`、producer 溯源(`sessionId`,run 产出的 origin 另有 `runId`/`toolCallId`/`requestHeaderSeq`,以及 session 事件已携带的环境 revision 与指纹预览)、`createdAt`。策展(`annotate_artifact`)仍是对其命名版本的元数据更新——title/caption/origin 原地变更,字节与 ordinal 永不变。

**Session 日志与 store 的分工。** model-visible ⟺ logged 规则在双权威下的重述:session 日志记录*事件与引用*——`science/artifact-saved` 从内嵌附件瘦身为 `{artifactId, versionId, ordinal, sha256, mediaType, origin, parent, title, caption}`——store 拥有*字节与跨 session 索引*。模型见过的一切仍可由日志 + store 重建:事件按校验和锁定内容,store 负责解析。严格 fold 仍只对日志确定性:同 session 引用照旧在 fold 内校验(连续性、parent 血缘、溯源);该 session 自身 fold 完全没有本地记录的跨 session 引用会被信任,而不是重新独立推导——因为实时 Runtime 已经在产出事件提交*之前*对 store 做过校验(Host 侧 pre-commit invariant 会查 store;replay 从不查)——S3 把这一点落实到了自动捕获接续与 `artifact_inputs`,但(尚)不包括 `editBaselines`/parent 血缘,后者仍只限同一 session(见 S3 note)。跨 project 引用仍完全在范围之外,遵循上文 v1 spec 条目的延后决定。Session 导出的附件抽取按校验和改指向 project store。

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

## 后果

三个切片均已按设计交付:[S1](2026-08-26-project-artifact-store-s1.zh.md)(store 包本体:身份、布局、线性化追加、删除边界)、[S2](2026-08-26-project-artifact-store-s2.zh.md)(运行时接线:捕获、策展、run input、edit service、事件瘦身)、[S3](2026-08-26-project-artifact-store-s3.zh.md)(跨 session 接续:同 project 的第二个 session 读取、通过 `artifact_inputs` 引用,并追加另一个 session 创建的 artifact;同一 project store 行始终显示该 artifact 的 latest 版本,无论由哪个 session 产出;Host 重启后仍会针对同一磁盘 store 继续这条链)。每个 note 各自拥有自己的验证、偏差与剩余范围。

仍然成立的已接受权衡:session 删除后 producer `sessionId` 悬空,是接受并文档化的溯源衰减,消费溯源的 Reviewer 必须容忍;复制检测是打开时的启发式,原目录不可达(磁盘未挂载)时打开副本与移动不可区分,会保持原 id;workspace 标记是用户目录里可见的点文件表面,剥离点文件的工具会破坏身份(退化为新 id,数据在 harness home 完好);S3 的跨 session 信任只延伸到严格高于该 session 自身对所引用 artifactId 已记录本地最高版本的版本(这既包括、也不限于该 session 自身 log 从未记录过的 artifactId)——一个等于或低于该本地最高版本、又与某个本地记录不完全匹配的引用仍会被拒绝。`editBaselines`/跨 session parent 血缘、浏览器端 artifact 读取、把 Files 做成 project 级 UI 表面,以及跨 project 引用,均仍在本 note 范围之外(留给 S4/S5 及后续工作)。
