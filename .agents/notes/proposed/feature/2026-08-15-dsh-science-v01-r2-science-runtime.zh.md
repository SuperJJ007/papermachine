# Agent Note: DSH Science v0.1 R2 基于 RC5 的 Science Runtime

Status: proposed

[English](2026-08-15-dsh-science-v01-r2-science-runtime.md) | 中文

## Problem

已验收的 DSH Science v0.1 谱系包含官方 RC5 发行基线与 R1 Science Session 域，但还没有 `science/environment-bound`、`science/run-started` 或 `science/run-finished` 的 producer。`omdsh-dev/dsh-science@e5e8b29b435f67e0a5dde5e2132580966e78b27b` 中的下游 Runtime 与 RC5 不具备的四项通用 subprocess 和 sandbox 扩展共同构建。其实现提交还混合了 package code、既有 Consumer migration、generated documentation 与无关的 repository repair。因此，复制下游分支或 cherry-pick 这些提交会导入 Runtime owner scope 之外的工作。

R2 需要一份可执行的 RC5 计划：增加 host-local Science Runtime，但不提前引入 model-facing tools 或 shipped Science composition。该计划必须把 process ownership 保留在现有 subprocess 与 sandbox capabilities 中，按要求顺序执行 durable Session mutation，保留每个既有 Consumer 的 RC5 行为，并将 fake-prefix source proof 与真实 Python/R acceptance 分开。

## Proposal

R2 在已验收 R1 谱系上增加 folded `@deepseek-ai/dsh-science-runtime` package。该 package 负责 `ctx.scienceRuntime`、现有 local Conda prefix 的 strict configuration、stable interpreter observation、exact-Session operation ownership、private Science scratch、direct Python/R argv construction、terminal classification，以及这些操作产生的 Session events。它组合 `ctx.sessions`、host-local `ctx.subprocess`、fully enforcing `ctx.sandbox`、已验收的 Science Session package 及其 invariant。它不注册 model tool、prompt、client projection、preset 或 shipped application row。

R2 首先只增加 Runtime 确实需要的 generic capabilities：显式 subprocess environment base、subprocess execution-world fact、retained-output UTF-8 validity，以及共享 sandbox runner/denial classification。既有 Consumers 显式声明其原有 RC5 选择并保持行为不变。只有这些前置项独立通过后，才增加 Runtime package。R version-probe correction 在 R2 内继续保持独立的 commit 与 evidence identity。

[R0 closure record](../../../../docs/evidence/2026-08-15-dsh-science-v01-r0-rc5-baseline-closure.md)负责 overlay identities 与 evidence classes。[R1 Science Session decision](../../implemented/feature/2026-08-15-dsh-science-v01-r1-science-session.md)负责 Runtime operations 必须追加的 durable event semantics。Generic subprocess、sandbox、Session、timeout、home-path 与 invariant packages 继续负责其现有职责；R2 扩展这些 owner，而不在 Science 内实现 private substitutes。

### Exact identities

| 对象 | 身份 | R2 用途 |
|---|---|---|
| 官方 RC5 source | `deepseek-ai/deepseek-harness@47f943859bef60e4160492346772ded9b24f765a`，版本 `0.1.0-rc.5` | 不可变 upstream product baseline |
| 已验收 R1 head | `codex/science-v01-r1-science-session` 上的 `7e11de7e4beaf17dd87cf19368cfc930837dc77c` | R2 plan commit 的 required ancestor 与 parent |
| Downstream Runtime source | `omdsh-dev/dsh-science@e5e8b29b435f67e0a5dde5e2132580966e78b27b`；`packages/science/science-runtime/**` | R-probe correction 之前，只读的 final Runtime semantics 与 file source |
| Downstream Runtime history | `bf4be838066576dc005822428e259673b049e048`、`2386ad5d675141495777f5753b6911cd27608302` 与 `390fbde6c1` | Initial implementation、hardening 与 cancellation-cleanup containment 的 provenance；绝不是 cherry-pick range |
| R version-probe correction | `b15f1ef42e92b72ad1b53412966408415f669a18`；只采用其 `Rscript --version` behavior、focused tests 与匹配的 Runtime prose | 独立 R2 code/evidence identity；排除其 Phase 3 parent 与无关 Runtime differences |
| R2 implementation base | 包含本 triplet 的 accepted commit，以 `7e11de7e4b` 为 parent 且没有 product change | 第一个 R2 implementation commit 的 parent；product edits 前记录 exact SHA |

