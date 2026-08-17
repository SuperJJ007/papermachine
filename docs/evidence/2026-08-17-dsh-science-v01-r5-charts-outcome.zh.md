# DSH Science v0.1 R5 图表与 Outcome 收尾证据

[English](2026-08-17-dsh-science-v01-r5-charts-outcome.md) | 中文

调查时间为 2026-08-17，平台为 macOS 26.5.2（Darwin 25.5.0，arm64），Node v24.14.0，pnpm 11.7.0。范围授权文档：[DSH Science v0.1 R5 图表与 Outcome](../../.agents/notes/implemented/feature/2026-08-16-dsh-science-v01-r5-charts-outcome.md)。

## 结果

R5 产品工作在分支 `codex/science-v01-r3-science-tools-plan` 的 `69045ba510f90380f5ed83ca1acbd955e7178fbf` 上验收通过，位于已验收 R4 收口 head `fb04b0d273a6d4d3a319a4e8243c44953010f930` 之上的八个线性提交。Science preset 现在暴露五个模型侧工具，一个已提交的 `science/chart-saved` event 本身即可为读取与导出授权自己的附件，已交付 Web composition 也能从持久数据回放 chart 与 Outcome rows。

规划要求三个分别验收的检查点 head（registry、生产端、presentation）。实现最终以一条按同样依赖顺序排列的八提交序列落地，下列全部 gate 都在最终合并 candidate 上运行，而不是在三个分别验收的 head 上运行。该偏差已记入 Note，也是 R5 唯一未按原文满足的验收标准。

收尾修复了实现遗留的两个缺陷，以及更早轮次引入的两处过期保证。可运行的 keyless Science 示例已经完全无法激活，因为 Runtime 现在等待 `attachments`，而且它没有覆盖任何新工具；`c6dae9e585` 在该 composition 中挂载 attachment store，并把脚本化模型扩展到两个 chart version 与一次 Outcome。R4 记录为既有失败的 `knip` 被修复，而不是继续携带。自 R2 起一直 `NOT-RUN` 的仓库单元测试套件暴露出：R4 的 fail-closed preset 元数据使 in-process subagent 的 preset-inheritance 用例全部无法挂载，tool-catalog harvest 保证也仍停留在 `tool-science` 加入之前的名单；`305462f43f` 与 `69045ba510` 分别修复了这两项。

## 精确身份

| Subject | Identity |
|---|---|
| 官方 RC5 | `deepseek-ai/deepseek-harness@47f943859bef60e4160492346772ded9b24f765a` |
| 已验收 R4 收口 head（R5 基线） | `fb04b0d273a6d4d3a319a4e8243c44953010f930` |
| Commit 1 | `a9a03fcdf2f2259b8de8ad6476f389800f10b839` —— `@deepseek-ai/dsh-session-attachment-index` 与两个 ApiProxy 调用点 |
| Commit 2 | `ecee9b8127c252eb27edaa1f86d7f4ebfb458cef` —— Runtime chart commit、`save_chart`、`publish_outcome`、共享 nested-dispatch guard、脱敏 chart state、Science extractor |
| Commit 3 | `161d176a313f15ee9a93c663d286111bdd2dda71` —— `@deepseek-ai/dsh-client-ui-science` 与通用 `loadImage` toolview wiring |
| Commit 4 | `731d3e03c97657728e7551f391da42b366fad38a` —— 五工具 Science preset 与已交付 Web bundle rows |
| Commit 5 | `c6dae9e585fcd2e0224a2d9a912cdf65c4139465` —— assembled keyless 源码 scenario、Web preset scenario、browser fixture replay |
| Commit 6 | `174d6b20e82cbc723772b89bf13950c04e908d15` —— subsystem、catalog 与 package 文档 |
| Commit 7 | `305462f43f15854246aef834c6f79c040aa43c63` —— in-process subagent driver preset fixtures 的随附元数据 |
| Commit 8 | `69045ba510f90380f5ed83ca1acbd955e7178fbf` —— tool-catalog harvest 保证中的 Science 工具 |
| R5 产品 candidate | `69045ba510f90380f5ed83ca1acbd955e7178fbf` |
| Clean acceptance archive | 由 candidate 的 `git archive` 展开到 `/Users/superjj/ccproj/dshscience-r5-acceptance-archive`，以 `pnpm install --frozen-lockfile --prefer-offline --ignore-scripts` 安装 |
| 隔离 DSH homes | `/Users/superjj/ccproj/dshscience-r5-acceptance-dsh-home` 与 `…-dsh-home-2`，mode `0700`，不在 `/tmp` 下 |
| 真实 Python prefix | `/opt/miniconda3/envs/qwen`（既有 Conda，含 `conda-meta/history`，prefix 内 Python 3.13.5） |
| 真实 R prefix | `/Users/superjj/.conda/envs/dsh-r-acceptance`（既有 Conda，含 `conda-meta/history`，prefix 内 Rscript） |
| 下游 source | 无；R5 是原创 RC5-line 工作，没有下游移植或 cherry-pick |

