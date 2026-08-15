# DSH Science v0.1 R1 Science Session 收尾证据

[English](2026-08-15-dsh-science-v01-r1-science-session.md) | 中文

调查时间为 2026-08-15，平台为 macOS 26.5.2（Darwin 25.5.0，arm64），Node v24.14.0，pnpm 11.7.0。范围授权文档：[DSH Science v0.1 R1 Science Session on RC5](../../.agents/notes/implemented/feature/2026-08-15-dsh-science-v01-r1-science-session.md)。

## 结果

R1 在 `741ec08af3163475f55ffda3fb6188a801e3ff1a`（分支 `codex/science-v01-r1-science-session`）处被接受，位于已接受的 R1 plan base `8880834c06b64ae91d5d750ea7d7e8b6d4f9c910` 之上两个提交；而该 plan base 本身直接派生自已接受的 R0B closure `f9bb7b4a91afe1cf69568184ff093fa9a8bd52f9`，二者之间只有文档/治理相关路径。`git merge-base --is-ancestor 47f943859bef60e4160492346772ded9b24f765a HEAD` 与 `git merge-base --is-ancestor f9bb7b4a91afe1cf69568184ff093fa9a8bd52f9 HEAD` 均成功。Worktree 干净。

## 精确身份

| 主题 | 身份 |
|---|---|
| R1 plan base | `8880834c06b64ae91d5d750ea7d7e8b6d4f9c910`（归档 R0 scope 记录，加入 R1 scope note） |
| R1 候选 head | `741ec08af3163475f55ffda3fb6188a801e3ff1a`，树 `59d1554ca8b6384215c7c5590a22c26bfc2b3ecb` |
| 提交 1 | `eb55f54138` —— 为 RC5 `packages/session/session-projection/src/index.ts` 中的 `ProjectionDefinition` 添加可选的 `checkpointStateSchema`、`checkpointStateSeq`、`viewChanged` |
| 提交 2 | `741ec08af3` —— 将 `packages/science/science-session` 移植到 RC5 上；修复了提交 1 中一个被本包自身移植过来的测试捕获到的水位线 admission 缺口 |
| Science 源码快照 | `omdsh-dev/dsh-science@e5e8b29b435f67e0a5dde5e2132580966e78b27b`，`packages/science/science-session/**` |
| 官方 RC5 | `deepseek-ai/deepseek-harness@47f943859bef60e4160492346772ded9b24f765a`，未变；除下方这一个新包自身的 manifest 及机械集成各行之外，无任何产品/包/lockfile 路径变更 |

## 最小验证矩阵

| 层级 | 命令 | 结果 |
|---|---|---|
| 范围与祖先关系 | `git merge-base --is-ancestor <R0B> HEAD`；`git merge-base --is-ancestor <RC5> HEAD`；`pnpm run change-scope --base 8880834c06 --head HEAD` | PASS —— 两条祖先关系均成立；每一个变更路径都可追溯到 scope note 的 Expected Impact 表或某个 owning generator（完整清单见提交信息） |
| Science 与 registry 行为 | `pnpm exec vitest run packages/science/science-session/tests packages/session/session-projection/tests` | PASS —— 70/70（27 个 session-projection + 43 个 science-session） |
| 聚焦的逐文件覆盖率 | `pnpm exec vitest run --coverage --coverage.include='packages/science/science-session/src/**' --coverage.include='packages/session/session-projection/src/**' packages/science/science-session/tests packages/session/session-projection/tests` | PASS —— 语句、分支、函数、行均 100%（546/546、488/488、122/122、469/469） |
| 既有持久化消费方 | `pnpm exec vitest run packages/session/session-projection-cache/tests packages/session/session-persistence-jsonl/tests packages/session/session-persistence-sqlite/tests packages/session-query/session-query/tests packages/session-query/session-query-sqlite/tests` | PASS —— 497/497，无回归 |
| 静态与包检查 | `pnpm run typecheck`；`pnpm run check:ci:artifacts` | PASS —— typecheck 退出码 0；check:ci:artifacts 5/5（build、publint、node-next-types、built-package-invariants、built-bin smoke） |
| Hygiene（逐项子检查） | `knip`、`constraints`、`verify-dsh-package-licenses`、`verify-package-invariants`、`verify-cordis-config`、`verify-node-next-types`、`verify-runtime-closure`、`verify-vendored-links` | 逐项单独运行，均 PASS |
| Hygiene（`rescope-vendor:check`） | `pnpm run rescope-vendor:check` | **FAIL —— 已确认为与本变更无关的既有问题。** 在未修改的 plan-base 树上（先 `git stash` 再重跑）复现出完全相同的 26 条问题清单，分布在 `packages/extensions/*`、`docs/subsystems/extensions.*` 等本变更从未触碰的路径上。`hygiene` 复合脚本因 `&&` 在第一个子检查处短路，因此上面每个后续子检查都单独运行以获得真实信号 |
| 文档 | `pnpm run doc-sync`；`pnpm run lint` | PASS —— doc-sync 28/28 个 gate；lint 退出码 0 |
| 精确候选评审 | 在 `741ec08af3163475f55ffda3fb6188a801e3ff1a` 处进行的全新 `sonnet` 评审，提供 scope note、精确 diff 与独立重跑指示 | PASS —— 独立重跑测试、覆盖率、回归、typecheck、doc-sync、hygiene 与 rescope-vendor 命令并复现了记录结果；blob 哈希比对确认 17 个已复制源码文件与 11 个测试文件一致；手工追踪水位线 admission 后未发现缺陷。由于源码 worktree 中有一份未追踪且未完成的本证据记录副本，评审使用了精确 detached checkout；该副本不影响 `741ec08af3`。评审还识别出依据 RC5 推导的 `tsconfig.json` references 是下方记录的第二处适配。源码行数更正见本表下方 |