任何 downstream test result、review verdict、build output、real-machine report、Phase 3 candidate 或当前 `main` worktree state，都不是 RC5 port 的 acceptance evidence。Grok 必须从 exact SHA 上的 R2 tree 重新推导每一项 final claim。

### Entry conditions

| 条件 | 必需证据 | Hard stop |
|---|---|---|
| 隔离 implementation worktree | 从 accepted R2 plan commit 新建 branch 与 worktree；product edits 前 `git status --porcelain=v1 --untracked-files=all` 为空 | 复用、清理、stage、reset 或 repoint 任何既有 worktree |
| R1 ancestry | `git merge-base --is-ancestor 7e11de7e4beaf17dd87cf19368cfc930837dc77c HEAD` 成功；pre-product diff 只包含本 proposed triplet | 不同 product base、来自 downstream history 的 merge，或无法解释的既有 product changes |
| 只读 sources | Exact `e5e8b29...`、`bf4be8...`、`2386ad5...`、`390fbde...` 与 `b15f1ef...` objects 可在本地解析，且无需编辑其 worktrees | Source identity 缺失、试图使用 moving branch name，或必须修改 source worktree |
| 受支持 toolchain | Node 满足 `^22.19.0 || >=24.0.0`，pnpm 为 `11.7.0`，且 frozen install 可用 | 为绕过 host failure 而改变 product design 或 dependency versions |
| 受保护状态 | Implementation 前记录每个既有 worktree 的 branch/HEAD/status | 任何吸收、清理或重新解释 protected dirty/untracked content 的计划 |
| Real acceptance inputs | Closure 前确定显式的既有 Conda Python/R prefixes，以及隔离、test-owned、non-temporary、mode-`0700` 的 DSH home | Auto-discovery、Conda mutation、使用 `/tmp`，或把 unavailable language 当作 PASS |

Implementation 必须针对 RC5 重新推导 patch。禁止 rebase、merge 或 cherry-pick downstream history。

### Scope

| 方向 | Delta | 允许结果 |
|---|---|---|
| IN | `GEN-SUBPROCESS-RUNTIME-FACTS` | 增加 required `environmentBase`（`scrubbed-parent` 或 `empty`）、readonly `executionWorld`（`host-local` 或 `remote`）与 `utf8Validity`（`valid`、`invalid` 或 `unknown`）；更新 providers、既有 Consumers、mocks、tests 与 owner documentation，使 RC5 behavior 保持显式 |
| IN | `GEN-SANDBOX-CLASSIFICATION` | 将共享 runner-spawn、runner-fatal 与 denial classifiers 移入 `@deepseek-ai/dsh-sandbox`；更新 Bash 与 Pwsh 以调用同一 implementation，并保持 runner failure 优先于 denial |
| IN | `SCI-RUNTIME` | 增加 `packages/science/science-runtime/**`：folded service/local provider、strict configuration、stable prefix observation、exact-Session leases、owned scratch、direct execution、lifecycle settlement、invariant companion、package documentation、fake-prefix tests、Loader composition 与 opt-in real acceptance |
| IN | `SCI-R-PROBE` | 只应用 `b15f1ef...` 中 standalone `Rscript --version` correction，并带 focused invalid-outcome/argv tests 与 matching Runtime prose |
| IN | Mechanical integration | 与 RC5 对齐的 package metadata、TypeScript paths/references、lockfile importer、package/capability documentation、model-experience/invariant registrations、经证明必需的最小 config-catalog support，以及 owning generators 的 outputs |
| IN | Closure evidence | 仅在 exact candidate 通过后将本 triplet 移至 `implemented/feature`；增加一组 dated R2 evidence triplet，记录实际 commands、results、identities、exceptions 与 `NOT-RUN` layers |
| OUT | Model-facing Science work | `GEN-RUNTIME-CONTEXT`、filesystem read-only entries、`tool-science`、tool schemas、prompt text、Science preset、snapshots、Web composition、charts、Outcome Consumers、settings、sidebar、Client UI 与 Desktop |
| OUT | Broader generic redesign | 新 process verbs、Science 内直接拥有 `node:child_process`、shell command construction、generic sandbox-policy redesign、remote scratch protocols、confidentiality claims 或无关 subprocess/sandbox refactors |
| OUT | Environment management and distribution | Conda discovery、create/clone/install/update/repair/delete、credentials、provider calls、installer、signing、notarization、publication、tag、release、Git push、PR、RC6 或 latest-upstream migration |

