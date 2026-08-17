# Agent Note：DSH Science v0.1 R1 Science Session on RC5

Status: implemented

[English](2026-08-15-dsh-science-v01-r1-science-session.md) | 中文

## 问题

在当时，已被接受的 DSH Science v0.1 基线只包含官方 RC5 加上治理与证据，没有任何 Science 产品代码。下游的 Science Session 实现（`omdsh-dev/dsh-science@e5e8b29b435f67e0a5dde5e2132580966e78b27b`）是与一场更广泛的 projection、持久化、查询与生命周期重构一起构建的。直接复制其分支或 cherry-pick 其 Phase 1 提交，会连带引入 R1 既不拥有也不需要的改动。

R1 需要一份可直接执行的 scope authority：既保留已接受的领域语义，又将其适配到 RC5 API；使第一个 Science 产品切片可独立评审；且不能把一次领域移植变成 Science Runtime、工具、preset、UI、Desktop、release 或上游版本迁移的工作。

## 决策

R1 把持久化的 Science Session 领域加入到 `packages/science/science-session`，再加上恢复该领域所必需的最小可选通用 projection 能力。本开发线此后已[迁移基线至 rc.7](../../proposed/process/2026-08-17-dsh-science-v01-rc7-rebaseline.md)；下文记录的 RC5 适配描述的是当时实际执行的移植过程，而非本开发线当前的上游基线。Session 日志仍是唯一的持久权威来源。该包不暴露任何公开的变更服务，不启动进程，不观测解释器，不注册任何模型工具或提示词，也不渲染任何客户端 UI。

`packages/science/science-session/src/*.ts`（17 个文件）与 `tests/*.ts`（11 个文件）中的每一个文件，都是 `omdsh-dev/dsh-science@e5e8b29` 的 `packages/science/science-session` 中对应文件的直接、未修改的副本，因为它们都不涉及下游 session-projection 重构中被排除的部分。有两个文件是经过适配而非直接复制的：`src/index.ts` 在其 `ctx.sessionProjections.register(...)` 调用中去掉了 `definitionToken` 字段，因为 RC5 的 `ProjectionDefinition` 并未声明该字段；`tsconfig.json` 的 TypeScript project `references` 是针对 RC5 实际的包布局重新推导而成（去掉了 `vendor/cosmokit`——RC5 的同级包并不依赖它）。`package.json` 与两份 README 都是从 RC5 同级包模板出发全新撰写——版本 `0.1.0-rc.5`、`publishConfig.access: public`、MIT、共用的 repository 字段——而非从下游的 `0.0.1-rc.2`／`restricted`／BSD-3-Clause 元数据复制而来。

`packages/session/session-projection/src/index.ts`（RC5 现有的单文件 `SessionProjectionRegistry`）新增了三个可选的 `ProjectionDefinition` 成员——`checkpointStateSchema`、`checkpointStateSeq`、`viewChanged`——恰好应用在五个集成点：checkpoint 创建、零 I/O checkpoint 视图、restore-floor 选择、冷恢复，以及实时通知。一个三者皆省略的 definition 会保留 RC5 原有的无条件行为；每一个既有的 session-projection 测试都原样通过。`definitionToken`、owner-aware 的 HMR 接管、callback containment、prototype-key hardening、下游的文件拆分，以及其持久化/查询/生命周期相关改动均未被移植——它们仍归属其既有的通用 owner，且并非在 RC5 上服务 Science definition 所必需。

[R0 closure 记录](../../../../docs/evidence/2026-08-15-dsh-science-v01-r0-rc5-baseline-closure.md) 拥有本笔记所构建于其上的、已接受的基线身份。[通用 session-projection 提案](../../proposed/architecture/2026-07-27-session-projection-and-command-log.md)、[session log 版本决策](../architecture/2026-08-10-session-log-version-mechanism.md) 与 [session end-seed 决策](../architecture/2026-07-30-session-end-seed-log-boundary.md) 仍是本笔记所在包所消费的那些机制的通用 owner；本笔记只拥有 Science 消费方及其受限的 RC5 registry 前置条件。

### Science Session 行为

该包拥有 `science/mode-bound`、`science/environment-bound`、`science/run-started`、`science/run-finished`、`science/chart-saved`、`science/outcome-published`。每个 payload 都是 `version: 1`、无损 JSON、携带完整的领域值而非补丁，且 required on read。生成的 `KNOWN_SESSION_EVENT_TYPES` 列表通过 `gen-persistence-catalog` 包含全部六个；没有任何 Science 事件被标记为 `ignorable`。

`science/mode-bound` 只能对 `agentPreset` 为 `science` 的 Session 合法绑定一次，且必须早于该 Science preset 的首个 request、step 或 tool-call 事实。严格 fold 会拒绝不连续的序列、格式错误的值、非法转移、逆向来源证明、被复用或已 settle 的 tool call、非单调的 revision 或时间，以及外来证据。invariant 在提交前应用同一条 Session-header 适用性规则与同一严格 fold，因此被拒绝的候选事件不会向日志追加任何内容。

环境、运行、图表与 Outcome 类型作为持久化词汇存在，即便其生产方仍在范围之外。只有 `session/end-seed` 才会为一个未匹配的运行中 run 派生 `interrupted`；不会追加任何合成的 Science 终态事件。Outcome 与 Goal 保持独立：两个领域互不读取、写入、完成或引用对方。

可选的 `science` projection 在该包未被组合时缺席，在有效 mode 绑定之前为 `null`。它的公开值只包含紧凑的已重放元数据与计数器；代码、stdout、stderr、图表字节、凭据与 Host 绝对路径附件均不会进入其中。严格 fold 仍是唯一的转移权威，且对每一份被接受的日志，实时 projection 都等于冷重放结果。