### 更正

精确候选评审确认了命令结果与 blob 身份，但没有正确重新推导源码行数。下方更正后的树清单仅取代该项计数；候选 SHA、逐字节一致结论、适配项与验证结果均不变。

### 明确标记为 NOT-RUN

真实 provider/模型调用、需要 key 的 e2e 或快照录制、真实 Python/R、浏览器或 Desktop 验收、打包安装器、签名、发布与 release，对 R1 而言均为 **NOT-RUN**：本切片未新增任何面向模型的 Consumer，也没有已组装的 Science 组合，因此这些层级尚不适用。

## 领域移植溯源

对原记录的更正：该树包含 18 个 `packages/science/science-session/src/*.ts` 文件（2098 行）。排除经过适配的 `src/index.ts` 后，余下 17 个源码文件（2032 行）与 `omdsh-dev/dsh-science@e5e8b29` 逐字节一致；全部 11 个 `tests/*.ts` 文件（2683 行）也逐字节一致，因此逐字节一致部分共 4715 行，源码与测试合计共 4781 行。这 17 个已复制源码文件与 11 个测试均不涉及下游 session-projection 重构中被排除的部分（`definitionToken`、owner-aware 的 HMR 接管、callback containment、prototype-key hardening、文件拆分，或持久化/查询/生命周期相关改动）。17+11 个相同文件之外有两处适配：`src/index.ts` 从 `ctx.sessionProjections.register(...)` 中去掉 `definitionToken` 字段，因为 RC5 更简单的 `ProjectionDefinition` 未声明它；`tsconfig.json` 使用依据 RC5 推导的 TypeScript project `references`，去掉 `vendor/cosmokit` 并指向 RC5 的包布局。`package.json` 与两份 README 均从 RC5 同级包模板出发重写，而非直接复制。

`packages/session/session-projection/src/index.ts` 是被扩展，而非被替换：RC5 现有的单文件 `SessionProjectionRegistry`（428 行：`register`、`onChanged`、`snapshot`、`checkpoint`、`restoreFloor`、`viewCheckpoint`、`restore`、`drive`）新增了三个可选的 `ProjectionDefinition` 成员，并恰好在 R1 scope note 指定的五个集成点（checkpoint 创建、零 I/O checkpoint 视图、restore-floor 选择、冷恢复、实时通知）应用它们——这些逻辑是针对 RC5 自身代码与约定重新推导而成，而非从下游那个文件拆分、感知 HMR 的六文件 registry 实现中复制而来。

## Overlay 清单更新

| `delta_id` | 之前状态 | R1 后状态 |
|---|---|---|
| `GEN-SESSION-REGISTRY` | 仅在 R1 中 `mapping` | `verified` —— 已添加并覆盖 `checkpointStateSchema`、`checkpointStateSeq`、`viewChanged`；未移植下游 registry 的任何其他能力 |
| `SCI-SESSION` | `not-started`；R1 的唯一产品切片 | `verified` —— 已在 `741ec08af3163475f55ffda3fb6188a801e3ff1a` 处移植并获得覆盖；其余每一条 overlay 行（`GEN-RUNTIME-CONTEXT`、`SCI-RUNTIME`、`SCI-R-PROBE`、`FS-READONLY`、`FS-READONLY-LOAD-FIX`、`SCI-TOOLS`、`SCI-PRESET`、`SCI-CHARTS-OUTCOME`、`SCI-SETTINGS-SIDEBAR`、`DESKTOP-CARRIER`）与 [R0 closure evidence](2026-08-15-dsh-science-v01-r0-rc5-baseline-closure.md) 中记录的状态完全一致；R1 未触碰其中任何一条 |

## 受保护状态的保全

本任务被禁止触碰的每一个既有 worktree 与 ref，在 `741ec08af3` 落地之后被重新记录，均与其入口快照完全一致：`main`（`e5e8b29b435f67e0a5dde5e2132580966e78b27b`，干净）、`origin/main`、dirty 的治理 worktree、R-probe 分支、Phase 3 候选、另外两个 detached 的 task worktree、dirty 的 Grok worktree、`codex/science-v01-r0a-governance-closure`（`73c0e9c004`，干净）、`codex/science-v01-rc5-baseline`（`f9bb7b4a91af`，干净），以及 R1 plan worktree（`8880834c06`，干净）。没有任何受保护 worktree 被 stage、clean、reset、checkout 或 repoint。未发生任何 push、tag、PR 或发布。

## 风险、未知项与暂缓的产品决策

- `packages/extensions/tool-cordis/src/api-catalog.ts` 的改动是 `gen-cordis-catalog` 机械再生成的结果，反映了 Cordis catalog 中新的 `ProjectionDefinition` 形状；它不是手写改动，除确认其确为 generator 输出外未做逐行单独评审。
- `rescope-vendor:check` 既有的 26 条问题缺口仍未解决；R1 既未修复也未扩大该缺口，对其应在何时被处理不表态。
- Science Runtime、工具、preset、图表/Outcome、设置/侧边栏、客户端 UI 与 Desktop，均与 R0 closure overlay 清单中记录的状态完全一致——`not-started` 或 `deferred`，不受 R1 影响。