`2386ad5...` 中历史 `scripts/rescope-vendor.ts` change、root BSD-license prose change、Phase 3 files，以及上述 rows 不要求的每一项其他 change，都被明确排除。

### Required generic capabilities

`SubprocessSpawnSpec.environmentBase` 为 required。既有 Consumers 使用 `'scrubbed-parent'`，保留 RC5 behavior；Science 使用 `'empty'` 并只提供其 fixed allowlist。Local 与 E2B providers 先应用 selected base，再应用 `spec.env`。Provider transport processes 可以保留其 documented environment，但不得意外传给 target program。

`SubprocessRuntime.executionWorld` 报告 `'host-local'` 或 `'remote'`。Local subprocess 报告 `'host-local'`；E2B 报告 `'remote'`。Science 在创建 owner marker、scratch directory 或 Session event 前拒绝 remote world。该 fact 不成为 general remote-provider identity protocol，也不重复增加 sandbox field。

`SubprocessOutputRead.utf8Validity` 描述所表示的 exact byte slice。保留或恢复这些 bytes 的 provider 报告 `valid` 或 `invalid`；只有 provider 已得到 decoded text 却没有 recoverable bytes 时才允许 `unknown`。Existing text Consumers 在其他方面保持其行为。Science version 与 UTF-8 probes 要求 lossless offset-zero read，且 `utf8Validity === 'valid'`。

Runner-spawn、runner-fatal 与 denial classification 移至 exported sandbox module。Bash、Pwsh 与 Science 调用该 module。Positive runner failure 表示 requested program 没有运行，因此优先于 denial signature；仅有 exit status 永远不能证明任一结果。

如果 RC5 config-catalog generator 无法跟随 Runtime imported `configSchema`，R2 可以增加记录该 package 所需的最小 local-schema resolution，并附 owning generator tests。必须先复现 failure。不得借此导入无关 generator change。

### Science Runtime behavior

Folded package 暴露 `bindEnvironment({ session, profileId, signal })`、`startRun({ session, language, code, toolCallId, requestHeaderSeq, signal })`，以及只包含 `runId`、`done` 与 idempotent `cancel()` 的 `ScienceRunHandle`。Public operation/result types 不包含 PID、subprocess handle、Conda implementation type 或 host scratch path。后续 tool Consumer 调用这些 operations；它不得自行追加 Runtime-owned Science events。

Profiles 命名既有 absolute Conda prefixes，并至少配置一个 Python 或 R interpreter。Runtime 永不调用 Conda，也不写入 configured prefix。它 canonicalize prefix 与 executable，要求 regular in-prefix interpreter/history files，记录 stable before/after identity，对 changed observation 最多重试一次，并发布真实的 invalid 或 drifted binding，而不是伪造 stability。

Binding 与 run setup 共享 non-queuing exact-Session reservation。同一 live Session 上的第二项 operation 返回 `RUNTIME_BUSY`。Detached lifecycle 保留 same-ID quarantine，直到每棵 owned probe/process tree quiescent 且 cleanup settled。每次 append 都重新检查 `ctx.sessions.get(session.id) === session`，因此 old object 无法写入 same-ID successor。

