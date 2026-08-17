# DSH Science v0.1 rc.5→rc.7 基线迁移证据

[English](2026-08-17-dsh-science-v01-rc7-rebaseline.md) | 中文

调查于 2026-08-17，平台 macOS 26.5.2（Darwin 25.5.0，arm64），Node v24.14.0，pnpm 11.7.0。Scope authority：[DSH Science v0.1 rc.7 基线迁移](../../.agents/notes/proposed/process/2026-08-17-dsh-science-v01-rc7-rebaseline.md)。

## Outcome

DSH Science 开发线自 [R0](../../.agents/notes/archived/process/2026-08-15-dsh-science-v01-r0-release-baseline-scope.md) 起固定在官方 rc.5（`47f943859bef60e4160492346772ded9b24f765a`）上，本次在 `codex/science-v01-rc7-rebaseline` 分支上合并了官方 rc.7（`99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`，标签 `dsh-v0.1.0-rc.7`）。合并基点恰好是 rc.5 标签；上游在其上贡献了 111 个提交，Science 开发线贡献了 48 个。合并解决了两处机械性冲突，且无需任何源码修复：双方都可能触碰到的每一份生成产物，其重新生成结果与已提交内容零差异；在合并提交上失败的每一项检查，要么是与 rc.5 基线逐条一致、经确认为既有问题的失败，要么是 [R5 证据](2026-08-17-dsh-science-v01-r5-charts-outcome.md)中已记录的既有环境问题，要么是经孤立复测确认不可复现的负载敏感型 flake。一次独立的纯文档提交提出了本次基线迁移的 Agent Note，把 proposed 状态的 R6 note 中 R6c settings 表层计划改写为 rc.7 打开的那条路径，并修正了 R1/R2 implemented notes 中两处已不再成立的现在时断言。

## Exact identities

| Subject | Identity |
|---|---|
| 此前的开发线基线（R0） | `deepseek-ai/deepseek-harness@47f943859bef60e4160492346772ded9b24f765a`，标签 `dsh-v0.1.0-rc.5` |
| 新的上游 head | `deepseek-ai/deepseek-harness@99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`，标签 `dsh-v0.1.0-rc.7` |
| 合并基点 | `47f943859bef60e4160492346772ded9b24f765a`（经 `git merge-base` 确认，与 R0 标签一致） |
| 基线迁移前的 Science 分支尖端 | `codex/science-v01-r3-science-tools-plan` 上的 `bb911b9c0c` |
| 合并提交（Phase 1 head） | `ecde1b09ff1efee2a68e199025aa37414426331b` |
| 文档提交（Phase 2 head） | `5c64af5339256c0365b9868d189cd64979cc409b` |
| 基线迁移分支 | `codex/science-v01-rc7-rebaseline`（未 push） |
| 版本号提升 | `packages/science/science-runtime`、`packages/science/science-session`、`packages/science/tool-science`、`packages/client/ui-science`、`packages/session/session-attachment-index`：`0.1.0-rc.5` → `0.1.0-rc.7` |
| 下游 source | 无；这是两棵已发布树之间的纯源码合并，不是一次移植 |

## Conflict resolutions

| File | Resolution |
|---|---|
| `packages/host/apiproxy/src/api-proxy.ts` | 保留 Science 开发线把 `referencedImage`/`imageInEvent`/`imageBlockIn` 移入 `@deepseek-ai/dsh-session-attachment-index` 的改动，以及上游删除 `WEB_SETTINGS_NAMESPACES`/`PRODUCT_SETTINGS_NAMESPACES`/`settings-not-exposed` 的改动。去掉不再使用的 `SETTINGS_NAMESPACE as AGENT_PRESET_SETTINGS_NAMESPACE` 导入；保留 `PresetNotCopyableError` |
| `scripts/doc-budgets.manifest.json` | 保留 `".agents/AGENTS.md": 160`，采用上游的 `"AGENTS.md": 1950` |

## Verification matrix

