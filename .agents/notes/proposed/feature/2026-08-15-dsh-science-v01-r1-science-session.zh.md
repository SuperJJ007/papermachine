# Agent Note: DSH Science v0.1 R1 基于 RC5 的 Science Session

Status: proposed

[English](2026-08-15-dsh-science-v01-r1-science-session.md) | 中文

## Problem

已验收的 DSH Science v0.1 基线包含官方 RC5、治理内容和证据，但不包含任何 Science 产品代码。`omdsh-dev/dsh-science@e5e8b29b435f67e0a5dde5e2132580966e78b27b` 中的下游 Science Session 实现与更大范围的 projection、persistence、query 和 lifecycle 重构共同构建。复制其分支或 cherry-pick Phase 1 提交会带入 R1 既不负责也不需要的变更。

R1 需要一份可直接执行的 scope authority，在适配 RC5 API 的同时保留已验收的领域语义。它必须让第一个 Science 产品切片能够独立审查，且不得把领域移植扩大为 Science Runtime、tools、preset、UI、Desktop、release 或 upstream 版本工作。

## Proposal

R1 在已验收 RC5 谱系上增加 durable Science Session 域，并只增加安全恢复该领域所需的可选通用 projection 行为。Session log 仍是唯一 durable authority。R1 不暴露公共 mutation service，不启动进程，不观察解释器，不注册模型工具或 prompt，也不渲染客户端 UI。

[R0 closure 记录](../../../../docs/evidence/2026-08-15-dsh-science-v01-r0-rc5-baseline-closure.md)负责已完成的基线身份。[通用 session-projection proposal](../architecture/2026-07-27-session-projection-and-command-log.md)、[session log version decision](../../implemented/architecture/2026-08-10-session-log-version-mechanism.md)与[session end-seed decision](../../implemented/architecture/2026-07-30-session-end-seed-log-boundary.md)仍是通用 owner；本 Note 只固定 Science consumer 及其有界 RC5 前置项。

### Exact identities

| 对象 | 身份 | R1 用途 |
|---|---|---|
| 官方 RC5 源码 | `deepseek-ai/deepseek-harness@47f943859bef60e4160492346772ded9b24f765a`，版本 `0.1.0-rc.5` | 不可变 upstream 产品基线 |
| 已验收 R0B head | `omdsh-dev/dsh-science@f9bb7b4a91afe1cf69568184ff093fa9a8bd52f9` | 必须作为产品祖先；不得 rebase 到其他历史 |
| Science 源码快照 | `omdsh-dev/dsh-science@e5e8b29b435f67e0a5dde5e2132580966e78b27b` | 只读语义与文件来源 |
| Science 实现历史 | `26b3d5013c1fc216ab8ee13d7bec903183cfdf90` 至 Phase 1 closure `66becdbd97a8284ed3b226686840d19a1e436284`；后续 `2386ad5d675141495777f5753b6911cd27608302` 在该包中只修改共享 Science fixture | 历史线索；绝不是 cherry-pick range 或可继承 PASS |
| R1 实施基点 | 包含本 triplet 与 R0 归档变更的 accepted commit，以 `f9bb7b4a91afe1cf69568184ff093fa9a8bd52f9` 为祖先，且两者之间只有 documentation/governance 路径 | 第一个 R1 产品提交的 parent；在 R1 closure evidence 中记录其精确 SHA |

RC6、已观察 npm artifact、后续官方源码、Phase 3 candidate `fae091e1080e830bed8ad0456e4cbced29101b01` 以及所有 dirty worktree 都不是 R1 source identity。

### Entry conditions

