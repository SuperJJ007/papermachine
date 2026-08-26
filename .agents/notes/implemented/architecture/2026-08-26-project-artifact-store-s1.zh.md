# Agent Note: Project artifact store — S1 store package

Status: implemented

[English](2026-08-26-project-artifact-store-s1.md) | 中文

## Problem

[Project 级 artifact store 设计](../../proposed/architecture/2026-08-25-project-artifact-store.zh.md)(S0)规定了一套 Project 拥有的 artifact 注册表,取代 session 级 attachment 存储,分 S1–S3 三个切片交付。S1 是存储本体:工作区身份注册表,以及 SQLite 索引加内容寻址 blob 存储——在任何产品包接入之前即可独立使用。S2(session 事件瘦身、捕获、`get_science_state` 重建)与 S3(跨 session 读取/引用/追加、Files projection、重启续接)尚未构建;S0 note 在它们交付前保持 `proposed` 状态。

## Decision

`@deepseek-ai/dsh-science-artifact-store`(`packages/science/science-artifact-store`)完整实现了 S0 规定的 Project 身份、存储布局、Artifact/Version 记录、并发追加线性化与删除边界。它是一个独立的 Cordis service,目前没有任何消费者:science-session、science-runtime 与 tool-science 均不受本切片影响。

分支 id(`ProjectId`、`ArtifactId`、`VersionId`)由本包自行拥有,而不是复用 `science-session` 现有的 `ScienceArtifactId` 词汇——本存储是一个更底层的包,science-session 与 science-runtime 将在 S2 依赖它,而非反过来,因此本包不能反向依赖两者中的任何一个。[S2](2026-08-26-project-artifact-store-s2.zh.md) 把这两套 id 空间归并了起来:让 `science-session` 用自己的命名重新导出这些分支 id,并删除了它此前的 `ScienceArtifactId` brand。

除 `openProject` 外的每个公开方法都直接接收 `projectId`,并且是自给自足的:它会打开(或复用已缓存的)该 Project 的 SQLite 连接,不要求同一进程内先调用过 `openProject`。这正是 Host 重启后、或已知某个 project id 的第二个 session 能够立即续接工作的原因,对应 S0 中 S3 的验收标准,且不会迫使 S3 再新增一条访问路径。

并发控制使用 `node:sqlite` 的 `DatabaseSync`,配置了 `sqlite3_busy_timeout()`,并在"读取 latest → 插入新 version → 更新 latest"这一序列外包一层 `BEGIN IMMEDIATE`:第二个写入者会在 `busyTimeoutMs` 内阻塞重试,而不是直接失败,因此两个操作系统进程并发追加同一 artifact 时能正确串行化,后提交者成为 latest。这一点由一个真实多进程测试(`tests/concurrent-append.spec.ts`)验证:该测试对同一磁盘上的存储实际启动两个 `node --import tsx/esm` 子进程,并断言得到的是一条线性、未分叉的链。

包 README 记录了完整的公开契约(Project 身份解析规则、存储布局、Artifact/Version 字段、线性化、删除边界、Config);本 note 不重复这些内容。

## Alternatives considered

**复用 `science-session` 的 `ScienceArtifactId`** —— 本切片拒绝:它命名的是 S2 将要重新设计的旧内嵌 attachment 模型,而且引入该依赖会颠倒预期的分层关系(store 应在 science-session 之下,而非之上)。

**通过共享的 `dsh-storage` KV hub 路由**,而非为每个 Project 单独开一个 SQLite 文件——依据[domain KV storage Agent Note](../../proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.zh.md)中的调研结论拒绝:该 hub 是每种 backend 共享一份介质,而本存储是每个 Project 目录一份 SQLite 文件,形态上更接近 `science-runtime` 的按 session scratch 目录,而非该 hub 的场景。

**完整 fsync 持久化的 blob 写入**(仿照 `attachment-local` 的硬链接加目录 fsync 发布路径)——在 S1 阶段拒绝为不成比例的做法:S0 note 明确指定"先写临时文件再 rename",而内容寻址下对已存在目标的 rename 覆盖本身已经按哈希天然幂等,无需额外的持久化机制;若实践中出现持久化缺口,再重新评估。

另见 [S0 note](../../proposed/architecture/2026-08-25-project-artifact-store.zh.md) 自身的 Alternatives considered 一节,本切片不再重复。

## Consequences

S1 交付了一个测试完整、文档齐全的独立包,但尚无任何产品可见效果——没有任何工具、事件或 UI 引用它。S2 必须补上 Cordis 注入、把 `science/artifact-saved` 重设计为引用形式,并统一 id 词汇;S3 必须补上跨 session 读取/引用/追加的接线与 Files projection。二者的范围均与 S0 描述完全一致。

本存储自身测试直接验证了两处刻意保留的简化:blob 写入不会回收孤儿数据(某次 append 写入了 blob,但目标 artifact 校验随后失败);工作区身份比较的是字面 `resolve()` 路径而非 `realpath()`,因此两条指向同一目录的符号链接路径不会被识别为同一工作区。两者均记录在包 README 的 Known Limitations 中。
