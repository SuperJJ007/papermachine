# DSH Science v0.1 R2 Science Runtime 收尾证据

[English](2026-08-15-dsh-science-v01-r2-science-runtime.md) | 中文

调查时间为 2026-08-16，平台为 macOS 26.5.2（Darwin 25.5.0，arm64），Node v24.14.0，pnpm 11.7.0。范围授权文档：[DSH Science v0.1 R2 Science Runtime on RC5](../../.agents/notes/implemented/feature/2026-08-15-dsh-science-v01-r2-science-runtime.zh.md)。

## 结果

R2 产品工作在 `4c3c814f7a51d7e48717afef91ba4369d05ab3e6`（分支 `grok/science-v01-r2-runtime`）处被接受，位于 R2 plan base `a1c9ba2a48c9ccc6895f821456a4d2942c6ebe2c` 之上五个线性提交。`git merge-base --is-ancestor 7e11de7e4beaf17dd87cf19368cfc930837dc77c HEAD` 与 `git merge-base --is-ancestor a1c9ba2a48c9ccc6895f821456a4d2942c6ebe2c HEAD` 均成功。不存在来自 `e5e8b29…` / `bf4be8…` / `2386ad5…` / `390fbde…` / `b15f1ef…` 的 merge 或 cherry-pick parent。在加入本 evidence triplet 并迁移 implemented Note 之后，implementation worktree 其余部分干净。

## 精确身份

| 主题 | 身份 |
|---|---|
| 官方 RC5 | `deepseek-ai/deepseek-harness@47f943859bef60e4160492346772ded9b24f765a` |
| 已验收 R1 head | `7e11de7e4beaf17dd87cf19368cfc930837dc77c` |
| R2 plan base | `codex/science-v01-r2-runtime-plan` 上的 `a1c9ba2a48c9ccc6895f821456a4d2942c6ebe2c` |
| R2 产品候选 | `4c3c814f7a51d7e48717afef91ba4369d05ab3e6`，树 `c797c9c77a3eccc8351dae5bda9a1630d3f909f5` |
| 提交 1 | `a5bf92c0a0` —— 必需的 `environmentBase`、`executionWorld` 与 `utf8Validity` |
| 提交 2 | `f9d3ee7ab3` —— 一个 sandbox classifier owner |
| 提交 3 | `eabee7a343` —— 与 RC5 对齐的 `@deepseek-ai/dsh-science-runtime` |
| 提交 4 | `95669a4f6a` —— standalone `Rscript --version` |
| 提交 5 | `4c3c814f7a` —— catalog/generator 集成 |
| 下游 Runtime 源 | `omdsh-dev/dsh-science@e5e8b29b435f67e0a5dde5e2132580966e78b27b`，`packages/science/science-runtime/**` |
| 隔离 DSH home | `/Users/superjj/ccproj/dshscience-r2-acceptance-dsh-home`，mode `0700`，不在 `/tmp` 下 |
| 真实 Python prefix | `/opt/miniconda3/envs/qwen`（既有 Conda，`conda-meta/history`，prefix 内 Python 3.13.5） |
| 真实 R prefix | `/Users/superjj/.conda/envs/dsh-r-acceptance`（既有 Conda，`conda-meta/history`，prefix 内 Rscript 4.5.3） |

## 验证矩阵

| 层级 | 命令 | 结果 |
|---|---|---|
| 范围与祖先关系 | `git merge-base --is-ancestor 7e11de7e4b HEAD`；`git merge-base --is-ancestor a1c9ba2a48 HEAD`；`pnpm --silent run change-scope --base a1c9ba2a48 --head HEAD`；`git diff --check a1c9ba2a48..HEAD` | PASS —— 两条祖先关系均成立；每一个已提交路径都映射到 R2 Note 或某个 owning generator；空白检查退出码 0 |
| 通用 subprocess 行为 | 针对 `packages/subprocess/subprocess/tests`、`packages/subprocess/subprocess-local/tests`、`packages/e2b/subprocess-e2b/tests` 以及每一个已变更 Consumer 测试目录的聚焦 Vitest | PASS —— 758 通过 / 27 跳过，34 个文件 |
| Sandbox classification | 针对 `packages/sandbox/sandbox/tests`、`packages/shell/bash-sandbox/tests` 与 `packages/shell/pwsh-sandbox/tests` 的聚焦 Vitest | PASS —— 111 通过 / 13 跳过，7 个文件 |
| Runtime 行为 | `pnpm exec vitest run packages/science/science-runtime/tests packages/science/science-session/tests` | PASS —— 128 通过，17 个文件 |
| 聚焦的逐文件覆盖率 | 针对 `packages/science/science-runtime/src/**` 以及每一个因 R2 变更的 generic source file 的定向 Vitest coverage，遵守规范的 `types.ts` 与其他仓库 exclusions | PASS —— 43 个文件，886 通过 / 40 跳过；纳入的文件语句/分支/函数/行均为 100% |
| 静态与包产物 | `pnpm run typecheck`；`pnpm run check:ci:artifacts` | PASS —— typecheck 退出码 0；check:ci:artifacts 5/5（build、publint、node-next-types、built-package-invariants、built-bin smoke） |
| Hygiene 剩余子检查 | `knip`、`constraints`、`verify-dsh-package-licenses`、`verify-package-invariants`、`verify-built-package-invariants`、`verify-cordis-config`、`verify-node-next-types`、`verify-runtime-closure`、`verify-vendored-links` | 在已知的 `rescope-vendor:check` 短路之后逐项运行，均 PASS |
| Hygiene（`rescope-vendor:check`） | `pnpm run rescope-vendor:check` 并与 `a1c9ba2a48` 比较 | **FAIL —— 既有且确认未变。** R2 plan base 与产品候选上的 26 条问题清单完全相同；已披露，不称为 PASS |
| 文档 | 具名 pairing 重录；`pnpm run doc-sync`；`pnpm run lint` | PASS —— doc-sync 28/28；lint 退出码 0 |
| 真实 Python/R 第 1 次 | 在 `4c3c814f7a` 上使用上述隔离 mode-`0700` home 与两个既有 prefixes 的 opt-in `test:real-acceptance` | PASS —— `python.status=PASS`，`r.status=PASS`，无 `prefixManifestDifferences` |
| 真实 Python/R 第 2 次 | 同一命令、同一候选、同一 prefixes、同一 home | PASS —— `python.status=PASS`，`r.status=PASS`，无 `prefixManifestDifferences` |
| 精确候选评审 | 仅针对变更的 generic contracts 与 Runtime lifecycle/security、在 `4c3c814f7a51d7e48717afef91ba4369d05ab3e6` 处的全新子代理评审 | PASS —— 无阻断项；已追踪 environment base、execution world、UTF-8 validity、classifier 优先级、exact-Session lease、start-before-spawn、quiescence、remote reject，以及 prefix/credential/event confinement |

