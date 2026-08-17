# Agent Note: DSH Science v0.1 R2 基于 RC5 的 Science Runtime

Status: implemented

[English](2026-08-15-dsh-science-v01-r2-science-runtime.md) | 中文

## 问题

在当时，已验收的 DSH Science v0.1 谱系包含官方 RC5 发行基线与 R1 Science Session 域，但还没有 `science/environment-bound`、`science/run-started` 或 `science/run-finished` 的 producer。`omdsh-dev/dsh-science@e5e8b29b435f67e0a5dde5e2132580966e78b27b` 中的下游 Runtime 与 RC5 不具备的四项通用 subprocess 和 sandbox 扩展共同构建。其实现提交还混合了 package code、既有 Consumer migration、generated documentation 与无关的 repository repair。因此，复制下游分支或 cherry-pick 这些提交会导入 Runtime owner scope 之外的工作。

R2 需要一份可执行的 RC5 计划：增加 host-local Science Runtime，但不提前引入 model-facing tools 或 shipped Science composition。该计划必须把 process ownership 保留在现有 subprocess 与 sandbox capabilities 中，按要求顺序执行 durable Session mutation，保留每个既有 Consumer 的 RC5 行为，并将 fake-prefix source proof 与真实 Python/R acceptance 分开。

## 决策

R2 在已验收 R1 谱系上增加 folded `@deepseek-ai/dsh-science-runtime` package。该 package 负责 `ctx.scienceRuntime`、现有 local Conda prefix 的 strict configuration、stable interpreter observation、exact-Session operation ownership、private Science scratch、direct Python/R argv construction、terminal classification，以及这些操作产生的 Session events。它组合 `ctx.sessions`、host-local `ctx.subprocess`、fully enforcing `ctx.sandbox`、已验收的 Science Session package 及其 invariant。它不注册 model tool、prompt、client projection、preset 或 shipped application row。

R2 首先只增加 Runtime 确实需要的 generic capabilities：显式 subprocess environment base、subprocess execution-world fact、retained-output UTF-8 validity，以及共享 sandbox runner/denial classification。既有 Consumers 显式声明其原有 RC5 选择并保持行为不变。只有这些前置项独立通过后，才落地 Runtime package。R version-probe correction 在 R2 内继续保持独立的 commit 与 evidence identity。

[R0 closure record](../../../../docs/evidence/2026-08-15-dsh-science-v01-r0-rc5-baseline-closure.md)负责 overlay identities 与 evidence classes。[R1 Science Session decision](2026-08-15-dsh-science-v01-r1-science-session.md)负责 Runtime operations 追加的 durable event semantics。[dated R2 evidence record](../../../../docs/evidence/2026-08-15-dsh-science-v01-r2-science-runtime.md)负责 volatile candidate SHAs、command outputs、host prefixes 与 reproduced baseline exceptions。Generic subprocess、sandbox、Session、timeout、home-path 与 invariant packages 继续负责其现有职责；R2 扩展这些 owner，而不在 Science 内实现 private substitutes。

### 精确身份

| 对象 | 身份 | R2 用途 |
|---|---|---|
| 官方 RC5 source | `deepseek-ai/deepseek-harness@47f943859bef60e4160492346772ded9b24f765a`，版本 `0.1.0-rc.5` | 不可变 upstream product baseline |
| 已验收 R1 head | `codex/science-v01-r1-science-session` 上的 `7e11de7e4beaf17dd87cf19368cfc930837dc77c` | R2 plan commit 的 required ancestor |
| Downstream Runtime source | `omdsh-dev/dsh-science@e5e8b29b435f67e0a5dde5e2132580966e78b27b`；`packages/science/science-runtime/**` | R-probe correction 之前，只读的 final Runtime semantics 与 file source |
| Downstream Runtime history | `bf4be838066576dc005822428e259673b049e048`、`2386ad5d675141495777f5753b6911cd27608302` 与 `390fbde6c1` | Initial implementation、hardening 与 cancellation-cleanup containment 的 provenance；绝不是 cherry-pick range |
| R version-probe correction | `b15f1ef42e92b72ad1b53412966408415f669a18`；只采用其 `Rscript --version` behavior、focused tests 与匹配的 Runtime prose | 独立 R2 code/evidence identity；排除其 Phase 3 parent 与无关 Runtime differences |
| R2 plan base | `codex/science-v01-r2-runtime-plan` 上的 `a1c9ba2a48c9ccc6895f821456a4d2942c6ebe2c` | 第一个 R2 implementation commit 的 parent；包含本 triplet 且没有 product change |

任何 downstream test result、review verdict、build output、real-machine report、Phase 3 candidate 或当前 `main` worktree state，都不是 RC5 port 的 acceptance evidence。每一项 final claim 都从 dated evidence record 所记录 SHA 上的 R2 tree 推导。