Environment binding 在追加一个 whole `science/environment-bound` value 前完成 interpreter observation 与 confinement。Run 写入并 sync exact source 与 run directory，追加 `science/run-started`，然后才能 spawn。Start commit 后，ordinary program failure、timeout、cancellation、sandbox denial 与 runner failure 都成为 terminal values，并且只有在 whole-tree quiescence 后才追加一条 matching `science/run-finished`。Detached Session 不接收 terminal append；replay 从 unmatched durable start 派生 `interrupted`。无法证明 quiescence 或无法 commit terminal fact 时，绝不能返回看似 durably settled 的 value。

每次 probe/run 都使用 direct argv、`environmentBase: 'empty'`、owned cwd、fixed locale/timezone 与 full `workspace-write` confinement。Python probes/runs 使用冻结的 isolated UTF-8 flags。R version discovery 使用 standalone `Rscript --version`；其 UTF-8 probe 与 runs 使用 `--vanilla --encoding=UTF-8`。Scratch 只位于 resolved DSH home 下，使用 exclusive owner markers 与 private modes，拒绝 symlink/path overlap，并保留 accepted run state，只移除当前 operation 拥有的 unpublished setup。

Confinement 限制 documented file writes；它不声称隔离 file reads、network、syscalls 或 scientific results。凡是 available sandbox 无法提供 full enforcement，Windows 就保持 fail-closed。Source code、stdout、stderr、credentials 与 absolute scratch paths 永不进入 Science Session events 或 public Science projection。

### RC5 adaptation and expected impact

Runtime package manifest 从 RC5 sibling packages 重新推导：版本 `0.1.0-rc.5`、`publishConfig.access: public`、MIT、shared repository field 与 RC5 workspace dependency declarations。其 TypeScript references 针对 RC5 layout 重新推导，不得复制不必要的 `vendor/cosmokit` reference。禁止 downstream `0.0.1-rc.2`、restricted publication 与 BSD metadata。

| 区域 | 预计路径 | 规则 |
|---|---|---|
| Subprocess definition/providers | `packages/subprocess/subprocess/**`、`packages/subprocess/subprocess-local/**`、`packages/e2b/subprocess-e2b/**` | 只增加三个 declared facts 与 providers 为兑现它们所需的 behavior |
| Existing subprocess Consumers | `packages/shell/bash-local/**`、`packages/shell/pwsh-local/**`、`packages/fs/tool-fs-search/**`、`packages/lsp/lsp-stdio/**`、`packages/subagent/subagent-acp/**`、`packages/subagent/subagent-claude-code/**`、`packages/subagent/subagent-codex/**`、terminal tests 与 exact E2B fixtures | 声明原有 scrubbed-parent behavior，并补齐新 required mock facts；Consumer semantics 不变 |
| Sandbox classification | `packages/sandbox/sandbox/**`、`packages/shell/bash-sandbox/**`、`packages/shell/pwsh-sandbox/**` | 只有一个 classifier owner；Bash/Pwsh 都通过后才能删除 deliberate duplicate helpers |
| Science Runtime | `packages/science/science-runtime/**`、`packages/science/README.*` | 在 RC5 上复现 final `e5e8b29...` Runtime semantics，然后应用 isolated R-probe correction |
| Package/tooling integration | `packages/README.*`、`tsconfig.base.json`、`tsconfig.host.json`、`pnpm-lock.yaml` 与最小 required generator/allowlist sources | 每条路径都必须由新 package 或一项 declared generic API 要求 |
| Generated/current documentation | 受影响的 `docs/architecture.*`、subsystem/config/capability/event/module references、`packages/extensions/tool-cordis/src/api-catalog.ts` 与 pairing sidecars | 先编辑 owners，再 regenerate English/catalog artifacts，最后更新 reviewed Chinese counterparts |
| Decision/evidence | 本 triplet 与一组 dated R2 closure-evidence triplet | Stable rationale 留在此处；volatile SHA 与 command results 留在 evidence |

`pnpm --silent run change-scope --base <R2-plan-base> --head HEAD` 必须解释 final path list。超出这些类别的 changed path 是 hard stop，除非 owning generator 明确命名该路径，或在 product change 前修订本 Note。

