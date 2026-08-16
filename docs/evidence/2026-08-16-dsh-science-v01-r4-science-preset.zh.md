# DSH Science v0.1 R4 内置 Science preset 收尾证据

[English](2026-08-16-dsh-science-v01-r4-science-preset.md) | 中文

调查时间为 2026-08-16，平台为 macOS 26.5.2（Darwin 25.5.0，arm64），Node v24.14.0，pnpm 11.7.0。范围授权文档：[DSH Science v0.1 R4 built-in Science preset on RC5](../../.agents/notes/implemented/feature/2026-08-16-dsh-science-v01-r4-science-preset.md)。

## 结果

R4 产品候选落地为已验收 R3 文档收口 head `92ee890e8da762ba789e74610551b4fd3351ed27` 之上的七个线性 commit。对完整区间的一次独立 clean-context review 未发现任何 `BLOCK` 或 `HIGH` finding；一条文档准确性 nit（`docs/config-catalog.zh.md` 中一处过期的生成行号引用，本身不是 R4 新增事实，但被 `AgentPreset.copyable` 的再生成扰动）在第七个 commit 中修复。本记录提升的正是该修复后的精确区间，head 为 `ac57329b7a2a6912734dee84774ea67b84859007`。

## 精确身份

| 主题 | 身份 |
|---|---|
| 官方 RC5 | `deepseek-ai/deepseek-harness@47f943859bef60e4160492346772ded9b24f765a` |
| 已验收 R3 文档收口 head（R4 plan base） | `92ee890e8da762ba789e74610551b4fd3351ed27` |
| 提交 1 | `e0e932bd5e` —— 通用 `copyable` preset 元信息字段：`dsh-agent-presets` discovery/authoring/index、`dsh-host-apiproxy` wire（`agent-preset-not-copyable`）、`dsh-client-ui-agent-preset` 禁用复制操作 |
| 提交 2 | `d2f39675e4` —— 内置 `science` agent preset（`apps/cli/config/agent-presets/science/{agent.cordis.yml,preset.yml}`）、`dsh-tool-science` 应用依赖，以及 `apps/cli/tests/web-agent-presets.e2e.ts` 中的 Science 覆盖 |
| 提交 3 | `5cf7f8ae11` —— 为第五个 preset 更新随附根目录 ARIA golden |
| 提交 4 | `33f7275e59` —— `apps/web/tests/science-preset.snapshot.ts` 及其已提交 replay fixture |
| 提交 5 | `49b38da347` —— 随附组装文档（`docs/subsystems/science.md`、`tool-science`/`ui-agent-preset` READMEs、重新生成的 `config-catalog.md`/`api-catalog.ts`） |
| 提交 6 | `9d2be4bd3d` —— 将 `science-preset.snapshot.ts` 与 `minimal-preset.snapshot.ts` 一起路由进 host `tsc` program |
| Review 修复 | `ac57329b7a` —— 修复独立 review 发现的 `docs/config-catalog.zh.md` 过期源码行号 |
| 已验收 R4 candidate（本记录的 head） | `ac57329b7a2a6912734dee84774ea67b84859007`，位于 R3 文档收口 head 之上七个 commit |
| Downstream preset provenance | `omdsh-dev/dsh-science@fae091e1080e830bed8ad0456e4cbced29101b01` —— 按本 Note [精确身份](../../.agents/notes/implemented/feature/2026-08-16-dsh-science-v01-r4-science-preset.md#exact-identities)表所述，仅作只读名单/locale/测试输入参考；R4 没有任何一行是从它 cherry-pick 而来 |

## 验证矩阵

| 层级 | 命令 | 结果 |
|---|---|---|
| Scope 与 ancestry | `git merge-base --is-ancestor 92ee890e8d ac57329b7a`；`CI=true pnpm --silent run change-scope --base 92ee890e8d --head ac57329b7a`；`git diff --check 92ee890e8d..ac57329b7a` | PASS —— merge base 为 R3 文档收口 head；报告的路径清单与本 Note[范围](../../.agents/notes/implemented/feature/2026-08-16-dsh-science-v01-r4-science-preset.md#scope) IN 各行精确一致（preset 目录、`apps/cli/package.json` 及 lockfile、`dsh-agent-presets`/`dsh-host-apiproxy`/`dsh-client-ui-agent-preset` 的可复制性接线、两个浏览器 e2e 文件及其 golden、Web snapshot 及其 fixture、CLI e2e 文件、README/subsystem/生成文档，以及两个 tsconfig 路由文件）；没有出现任何 OUT-of-scope 路径（`packages/bundle/web-app/cordis.patch.yml`、`examples/headless-agent/**`、任何 `*/invariant` companion、Host `dsh-science-session` 或 `science-runtime` 行）；没有空白字符违规 |
| Copyability、API 与 client unit | `CI=true pnpm exec vitest run packages/preset/agent-presets/tests packages/host/apiproxy/tests/api-proxy-agent-preset.spec.ts packages/host/apiproxy/tests/rpc-schemas.spec.ts packages/client/ui-agent-preset/tests` | PASS —— 372 passed，17 files |
| CLI preset 组装 | `CI=true pnpm exec vitest run --config vitest.e2e.config.ts apps/cli/tests/web-agent-presets.e2e.ts` | PASS —— 35 passed，1 file；覆盖精确 Science 模型工具名单、`standard`/`science` 隔离、无 Science Runtime 时的明确失败、点名来源的复制拒绝，以及通过 `ctx.isolate('subprocess').isolate('sandbox')` 隔离的 fake-backed（真实 `dsh-science-runtime`、fake subprocess/sandbox）Runtime 成功绑定环境 |
| Web 浏览器与无密钥请求 | `CI=true pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/agent-preset-selection.e2e.ts apps/web/tests/agent-preset-authoring.e2e.ts apps/web/tests/science-preset.snapshot.ts` | PASS —— 14 passed，3 files；更新并断言真实随附根目录 ARIA golden（第五个 preset、本地化文案、禁用的 Science 复制操作），并通过随附 Web scaffold 驱动一次真实无密钥请求，包含 `ctx.agentPresets.mount(agentCtx, 'science')` |
| 已构建应用解析 | `CI=true pnpm run build`；`DSH_EXAMPLE_MODE=lib CI=true pnpm exec vitest run --config vitest.snapshot.config.ts apps/web/tests/science-preset.snapshot.ts`；`CI=true pnpm run check:ci:artifacts` | PASS —— 完整 build exit 0；lib-mode snapshot 1 passed（证明 `apps/web/tsconfig.json`/`tsconfig.host.json` 路由修复与已构建 artifact 解析）；`check:ci:artifacts` 5/5（build、publint、node-next-types、built-package-invariants、built-bin smoke） |
| 配置与 hygiene | `CI=true pnpm run verify-cordis-config`；`CI=true pnpm run hygiene` | `verify-cordis-config` PASS —— 122 个配置文件。`hygiene` 复合检查：除 `rescope-vendor:check` 与 `knip` 外全部 PASS，这两项均为**已确认未变化的 pre-existing** —— 见下文 |
| Hygiene（`rescope-vendor:check`） | `pnpm exec tsx scripts/rescope-vendor.ts --check` | **FAIL —— pre-existing，在 R4 plan base 上确认一致。** 通过一次性 worktree 在 head `92ee890e8d` 上运行，得到完全相同的 26-problem list（Markdown fences、docs prose、code specifiers，分布在 `docs/event-producer-consumer*`、`docs/subsystems/extensions*`、`packages/api/remotes`、`packages/extensions/cordis-*`、`packages/extensions/ui-cordis`、`packages/extensions/tool-cordis/src/api-catalog.ts`、`scripts/gen-cordis-catalog.ts`）；R4 既不新增也不修复它 |
| Hygiene（`knip`） | `pnpm exec knip --treat-config-hints-as-errors` | **FAIL —— pre-existing，在 R4 plan base 上确认一致。** 同样通过一次性 worktree 确认，得到完全相同的 2 个未使用文件（`examples/headless-agent/tests/fixtures/science-{mock-llm,runtime-fixture}.ts`，最后由 R3 review 修复 commit `be46f69b6e` 触碰）；R4 未触碰这两个文件 |
| Hygiene 其余子检查 | `publint`；`constraints`；`verify-dsh-package-licenses`；`verify-package-invariants`；`verify-built-package-invariants`；`verify-node-next-types`；`verify-runtime-closure`；`verify-vendored-links` | PASS —— 225 个 package 声明 MIT；222 个手工拥有与 222 个已编译的 invariant companion 均合规；231 个声明 API 在 NodeNext 下编译；109 个 package 构成闭合的运行时依赖图；9 个 vendored 名称均可解析 |
| 文档 | `CI=true pnpm run verify-agent-note-format`；`CI=true pnpm run verify-translation-pairing`；`CI=true pnpm run doc-sync`；`CI=true pnpm run lint`；`git diff --check` | PASS —— 545 个 Agent Note 均合规；950 对双语文档一致（行号修复之后）；doc-sync 28/28 个 gate；lint exit 0；没有空白字符违规 |
| 跨文件重复 | `CI=true pnpm run duplication` | **FAIL —— pre-existing，与本次改动无关。** 8 组 clone pair，与 R3 evidence record 中记录的完全一致（`goal/goal` 与 `science-session` 的 invariant、`science-runtime` 内部、`bash-sandbox` 与 `pwsh-sandbox`、`gen-config-catalog.ts` 自身克隆）；没有任何 R4 新增或改动的文件出现在其中 |
| 独立 review | 对 `92ee890e8d..9d2be4bd3d`（行号修复之前的六个 commit 区间）以及本验证矩阵的一次 clean-context 语义与 diff review | **ACCEPT WITH NITS** —— 没有 `BLOCK`/`HIGH` finding；reviewer 独立重跑了 copyability/CLI unit 套件（分别 372 与 35 个测试，均为绿色），并把本 Note 的每一项声明（精确 preset 名单/配置/元信息、`copyable` 机制端到端、Host/Runtime 非拥有关系、ARIA golden、`ctx.isolate()` 正确性、tsconfig 路由）逐一对照真实源码核实；唯一可操作的 nit（过期的 `config-catalog.zh.md` 行号）已由 commit `ac57329b7a` 关闭；其余三条 nit 分别是继承自 R1/R3 的按设计 sanitization 范围、一处未模板化的 Host scratch 路径落在 fixture 中却确认从未到达模型可见文本的 fixture 卫生小瑕疵，以及遵循既有仓库先例的测试替身重复——均不需要代码变更 |
| 真实 Python/R 与 provider | 本次 session 未获授权 | 按本 Note 声明为 `NOT-RUN`；与源码、fake-Runtime、built、Web、Desktop 与 release 验收分离 |
| Desktop 与 release | 不运行命令 | `NOT-RUN`；R4 不产生载体、installer、签名、发布、tag 或 release 证据 |

### 明确 NOT-RUN

Repository-wide unit suite（CI 负责 exhaustive matrix）、针对明确授权的既有 Conda prefixes 的真实 Python/R Science Runtime acceptance、Desktop、provider credentials、signing、publication、tag、release、Git push 与 PR，对 R4 均为 `NOT-RUN`。这些 layers 不在本 slice 范围内。

## Review

独立 review 把本 Note[Preset 身份、元数据与名单](../../.agents/notes/implemented/feature/2026-08-16-dsh-science-v01-r4-science-preset.md#preset-identity-metadata-and-roster)一节中的每一项声明，与已提交的 `apps/cli/config/agent-presets/science/{agent.cordis.yml,preset.yml}` 逐字节核对（id、order `5`、中文 `preset.yml` 字符串、`copyable: false`、`profileId: science`、`modeRevision: science-v1`、`stateHistoryLimit: 8`、精确的组合插件清单，以及 `apps/cli/tests/web-agent-presets.e2e.ts` 中断言的精确模型工具名单），确认通用 `copyable` 机制在元信息默认值、`copyComposition()`、Host wire（`agent-preset-not-copyable`，携带 `agentPreset`/`source`/`reason`）与 Web 管理分区的禁用复制操作四处保持一致执行，并通过 `git diff --stat` 确认了[Host、Session 与 Runtime 归属](../../.agents/notes/implemented/feature/2026-08-16-dsh-science-v01-r4-science-preset.md#host-session-and-runtime-ownership)一节的否定性声明（整个区间没有出现任何 `dsh-invariants`、`dsh-science-session` 或 Runtime 行，且 `packages/science/tool-science/src/**` 未被触碰——只有其 README 变化）。它直接通过 `vitest run` 独立重跑了 copyability/API/client unit 套件与 CLI e2e 文件（均为绿色），并以直接阅读的方式审查了 `apps/web/tests/science-preset.snapshot.ts` 及其已提交 fixture，而非执行 `pnpm run test:web`——后者需要一次完整的预先 build，超出了该次 review 的实际时间预算；本记录自身的验证矩阵补齐了这一缺失的执行。

Reviewer 关闭的唯一 finding，是 `AgentPreset.copyable` 字段新增所扰动的一处过期生成交叉引用——只有双语配对的一侧（`docs/config-catalog.zh.md`）仍读取着英文一侧再生成之前的行号；`verify-translation-pairing` 的结构化哈希检查不会捕捉一个已经哈希匹配的区块内部漂移的行号，因此这一缺口在 doc-sync 中一直存活，直到 review 的直接比对才发现它。该问题已由 commit `ac57329b7a` 修复，并通过 `verify-translation-pairing`、`verify-config-catalog` 与 `doc-sync` 重新确认。

## Domain port provenance

R4 是原创组装工作，不是移植。内置 `science` preset 的名单、配置值与中文元数据都由本 Note 直接决定，而非从 `omdsh-dev/dsh-science@fae091e1080e830bed8ad0456e4cbced29101b01` 复制而来；该 commit 只是关于下游名单/locale 长什么样的只读参考，本 Note 的替代方案一节已明确将它列为被否决的 provenance（整段失败的候选、缺少 R3 要求的 `stateHistoryLimit`、用直接 assembly snapshot 而非真实请求）。通用 `copyable` preset 元信息机制没有下游对应物，是 R4 原创，专门用于关闭 R1/R3 把 `ScienceModeRef.presetId` 绑定到字面 `science` id 所制造的那个具体风险。

## Overlay inventory update

| `delta_id` | 此前状态 | R4 状态 |
|---|---|---|
| `SCI-PRESET` | `deferred`（自 R0 起开放） | 在已验收 candidate `ac57329b7a` 上 `verified` |
| `SCI-CHARTS-OUTCOME` | `deferred` | 不变：`deferred` |
| `SCI-SETTINGS-SIDEBAR` | `deferred` | 不变：`deferred` |
| `DESKTOP-CARRIER` | `deferred` | 不变：`deferred` |
| 其余 overlay rows | 与 [R3 closure evidence](2026-08-16-dsh-science-v01-r3-science-tools.md) 中记录的一致 | 不变 |

## Protected-state preservation

`/Users/superjj/ccproj/DSHscience`（分支 `codex/science-v01-r3-science-tools-plan`）之外的任何 protected worktree 都未被 staged、cleaned、reset、checked out 或 repointed；用于在 R4 plan base 上确认 `rescope-vendor:check`/`knip`/`goal.snapshot.ts` pre-existing 行为的那次一次性 worktree 建在 `/tmp` 之下，并在同一 session 内以 `git worktree remove --force` 移除。没有发生 push、tag、PR 或 publish。本次工作期间运行过一次 `pnpm run clean`，加上对 `packages/boot`、`packages/science`、`packages/session/session-persistence-jsonl`、`packages/subprocess/subprocess`、`packages/test-support`、`packages/util/launch-environment`、`vendor/group`、`vendor/hmr` 的一次定向 `git clean -fdx`，用于移除 `tsc -b tsconfig.host.json` 遗留在这些本次改动未触碰的 package 的 `src/` 旁边的散落 `.js`/`.d.ts` build residue；随后立即重跑了一次完整 `pnpm run build` 以恢复 `lib/`，再重新验证 CLI e2e 套件。

## Risks, unknowns, and deferred product decisions

- `rescope-vendor:check` 的 pre-existing 26-problem gap 仍然存在；R4 既不修复也不扩大它。
- pre-existing 的 8-clone `duplication` gap 仍然存在；R4 既不修复也不扩大它，且报告的 clone pair 中没有任何一个 R4 新增文件。
- `knip` 的 pre-existing 2-unused-file 报告（来自 R3 的 `examples/headless-agent` Science 测试 fixture）仍然存在；R4 不触碰这两个文件。
- 在任何未配置 `dsh-science-runtime` 行的 Host 上，preset 仍可被发现和选中——截至本记录，随附 Web Host 正是如此；`apps/cli/tests/web-agent-presets.e2e.ts` 已确认此类 Host 上首次真实 Science 请求会明确失败（`no Science Runtime is mounted (ctx.scienceRuntime)`），但没有任何 settings/sidebar 表层会提前告知用户这一点——`SCI-SETTINGS-SIDEBAR` 仍是那个会加入该能力的开放行。
- 真实 Python 与 R Science Runtime acceptance、chart/Outcome 发布、settings/sidebar 表层与 Desktop，仍然与 R0–R3 overlay inventory 中记录的一致：留给后续 slice 的开放工作。