### 范围

| 方向 | Delta | 结果 |
|---|---|---|
| IN | `GEN-SUBPROCESS-RUNTIME-FACTS` | 必需的 `environmentBase`（`scrubbed-parent` 或 `empty`）、只读 `executionWorld`（`host-local` 或 `remote`），以及 `utf8Validity`（`valid`、`invalid` 或 `unknown`）；providers、既有 Consumers、mocks、tests 与所属 documentation 使 RC5 行为保持显式 |
| IN | `GEN-SANDBOX-CLASSIFICATION` | 共享的 runner-spawn、runner-fatal 与 denial classifiers 位于 `@deepseek-ai/dsh-sandbox`；Bash 与 Pwsh 调用这一实现，并保持 runner failure 优先于 denial |
| IN | `SCI-RUNTIME` | `packages/science/science-runtime/**`：folded service/local provider、strict configuration、stable prefix observation、exact-Session leases、owned scratch、direct execution、lifecycle settlement、invariant companion、package documentation、fake-prefix tests、Loader composition 与 opt-in real acceptance |
| IN | `SCI-R-PROBE` | 来自 `b15f1ef...` 的 standalone `Rscript --version`，以及 focused invalid-outcome/argv tests 与匹配的 Runtime prose |
| IN | Mechanical integration | 与 RC5 对齐的 package metadata、TypeScript paths/references、lockfile importer、package 与 capability documentation、model-experience/invariant registrations、imported-`configSchema` catalog walk，以及 owning generators 的输出 |
| IN | Closure evidence | 位于 `implemented/feature` 的本 triplet，以及一份记录实际 commands、results、identities、exceptions 与 `NOT-RUN` layers 的 dated R2 evidence triplet |
| OUT | Model-facing Science work | `GEN-RUNTIME-CONTEXT`、filesystem read-only entries、`tool-science`、tool schemas、prompt text、Science preset、snapshots、Web composition、charts、Outcome Consumers、settings、sidebar、Client UI 与 Desktop |
| OUT | Broader generic redesign | New process verbs、Science 内直接持有 `node:child_process`、shell command construction、generic sandbox-policy redesign、remote scratch protocols、confidentiality claims，或无关的 subprocess/sandbox refactors |
| OUT | Environment management and distribution | Conda discovery、create/clone/install/update/repair/delete、credentials、provider calls、installer、signing、notarization、publication、tag、release、Git push、PR、RC6 或 latest-upstream migration |

`2386ad5...` 中历史性的 `scripts/rescope-vendor.ts` 改动、root BSD-license prose 改动、Phase 3 files，以及上表各行未要求的其他改动，仍然排除在外。

### 必需的通用能力

`SubprocessSpawnSpec.environmentBase` 是必需的。既有 Consumers 使用 `'scrubbed-parent'`，从而保留 RC5 行为；Science 使用 `'empty'`，并且只提供其固定 allowlist。Local 与 E2B providers 在 `spec.env` 之前应用所选 base。Provider transport processes 可以保留自己已记录的 environment，但 target program 不得意外继承它。

`SubprocessRuntime.executionWorld` 报告 `'host-local'` 或 `'remote'`。Local subprocess 报告 `'host-local'`；E2B 报告 `'remote'`。Science 在创建 owner marker、scratch directory 或 Session event 之前拒绝 remote world。该 fact 不是通用 remote-provider identity protocol，也不复制 sandbox field。

`SubprocessOutputRead.utf8Validity` 描述所表示的精确 byte slice。保留或恢复这些 bytes 的 provider 报告 `valid` 或 `invalid`；仅当 provider 已解码文本但没有可恢复 bytes 时，才允许 `unknown`。既有 text Consumers 在其他方面保持其行为。Science 的 version 与 UTF-8 probes 要求无损的 offset-zero 读取，且 `utf8Validity === 'valid'`。

Runner-spawn、runner-fatal 与 denial classification 位于导出的 sandbox module。Bash、Pwsh 与 Science 调用该 module。被明确识别的 runner failure 表示 requested program 并未运行，因此优先于 denial signature；仅凭 exit status 永远不能证明其中任何一种结果。

config-catalog generator 会跟随同一 package 内导入的 `configSchema`，从而在不引入无关 generator 工作的情况下为 Runtime package 生成文档。

### Science Runtime 行为

该 folded package 暴露 `bindEnvironment({ session, profileId, signal })`、`startRun({ session, language, code, toolCallId, requestHeaderSeq, signal })`，以及只包含 `runId`、`done` 与幂等 `cancel()` 的 `ScienceRunHandle`。Public operation 与 result types 不含 PID、subprocess handle、Conda implementation type 或 host scratch path。后续 tool Consumer 调用这些 operations；它自身不得追加 Runtime 所拥有的 Science events。