### Implementation stages and commit boundaries

1. 记录 exact R2 plan base、protected-worktree inventory、toolchain、source objects 与 empty product diff。在复制代码前，对 final downstream files 到 RC5 建立逐 path mapping，并把每条 historical path 分类为 required、generated、adapted 或 excluded。
2. 将 `GEN-SUBPROCESS-RUNTIME-FACTS` 实现为一个可独立审查的 commit。增加 focused definition、local、E2B 与 existing-Consumer tests；此 commit 不得增加 Science code。
3. 将 `GEN-SANDBOX-CLASSIFICATION` 实现为一个可独立审查的 commit。只移动 shared classification behavior，测试 precedence 与 spawn identity，并证明 Bash/Pwsh behavior 不变。
4. 以一个 product commit 增加 RC5-aligned Science Runtime package、Loader composition、fake-prefix tests、package integration 与 owner documentation。以 final `e5e8b29...` tree 作为 semantic source，包括其中已存在的 `2386ad5...` 与 `390fbde...` hardening；不得 replay 它们的无关 paths。
5. 以单独 commit 应用 `b15f1ef...` R-probe correction。只复制 standalone R version argv behavior、focused tests 与 matching Runtime prose；不得复制其 Phase 3 parent 或无关 package differences。
6. 对 complete candidate 运行 verification matrix，审查 exact diff，并取得一次 clean-context review；review 只覆盖 changed generic APIs 与 Runtime lifecycle/security invariants。Material repair 会产生新 candidate，并重新运行 affected checks 与 focused review。
7. 所有 required evidence layers 通过后，增加 dated closure evidence，并把本 triplet 移至 `implemented/feature`，改写为 present-tense `Decision` 与 `Consequences` sections。停在 Runtime Context、filesystem read-only、tools、preset、UI、Desktop、push 或 release work 之前。

### Verification matrix

| 证据 | 必需 command 或 observation | Acceptance rule |
|---|---|---|
| Scope and ancestry | `git merge-base --is-ancestor 7e11de7e4beaf17dd87cf19368cfc930837dc77c HEAD`；`pnpm --silent run change-scope --base <R2-plan-base> --head HEAD`；`git diff --check <R2-plan-base>..HEAD` | 每条 path 映射到本 Note 或 owning generator；不存在 downstream merge/cherry-pick ancestry |
| Generic subprocess behavior | 对 `packages/subprocess/subprocess/tests`、`packages/subprocess/subprocess-local/tests`、`packages/e2b/subprocess-e2b/tests` 与每个 changed Consumer test directory 运行 focused Vitest | Empty/scrubbed bases、execution worlds、byte-slice validity 与 unchanged existing Consumer behavior 全部通过 |
| Sandbox classification | 对 `packages/sandbox/sandbox/tests`、`packages/shell/bash-sandbox/tests` 与 `packages/shell/pwsh-sandbox/tests` 运行 focused Vitest | Spawn identity 与 fatal-runner evidence 为 positive；runner failure 优先于 denial；两个 shell Consumers 一致 |
| Runtime behavior | `pnpm exec vitest run packages/science/science-runtime/tests packages/science/science-session/tests`，加上 Runtime suite 中的 real Loader composition | Config、observation、scratch、start-before-spawn、exact Session、cancellation/timeout、quiescence、detachment、replay、prefix manifest 与 R argv 通过 |
| Focused per-file coverage | Targeted Vitest coverage，包含 `packages/science/science-runtime/src/**` 与 R2 改动的每个 generic source file | 每个 included source file 在 canonical exclusions 下达到 100% statements、branches、functions 与 lines；不得降低 thresholds 或加入无理由 ignores |
| Static and package artifacts | `pnpm run typecheck`；`pnpm run check:ci:artifacts` | Source/build faces、declarations、publint、built package invariants、NodeNext consumption 与 built entries 通过 |
| Hygiene | `pnpm run hygiene`；如果只因已知 `rescope-vendor:check` baseline gap 停止，则逐项运行后续 subchecks，并将 failure list 与 R2 plan base 做逐字节比较 | 任何新增或变化的 hygiene finding 都阻塞 acceptance；复现的 unchanged baseline gap 必须披露，绝不能称为 PASS |
| Documentation | Named pairing re-records；`pnpm run doc-sync`；`pnpm run lint` | Generated sources fresh，所有 pairs 的 structure 与 meaning 一致，且 prose 描述 current R2 behavior，不包含 Phase 3 claims |
| Real Python/R | 在 exact candidate 上使用 Node 24+、显式 existing prefixes 与隔离的 non-temporary mode-`0700` DSH home：设置 documented opt-in variables 后运行 `pnpm --filter @deepseek-ai/dsh-science-runtime test:real-acceptance` | Machine-readable Python/R reports 分别为 `PASS`；prefix manifest differences 为空；skipped/unavailable language 不构成 closure |
| Exact candidate review | Fresh reviewer 接收 base/head、IN/OUT table、source mapping、full diff、focused results、real reports 与 `NOT-RUN` list | Review 只覆盖 changed generic contracts 与 Runtime lifecycle/security invariants；针对其他 SHA 的 verdict 无效 |

