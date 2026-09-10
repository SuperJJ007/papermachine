# Agent Note: DSH Science v0.1 RC5 发行基线

Status: implemented
Archived: 2026-08-15

[English](2026-08-15-dsh-science-v01-r0-release-baseline-scope.md) | 中文

## 问题

DSH Science 在把 Science 或 Desktop 实现移入公开发行线之前，需要一个来源可归因的上游基线。下游 Science 历史与 DeepSeek Harness 官方源码没有共同祖先；下游开发线还混合了已接受的 Science 基础、未通过的 Phase 3 候选、仓库治理和后续发行工作。重放整段历史会掩盖归属，并混淆源码、构建、已安装制品、真实运行时、Desktop、签名和发布证据。

首个 v0.1 实现还需要稳定源码。在第一版尚未形成完整闭环时持续 rebase 到移动的 upstream，会反复使已接受的 overlay 失效。

## 决定

R0 将 `codex/science-v01-rc5-baseline` 直接建立在官方 DeepSeek Harness 提交 `47f943859bef60e4160492346772ded9b24f765a` 上；该提交的 tree 为 `f904efab9ef435201d6ba4da88a34d6366568272`，根版本为 `0.1.0-rc.5`。唯一交付物是该分支的 accepted tip，以及可机械解析该 tip 的 canonical scope/evidence records。R0 只承载治理路由、身份与验证证据以及 overlay 清单，不包含产品源码、package manifest、lockfile、runtime config、release workflow、Science 或 Desktop 变更。

第一版 DSH Science v0.1 完成前固定使用 RC5。随后由独立迁移任务选择届时最新的精确官方版本，并重放已接受的 overlay stack。RC6 和其他观测版本不改变本基线。

### 精确身份

| 身份 | 值 | 最大可声明结论 |
|---|---|---|
| 采用的官方源码 | `https://github.com/deepseek-ai/deepseek-harness.git`；commit `47f943859bef60e4160492346772ded9b24f765a`；tree `f904efab9ef435201d6ba4da88a34d6366568272`；根版本 `0.1.0-rc.5`；MIT | 精确的公开源码身份 |
| R0A 治理来源 | `codex/science-v01-r0a-governance-closure`；`73c0e9c004157798682759e7d5b0280b9ec913c3`；tree `c53d3a9274ebf3f5986be5f42224f724c0324a91` | 下游谱系中已接受的治理子集 |
| R0B 已检查内容提交 | `948693150e2fe8a9d38fbb1e125a2a106d9488ee`；tree `35062cb234e05176fa83132253ea797634700a1a` | closure-only 提交未改变输入的产品检查 |
| R0B 已接受 HEAD | 最后同时修改本 triplet 和 [closure 证据](../../../../docs/evidence/2026-08-15-dsh-science-v01-r0-rc5-baseline-closure.md)的提交；两个路径解析到同一提交，且该提交为 branch tip | closure 证据中记录的 R0 源码、构建、打包和文档结果 |
| 已观察 npm 制品 | `@deepseek-ai/dsh@0.1.0-rc.6`；registry integrity `sha512-brpZfED7ieRa2PQ5tUxMhHrM1pb2CmKFVM/f6yMULBDMicahk+Z2OsHgTwTDnoiZm23Ftu9rQz0NN4pflaoJcg==`；未观察到 `gitHead` | 存在一个无法映射源码的 npm 制品；它不等于 RC5 |
| Science overlay | `https://github.com/omdsh-dev/dsh-science.git`，精确 SHA 见 closure inventory | 仅为下游源码或历史候选来源 |
| Desktop 制品 | 无 | 不存在 Desktop 源码、安装器、签名或运行证据 |

证据文件无法包含其所在提交自己的 SHA，因此 R0 从 Git 历史机械解析 accepted head，而不在正文中保留自指占位符：

```sh
git log -1 --format=%H -- .agents/notes/implemented/process/2026-08-15-dsh-science-v01-r0-release-baseline-scope.md
git log -1 --format=%H -- docs/evidence/2026-08-15-dsh-science-v01-r0-rc5-baseline-closure.md
```

验收时两个命令返回同一个提交，且 `codex/science-v01-rc5-baseline` 指向它。Closure 记录固定该提交的精确 parent、ancestry、tree、允许路径清单和 clean status。产品输入检查来自 `948693150e2fe8a9d38fbb1e125a2a106d9488ee`；closure 记录证明 accepted head 在该提交之后只修改 scope/evidence triplet。文档检查在 accepted head 自身运行。

### R0A 与 R0B

R0A 对治理 worktree 中 R0 必需的最小子集进行分类和接受，但不接管 dirty architecture-governance worktree。第一个提交在下游谱系中承载发行调研与 Science MVP 对齐；第二个提交建立精简的 Agent/evidence/subsystem 路由、必需 symlink、文档排除项和日期化证据层。根文档与 `docs/AGENTS.md` 的大范围压缩不属于 R0。