空 profile map 是合法的显式未配置状态。每个已声明的 profile 命名已存在的绝对 Conda prefixes，并且至少包含一个 Python 或 R interpreter。独立的 `@deepseek-ai/dsh-science-runtime/with-settings` 入口注入 `settings`，并把 Cordis `profiles` map 当作 restart-scoped `science-runtime` namespace 的 composition `base`；它在 load 时对解析后的 map 做一次快照，因此一次 write 只影响下一次 Host start。根入口永不读取 settings。Runtime 永不调用 Conda，也不写入 configured prefix。它会规范化 prefix 与 executable，要求 prefix 内的常规 interpreter/history files，记录稳定的 before/after identity，对一次变化的 observation 重试一次，并发布诚实的 invalid 或 drifted binding，而不是制造稳定性。

Binding 与 run setup 共享非排队的 exact-Session reservation。同一 live Session 上的第二次 operation 返回 `RUNTIME_BUSY`。Detached lifecycle 会保留 same-ID quarantine，直到每一个 owned probe 与 process tree 都 quiescent，并且 cleanup 已经 settled。每次 append 都会再次检查 `ctx.sessions.get(session.id) === session`，因此旧对象不能写入 same-ID successor。

Environment binding 在追加一个完整的 `science/environment-bound` value 之前观察并限制 interpreter。一次 run 会写入并 sync 精确 source 与 run directory，追加 `science/run-started`，然后才 spawn。start 提交之后，ordinary program failure、timeout、cancellation、sandbox denial 与 runner failure 成为 terminal values，并且仅在 whole-tree quiescence 之后追加一条匹配的 `science/run-finished`。Detached Session 不会收到 terminal append；replay 从未匹配的 durable start 推导 `interrupted`。无法证明 quiescence 或无法提交 terminal fact 时，永不返回看起来已经 durably settled 的值。

每一次 probe 与 run 都使用 direct argv、`environmentBase: 'empty'`、owned cwd、固定 locale/timezone，以及完整的 `workspace-write` confinement。Python probes/runs 使用冻结的 isolated UTF-8 flags。R version discovery 使用 standalone `Rscript --version`；其 UTF-8 probe 与 runs 使用 `--vanilla --encoding=UTF-8`。Scratch 只位于已解析的 DSH home 之下，使用独占 owner markers 与 private modes，拒绝 symlinks 与 path overlap，并保留已接受的 run state，同时只删除当前 operation 所拥有的 unpublished setup。

Confinement 限制已记录的 file writes；它不声称 file-read、network、syscall 或 scientific-result isolation。在可用 sandbox 无法提供 full enforcement 的地方，Windows 保持 fail-closed。Source code、stdout、stderr、credentials 与绝对 scratch paths 永不进入 Science Session events 或 public Science projection。

### RC5 适配

Runtime package manifest 依据 RC5 同级 packages 重新推导：版本 `0.1.0-rc.5`、`publishConfig.access: public`、MIT、共享 repository field，以及 RC5 workspace dependency declarations。其 TypeScript references 依据 RC5 布局重新推导，并且不复制不必要的 `vendor/cosmokit` reference。下游的 `0.0.1-rc.2`、restricted publication 与 BSD metadata 均不存在。

| 区域 | 路径 | 规则 |
|---|---|---|
| Subprocess definition/providers | `packages/subprocess/subprocess/**`、`packages/subprocess/subprocess-local/**`、`packages/e2b/subprocess-e2b/**` | 只增加这三项已声明 facts，以及兑现它们所需的 provider behavior |
| 既有 subprocess Consumers | `packages/shell/bash-local/**`、`packages/shell/pwsh-local/**`、`packages/fs/tool-fs-search/**`、`packages/lsp/lsp-stdio/**`、`packages/subagent/subagent-acp/**`、`packages/subagent/subagent-claude-code/**`、`packages/subagent/subagent-codex/**`、terminal tests 与精确 E2B fixtures | 声明原先的 scrubbed-parent 行为，并补齐新的 required mock facts；Consumer semantics 不变 |
| Sandbox classification | `packages/sandbox/sandbox/**`、`packages/shell/bash-sandbox/**`、`packages/shell/pwsh-sandbox/**` | 一个 classifier owner；仅在两个 Consumers 都通过后删除有意重复的 helpers |
| Science Runtime | `packages/science/science-runtime/**`、`packages/science/README.*` | 在 RC5 上复现最终 `e5e8b29...` Runtime semantics，然后应用 isolated R-probe correction |
| Package/tooling integration | `packages/README.*`、`tsconfig.base.json`、`tsconfig.host.json`、`pnpm-lock.yaml`，以及最低限度必需的 generator/allowlist sources | 每一条路径都必须由新 package 或某一已声明 generic API 所要求 |
| Generated/current documentation | 受影响的 `docs/architecture.*`、subsystem/config/capability/event/module references、`packages/extensions/tool-cordis/src/api-catalog.ts` 与 pairing sidecars | 先编辑 owners，再生成 English/catalog artifacts，然后更新经过评审的中文对应文本 |
| Decision/evidence | 本 triplet 与一份 dated R2 closure-evidence triplet | 稳定 rationale 留在此处；volatile SHA 与 command results 留在 evidence |