| 条件 | 必需证据 | Hard stop |
|---|---|---|
| 干净实施 worktree | 从包含本 Note 的 accepted commit 新建 branch/worktree；产品编辑前 `git status --porcelain=v1 --untracked-files=all` 为空 | 将复用或清理任何既有 worktree 状态、staged 内容或 untracked 内容 |
| RC5 ancestry | `git merge-base --is-ancestor f9bb7b4a91afe1cf69568184ff093fa9a8bd52f9 HEAD` 成功；从该 SHA 到产品编辑前 HEAD 的 diff 只包含已接受的 R0 retirement 与 R1 plan 路径 | 产品基线、parent 或仅文档前置项不一致 |
| 只读来源 | 本地可解析 exact `e5e8b29...` tree 与列出的历史提交；其 worktree 保持不变 | 无法解析来源身份，或必须编辑来源 worktree |
| 受支持工具链 | Node 满足 `^22.19.0 || >=24.0.0`；pnpm 为 `11.7.0`；baseline frozen install 可用 | 依赖或工具链 workaround 将改变产品设计 |
| 受保护状态 | 实施前记录现有 main、R0A、R0B、governance、Phase 3、R-probe、task 与 Grok worktrees | R1 将 reset、clean、repoint、stage 或吸收任何受保护状态 |

不得 rebase、merge 或 cherry-pick 下游历史。应针对 RC5 逐项移植或重写已接受 delta，并在 R1 evidence inventory 中保留精确 source path provenance。

### Scope

| 方向 | Delta | 允许结果 |
|---|---|---|
| IN | `SCI-SESSION` | 新增 `packages/science/science-session/**`：branded IDs、六种 required-on-read Science events、strict decoders 与 fold、applicability policy、invariant companion、incremental projection、checkpoint admission、replay、package documentation 和 owning tests |
| IN | 最小 `GEN-SESSION-REGISTRY` | 在现有 RC5 `session-projection` 实现中增加可选 private checkpoint-state validation、可选 private-state-to-row watermark validation 与可选 public-view change detection，并附通用 tests 和 documentation |
| IN | 机械集成 | `packages/science/` group documentation、与 RC5 对齐的 package metadata/version、TypeScript aggregates/paths、workspace lockfile importer、invariant/model-experience allowlists、generated known-event/documentation artifacts，以及仓库门禁要求的 type-equivalence registrations |
| IN | 验收记录 | Exact candidate 通过 review/checks 后，本 Agent Note lifecycle update 与一组 dated R1 closure evidence triplet |
| OUT | 后续 Science 切片 | Science Runtime、R-probe、runtime-context repair、read-only filesystem entry、Science tools、preset、charts 或 Outcome consumers、settings、sidebar、Client UI 与 Desktop |
| OUT | 大范围通用重构 | Definition-token/HMR owner arbitration、callback-containment changes、source file splitting、persistence revision 或 retirement changes、projection-cache durability redesign、query/API/UI changes、`lastActivityTime`，以及 `66becdb...` 或 `e5e8b29...` 中所有无关路径 |
| OUT | 发行与迁移 | Provider calls、真实 Python/R、browser 或 Desktop acceptance、installer、signing、npm publication、tag、release、Git push、PR、采用 RC6 或迁移到最新 upstream |

### Science Session behavior

本包负责 `science/mode-bound`、`science/environment-bound`、`science/run-started`、`science/run-finished`、`science/chart-saved` 与 `science/outcome-published`。每个 payload 均包含 `version: 1`，是 lossless JSON，携带完整 domain value 而非 patch，并且 required on read。Generated `KNOWN_SESSION_EVENT_TYPES` 通过 `gen-persistence-catalog` 纳入全部六种事件；任何 Science event 都不得标记为 `ignorable`。

`science/mode-bound` 只能出现一次，只适用于 `agentPreset` 为 `science` 的 Session，并且必须早于第一个 Science-preset request、step 或 tool-call fact。Strict fold 拒绝不连续序列、malformed values、invalid transitions、forward provenance、复用或已 settled tool calls、非单调 revision/time 与 foreign evidence。Invariant 在 commit 前应用 Session-header applicability rule 与同一个 strict fold，因此拒绝不会追加任何内容。