## 验证矩阵

| Layer | Command | Result |
|---|---|---|
| 范围与祖先 | `git diff --check fb04b0d273..HEAD`；`CI=true pnpm --silent run change-scope --base fb04b0d273 --head HEAD` | PASS —— whitespace exit 0；每个变更路径都对应 R5 Note 行、其所属 generator，或已披露的 fixture 修复 |
| 受影响包单元测试 | `pnpm exec vitest run packages/science packages/session/session-attachment-index packages/host/apiproxy packages/client/ui-science packages/client/ui-tool` | PASS —— 896 passed，62 files；覆盖 Science fold/projection/invariants、Runtime chart 生命周期与文件系统竞态、Consumer guards 与 evidence 校验、registry authorization/export，以及 Client rows |
| 仓库单元套件与 coverage gate | `pnpm run test:coverage` | 在 candidate 上 PASS —— 842 files 中 13 761 passed / 109 skipped，per-file 100% 阈值达成，exit 0。修复前同一命令在 `preset-inheritance.spec.ts` 与 `gen-tool-catalog.spec.ts` 失败 7 项，另有 `packages/boot/app-boot/tests/hmr-config.spec.ts` 一次与负载相关的文件监听超时，该文件单独运行与最终运行均通过 |
| keyless 源码 snapshots | `pnpm exec vitest run --config vitest.snapshot.config.ts` | 所有 Science scenario PASS —— 重新录制的 `science-tools` model view 固定全部五个工具 schema 与 guidance section，其 stream 固定每个 `tool/result` 之前的 `science/chart-saved`、两个连续 version、一次 Outcome、tagged presentation metadata，且没有 image bytes |
| Web browser lane | `pnpm exec vitest run --config vitest.web.config.ts` | 所有 keyless 文件 PASS —— 76 files 中 258 passed / 7 skipped，含已交付 composition 的 chart/Outcome fixture replay（已存储与缺失对象、lightbox focus 与 Escape 复位、reload replay、两个 Outcome revision），以及驱动 run、两次保存、发布与脱敏 state 的五工具 Web preset scenario |
| Web 真实 key smoke | `pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/smoke-real.e2e.ts` | **FAIL —— 既有问题，与本次无关。** 其 keyless CLI 用例通过；真实 key 用例无法到达 composer，因为 `9ee5aef98c` 引入的 onboarding 通知对话框在全新 `DSH_HOME` 中拦截指针事件，而 `b70a549714` 早已删除该文件的关闭步骤。R5 既未改动该文件也未改动该对话框 |
| 静态检查 | `pnpm run typecheck`；`pnpm run lint:contracts-ready` | PASS —— 两者 exit 0 |
| 文档 | `pnpm run doc-sync` | PASS —— 28/28 gates |
| Module graph | `pnpm run verify-module-graph` | **在 candidate 上 FAIL，收口后已更正。** R5 新增了 `client-ui-science` 与 `session-attachment-index`，并给 `science-runtime` 添加了 `attachment` 依赖，却没有重新生成 `docs/module-graph.md`。上表遗漏它，是因为 `doc-sync` 不承载该 gate，hygiene 子检查清单也不含它；只有 `check-all` 与 CI 静态 lane 会运行。已在紧随此收口 head 的更正提交中重新生成并重录配对 |
| Hygiene 子检查 | `knip`；`publint`；`constraints`；`verify-dsh-package-licenses`；`verify-package-invariants`；`verify-built-package-invariants`；`verify-cordis-config`；`verify-node-next-types`；`verify-runtime-closure`；`verify-vendored-links` | PASS —— 逐项单独运行；`knip` 自 R3 以来首次通过，因为 `examples/headless-agent` 的两个 Science fixtures 现已声明为 entries |
| Hygiene（`rescope-vendor:check`） | 在 candidate 与一次性 worktree 中的 `fb04b0d273` 上运行 `pnpm exec tsx scripts/rescope-vendor.ts --check` | **FAIL —— 既有问题，已确认一致。** 同样的 26 个问题也出现在 R5 基线上；R5 既未新增也未修复 |
| 跨文件重复 | 在 candidate 与同一一次性 worktree 的 `fb04b0d273` 上运行 `pnpm run duplication` | 作为对比 PASS —— 两个版本都是 8 组 clone，集合完全相同；R5 未引入新的 clone |
| 真实 Python/R 第 1 次 | 在 candidate 的 clean archive 中，使用两个既有 prefixes 与第一个隔离 home 运行 `test:real-acceptance` | PASS —— `python.status=PASS`，`r.status=PASS`，无 `prefixManifestDifferences`；两种语言都通过真实 PNG 产物创建、chart commit 与 attachment readback、chart replay 与 Outcome publication |
| 真实 Python/R 第 2 次 | 同一命令与 candidate，使用第二个隔离 home | PASS —— Python 与 R 的独立报告完全一致 |
| Desktop、provider 与 release | 无命令 | `NOT-RUN`；R5 不产生 carrier、installer、签名、发布、tag 或 release 证据 |