## 已考虑的替代方案

**Cherry-pick `bf4be8...`、`2386ad5...`、`390fbde...` 或 R-probe branch。** 拒绝，因为这些 histories 包含 mixed generic migrations、generated outputs、unrelated repairs 或 Phase 3 ancestry。Exact commits 是 provenance，不是 unrelated RC5 line 的 patch boundaries。

**在 generic requirements 之前移植 Runtime package。** 拒绝，因为 Science 随后会重复实现 environment construction、execution-world checks、byte-validity inference 或 sandbox classification。这些职责已经属于 shared capabilities，并且必须保持 independently usable/testable。

**把 generic prerequisites 与 Runtime 放入一个 large commit。** 拒绝，因为 required-field subprocess migration 会触及许多既有 Consumers，而 Runtime 增加独立 lifecycle 与 filesystem ownership。Separate commits 使 compatibility regressions 与 scope growth 可以归属到明确切片。

**增加 `tool-science`，让 Runtime 具有 production Consumer。** 拒绝，因为 tools 是 model-facing，并依赖 Runtime Context、filesystem read-only behavior、prompt/schema decisions、snapshots 与后续 preset。R2 是 pre-product infrastructure，不声称已经形成包含三种角色的完整 capability seam。

**在 Science 内使用 `node:child_process` 或 shell command。** 拒绝，因为这会重复 process-tree ownership、output retention、termination、quiescence、quoting 与 sandbox integration，而这些已经由 `ctx.subprocess` 与 `ctx.sandbox` 负责。

**Auto-discover 或 manage Conda environments。** 拒绝，因为 discovery、solving、installation、mutation locks、approvals、rollback 与 deletion 构成独立 product capability。R2 只观察并执行显式配置的 existing prefixes。

**把 fake-prefix tests 视为 Runtime completion。** 拒绝，因为 deterministic source tests 无法证明 accepted SHA 上真实 Python/R executable、OS confinement、environment scrubbing、process-tree settlement 或 prefix non-mutation。

## 取代关系与生命周期

本 Note 不 supersede Science Session、subprocess、sandbox、session-log、timeout、home-path、invariant 或 distribution decisions。它消费或窄幅扩展这些 decisions。它反向链接这些 owners，并且只陈述实际落地的 behavior。

本 implemented triplet 保持 active，因为它的 alternatives、ownership boundary、negative guarantees 与 real-acceptance split 对后续 Science slices 仍然有用。Dated evidence record 负责 volatile candidate SHAs、command outputs、host details 与 reproduced baseline exceptions；本 Note 负责 stable scope、ordering、exclusions 与 acceptance meaning。

## 后果

R2 为 Science 提供了 `science/environment-bound`、`science/run-started` 与 `science/run-finished` 的 host-local producer，同时不导入 downstream history、model-facing tools 或 shipped composition。代价是一次覆盖既有 Consumers 的 required-field subprocess migration，以及一个在 R2 阶段仍没有 model-visible Consumer 的 Runtime；[R3](2026-08-16-dsh-science-v01-r3-science-tools.md)补上了该 Consumer，而 preset 与 UI slices 仍为 OUT。

Exact-Session reservation 与 same-ID quarantine 位于每一次 durable append 之前；tests 覆盖 cancellation、timeout、detachment、service disposal、terminal-commit rejection 与 late quiescence，因此 failure path 不能在 proof 之前释放，也不能在 proof 之后继续持有 lease。File-write confinement 比 confidentiality 更窄：documentation 与 results 不声称对 file reads、networking、syscalls 或 scientifically incorrect code 的防护。

真实 Python 与 R acceptance 仍为 opt-in，并依赖 host。Environment 或 host failure 在 recorded candidate 上成功 rerun 之前都是字面的 FAIL/`NOT-RUN`；historical downstream PASS 不能关闭 R2。[R3](2026-08-16-dsh-science-v01-r3-science-tools.md)用 model-facing 的 `@deepseek-ai/dsh-tool-science` Consumer 补全了这个 Runtime，是在它同时新增的 generic runtime-context 与 filesystem read-only prerequisites 之后交付的；built-in Science preset 仍是下一项开放 slice。