私有 projection 状态是 `stateVersion: 2` 的纯 JSON：一个已观测事件水位线、一个经编码的 fold，以及一个稀疏的脱敏见证（witness）。只有当 Science checkpoint schema 能把该 witness 重放为与之编码一致的 fold、且嵌入的水位线与 checkpoint 行的外层 `seq` 一致时，持久化状态才会被 admit。支持性事件可以推进私有水位线而不改变公开的 Science 值；这类推进不会发出重复的公开 projection 通知。

### 范围

| 方向 | Delta | 结果 |
|---|---|---|
| IN | `SCI-SESSION` | `packages/science/science-session/**`：branded ID、六个 required-on-read 的 Science 事件、严格解码器与 fold、适用性策略、invariant 配套项、增量 projection、checkpoint admission、重放、包文档，以及归属测试 |
| IN | 最小化的 `GEN-SESSION-REGISTRY` | 在 RC5 既有的 `session-projection` 实现中新增可选的私有 checkpoint 状态校验、私有状态到行水位线的校验，以及公开视图变更检测，附带通用测试与文档 |
| IN | 机械集成 | `packages/science/` 分组文档、RC5 对齐的包元数据与版本、TypeScript project references、workspace lockfile 条目、`SENTENCE_MODEL_EXPERIENCE` 白名单条目，以及仓库门禁所需的生成型 known-event/catalog/doc-graph 产物 |
| OUT | 后续 Science 切片 | Science Runtime、R-probe、runtime-context 修复、只读文件系统入口、Science 工具、preset、图表或 Outcome consumer、设置、侧边栏、客户端 UI 与 Desktop |
| OUT | 宽泛的通用重构 | definition-token/HMR owner 仲裁、callback-containment 改动、源文件拆分、持久化 revision 或 retirement 改动、projection-cache 持久化重设计、query/API/UI 改动，以及 `66becdb...` 或 `e5e8b29...` 中的其他一切无关路径 |
| OUT | 分发与迁移 | provider 调用、真实 Python/R、浏览器或 Desktop 验收、安装器、签名、npm 发布、tag、release、Git push、PR、RC6 采纳，或迁移到最新上游 |

## 已考虑的替代方案

**Cherry-pick Phase 1 提交。** 已拒绝，因为 `66becdb...` 把 Science 收尾与广泛的通用持久化、查询、API、生命周期与文档改动混在一起。提交身份只是溯源，并非 RC5 上可直接应用的补丁边界。

**复制 Science 包但不做 checkpoint admission。** 已拒绝，因为这样 RC5 会在不证明其 witness、fold 或嵌入水位线的情况下接受一行版本匹配的私有缓存行。一条被破坏或被拼接的捷径路径便可能供出一个严格重放本该拒绝的值。

**移植下游完整的 projection 重构。** 已拒绝，因为 owner-aware 的 HMR 仲裁、callback containment、文件拆分、持久化 revision 与查询改动都是独立的通用工作。R1 只需要三个能保留既有 RC5 definition 行为的可选能力。

**等 Science Runtime 就绪后再加入该领域。** 已拒绝，因为 Runtime 必须通过一套已接受的 Session 词汇与 invariant 来追加持久化事实。若颠倒这一依赖顺序，会让执行行为反过来定义自己的记录语义。

**先迁移到最新官方版本。** 已拒绝，因为 v0.1 已被固定在 RC5 上。迁移到最新官方源码只会在第一个完整版本之后进行，并作为独立的程序重放已接受的 overlay 各行。

## 取代关系与生命周期

本笔记不取代通用的 session-projection、session-log-version、session-end-seed、持久化或 Goal 相关决策。它们仍然生效，因为其通用理由与保证仍在治理其他消费方。

已完成的 [R0 scope 记录](../../archived/process/2026-08-15-dsh-science-v01-r0-release-baseline-scope.md) 已被归档；R0 closure 证据接管了它曾经治理的那些已接受身份与结果。

## 后果

R1 为 Science overlay 提供了一个可独立评审的领域切片：拥有严格确定性的 fold，以及不会在错误水位线下被拼接的 checkpoint admission；其代价是一份目前尚无生产方的持久化词汇——仍需先构建 Science Runtime 及其工具 Consumer，才能有任何真实的 Python/R 执行来追加这些事件。Required-on-read 的 Science 事件会使包含它们的会话对不认识这六种事件类型的构建版本不可读；这是刻意为之（领域真相优先于兼容性），把它们标为 `ignorable` 并不能削弱这一点。

`packages/session/session-projection/src/index.ts` 现在是 Science 领域的一个共享通用依赖，而不再是 Science 专属文件。它的三个可选成员被每一个既有消费方的回归测试套件（`session-projection-cache`、JSONL、SQLite、`session-query`、`session-query-sqlite`；共 497 个测试，未作修改）以及 27 个 session-projection 专属测试加 43 个 Science 专属测试（共 70 个）行使到；两个包 `src/` 合计的语句/分支/函数/行覆盖率均为 100%。未来对 `ProjectionDefinition` 的任何改动，都必须为每一个省略这三个可选成员的注册方保留这份兼容性约定。

真实 provider/模型调用、真实 Python/R、Desktop、打包安装器、签名、发布与 release 仍为 `NOT-RUN`：本切片未新增任何面向模型的 Consumer，也没有已组装的 Science 组合，因此这些证据层级尚不适用。下一项实现是 Science Runtime：把 `ctx.scienceRuntime` 与一个 host-local 的 `ctx.subprocess`、一个完整的 `ctx.sandbox`，以及本笔记的 Session invariant 组合起来。