### 明确标记为 NOT-RUN

对 R2 而言，repository-wide unit suite、model snapshots、browser suites、provider e2e、Desktop、打包安装器、签名、发布、tag、release、Git push、PR、Runtime Context、filesystem read-only、`tool-science`、Science preset 与 Client UI 均为 `NOT-RUN`。这些层级超出本切片；CI 负责穷尽矩阵。历史下游 PASS 不是 R2 证据。

## 领域移植溯源

Runtime package 针对 RC5 从 `omdsh-dev/dsh-science@e5e8b29` 的 `packages/science/science-runtime/**` 重新推导，然后再应用 isolated `b15f1ef…` `Rscript --version` correction。Package metadata、TypeScript references、READMEs 与 generator 集成均按 RC5 适配（`0.1.0-rc.5`，public，MIT），并且不复制下游的 `0.0.1-rc.2` / restricted / BSD metadata，也不复制 `vendor/cosmokit` reference。

通用 subprocess facts 与 sandbox classifier 是新的 RC5 patches，不是对 `bf4be8…` / `2386ad5…` / `390fbde…` 的 cherry-pick。既有 Consumers 显式命名 `'scrubbed-parent'`。Science 是唯一的 `'empty'` 调用方，并且在 owner markers、scratch 或 Session events 之前拒绝 `'remote'`。

## Overlay 清单更新

| `delta_id` | 之前状态 | R2 后状态 |
|---|---|---|
| `GEN-SUBPROCESS-RUNTIME-FACTS` | R0 清单中没有作为具名行出现 | 在 `a5bf92c0a0` / `4c3c814f7a` 处 `verified` |
| `GEN-SANDBOX-CLASSIFICATION` | R0 清单中没有作为具名行出现 | 在 `f9d3ee7ab3` / `4c3c814f7a` 处 `verified` |
| `SCI-RUNTIME` | 在 `SCI-SESSION` 被接受之前为 `deferred` | 在 `4c3c814f7a51d7e48717afef91ba4369d05ab3e6` 处 `verified` |
| `SCI-R-PROBE` | `deferred`；独立 evidence identity | 在同一候选的 `95669a4f6a` 处 `verified` |
| `SCI-SESSION` / `GEN-SESSION-REGISTRY` | 在 R1 中 `verified` | 未变 |
| 其余 overlay 行 | 与 [R0 closure evidence](2026-08-15-dsh-science-v01-r0-rc5-baseline-closure.zh.md) 和 [R1 evidence](2026-08-15-dsh-science-v01-r1-science-session.zh.md) 中记录的状态一致 | 未变：`GEN-RUNTIME-CONTEXT`、`FS-READONLY`、`FS-READONLY-LOAD-FIX`、`SCI-TOOLS`、`SCI-PRESET`、`SCI-CHARTS-OUTCOME`、`SCI-SETTINGS-SIDEBAR`、`DESKTOP-CARRIER` |

## 受保护状态的保全

入口处记录的每一个既有 worktree 都未被编辑：`/Users/superjj/ccproj/DSHscience`（`e5e8b29b435f67e0a5dde5e2132580966e78b27b`，`main`）、R2 plan worktree（`a1c9ba2a48`，干净）、R1 worktree（`7e11de7e4b`，干净）、R0A/R0B worktrees、R-probe worktree（`b15f1ef42e`）、dirty 的治理 worktree，以及其他 detached 的 Codex/Grok worktrees。没有任何受保护 worktree 被 stage、clean、reset、checkout 或 repoint。未发生任何 push、tag、PR 或发布。

## 风险、未知项与暂缓的产品决策

- `rescope-vendor:check` 既有的 26 条问题缺口仍未解决；R2 既未修复也未扩大该缺口，对其应在何时被处理不表态。
- File-write confinement 不是 confidentiality。真实验收证明了 prefix write denial 与 environment scrubbing；它不证明 file-read、network、syscall 或 scientific-result isolation。
- Runtime Context、filesystem read-only、`tool-science`、preset、Client UI 与 Desktop，均与 R0/R1 overlay 清单中记录的状态完全一致。