### 明确 NOT-RUN

Windows 与 Linux 平台通道（由 CI 拥有矩阵）、带凭据的真实 provider e2e、Desktop 与打包安装器、signing、notarization、Authenticode、npm publication、Git tag、GitHub release、Git push 与 PR 创建，在 R5 均为 `NOT-RUN`。

## Review

收尾前的状态通过了作者们的定向检查，但仍有两项验收义务未完成，还有一处更早的回归未被发现。

可运行 keyless 示例是较大的缺口。`@deepseek-ai/dsh-science-runtime` 现在注入 `attachments`，因此没有挂载 attachment store 的 `examples/headless-agent/science-tools.cordis.snapshot.yml` 以 `science-runtime: pending (waiting for service: attachments)` 无法激活。该 scenario 也没有扩展到新工具，因此没有任何可运行示例执行 `save_chart` 或 `publish_outcome`，也没有 snapshot 固定它们的模型侧 schema。Commit 5 在 Runtime 旁挂载 `@deepseek-ai/dsh-attachment-local`，让 fake subprocess 在每个 run 自有的 `SCIENCE_ARTIFACT_DIR` 写入 deterministic PNG，并把模型脚本扩展为 state、run、两次保存、发布与最后一次脱敏 state 读取。录制该 scenario 同时暴露两个 normalizer 缺陷：chart identities 会塌缩进 run-id token，模型侧 `environmentFingerprintPreview` 未被归一化，而它所预览的 fingerprint 会随临时 prefix 变化，这会让期望值不稳定。