R0B 通过内容移植获批文档机制，不执行 merge 或 cherry-pick，并把它放到官方 RC5 历史上。下游根、`main`、Phase 3 和 R-probe 提交不在 R0B ancestry 中。被阻塞的候选可保留本地诊断提交，但只有 closure 记录及其解析到的所在提交构成验收。

### 包含与排除

| 领域 | 包含 | 排除 |
|---|---|---|
| 身份 | 官方 RC5 commit/tree/version/license、已观察 archive checksum、accepted R0 head、未映射 RC6 观测 | 采用 RC6、推断源码与制品等价或跟随移动 upstream |
| 治理 | R0 决定、日期化证据路由、精确验证记录、完整 overlay 清单、机械 pairing/budget/site 元数据 | 整体搬入 dirty 治理变更、大范围文档清理、临时 plan 或聊天 handoff |
| 验证 | Frozen install；文档；Standard source/build/CLI/Web composition；release-family pack；workflow 平台上的已安装 CLI identity；packed Web readiness；精确 Git scope | 真实 provider/model、真实 Python/R、宽泛产品 e2e、Windows 诊断、Desktop、installer、签名、publication 或 release readiness |
| 产品 | 仅清单和来源 | 所有 Science、通用 runtime、Electron/Tauri、Desktop、package、app、test、manifest、lockfile、branding、license 或 release-workflow 实现 |

官方 `release:verify-packed-install` 原文命令在 release workflow 声明的 `ubuntu-24.04` 平台上验证。macOS arm64 上由 `npm install --omit=optional` 触发的源码构建失败保留为平台诊断；去掉该 flag 的适配安装不替代必需的 Ubuntu 结果。

### Entry、exit 与 hard stop

| 类型 | 条件 | 必需响应 |
|---|---|---|
| Entry | 官方 URL、commit、tree、根版本、license、Node range 和 pnpm version 精确一致；R0A 有 accepted allowlist；所有既有 worktree/ref 与 dirty/untracked 状态已记录 | 直接在官方 commit 创建隔离 branch/worktree；不移动既有 ref 或 worktree |
| Entry | 支持的 toolchain 与 release workflow 的 `ubuntu-24.04` 平台可用 | 只运行与 R0 未改产品输入匹配的最小 source/build/packed checks |
| Exit | Accepted tip 只通过 R0-owned documentation/evidence commits 继承官方 RC5；closure commit 的 checked-content parent 为 `948693150e2fe8a9d38fbb1e125a2a106d9488ee`；精确逻辑记录 allowlist 干净 | 记录 ancestry、tree、path manifest、clean status 与 accepted-head 机械解析 |
| Exit | 每个 overlay row 均有 owner、精确 source/target、classification、dependencies、status、planned tests、evidence layer 与 disposition | 所有代码 row 保持未移植，并只命名一个 next slice |
| Exit | 必需 documentation、Standard source/build、release-family pack、workflow-platform installed identity、packed Web 与 protected-state checks 在各自精确输入上 PASS | 把 scope pair 移入 `implemented/process`；其他层保持显式 `NOT-RUN` |
| Hard stop | 官方 identity/archive metadata 不一致；required check 在必需平台 FAIL；result 无法绑定精确未变输入 | 不接受、不 commit、不 fast-forward、不 push R0B closure |
| Hard stop | R0 需要修改 product source/test、package manifest、lockfile、runtime config、branding、license 或 release workflow | 留到 R1 或另行授权的决定 |
| Hard stop | 受保护 worktree/ref 变化、dirty path owner 不清楚，或步骤会 tag、publish、建 release/PR、rewrite history | 停止且不 cleanup 或扩大变更 |

### Overlay inventory 规范

