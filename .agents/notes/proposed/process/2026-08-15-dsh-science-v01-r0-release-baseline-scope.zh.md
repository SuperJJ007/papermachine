# Agent Note：DSH Science v0.1 RC5 发行基线范围

Status: proposed

[English](2026-08-15-dsh-science-v01-r0-release-baseline-scope.md) | 中文

## 问题

DSH Science 需要先建立一条来源可归因的发行线，之后才能把任何 Science 或 Desktop 实现迁移到该发行线上。当前下游开发线与 DeepSeek Harness 官方源码没有共同历史，仓库元数据、版本身份和许可证身份也不同。若重放整段下游历史，就会把已接受的 Science 基础、未通过的 Phase 3 候选、仓库治理、发布机制和未来 Desktop 工作混成一次无法审查的变更。

发行基线还必须明确证据边界。干净源码树、成功构建、已安装 npm 闭包、真实 Python/R 运行、Desktop 安装包、签名和发布是不同结果。用其中一项证明另一项，会让首个 v0.1 声明失去可信度。

2026-08-15，产品负责人决定首个 v0.1 实现固定基于官方 RC5。只有第一版本完成后，才开始迁移到届时最新的官方版本。因此，RC6 及之后持续变化的源码既不是 R0 输入，也不能成为刷新 v0.1 分支的理由。

## 提案

R0 建立唯一的干净本地发行基线候选，直接以 DeepSeek Harness 官方提交 `47f943859bef60e4160492346772ded9b24f765a` 为根，其根版本为 `0.1.0-rc.5`。R0 不迁移任何产品代码，只承载已接受的治理路由、带日期的身份与基线证据、overlay 清单，以及验证这些文档时机械上无法避免的非运行时元数据。

一句话目标是：**建立一个精确、可复现的 RC5 源码基线，使后续每项 Science delta 都能独立迁移和验收。** 现在必须完成这件事，因为继续在无关的下游历史上开发功能，会让源码归属和发行证据越来越难以恢复。

R0 只有一个逻辑交付物：分支 `codex/science-v01-rc5-baseline` 上一个干净、已在本地提交的 `<R0B_HEAD>`；其直接根为 `47f943859bef60e4160492346772ded9b24f765a`，仓库内还有与 `<R0B_HEAD>` 绑定的身份、清单和检查记录。R0A 治理提交是该基线的来源和入口证据，不是第二条产品线。R0 不授权 push、tag、npm 发布、安装器或 release。

## 证据基础

### 2026-08-15 已验证事实