Environment、run、chart 与 Outcome types 作为 durable vocabulary 存在，即使其 producers 仍属于 OUT scope。只有 `session/end-seed` 会为 unmatched running run 派生 `interrupted`；不会追加 synthetic Science terminal event。Outcome 与 Goal 相互独立：任一领域都不得读取、写入、完成或引用另一个领域。

未组合本包时，可选 `science` projection key 不存在；在有效 mode binding 前，其值为 `null`。Public value 只包含紧凑的 replayed metadata 与 counters；code、stdout、stderr、chart bytes、credentials 与 host-absolute attachment paths 永不进入其中。Strict fold 仍是唯一 transition authority，且每个 admitted log 的 live projection 必须等于 cold replay。

Private projection state 保持 plain JSON，使用 `stateVersion: 2`，并包含 observed event watermark、encoded fold 与 sparse redacted witness。Persisted state 只有在 Science checkpoint schema 可将 witness replay 为 encoded fold，且 embedded watermark 等于 checkpoint row 的 outer `seq` 时才可采用。Supporting events 可以推进 private watermark 而不改变 public Science value；此类推进不得发出重复 public projection notification。

### RC5 adaptation

保留 RC5 的 `packages/session/session-projection/src/index.ts` 布局。在其现有 `ProjectionDefinition` 中增加可选 `checkpointStateSchema`、`checkpointStateSeq` 与 `viewChanged` 成员；在 checkpoint creation、zero-I/O checkpoint view、restore-floor selection、cold restore 与 live notification 中一致应用。未提供这些成员的 definitions 保持 RC5 行为。Invalid 或 transformed checkpoint state 被丢弃并要求 full-log refold；embedded/outer watermark mismatch 在 checkpoint emission 与 admission 两侧都必须拒绝。

不得移植 `definitionToken`、owner-aware HMR takeover、callback containment、prototype-key hardening、下游 file split 或其 persistence/query/lifecycle changes。这些变更并非 RC5 上 Science definition 的必要条件，仍由其通用 owner 负责。若 focused failing test 证明其中一项必需，这代表 scope 变化，并不构成导入下游 commit 的授权。

Science package root 应适配 RC5 definition，并省略上述三个可选能力以外的 downstream-only registration members。Package manifest 从 RC5 sibling packages 派生：使用版本 `0.1.0-rc.5`、`publishConfig.access: public`、sibling repository field 和 RC5 dependency versions。Manifest metadata 不构成 publication 授权。不得复制下游 package 的 `0.0.1-rc.2` 或 `publishConfig.access: restricted` metadata。

`packages/core/session/src/known-event-types.ts` 是 generated output。先增加 Science declaration merging，再运行 owning generator，并审查生成的 event list。不得手工编辑 generated file。现有 persistence、projection-cache 与 query implementations 应保持 source-identical，除非针对上述三个 optional registry capabilities 的命名 R1 acceptance test 失败；任何超出所列通用 owner 的必需代码变更，都必须先修订本 Note 才能继续实施。

### Expected impact

| 区域 | 预计路径 | 规则 |
|---|---|---|
| Science domain | `packages/science/science-session/**`、`packages/science/README.{md,zh.md,i18n.yaml}` | 移植 domain semantics，只为 RC5 APIs 重写，并由 package/invariant tests 自行负责 |
| 通用前置项 | `packages/session/session-projection/src/index.ts`、其 tests 与 README pair，以及 `docs/subsystems/session-projection.*` | 只增加三个 optional capabilities；保留现有 consumers |
| Package integration | `packages/README.*`、`tsconfig.base.json`、`tsconfig.host.json`、`pnpm-lock.yaml` 及最小必要 script manifests/allowlists | 每项变更都必须是新 package 的机械证据 |
| Generated references | `packages/core/session/src/known-event-types.ts`、persistence/module graphs、subsystem indexes 与 generators 命名的其他 outputs | 从 owner 重新生成；不得直接编辑 generated English sources |
| Decision and evidence | 本 triplet、当 declared interface 变化时仍 active 的 generic projection note，以及一组 dated R1 closure evidence triplet | 稳定 rationale 放入 Agent Notes；dated SHA/command results 放入 evidence |