[Closure 证据](../../../../docs/evidence/2026-08-15-dsh-science-v01-r0-rc5-baseline-closure.md#complete-overlay-inventory)保存完整行。每行必须包含：

| 字段 | 必填内容 |
|---|---|
| `delta_id` | 与提交顺序无关的稳定标识 |
| `owner` | 负责的 maintainers 与 package/process 领域 |
| `source_identity` | 仓库 URL、完整源码 SHA 和源码路径；不同证据身份必须分行 |
| `target` | 官方 RC5 SHA 与目标 package、capability 或 carrier |
| `classification` | `generic`、`upstream-candidate`、`Science-owned` 或 `Desktop-owned` 中恰好一个 |
| `dependencies` | 必须先具备的其他 delta ID 和精确 upstream API |
| `port_status` | `not-started`、`mapping`、`candidate`、`verified`、`deferred` 或 `rejected` |
| `tests` | 计划的 source、build、packed、real-runtime、Desktop 和 release 检查，并显式标记不适用层 |
| `evidence` | 精确 candidate SHA、command/result/date/platform/evidence layer，或明确的 historical/NOT-RUN 状态 |
| `disposition` | Port、rewrite、propose upstream、retain as reference 或 reject，以及 hard stop |

清单中的任何一行都不会被隐式接受。源码 SHA 与历史 PASS 只证明 provenance，不证明 RC5 兼容性。

### 验证

[Closure 证据](../../../../docs/evidence/2026-08-15-dsh-science-v01-r0-rc5-baseline-closure.md)记录命令、平台、精确身份、结果和继承输入依据。R0 分开以下证据层：

| 层级 | R0 结果 |
|---|---|
| 官方源码/archive | commit、tree、metadata、GitHub archive SHA-256 与 archive 内容已验证 |
| 文档 | 聚焦 Agent Note/pairing、`doc-sync`、lint 和 whitespace 检查在 accepted head 通过 |
| Standard source/build | Source launch、Standard Web composition、build、publint、NodeNext types、built-package invariants、built-bin smoke 和聚焦 built CLI smoke 通过 |
| Packed artifact | DSH/vendor/Landlock families 完成 pack；官方原文 installed CLI 检查在 `ubuntu-24.04` 通过；packed Standard Web 达到 loopback readiness 并干净退出 |
| Runtime/Desktop/release | 真实 provider、Python/R、Desktop runtime、installer、updater、signing、notarization、Authenticode、npm publication、tag-based release 和迁移最新版均为 `NOT-RUN` |

Source/build PASS 不证明已安装制品、运行时、平台、Desktop、签名或 release 结果。后续源码或产品输入变更只有在精确输入身份证明和受影响重跑后才能继承结果。

### 保留与 upstream intake

既有 `main`、`origin/main`、architecture-governance、task、R-probe、Phase 3、detached 和 Grok worktree 均为受保护输入。R0 不 stage、clean、reset、repoint、delete 或 rewrite 它们。Closure 证据记录 R0 前后的精确 head 与 dirty/untracked 数量。

首个 v0.1 实现期间，上游 intake 只观察，且最多每两天一次。记录包含官方 default-ref SHA、相关 release/security 链接、观察时间和 `no-impact`、`security-review-required`、`post-v0.1-migration-input` 中一个 disposition。观察不会 merge、rebase、cherry-pick，且不会只因 upstream 移动就改变 RC5。可信的安全或 build-blocking 事件进入独立 change control。

### 唯一下一步

唯一的下一项实现是 R1：把 `https://github.com/omdsh-dev/dsh-science.git@e5e8b29b435f67e0a5dde5e2132580966e78b27b` 的 Science Session 域移植到解析所得 R0B accepted head，并完成验收。

R1 必须从干净 worktree 开始，编辑前先映射 `SCI-SESSION` 与 `GEN-SESSION-REGISTRY`。Diff 仅限 `packages/science/science-session` 以及 RC5 确实缺失且不可避免的通用 event/projection registration，并附带 owner tests、文档和精确 RC5 build 证据。R1 不包含 Science Runtime、runtime-context repair、read-only filesystem、Science tools/preset、charts/Outcome、settings/sidebar、Desktop、publication 或迁移最新版。

## 考虑过的替代方案

**把下游历史 rebase 或 merge 到 RC5。** 拒绝，因为两条历史没有共同祖先，且下游混合了已接受、失败和未完成工作。Overlay inventory 在不移植整段历史的前提下保留来源。

**首版从 RC6 开始或持续跟随 upstream。** 拒绝，因为观测到的 RC6 npm 制品没有已验证的源码映射，而持续采用会反复使 overlay 证据失效。首版后一次迁移具有有界源码身份和独立验收。

**用 macOS 适配安装替代必需的 packed-install。** 拒绝，因为去掉 `--omit=optional` 改变了官方命令。必需命令在 workflow 声明的 Ubuntu 平台运行；macOS 结果仍是独立诊断。

**在证据文件中写入其所在提交自己的 SHA。** 拒绝，因为 Git commit 无法包含其最终 hash。机械解析最后同时修改两份 canonical record 的提交可以验证，且不依赖外部 handoff 或可变占位符。

**整体搬入 dirty governance worktree 或 Phase 3 候选。** 拒绝，因为它们包含不同 owner 的问题，且 Phase 3 保留了 whole-candidate FAIL。R0 只接受已审查的治理路由；后续一次只移植一条 inventory row。

## 后果

R0 提供干净 RC5 比较点和精确归属台账，但不声称任何 Science 或 Desktop 功能已经存在。第一版不承担持续跟随 upstream 的反复适配成本；后续迁移承担一次明确的 compatibility 与 overlay replay 成本。

Accepted head 在已检查内容提交后包含一个 documentation-only closure commit。这使证据 authority 留在仓库内，同时不假装文件可以嵌入其所在提交 SHA；精确路径等价检查决定早期结果可以继承的范围，最终文档检查绑定 accepted head。

只要 RC5 仍是第一版基线，或其 replay 规则仍指导后续迁移，本决定就保持 active。没有相关 implemented note 被 archive，没有 proposed note 被 reject，也不会因本决定删除既有临时或 dirty 工作。

后续经明确授权向 remote push accepted branches 只构成仓库内容发布，不会创建产品 tag、npm package、installer、signed artifact 或 release-readiness 声明。
