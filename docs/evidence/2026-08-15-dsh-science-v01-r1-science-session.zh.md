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
| 精确候选评审 | 在 `741ec08af3163475f55ffda3fb6188a801e3ff1a` 处进行的全新 `sonnet` 评审，提供 scope note、精确 diff 与对每个声明数字的独立重跑指示 | PASS —— 从零独立重新推导了本记录中的每一个数字（对全部 17+11 个移植文件与 `omdsh-dev/dsh-science@e5e8b29` 做了 blob 哈希比对，确认除已记录的 `definitionToken` 移除之外逐字节一致；自行重跑了完整的测试/覆盖率/回归/typecheck/doc-sync/hygiene/rescope-vendor 命令并得到相同数字；对水位线 admission 修复做了手工追踪以核实其正确性，而非仅凭测试变绿）。在被评审的提交本身中未发现任何缺陷。两点说明：（1）为获得干净的 `doc-sync` 结果，需要对该确切 SHA 做一次隔离的 detached checkout，因为本 worktree 在评审期间还放着一份未追踪、尚未完成的本记录副本（缺少其 `.i18n.yaml`），与被评审的提交并存——这是评审期间的 worktree 卫生问题，而非 `741ec08af3` 自身的缺陷，已通过下方补全本记录的配对关系解决；（2）`packages/science/science-session/tsconfig.json` 的 TS project `references` 列表与下游源码也存在差异（去掉了 `vendor/cosmokit`——RC5 的同级包并不依赖它），这是机械上必需的改动，并已被 `typecheck` 通过覆盖，但提交信息中按文件范围限定的适配说明未提及它，此处予以更正 |

### 明确标记为 NOT-RUN

真实 provider/模型调用、需要 key 的 e2e 或快照录制、真实 Python/R、浏览器或 Desktop 验收、打包安装器、签名、发布与 release，对 R1 而言均为 **NOT-RUN**：本切片未新增任何面向模型的 Consumer，也没有已组装的 Science 组合，因此这些层级尚不适用。

## 领域移植溯源

`packages/science/science-session/src/*.ts` 的全部 17 个文件（2101 行）与 `tests/*.ts` 的全部 11 个文件（2683 行），均从 `omdsh-dev/dsh-science@e5e8b29` 的 `packages/science/science-session` 完整读取后按原样直接复制文件，未做修改（评审期间已独立做 blob 哈希比对确认逐字节一致），因为它们都不涉及下游 session-projection 重构中被排除的部分（`definitionToken`、owner-aware 的 HMR 接管、callback containment、prototype-key hardening、文件拆分，或持久化/查询/生命周期相关改动）——复制前已逐一读取确认。存在两处适配，均在被复制的 17+11 个文件之外：`src/index.ts` 的 `ctx.sessionProjections.register(...)` 调用去掉了 `definitionToken` 字段，因为 RC5 更简单的 `ProjectionDefinition` 并未声明该字段；`tsconfig.json` 的 TS project `references` 列表是依据 RC5 重新推导而成、而非直接复制，去掉了 `vendor/cosmokit`（RC5 同级包并不共享此依赖），并指向 RC5 实际的包布局。`package.json` 与两份 README 均按 R1 note 的要求，从 RC5 同级包模板出发刻意重写，而非直接复制。

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

## 唯一下一步

唯一的下一项实现是 Science Runtime：在 `741ec08af3163475f55ffda3fb6188a801e3ff1a` 之上，将 `ctx.scienceRuntime` 与一个 host-local 的 `ctx.subprocess`、一个完整的 `ctx.sandbox`，以及已接受的 Science Session invariant 组合起来。其余每一条 overlay 行继续保持暂缓。