实施必须用 `pnpm --silent run change-scope --base <R1-plan-base> --head HEAD` 记录 final path list。超出这些类别的 changed path 是 hard stop，除非 owning generator 明确生成该路径，或在代码变更前修订本 Note。

### Implementation stages

1. 记录 exact implementation base、protected-worktree state、supported toolchain、source identities 与 empty product diff。建立从 `e5e8b29...` Science package 到 RC5 的逐文件 mapping；在每项 dependency 与 generated owner 完成分类前不得复制文件。
2. 原位增加三个 optional generic projection capabilities，并补充 focused invalid-state、watermark、unchanged-public-view、restore 与 existing-consumer regression tests。将其保留为可独立审查的 generic prerequisite commit。
3. 增加 RC5-aligned Science package、strict domain/invariant behavior、projection registration、package metadata、group docs、focused tests 与机械 generator outputs。不得把它组合进 shipped preset 或 application。
4. 运行 verification matrix，检查 complete diff，并在 exact candidate SHA 上取得 fresh independent review。任何修复都会产生新 candidate SHA，并重新运行受影响 checks 与 review。
5. 验收后增加 dated closure evidence，把本 triplet 移到 `implemented/feature`，并改写为 present-tense `Decision` 与 `Consequences` sections。停在 Science Runtime 之前。

### Verification matrix

| 证据 | 必需命令或观测 | 限制 |
|---|---|---|
| Scope and ancestry | `git merge-base --is-ancestor f9bb7b4a91afe1cf69568184ff093fa9a8bd52f9 HEAD`；`pnpm --silent run change-scope --base <R1-plan-base> --head HEAD`；`git diff --check <R1-plan-base>..HEAD` | 只证明 ancestry、changed paths 与 whitespace |
| Science and registry behavior | `pnpm exec vitest run packages/science/science-session/tests packages/session/session-projection/tests` | 必须覆盖 strict fold、applicability、invariant rejection、live/cold replay、optional registration、HMR disposal、checkpoint admission 与 notification behavior |
| Focused per-file coverage | `pnpm exec vitest run --coverage --coverage.include='packages/science/science-session/src/**' --coverage.include='packages/session/session-projection/src/**' packages/science/science-session/tests packages/session/session-projection/tests` | 每个 included source file 达到 100%；不得降低 thresholds 或增加无理由 ignores |
| Existing durability consumers | 根据实际 generic diff 选择 focused `session-projection-cache`、JSONL、SQLite 与 session-query tests | 仅为 regression evidence；运行测试不代表允许移植代码 |
| Static and package checks | `pnpm run typecheck`；`pnpm run hygiene`；`pnpm run check:ci:artifacts` | Source、package、built export、publint、invariant 与 NodeNext evidence；不构成 installed application claim |
| Documentation | Focused translation re-records；`pnpm run doc-sync`；`pnpm run lint` | 除机械 PASS 外，还必须由人工审查 pair meaning |
| Exact candidate review | Fresh reviewer 接收 exact base/head、IN/OUT table、path inventory、test results 与 NOT-RUN list | 对其他 SHA 的 verdict 不是 acceptance evidence |

R1 不增加 model-facing Consumer 或 assembled Science composition，因此不要求 keyless 或 with-key model snapshots。真实 Python/R、provider calls、browser、Desktop、packed installer、signing、publication 与 release 仍为 `NOT-RUN`，且不得由本 matrix 推断。

## Alternatives considered

**Cherry-pick Phase 1 commits。** 拒绝，因为 `66becdb...` 将 Science closure 与大范围 generic persistence、query、API、lifecycle 和 documentation changes 混合。Commit identity 是 provenance，不是适用于 RC5 的 patch boundary。