| Layer | Command | Result |
|---|---|---|
| 生成产物 | `pnpm run gen-cordis-catalog`、`gen-cordis-api`、`gen-client-catalog`、`gen-tool-catalog`、`gen-config-catalog`、`gen-persistence-catalog`、`gen-module-graph`、`gen-third-party-notices`，随后 `git status --short` / `git diff --stat` | PASS——每个 generator 都运行了；对合并提交而言全部 8 个都是零字节差异 |
| Typecheck | `pnpm run typecheck` | PASS——exit 0（`build:lib:host` + `tsc -b tsconfig.client.json`） |
| Lint | `pnpm run lint` | PASS——exit 0（`build:lib:host` + `oxlint`） |
| Build | `pnpm run build` | PASS——exit 0 |
| Hygiene | `pnpm run hygiene` | **仅 `rescope-vendor:check` 失败，属既有问题。** 其余 11 项子检查（`knip`、`publint`、`constraints`、`verify-dsh-package-licenses`、`verify-package-invariants`、`verify-built-package-invariants`、`verify-cordis-config`、`verify-node-next-types`、`verify-optional-dependency-imports`、`verify-runtime-closure`、`verify-vendored-links`）逐条单独运行均 PASS |
| `rescope-vendor:check` 一致性 | 在合并提交，以及在 rc.5 合并基点上的一次性 detached worktree 中运行 `tsx scripts/rescope-vendor.ts --check` | 两处均报告 26 个问题；对两份排序后的 residue 列表求 `diff` 为空——集合完全一致，确认该失败属既有问题、并非本次基线迁移引入（与 [R5 证据](2026-08-17-dsh-science-v01-r5-charts-outcome.md)此前对同样 26 个问题的确认一致） |
| Documentation | `pnpm run doc-sync`（在合并提交上运行一次，在 Phase 2 编辑完成后的文档提交上再运行一次） | 两次均 PASS——29/29 gates，含 doc budgets、translation pairing（在最终 head 上全库 967 对一致）、module graph、agent-note format/classification |
| 仓库单元测试套件 | `pnpm run test` | 首次运行：3 失败 / 13882 通过 / 109 跳过（共 13994）——`packages/hooks/hooks-claude-code/tests/bridge.spec.ts`、`packages/hooks/hooks-claude-code/tests/coverage-edge-paths.spec.ts`、`packages/shell/bash-sandbox/tests/partial-landlock.spec.ts`，均为在全量套件并行负载下的 `Test timed out in 5000ms`。单独重跑这 3 个文件：43/43 通过，0 失败——确认为负载敏感，并非回归 |
| Keyless snapshots | `pnpm run test:snapshot` | 2 失败 / 117 通过 / 1 跳过（共 120）——两处失败都在 `examples/acp-agent/tests/goal.snapshot.ts`，断言空 stderr 时，Node 24.14.0 会打出一条与之无关的 `node:sqlite` experimental-feature 警告；这个确切的文件与原因已经作为既有的、仅限本地的问题记录在 [R5 证据](2026-08-17-dsh-science-v01-r5-charts-outcome.md)的 Risks 部分 |
| Web browser lane | `pnpm run test:web` | 首次运行：8 失败 / 255 通过 / 7 跳过（共 270）。`apps/web/tests/smoke-real.e2e.ts` 中 5 处失败：与 [R5 证据](2026-08-17-dsh-science-v01-r5-charts-outcome.md)记录的既有问题失败特征完全一致（`<div class="BdGIFa_copy">` 这个 onboarding-notice 浮层，在全新 `DSH_HOME` 下拦截了 workspace picker 上的指针事件）。`apps/web/tests/subagent-interrupt-ui.e2e.ts`（2 个测试）与 `apps/web/tests/background-job-list.e2e.ts`（1 个测试）共 3 处失败，均为 golden/timing 不一致。单独重跑这 2 个文件：6/6 通过，0 失败——确认为负载敏感，并非回归 |
| Whitespace | `git diff --check 47f943859b...HEAD`（分别在合并提交与最终文档提交上运行） | PASS——两次都 exit 0，无输出 |
| Real-API e2e | `pnpm run test:e2e` | `NOT-RUN`——本环境没有根 `.env`，也没有 `DEEPSEEK_API_KEY`；该套件按设计在无 key 时自跳过，因此这是无 key 环境的限制，而不是失败 |
| 真实 Python/R Science 验收 | 无 | `NOT-RUN`——本次未搭建隔离的 Conda 验收环境，不作声明 |
| Desktop、provider 与 release | 无 | `NOT-RUN`——本次基线迁移不产生任何 carrier、installer、签名、发布、tag 或 release 产物 |