仓库单元套件自 R2 起一直 `NOT-RUN`。在 candidate 上运行后暴露两处过期保证。R4 的 fail-closed preset 策略（`cda69a9e5f`）破坏了 `packages/subagent/subagent-in-process-driver/tests/preset-inheritance.spec.ts` 的全部用例，因为这些 fixtures 从 `trust: 'system'` 根挂载却没有 `preset.yml`，而该提交把它变为必需；commit 7 补上 agent-presets 系统 fixtures 使用的同一份最小元数据，该 driver 的四个文件 58/58 通过。`packages/core/tools/tests/gen-tool-catalog.spec.ts` 仍期望 R3 中 `tool-science` 加入 `TOOL_PACKAGES` 之前的 harvest 名单，R5 的两个新增把既有的三个名字漂移扩大为五个；commit 8 恢复该保证。

其余检查确认实现符合设计：模型结果只有文字且不含 attachment handle、durable event order 中 Science event 先于其 tool result、脱敏后的 state entries、包含显式失败对象的 session-authorized browser replay，以及两种语言 prefix 不变的真实 Conda 运行。

## Overlay inventory update

| `delta_id` | Prior status | R5 status |
|---|---|---|
| `SCI-CHARTS-OUTCOME` | `deferred`（自 R0 起开放） | 在产品 candidate `69045ba510` 上 `verified` |
| `SCI-SETTINGS-SIDEBAR` | `deferred` | 不变：`deferred` |
| `DESKTOP-CARRIER` | `deferred` | 不变：`deferred` |
| 其余 overlay rows | 与 [R4 收口证据](2026-08-16-dsh-science-v01-r4-science-preset.md) 记录一致 | 不变 |

## Protected-state preservation

没有对 `/Users/superjj/ccproj/DSHscience`（分支 `codex/science-v01-r3-science-tools-plan`）之外的任何 worktree 执行 stage、clean、reset、checkout 或重新指向。为确认既有的 `rescope-vendor:check` 与重复检测结果，在会话 scratch 目录下创建了一个位于 `fb04b0d273` 的一次性 detached worktree；clean acceptance archive 与其两个 mode-`0700` home 也都在仓库之外。未执行 push、tag、PR、publish、release、环境变更或 Conda prefix 变更；两次 real-acceptance 报告的 prefix manifest 均未变化。

## Risks, unknowns, and deferred product decisions

- R5 以一条有序序列落地，而不是三个分别验收的检查点 head，因此 range 内没有任何中间提交在自己的 tree 上过 gate；验收声明依赖最终 candidate。
- `rescope-vendor:check` 的既有 26 项缺口仍然开放，既有的 8 组 `duplication` 缺口同样开放，且没有任何 R5 文件出现在这些 clone 对中。
- `apps/web/tests/smoke-real.e2e.ts` 因上述 onboarding 对话框原因在本地保持红色。没有 `DEEPSEEK_API_KEY` 时它会自动跳过，因此 CI 看不到；该对话框变更的负责人应恢复关闭步骤。
- `examples/acp-agent/tests/goal.snapshot.ts` 在不传 `--disable-warning=ExperimentalWarning` 的情况下断言 stderr 为空，因此 Node 24.14 的 `node:sqlite` 实验性警告会让它在本地失败。headless 与 JSON-RPC snapshot scenario 已经传入该 flag。
- `packages/boot/app-boot/tests/hmr-config.spec.ts` 最多等待十秒的文件系统监听事件，在全套件负载下超时过一次，而单独运行与最终运行均通过。这是对负载敏感的时序断言，不是 R5 行为。
- 挂载 `@deepseek-ai/dsh-science-runtime` 却没有 attachment store 的部署，现在会让 Runtime 停在等待 `attachments`，而不是在首次使用时失败；此时的 diagnostic 是 Loader 激活消息，不是 Science 专用消息。
- 真实 Python/R acceptance 只证明本机两个 prefix 上的 interpreter-to-artifact integration。plotting library 可用性、保留 scratch 与 attachments 的配额与垃圾回收、settings/sidebar 表面、Desktop 与 release 仍是后续切片的开放工作。