Exact real-runtime command 如下：

```sh
DSH_SCIENCE_RUNTIME_REAL_ACCEPTANCE=1 \
DSH_SCIENCE_RUNTIME_TEST_OWNED=1 \
DSH_SCIENCE_RUNTIME_DSH_HOME=<absolute-non-temp-mode-0700-test-home> \
DSH_SCIENCE_RUNTIME_PYTHON_PREFIX=<absolute-existing-python-prefix> \
DSH_SCIENCE_RUNTIME_R_PREFIX=<absolute-existing-r-prefix> \
pnpm --filter @deepseek-ai/dsh-science-runtime test:real-acceptance
```

Final local run 不重复 repository-wide unit suite、model snapshots、browser suites、provider e2e、Desktop、installer、signing 或 release checks。它们不匹配 R2 的 non-model-facing、unshipped scope。CI 负责 exhaustive repository coverage 与 platform matrix；R2 本地只运行上述 targeted behavior、required static/artifact、documentation、hygiene 与 real-runtime evidence。

## Alternatives considered

**Cherry-pick `bf4be8...`、`2386ad5...`、`390fbde...` 或 R-probe branch。** 拒绝，因为这些 histories 包含 mixed generic migrations、generated outputs、unrelated repairs 或 Phase 3 ancestry。Exact commits 是 provenance，不是 unrelated RC5 line 的 patch boundaries。

**在 generic requirements 之前移植 Runtime package。** 拒绝，因为 Science 随后会重复实现 environment construction、execution-world checks、byte-validity inference 或 sandbox classification。这些职责已经属于 shared capabilities，并且必须保持 independently usable/testable。

**把 generic prerequisites 与 Runtime 放入一个 large commit。** 拒绝，因为 required-field subprocess migration 会触及许多既有 Consumers，而 Runtime 增加独立 lifecycle 与 filesystem ownership。Separate commits 使 compatibility regressions 与 scope growth 可以归属到明确切片。

**增加 `tool-science`，让 Runtime 具有 production Consumer。** 拒绝，因为 tools 是 model-facing，并依赖 Runtime Context、filesystem read-only behavior、prompt/schema decisions、snapshots 与后续 preset。R2 是 pre-product infrastructure，不声称已经形成包含三种角色的完整 capability seam。

**在 Science 内使用 `node:child_process` 或 shell command。** 拒绝，因为这会重复 process-tree ownership、output retention、termination、quiescence、quoting 与 sandbox integration，而这些已经由 `ctx.subprocess` 与 `ctx.sandbox` 负责。

**Auto-discover 或 manage Conda environments。** 拒绝，因为 discovery、solving、installation、mutation locks、approvals、rollback 与 deletion 构成独立 product capability。R2 只观察并执行显式配置的 existing prefixes。

**把 fake-prefix tests 视为 Runtime completion。** 拒绝，因为 deterministic source tests 无法证明 accepted SHA 上真实 Python/R executable、OS confinement、environment scrubbing、process-tree settlement 或 prefix non-mutation。