### Explicitly NOT-RUN

`test:e2e`（无 key）、真实 Python/R Conda 验收、`test:coverage`（本轮要求的检查是 `test`，不是它）、Windows 与 Linux 平台 lane（由 CI 负责该矩阵）、Desktop 与 packed installer、签名、notarization、Authenticode、npm 发布、Git tag、GitHub release、Git push 与 PR 创建。

## Review

合并本身无需任何源码修复。两处冲突都是机械性的（同一文件/manifest 中互不相干的改动；双方改动均完整保留），且合并可能弄脏的全部 8 个 generator，其输出都与已提交树逐字节一致，因此无需任何重新生成提交。

在合并提交上观察到的每一处测试失败，都能追溯到与本次基线迁移无关的三类原因之一：R5 证据中已经点名过、文件与症状完全一致的既有问题（`rescope-vendor:check` 的 26 个问题、`goal.snapshot.ts` 的 Node 24.14 SQLite 警告、`smoke-real.e2e.ts` 的 onboarding 浮层指针拦截）；或是一个时序敏感的测试，只在本次验证过程连续运行全量套件造成的负载下失败，单独运行时立刻通过（`bridge.spec.ts`、`coverage-edge-paths.spec.ts`、`partial-landlock.spec.ts`、`subagent-interrupt-ui.e2e.ts`、`background-job-list.e2e.ts`）。没有任何测试需要手改期望值，也没有任何 fixture 被重新录制。

在依赖上游 rc.5→rc.7 对 `packages/settings` 与 `packages/client/ui-conversation` 的改动之前，先直接比较了二者的 diff（`git diff 47f9438...upstream/master -- packages/settings packages/client/ui-conversation`）：rc.7 没有改动 settings seam 的读写 API，也没有改动 `ui-conversation` 的 Details column（rc.7 只增加了 Safari `InputBar` 处理），这确认——而非假定——了基线迁移前的 R6a/R6b 提交（`f5bbcf0ff2`、`bb911b9c0c`）无需任何适配。

## Overlay inventory update

| `delta_id` | Prior status | rc.7 基线迁移后状态 |
|---|---|---|
| `SCI-SETTINGS-SIDEBAR` | `deferred` | 不变：`deferred`——本次只是源码层面的基线迁移；R6c 明确不在范围内 |
| Remaining overlay rows | 如 [R5 收口证据](2026-08-17-dsh-science-v01-r5-charts-outcome.md)所记录 | 不变 |

## Protected-state preservation

`/Users/superjj/ccproj/DSHscience`（分支 `codex/science-v01-rc7-rebaseline`）之外没有任何 worktree 被 stage、clean、reset、checkout 或 repoint。为确认 `rescope-vendor:check` 的一致性，曾在 session scratch 目录下创建过一个位于 rc.5 合并基点的一次性 detached worktree，将其 `node_modules` 软链接到主 worktree（只读使用），随后立即移除（`git worktree remove --force`）。没有执行任何 push、tag、PR、publish、release 或 Conda 环境变更。

## Risks, unknowns, and deferred product decisions

- 本证据只覆盖源码层面的基线迁移。R6a 与 R6b 现在落在与其提交（`f5bbcf0ff2`、`bb911b9c0c`）最初落地时不同的树上；未来对任一检查点的验收都必须针对本次基线迁移之后的 head 评审，而不是它们基线迁移前的 SHA，依据见[基线迁移 note](../../.agents/notes/proposed/process/2026-08-17-dsh-science-v01-rc7-rebaseline.md)的 Risks 部分。
- `rescope-vendor:check` 既有的 26 个问题缺口仍然存在，与本次无关。
- `examples/acp-agent/tests/goal.snapshot.ts` 与 `apps/web/tests/smoke-real.e2e.ts` 在本地仍然是红的，原因与既有记录完全相同；二者都不像 `test:e2e` 那样在本环境自动跳过。
- 真实 Python/R Conda 验收与每一个 Desktop/release 层，本次基线迁移都未涉及；它们没有任何 rc.7 证据，不得被解读为 R2 或 R5 在 rc.5 上验收结果的延伸。
- R6c（Science settings 卡片、header action、Details entry、默认 Web Runtime row）不在本次范围内实现，依据其明确的 out-of-scope 指示。