- 官方 [`deepseek-ai/deepseek-harness` 源码](https://github.com/deepseek-ai/deepseek-harness/commit/47f943859bef60e4160492346772ded9b24f765a)的 `master` 位于 `47f943859bef60e4160492346772ded9b24f765a`；其 tree 为 `f904efab9ef435201d6ba4da88a34d6366568272`，根版本为 `0.1.0-rc.5`，许可证为 MIT，Node 支持范围为 `^22.19.0 || >=24.0.0`。精确查询未返回公开的 `dsh-v0.1.0-rc.5` tag。仓库包含 CLI 和 Web 应用，不包含 Electron 或 Desktop 应用目录树。
- 本地 `main` 和普通项目 worktree 位于 `e5e8b29b435f67e0a5dde5e2132580966e78b27b`；现场核对的 `origin/main` 位于 `0be28653be115622c554dae3f00105c2305b9c02`。本地分支干净，并领先该远端两个提交。
- `e5e8b29...` 与 `47f943...` 没有 merge base。以官方源码为左侧、下游源码为右侧比较得到 `12,293/17` 个提交。因此，传统 rebase 或 merge 会移植整段历史，并不是普通更新。
- 已集成的下游 `main` 包含 Science Session 领域、Science Runtime、提交 `0a940733e80d57c70245134bf260012f9be29114` 与 `e5e8b29b435f67e0a5dde5e2132580966e78b27b` 中的通用 runtime-context 修复，以及它们需要的通用支持。它不包含 `packages/science/tool-science`、内置 Science preset、Science chart 或 Outcome Consumer、Science settings card、Science sidebar 或 Desktop 代码。
- 独立 Phase 3 候选 `fae091e1080e830bed8ad0456e4cbced29101b01` 包含只读文件系统入口、Science tools 和 Science preset。历史精确范围证据报告了 hygiene 检查失败，以及仍有 HIGH 问题未解决的最终审查；本次调查只把该报告作为历史证据，没有重新验证或修改候选。后续的 R 探针修复 `b15f1ef42e92b72ad1b53412966408415f669a18` 及其真实运行时结果，不能消除继承的 Phase 3 整体审查失败。
- npm registry 元数据显示 `@deepseek-ai/dsh@0.1.0-rc.6` 同时是 `latest` 和 `next`，发布时间为 `2026-08-13T12:35:03.812Z`，integrity 为 `sha512-brpZfED7ieRa2PQ5tUxMhHrM1pb2CmKFVM/f6yMULBDMicahk+Z2OsHgTwTDnoiZm23Ftu9rQz0NN4pflaoJcg==`。该版本没有 `gitHead`，registry 元数据也没有 RC5 发布时间。RC6 是一个无法映射源码的已观察 artifact，v0.1 实现线忽略它。

下表记录 R0 之前受保护 worktree 的快照。它是证据，不是后续状态的 authority。

| Worktree | 分支或状态 | HEAD | 观察时的 dirty 状态 |
|---|---|---|---|
| `/Users/superjj/ccproj/DSHscience` | `main` | `e5e8b29b435f67e0a5dde5e2132580966e78b27b` | clean |
| `/private/tmp/dshscience-science-v01-architecture-governance` | `codex/science-v01-architecture-governance` | `e5e8b29b435f67e0a5dde5e2132580966e78b27b` | 11 项 tracked 修改和 11 个 untracked 路径 |
| `/Users/superjj/.codex/worktrees/24b6/DSHscience` | detached 任务 worktree | `e5e8b29b435f67e0a5dde5e2132580966e78b27b` | 创建本记录前 clean |
| `/Users/superjj/.codex/worktrees/7e1d/DSHscience` | `codex/fix-science-r-version-probe` | `b15f1ef42e92b72ad1b53412966408415f669a18` | clean |
| `/Users/superjj/.codex/worktrees/8489/DSHscience` | detached Phase 3 候选 | `fae091e1080e830bed8ad0456e4cbced29101b01` | clean |
| `/Users/superjj/.codex/worktrees/8942/DSHscience` | detached | `e5e8b29b435f67e0a5dde5e2132580966e78b27b` | clean |
| `/Users/superjj/.codex/worktrees/e229/DSHscience` | detached | `e5e8b29b435f67e0a5dde5e2132580966e78b27b` | clean |
| `/Users/superjj/.grok/worktrees/ccproj-dshscience/2026-08-13-a6c14eca` | detached Phase 2 worktree | `9e1086777a0eb1c9429e7877deb88387bf52459b` | 54 项 tracked 修改和 31 个 untracked 路径 |

### 推断

- v0.1 分支必须直接从官方提交开始，不能从任何下游分支名开始。当前 Science 工作应变成可归因的 overlay 清单，而不是继承的历史。
- 治理 worktree 至少包含三个相互独立的问题：发行调研与产品对齐、证据路由机制、根文档说明的大范围改写。整体搬入该 worktree 会形成巨型无关 diff，并模糊归属。
- Phase 3 候选可以提供代码阅读证据和 delta 来源，但局部 slice 检查与真实运行时修复不能被提升为 Phase 3 整体验收，也不能作为一次 R1 变更整体复制。

### 决定

- 首个 v0.1 完成前始终固定 RC5。每日或每两日观察都不能改变实现基线。第一版本完成后，通过独立迁移选择并验证届时最新的精确官方源码。
- 治理收口和基线落地属于同一个 R0，因为基线只有先获得已接受的身份与证据归属位置，才能成为 authority。二者仍拆成 R0A 和 R0B，使各自历史、diff 和检查保持可审查。
- R0 不包含 Science、通用 runtime、Standard 行为、Electron、release 或 migration 实现。所有含代码的 delta 从 R1 或更晚阶段开始。

### 未验证与 NOT-RUN 证据

- GitHub 源码 archive SHA-256、RC5 依赖安装、源码 smoke、build、package packing、已安装 Web/CLI 检查和最终 R0 diff 检查，均属于 R0B 执行证据，本次范围调查没有运行。
- v0.1 不要求 RC6 源码映射、完整 RC6 package-family 清单、匿名 RC6 安装或兼容性审计。缺少这些结果不会阻塞 R0。
- 真实 provider、真实 Python/R、installer、signing、notarization、Authenticode、Desktop runtime、updater、publication 和 release readiness 在 R0 均为 `NOT-RUN`。
- v0.1 完成后迁移所用的精确官方目标，只能在迁移开始时确定；它是后续选择，不是需要用户在 R0 回答的未知项。

## R0A 与 R0B

| Slice | 目的 | 允许的工作 | 退出条件 |
|---|---|---|---|
| R0A — 治理收口 | 建立已接受的基线决定、证据路由和精确迁移 allowlist，同时不接管无关 dirty 文件 | 按精确路径审查现有治理 worktree；拆分发行/MVP 决定、证据路由机制和大范围说明压缩；只接受 R0 必需的记录和路由；执行有范围的 Agent Note supersession 审计 | 精确的本地治理 commit，所有路径都已分类，得到经过审查的 R0B 文件 allowlist，且无产品源码变更 |
| R0B — 官方基线落地 | 建立唯一发行基线候选 | 直接在 `47f943...` 创建 `codex/science-v01-rc5-baseline`；只添加已批准的 R0A 记录、带日期的基线证据、overlay 清单及机械上必需的文档元数据；执行最小检查 | 干净的 `<R0B_HEAD>`、精确 ancestry 与允许的 diff、所有必需 R0 检查 PASS，并且所有受保护的既有 worktree 均未改变 |

R0A 不要求把整个治理 worktree 作为一个 commit 落地。发行调研与 Science MVP 对齐可以形成一组经过审查的决定；证据路由可以成为第二组机械变更；根目录及 `docs/AGENTS.md` 的大范围压缩仍是单独治理变更，除非 R0 能证明每一行都是证据路由所必需的。R0B 有意迁移获批 allowlist 中的文件内容，不 cherry-pick 或 merge 治理分支。

## IN 与 OUT scope

| 领域 | IN scope | OUT of scope |
|---|---|---|
| 源码身份 | 官方提交 `47f943...`、其 tree、根版本、许可证、archive URL 与 checksum，以及最终的 `<R0B_HEAD>` | 采用 RC6、移动分支、推断源码/artifact 等价，或 v0.1 后迁移 |
| Git 拓扑 | 一个直接以官方提交为根的新本地分支，以及隔离的非临时 worktree | Rebase、merge、history rewrite，或推进当前 `main`、`origin/main`、Phase 3、R 探针、治理或 Grok worktree |
| 治理 | canonical R0 记录、已接受的发行/MVP 决定子集，以及带日期证据所需的最小路由 | 整体搬入 dirty 治理 diff、大范围文档清理、临时 plan 或聊天 handoff |
| 证据 | 带日期的基线/版本记录、受保护状态快照、完整 overlay 清单、精确命令、结果和证据层限制 | 声称源码或 build 证据可以证明 runtime、Desktop、signing、installer 或 release 状态 |
| 元数据 | 文档 pairing/budget/exclusion 条目，以及已接受路由机械要求的其他非运行时元数据；预计不会变更 allowlist 之外的内容 | Package version、dependency、`package.json`、`pnpm-lock.yaml`、runtime config、生成的产品 catalog、branding、license、release workflow 或 publication credential |
| Standard 基线验证 | 聚焦的源码启动/配置检查、构建后 Web/CLI 与 package invariant、release-family packing、已安装 CLI identity、已安装 Web readiness/clean shutdown | 真实 model/provider 调用、宽泛产品 e2e、Windows Wine 诊断、GUI 交互验收或完整平台 CI |
| Science | 只做清单与来源记录 | Science Session、Runtime、runtime-context、filesystem、tools、preset、chart、Outcome、settings、sidebar 或 client 代码与测试 |
| Desktop 与 release | 分列 identity，并明确标记 absent 或 `NOT-RUN` | Electron/Tauri 代码、installer、updater、signing、notarization、Authenticode、npm publication、Git tag、push、PR 或公开 release |

如果 RC5 不修改产品源码就无法通过基线检查，R0 必须停止。不得把“必要元数据”用作源码修复的入口。任何拟议的 `package.json`、lockfile、package、application、runtime configuration、test fixture 或 product doc 变更，都需要新的范围决定或进入 R1。

## 身份台账与上游接收

| 身份类别 | 精确身份或必填字段 | R0 处理 | 最大可声明结论 |
|---|---|---|---|
| 采用的官方源码 | `https://github.com/deepseek-ai/deepseek-harness.git`；提交 `47f943859bef60e4160492346772ded9b24f765a`；tree `f904efab9ef435201d6ba4da88a34d6366568272`；根版本 `0.1.0-rc.5`；MIT；source archive URL 与 R0 计算的 SHA-256 | 不可变的 R0/R1 首版本基线 | 仅限精确官方源码身份 |
| R0 基线候选 | 分支 `codex/science-v01-rc5-baseline`；`<R0B_HEAD>`；直接以 `47f943...` 为根的 parent chain；精确的 R0-only diff | R0 唯一交付物 | 只限 `<R0B_HEAD>` 实际记录的 source/build/packed 结果 |
| 已观察 npm artifact | `@deepseek-ai/dsh@0.1.0-rc.6`；上述发布时间与 integrity；缺少 `gitHead` | 只为防止替代而记录；v0.1 忽略 | 存在未映射的 npm artifact |
| Science overlay | 当前 main 源码 `e5e8b29...`；候选身份 `fae091e...` 和 `b15f1ef...`；逐项 delta 的源码路径与提交 | 仅列清单；每次只迁移一个 R1 slice | 现有下游源码或历史证据，绝不代表 RC5 兼容性 |
| Desktop artifact | 采用的基线中不存在第一方 DSH Science Desktop 源码或 artifact | `NOT-RUN`；不使用占位版本或 checksum | 没有 Desktop 证据 |

v0.1 开发期间，上游接收只做观察，并且可以不执行。记录者最多每两天一次保存官方 default-ref SHA、release/security 链接、观察时间，以及一个 disposition：`no-impact`、`security-review-required` 或 `post-v0.1-migration-input`。记录绝不 merge、rebase、cherry-pick、更新依赖，也不会仅因分支移动就使 RC5 失效。可信的安全或阻塞构建事件会暂停受影响工作，并开启独立的 change-control 决定。v0.1 完成后，由一个迁移任务选择届时最新的精确官方 SHA，并重放已接受的小型 overlay stack；无需逐个采用期间观察到的版本。

## 分支与 worktree 流程

1. 重新记录所有现有 worktree 的路径、分支、HEAD、staged、unstaged 和 untracked 状态。把每个既有路径都视为受保护的用户数据。
2. 验证官方 URL、精确 commit、tree、根版本、许可证，以及支持的 Node/pnpm 版本。如果本地缺少该 commit object，只从官方 URL fetch 该精确对象，不移动任何本地或 remote-tracking branch。
3. 验证 `codex/science-v01-rc5-baseline` 和选定的非 `/tmp` worktree 路径均不存在。该 worktree 必须与当前列出的所有 worktree 隔离，并适用于后续会拒绝通用临时根目录的 Science 测试。
4. 直接从 `47f943859bef60e4160492346772ded9b24f765a` 创建分支和 worktree。不配置 upstream branch，也不从下游历史 merge、rebase 或 cherry-pick。
5. 只应用经过审查的 R0A 内容 allowlist。官方版本、许可证、仓库元数据、release workflow、package graph、lockfile 和产品源码保持不变。
6. 把每一项检查和证据行绑定到当前完整 `<R0B_HEAD>`。检查后任何内容变更都会使受影响结果失效，并要求重新运行。
7. 只有所有退出条件都通过，才能创建本地 R0 commit。随后停止，不 push、tag、建 PR、publish 或清理其他 worktree。

必需 ancestry 是 `47f943...` 后面只接小型、R0-owned 的文档/证据 commit。旧下游根、`main`、Phase 3 与 R 探针提交不得出现在 `<R0B_HEAD>` ancestry 中。

## Overlay 清单

每个清单行至少使用以下 schema。

| 字段 | 必填内容 |
|---|---|
| `delta_id` | 不受 commit 顺序影响的稳定本地标识符 |
| `owner` | 人员/团队，以及负责的 package 或 process 领域 |
| `source_identity` | 仓库 URL、完整源码 SHA 和源码路径；证据不同的多个 SHA 必须分列 |
| `target` | 采用的源码 SHA，加目标 package、capability 或 carrier |
| `classification` | 必须且只能是 `generic`、`upstream-candidate`、`Science-owned` 或 `Desktop-owned` 之一 |
| `dependencies` | 必须先存在的其他 delta ID 和精确 upstream API |
| `port_status` | `not-started`、`mapping`、`candidate`、`verified`、`deferred` 或 `rejected` |
| `tests` | 计划的聚焦 source、build、packed、real-runtime、Desktop 和 release 检查；不适用层也要明确 |
| `evidence` | 精确 candidate SHA、command、result、date、platform 和 evidence layer；历史证据要标为 historical |
| `disposition` | Port、rewrite、propose upstream、retain only as reference 或 reject，并包含 hard-stop reason |

R0 至少建立以下初始行，但不迁移它们。

| Delta | 来源 | 分类 | R0 状态与最早 owner |
|---|---|---|---|
| 通用 runtime-context 修复 | `0a940733...` 加测试修复 `e5e8b29...`，`packages/core/agent-loop` | `upstream-candidate` | 已在下游 `main` 实现；尚未做 RC5 mapping 或检查；模型可见 Science tools 之前需要，R0 之前不需要 |
| Science Session 领域 | `e5e8b29...`，`packages/science/science-session` 及其通用 projection/event 依赖 | `Science-owned` | 只在下游集成；R1 唯一 next slice |
| Science Runtime | `e5e8b29...`，`packages/science/science-runtime`；R 探针修复 `b15f1ef...` 保持独立 | `Science-owned` | 下游已集成基础设施，`b15f1ef...` 有独立接受的 real-runtime 证据；Science Session 之后才能迁移，并在 RC5 上重新验证 |
| 只读文件系统入口 | `8c7d5e01...` 和 `0073f6e0...` | `upstream-candidate` | 仅在 Phase 3 候选中；整体候选未接受；延后到 Consumer 需要时 |
| Science tool Consumer | `27c96d8e...`，`packages/science/tool-science` | `Science-owned` | 仅为候选；继承 Phase 3 hard stop；依赖 Runtime 与 runtime-context 修复 |
| 内置 Science preset | `fae091e...`，Science preset/config/snapshot 路径 | `Science-owned` | 仅为候选；最终 review 失败；依赖已接受的 tools 与 composition 证据 |
| Charts 与 Outcome | 无 implementation SHA | `Science-owned` | `not-started`；在 tools/preset 之后 |
| Settings 与 Science sidebar/client | 无 implementation SHA | `Science-owned` | `not-started`；先完成产品决定与 projection API |
| Desktop carrier | 无 implementation SHA 或第一方 artifact | `Desktop-owned` | `not-started`；只有共享 Web Standard 与 Web Science composition 通过后才开始 |

## 入口、退出与 hard stop

| 类型 | 条件 | 必需响应 |
|---|---|---|
| Entry | 本范围记录及适用的发行/MVP 决定集已接受；R0A 有已分类的文件台账和精确 R0B allowlist | 只从命名 SHA 开始 R0A/R0B |
| Entry | 官方 URL 能解析到精确 commit/tree/version/license；支持的 Node 和固定 pnpm 可用；目标分支/路径不存在 | 创建 worktree 前记录这些值 |
| Entry | 既有 `main`、`origin/main`、Phase 3、R 探针、治理、任务和 Grok worktree 的身份与 dirty 状态已记录 | 按路径保护，并在退出时再次比较 |
| Exit | `<R0B_HEAD>` 直接派生自 `47f943...`；diff 只包含已批准的非产品 allowlist；worktree 干净 | 记录完整 SHA、parent list、tree、status 和 diff manifest |
| Exit | 身份台账与每个 overlay 行都具有 owner、source、target、classification、dependency、status、tests 和 evidence-layer state | 不保留未知或隐式接受的 delta |
| Exit | 文档、聚焦 source、build、packed CLI、packed Web readiness 与 clean-diff 检查在 `<R0B_HEAD>` 全部 PASS | 记录原样 command 和 output；不得复用旧 SHA 的结果 |
| Exit | 每个受保护的既有 worktree 与 ref 都和入口快照相同 | 报告零干扰后停止 |
| Hard stop | 官方 identity、archive、tree、version 或 license 不一致；source object 无法归因到官方 URL | 不创建或推进基线 |
| Hard stop | dirty/untracked 路径未分类、与其他 owner 重叠或会被覆盖；目标 branch/path 已存在 | 停止，不清理也不接管 |
| Hard stop | R0 需要修改产品源码、测试、package manifest、lockfile、runtime config、branding、license 或 release workflow | 把变更重新限定到 R1 或独立决定 |
| Hard stop | 必需检查失败、受环境阻塞且没有可复现的 host 重跑，或检查运行在不同 SHA | 不得宣称 R0 完成，也不得提交 PASS 标签 |
| Hard stop | 某步骤会 push、tag、publish、创建 PR、访问 release credential，或修改既有受保护 ref/worktree | 停止并取得单独明确授权 |

## 最小验证矩阵

| 层 | `<R0B_HEAD>` 上的最小命令或探针 | R0 含义 | 调查状态 |
|---|---|---|---|
| Identity 与 scope | `git rev-parse HEAD HEAD^{tree}`；`git merge-base --is-ancestor 47f943859bef60e4160492346772ded9b24f765a HEAD`；`git diff --name-status 47f943859bef60e4160492346772ded9b24f765a..HEAD`；`git status --porcelain=v2 --branch` | 精确 ancestry、allowlist delta 和 clean tree | identity 输入已验证；未来 `<R0B_HEAD>` 为 `NOT-RUN` |
| Toolchain/install | `node --version`；`pnpm --version`；`pnpm install --frozen-lockfile` | 用受支持 engine 和不可变 dependency graph 复现 RC5 | `NOT-RUN` |
| Documentation | 迭代时聚焦运行 `verify-agent-note-format`、`verify-agent-note-classification` 和 `verify-translation-pairing`；随后运行 `pnpm run doc-sync` 与 `git diff --check` | canonical record、link、pair integrity 与 generated-doc freshness | R0B 为 `NOT-RUN` |
| Standard source | `pnpm exec vitest run apps/cli/tests/source-launch.compat.spec.ts apps/cli/tests/web-agent-presets.e2e.ts` | 不使用真实 credential 验证源码 CLI 启动及已交付 Standard/Web composition | `NOT-RUN` |
| Standard build | `pnpm run check:ci:artifacts`；然后在不重建的情况下运行 `DSH_REQUIRE_BUILT_CLI_SMOKE=1 pnpm exec vitest run apps/cli/tests/lazy-search-startup.compat.spec.ts` | Host/client/Web build、publint、package invariant、构建后的 CLI 和 loopback Web readiness | `NOT-RUN` |
| Release-family pack | 复现无需 credential 的 `release.yml` pack job：`pnpm run release:verify --family dsh`，把 dsh/vendor/Landlock entry pack 到 worktree 外目录，然后运行 `pnpm run release:verify-packed-install --family dsh --from ...` | RC5 package version、tarball closure、dependency resolution 和已安装 CLI version；不写 registry | `NOT-RUN` |
| Packed Standard Web | 在同一隔离 packed consumer 中，用隔离的 `DSH_HOME` 运行 `node <consumer>/node_modules/@deepseek-ai/dsh/lib/bin.js web --host 127.0.0.1 --port 0`，等待 ready URL，终止进程并要求退出码 `0`；沿用 `scripts/publish-npm-baseline.ts` 中已提交的 readiness 语义 | Packed Web 闭包在没有 monorepo fallback 的情况下达到 loopback readiness 并干净退出 | `NOT-RUN` |
| Protected state | 重复入口 worktree/ref/status 清单，并比较精确输出 | 没有改变任何既有用户工作 | `NOT-RUN` |

R0 不运行 `test:e2e`、需要 key 的模型 snapshot、真实 Python/R acceptance、Windows Wine 检查、浏览器交互验收、Desktop build、installer、updater 检查、signing、notarization、Authenticode、publication 或 release verification。这些项目明确保持 `NOT-RUN`，不是静默跳过。

## 保留与回滚

当前 `main`、现场核对的 `origin/main`、Phase 3 候选、R 探针分支、dirty 治理 worktree、dirty Grok worktree 以及每个 detached checkout 都是只读输入。R0 不对它们执行 stage、clean、reset、checkout、prune、repoint 或 delete。任何受保护路径的状态发生变化都是 hard stop，即使该变化看似无关。

R0 失败只影响新建的 R0 worktree 和 branch。默认失败动作是记录新 worktree 的精确 status 与 HEAD，并将其留在原处以供检查。只有证明目标是本任务创建的精确路径、每项变更都归本任务所有且已保留或有意放弃、不存在 untracked 用户路径，并记录完整 HEAD 后，才允许丢弃。通过 Git 移除精确 worktree；默认保留 branch。删除本任务创建的精确 branch 需要单独明确的丢弃授权。绝不使用递归文件系统删除、reset 或 checkout 来“清理”失败候选。

## 预计文件、package 与测试影响

| 阶段 | 预计路径 | 明确不影响 |
|---|---|---|
| 本次范围调查 | 仅本 Agent Note 的英文/中文 pair、其 `.i18n.yaml` 记录，以及 pairing workflow 用于恢复的内容寻址 `refs/dsh/translation-pairing/snapshots/*` ref | 不影响任何其他文档、源码、测试、manifest、lockfile、worktree、既有 branch/tracking ref 或 remote |
| R0A | 既有治理 owner 的发行/MVP note pair；最小 evidence-route instructions、symlink、pairing/budget exclusion 及其聚焦测试；大范围说明压缩除非独立需要，否则拆开 | 不影响 `packages/`、`apps/`、`vendor/`、`native/`、产品测试、package manifest、lockfile 或 release workflow |
| R0B | 新开发线上的本范围记录；一对带日期的 RC5 baseline/evidence 记录；证据中的一个 overlay inventory；仅限机械必需的 documentation-route metadata | 不影响产品或 runtime 源码、生成的 product catalog、package/version/dependency，也不改 Science 或 Desktop 测试 |
| R1 及以后 | 首先是 `packages/science/science-session`；后续精确行可能触及通用 Session/projection owner、Science Runtime、agent-loop、filesystem、tools、preset、charts/Outcome、settings/client 和 Desktop package，以及各自负责的 tests/docs | R0 不授权上述任何路径 |

构建和测试命令可能产生 ignored output 和 worktree 外 artifact。R0 记录其精确位置，只能在所有进程结束、且确认已接受证据不依赖这些文件后，移除本任务创建的可丢弃输出。它绝不把仓库清理解释为可以修改其他 worktree 的权限。

## 文档生命周期

本记录以 `proposed/process` Agent Note 开始，因为它授权未来 workflow，并包含 acceptance criteria。只有 R0B 已存在、所有 exit condition 在同一个精确 `<R0B_HEAD>` 上通过，并且本文改写为现在时的 `Decision`、`Verification` 和 `Consequences` 章节后，它才移到 `implemented/process`。移动文件不会把 `NOT-RUN` 层变成 PASS。

R0A 建立路由后，精确 SHA、archive hash、command、platform、result 和 protected-state snapshot 应进入带日期的 R0 baseline evidence record。稳定架构文档只在产品代码存在后记录当前 composition 或 extension-point 事实；不得写入 branch 名、当前 worktree status 或 check report。临时 plan 和 handoff 只有在其持久事实已经转移、且所属任务允许删除时才退役；R0 不会因为本记录取代了其规划用途，就删除已有临时材料。

有范围的 Agent Note 审计保留 proposed Science MVP 与 distribution 决定，因为它们负责产品架构；保留 implemented npm release-sequence 决定，因为它负责 packing/publication 机制；也保留部分被取代的 artifact-first publication 提案，因为 R0 没有解决其剩余 installed-artifact 问题。任何 active note 都不会只因为新增本范围记录就具备 archive 或 delete 条件。

v0.1 和后续 latest-source migration 都完成后，只有当 implemented R0 note 的 baseline-selection rationale、negative guarantee 与 overlay replay rule 不再指导未来发行时，才能将其 archive。proposed note 永远不能 archive；放弃的 proposal 应按照 Agent Note 生命周期规则 reject 或 delete。

## 唯一下一步

R0 完成后的唯一 NEXT 是：**R1：在 `<R0B_HEAD>` 上迁移并验收 Science Session 领域。** 只有 R0 worktree 干净、精确 baseline 检查已记录、Science Session 清单行列出当前 main 源码路径与每项必要 RC5 adaptation，并且 R1 diff 能限制在该领域及无法避免的通用 event/projection 支持时，R1 才能开始。R1 不包含 Science Runtime、runtime-context 修复、只读 filesystem、Science tools/preset、charts/Outcome、settings/sidebar、Desktop、publication 或迁移最新版。任何 RC5 SHA 变更或 R1 新发现都要求建立新的精确 candidate，并在接受前重跑受影响检查。

## 待决问题与未知项

执行 R0 不需要其他产品决定：产品负责人已选择 RC5，并把 latest-source migration 推迟到第一版本之后。Build failure、archive checksum、API mapping 与 candidate scope 都是可以在执行现场查明的事实，不得作为偏好问题退回用户。

真正的后续决定仍有意延后：任何 push 前确定 canonical public repository 与 remote；Desktop release 工作前确定 v0.1 应用名称、bundle identifier、signing identity 与 update feed；settings 实现前确定外部 Python/R prefix 的最终 settings-card 语义；post-v0.1 migration 时确定采用的精确官方源码。这些事项都不阻塞未修改的 RC5 baseline。

## 考虑过的替代方案

**把当前下游历史 rebase 或 merge 到官方 RC5。** 拒绝，因为两段历史没有 merge base，并相差数千个官方 commit。结果会隐藏归属，并把已接受、已失败和未实现工作混在一起。

**v0.1 从 RC6 开始，或持续跟随最新官方源码。** 拒绝，因为 RC6 无法映射源码，且产品负责人已将 v0.1 固定为 RC5。持续采用会反复使每次 overlay 验收失效；一次 post-v0.1 migration 是有界替代方案。

**把治理收口作为 R0 之前的独立阶段。** 拒绝，因为没有已接受 identity/evidence route 的基线不能成为 authority。R0A 把治理保留在 R0 内，同时防止它污染 R0B 源码 diff。

**把 dirty 治理 worktree 整体复制到 RC5。** 拒绝，因为其中的发行决定、产品 note 对齐、证据路由、说明压缩、manifest、test 和 symlink 分属不同 owner。R0A 先进行分类和拆分，再由 R0B 迁移 allowlist。

**在 R0 迁移当前已实现的 Science Session、Runtime 或通用 runtime-context 修复。** 拒绝，因为任何产品代码都会让基线失败原因变得含糊，并消除干净比较点。R1 从唯一一个 Science Session slice 开始。

**不做本地 source/build/packed 检查，直接信任官方 RC5 元数据。** 拒绝，因为上游 publication 不能证明本仓库的精确 branch、允许的 diff、本地 toolchain、packed Web/CLI 闭包或不存在 monorepo fallback。

## 验收标准

- R0A 记录已接受的治理决定集、证据路由、精确 commit identity、supersession disposition 与 R0B 文件 allowlist，同时不接管无关 dirty 路径。
- `codex/science-v01-rc5-baseline` 直接从 `47f943859bef60e4160492346772ded9b24f765a` 开始，没有下游历史 ancestor，只承载 R0-owned 非产品 commit。
- 采用的 source、R0 head、被忽略的 observed npm artifact、Science overlay 与缺失的 Desktop artifact 分别占用独立 identity 行，且不推断等价关系。
- Overlay inventory 包含每个已知 `generic`、`upstream-candidate`、`Science-owned` 与 `Desktop-owned` delta，满足必需 schema，且没有迁移产品代码。
- 最终 diff 只包含已批准的 documentation/evidence allowlist，不包含 `packages/`、`apps/`、`vendor/`、`native/`、`package.json`、lockfile、product test、branding、license 或 release-workflow 变更。
- Documentation、focused source、build、release-family pack、installed CLI identity 与 packed Web readiness 检查在同一个精确 `<R0B_HEAD>` 上 PASS；其他证据层都明确保持 `NOT-RUN`。
- R0 worktree 干净，每个既有 worktree/ref/status 与 entry snapshot 相同，并且没有发生 cleanup、push、tag、PR、publication 或 credential access。
- Handoff 只命名一个 NEXT：满足上述 entry contract 的有界 R1 Science Session 迁移。

## 风险

主要风险是让一条历史无关的分支伪装成 RC5 更新、把失败的 Phase 3 代码作为一个已接受 overlay 迁移、让大范围治理清理支配基线 diff，或把 source/build 证据提升成 release 声明。精确源码与基线 identity、R0A/R0B 拆分、清单 schema、绑定 SHA 的检查和独立证据层共同限制这些风险。

第一版本期间固定 RC5，意味着之后要承担一次迁移成本。这是有意选择：第一版获得稳定源码与审查目标，而 post-v0.1 migration 有自己的精确源码选择、compatibility audit、overlay replay 和 acceptance，不必通过每日 rebase 持续支付迁移成本。