**复制 Science package 但不增加 checkpoint admission。** 拒绝，因为 RC5 会采用 version-matching private cache row，却不证明其 witness、fold 或 embedded watermark。Corrupt 或 spliced shortcut 因而可能提供 strict replay 会拒绝的值。

**移植完整 downstream projection refactor。** 拒绝，因为 owner-aware HMR arbitration、callback containment、file splitting、durability revisions 与 query changes 都是独立 generic work。R1 只需要三个可选能力，并须保留既有 RC5 definitions。

**等待 Science Runtime 后再增加领域。** 拒绝，因为 Runtime 必须通过已验收 Session vocabulary 与 invariant 追加 durable facts。反转依赖会让 execution behavior 自行定义其 record semantics。

**先迁移到最新官方版本。** 拒绝，因为 v0.1 固定在 RC5。只有第一个完整版本完成后，才会把 accepted overlay rows 作为独立计划 replay 到当时的最新官方源码。

## Supersession and lifecycle

本 Note 不 supersede generic session-projection、session-log-version、session-end-seed、persistence 或 Goal decisions。它们继续保持 active，因为其通用 rationale 与 guarantees 仍约束其他 consumers。R1 实施只在三个 optional members 改变 declared interface 的位置更新 generic projection note，并反向链接 implemented R1 decision。

已完成的 [R0 scope record](../../archived/process/2026-08-15-dsh-science-v01-r0-release-baseline-scope.md)已归档，因为其一次性 baseline steps 全部 resolved，且 R0 closure evidence 负责 accepted identities 与 results。它保留为 frozen historical snapshot。本 proposed triplet 在 R1 implemented 或 rejected 前保持 active，且在 proposed 状态下永不归档。

## Acceptance criteria

- Accepted candidate 以已记录 R1 plan base 为祖先，且不存在 Runtime、tools、preset、UI、Desktop、release 或 latest-upstream path。
- 六种 Science event declarations 全部生成进 required-on-read vocabulary；不认识它们的 RC5 reader 必须拒绝 resulting log，而不能静默跳过。
- 对每个 accepted test log，strict replay、incremental projection、cold restore 与 checkpoint-backed restore 产生相同 public Science value；malformed streams 与 invalid cache rows 按规定失败或 refold。
- Invariant 在 append 前拒绝 invalid Science facts，同时 Standard sessions 与未提供 optional projection registry 的 hosts 保持既有行为。
- 每个 changed Science 与 generic projection source file 都达到 focused per-file 100% coverage，且必需 static、package、artifact、documentation 与 exact-SHA review checks 通过。
- Dated closure record 分离 source/unit、generated、built-package 与 NOT-RUN evidence，并为每个 final delta 列出 source SHA 与 owner。
- Final Agent Note 为 implemented，worktree 干净，protected worktrees 未变化，唯一下一项实现是基于 accepted R1 head 的 Science Runtime。

## Risks

- Downstream package 包含面向未来 producers 的 durable vocabulary，但当前没有 producer。Strict applicability 与不存在 mutation service 可防止 R1 伪造 runtime evidence，但 reviewer 必须继续把 consumer code 排除在该切片之外。
- Sparse witnesses 仍会随 retained provenance 增长。R1 不作 constant-time 或 bounded-history 声明；优化必须等待 measured need，且不得削弱 replay equivalence。
- Optional checkpoint admission 会修改 generic published package。未提供新成员的现有 definitions 必须保持 RC5 行为，并由 focused consumer tests 证明 compatibility。
- Required-on-read Science events 会刻意使 older builds 无法读取这些 sessions。为提高 compatibility 而把它们标记为 ignorable 会静默删除领域事实，因此被禁止。
- Generated 与 package-integration paths 可能掩盖 scope growth。每个此类路径都必须追溯到 owning generator 或 manifest requirement；否则实施必须停止并修订计划。