## Supersession and lifecycle

本 Note 不 supersede Science Session、subprocess、sandbox、session-log、timeout、home-path、invariant 或 distribution decisions。它消费或窄幅扩展这些 decisions。Implemented form 必须反向链接这些 owners，并且只陈述实际落地的 behavior。

本 proposed triplet 在 R2 implemented 或 rejected 前保持 active，且 proposed 状态下永不归档。Final evidence record 负责 volatile candidate SHAs、command outputs、host details 与 reproduced baseline exceptions；本 Note 负责 stable scope、ordering、exclusions 与 acceptance meaning。

## Acceptance criteria

- Accepted candidate 以已记录 R2 plan base 为祖先，不包含 downstream merge/cherry-pick、Runtime Context、filesystem read-only、tool、preset、UI、Desktop、distribution 或 latest-upstream work。
- 每个既有 subprocess Consumer 在显式选择 environment base 并提供其 role 所需的新 execution-world/output facts 时，保持 RC5 behavior。
- Bash、Pwsh 与 Science 使用同一个 sandbox classifier；positive runner failure 优先于 denial，ordinary program failure 不会被误报为 infrastructure failure。
- Runtime 在创建 durable facts 或 accepted scratch 前，要求 exact live Science Session、host-local subprocess world、full sandbox enforcement 与 configured existing prefix。
- `science/run-started` 在 spawn 前 durable；terminal settlement 仅在 whole-tree quiescence 后发生；detached 或 replaced Sessions 永不接收 old lifecycle 的 terminal append。
- Runtime operations 永不调用 Conda、不修改 configured prefix、不继承 ambient credentials、不通过 public results 暴露 host scratch，也不把 code/stdout/stderr 放入 Session log 或 public Science projection。
- Final Runtime 使用 standalone `Rscript --version`；focused tests 拒绝 former combined version argv，且真实 Python/R acceptance 在 exact candidate 上分别报告 `PASS`，prefix-manifest diff 为空。
- Focused coverage plan 纳入的每个 changed source file 都达到 100%；required static、artifact、hygiene、documentation 与 focused review checks 在不弱化 gates 的情况下满足 matrix。
- Closure evidence 分离 source/fake-prefix、built artifact、real Python、real R 与 `NOT-RUN` product/distribution layers。Implementation worktree 干净，每个 protected worktree/ref 与 entry snapshot 一致。

## Risks

- Required subprocess fields 会对既有 Consumers 形成 broad compile-time migration。Mechanical edits 可能掩盖 changed defaults，因此每个 Consumer 都必须声明其原有 RC5 choice，并由 owning tests 覆盖。
- 如果 failure path 在 quiescence 前释放，或在 positive proof 后永不释放，exact-Session reservation 与 same-ID quarantine 可能永久泄漏。Tests 必须覆盖 cancellation、timeout、detachment、service disposal、terminal-commit rejection 与 late quiescence。
- Sandbox runner diagnostic 可能与 program denial 相似。Weak classification 可能把从未运行的 program 报告为普通 Science failure；过宽 matching 则可能把真实 program failure 隐藏为 infrastructure failure。
- Host scratch cleanup 会在 test-owned paths 内执行 destructive action。Implementation 必须在 removal 前解析并验证 exact owner markers 与 path containment；绝不能对 configured prefix、repository、home 或 pre-existing worktree 使用 broad cleanup。
- File-write confinement 比 confidentiality 更窄。Documentation 与 results 不得暗示对 file reads、network、syscalls 或 scientifically incorrect code 的防护。
- Real acceptance 依赖当前 host interpreters 与 confinement support。Environment 或 host failure 在 exact candidate 成功 rerun 前继续是 literal FAIL/NOT-RUN evidence；historical downstream PASS 不能关闭 R2。
- Generated 与 integration paths 可能掩盖 Phase 3 leakage。任何 unexplained path、new model-visible text、shipped composition row 或对 `agent-loop` changes 的需要，都会让 implementation 停止并要求 explicit plan amendment。
