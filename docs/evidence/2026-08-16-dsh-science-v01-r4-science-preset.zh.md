# DSH Science v0.1 R4 内置 Science preset 收尾证据

[English](2026-08-16-dsh-science-v01-r4-science-preset.md) | 中文

调查与最终复审时间为 2026-08-16，平台为 macOS 26.5.2（Darwin 25.5.0，arm64）。最终修复门禁使用 Codex workspace runtime：Node v24.19.0、pnpm 11.19.0。范围授权文档：[DSH Science v0.1 R4 built-in Science preset on RC5](../../.agents/notes/implemented/feature/2026-08-16-dsh-science-v01-r4-science-preset.md)。

## 结果

最终验收否决了此前位于 `b3a7f03a5d0accd899ae7d3067cd70f4c26e5f98` 的 R4 收口：元数据缺失、无法读取、YAML 损坏、顶层类型错误或字段类型错误时，Science 禁止复制策略可能被清空，使不可用副本看似成功创作；同时 Science 工具 README 仍声称工具 schema 不按 preset 限定。Commit `cda69a9e5f6fb729c4699f70e06dc23745f0788f` 修复这两项 blocker。随附 preset 现在必须提供合法元数据，每个损坏 preset 都解析为不可复制，直接 service/API 复制会携带 discovery 原因拒绝，真实随附 Science 根目录覆盖策略缺失／YAML 损坏／非布尔值，过期限制也已删除。修复后的行为 candidate 通过下列聚焦源码、Host artifact、CLI、浏览器、lib-mode、配置、文档与 lint 门禁；最终语义与 diff 复审未发现范围内剩余 blocker 或 high-severity finding。

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
| 此前 R4 文档收口 | `b3a7f03a5d0accd899ae7d3067cd70f4c26e5f98` —— 因复制策略仍 fail-open 且一项限制过期而被最终验收否决的 head |
| 修复后的 R4 行为 candidate | `cda69a9e5f6fb729c4699f70e06dc23745f0788f`，位于 R3 文档收口 head 之上九个 commit |
| Downstream preset provenance | `omdsh-dev/dsh-science@fae091e1080e830bed8ad0456e4cbced29101b01` —— 按本 Note [精确身份](../../.agents/notes/implemented/feature/2026-08-16-dsh-science-v01-r4-science-preset.md#exact-identities)表所述，仅作只读名单/locale/测试输入参考；R4 没有任何一行是从它 cherry-pick 而来 |

## 验证矩阵

| 层级 | 命令 | 结果 |
|---|---|---|
| Scope 与 ancestry | `git merge-base --is-ancestor 92ee890e8d cda69a9e5f`；`CI=true pnpm --silent run change-scope --base 92ee890e8d --head cda69a9e5f`；`git diff --check 92ee890e8d..cda69a9e5f` | PASS —— plan base 仍为 merge base；九个 commit 的区间留在本 Note 的 IN 行内，只新增 fail-closed preset 元数据实现／测试、受影响包与应用 prose 及生成目录；没有增加 Runtime 行、invariant companion、Desktop 载体、环境变更、provider、release 或发布路径 |
| Copyability、API 与 client unit | `CI=true pnpm exec vitest run packages/preset/agent-presets/tests packages/host/apiproxy/tests/api-proxy-agent-preset.spec.ts packages/host/apiproxy/tests/rpc-schemas.spec.ts packages/client/ui-agent-preset/tests` | PASS —— 378 passed，17 files |
| CLI preset 组装 | `CI=true pnpm exec vitest run --config vitest.e2e.config.ts apps/cli/tests/web-agent-presets.e2e.ts` | PASS —— 38 passed，1 file；除原有名单／Runtime 行为外，真实随附根目录现在还证明 Science 元数据缺失、格式错误与非布尔策略会使该行损坏且不可复制，并拒绝直接复制 |
| Web 浏览器与无密钥请求 | `CI=true pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/agent-preset-selection.e2e.ts apps/web/tests/agent-preset-authoring.e2e.ts apps/web/tests/science-preset.snapshot.ts` | PASS —— 14 passed，3 files；更新并断言真实随附根目录 ARIA golden（第五个 preset、本地化文案、禁用的 Science 复制操作），并通过随附 Web scaffold 驱动一次真实无密钥请求，包含 `ctx.agentPresets.mount(agentCtx, 'science')` |
| 已构建应用解析 | `CI=true pnpm run build:lib:host`；`DSH_EXAMPLE_MODE=lib CI=true pnpm exec vitest run --config vitest.snapshot.config.ts apps/web/tests/science-preset.snapshot.ts`；`CI=true pnpm run check:ci:artifacts`；sandbox 超时后在 Host 上原样重跑 built-bin 命令 | PASS —— Node 24 Host build exit 0；lib-mode snapshot 1/1；artifact composite 的 build、publint、NodeNext types 与 built-package-invariants 通过，built-bin lane 因 sandbox 中等待 lifecycle marker 而阻塞；精确的 11-file built-bin 命令在 Host 上 30/30 通过，因此五项 artifact 检查都有正向证据，且没有隐藏 sandbox 失败 |
| 配置与 lint | `CI=true pnpm run verify-cordis-config`；`CI=true pnpm run lint:contracts-ready` | PASS —— 122 个配置文件与全部 contract-ready lint 检查均通过 |
| Hygiene（`rescope-vendor:check`） | `pnpm exec tsx scripts/rescope-vendor.ts --check` | **FAIL —— pre-existing，在 R4 plan base 上确认一致。** 通过一次性 worktree 在 head `92ee890e8d` 上运行，得到完全相同的 26-problem list（Markdown fences、docs prose、code specifiers，分布在 `docs/event-producer-consumer*`、`docs/subsystems/extensions*`、`packages/api/remotes`、`packages/extensions/cordis-*`、`packages/extensions/ui-cordis`、`packages/extensions/tool-cordis/src/api-catalog.ts`、`scripts/gen-cordis-catalog.ts`）；R4 既不新增也不修复它 |
| Hygiene（`knip`） | `pnpm exec knip --treat-config-hints-as-errors` | **FAIL —— pre-existing，在 R4 plan base 上确认一致。** 同样通过一次性 worktree 确认，得到完全相同的 2 个未使用文件（`examples/headless-agent/tests/fixtures/science-{mock-llm,runtime-fixture}.ts`，最后由 R3 review 修复 commit `be46f69b6e` 触碰）；R4 未触碰这两个文件 |
| Hygiene 其余子检查 | `publint`；`constraints`；`verify-dsh-package-licenses`；`verify-package-invariants`；`verify-built-package-invariants`；`verify-node-next-types`；`verify-runtime-closure`；`verify-vendored-links` | PASS —— 225 个 package 声明 MIT；222 个手工拥有与 222 个已编译的 invariant companion 均合规；231 个声明 API 在 NodeNext 下编译；109 个 package 构成闭合的运行时依赖图；9 个 vendored 名称均可解析 |
| 文档 | `pnpm run gen-cordis-catalog`；对受影响 pair 运行 `./node_modules/.bin/tsx scripts/verify-translation-pairing.ts --write ...`；`CI=true pnpm run doc-sync`；`git diff --check` | PASS —— 导出的复制失败约定已反映到 `api-catalog.ts` 与双语 core 目录，全部 28 项文档门禁通过，没有空白字符违规 |
| 跨文件重复 | `CI=true pnpm run duplication` | **FAIL —— pre-existing，与本次改动无关。** 8 组 clone pair，与 R3 evidence record 中记录的完全一致（`goal/goal` 与 `science-session` 的 invariant、`science-runtime` 内部、`bash-sandbox` 与 `pwsh-sandbox`、`gen-config-catalog.ts` 自身克隆）；没有任何 R4 新增或改动的文件出现在其中 |
| 最终验收 review | 对此前收口、修复 commit、测试、生成目录与当前验证矩阵进行语义及 diff 复审 | **ACCEPT** —— audit 先因 fail-open 策略与过期 Science 限制否决 `b3a7f03a5d`；`cda69a9e5f` 关闭两者，在 parser/discovery/service/真实随附根目录各层覆盖每个新失败模式，保留 user/system 元数据差异，并且修复范围内没有剩余 blocker 或 high-severity finding |
| 真实 Python/R 与 provider | 本次 session 未获授权 | 按本 Note 声明为 `NOT-RUN`；与源码、fake-Runtime、built、Web、Desktop 与 release 验收分离 |
| Desktop 与 release | 不运行命令 | `NOT-RUN`；R4 不产生载体、installer、签名、发布、tag 或 release 证据 |

### 明确 NOT-RUN

Repository-wide unit suite（CI 负责 exhaustive matrix）、针对明确授权的既有 Conda prefixes 的真实 Python/R Science Runtime acceptance、Desktop、provider credentials、signing、publication、tag、release、Git push 与 PR，对 R4 均为 `NOT-RUN`。这些 layers 不在本 slice 范围内。

## Review

原 review 正确确认了内置 preset 的身份、名单、Host/Runtime 非拥有关系、wire code 与 Web 禁用操作，但没有质疑 metadata reader 的 fail-soft 行为。最终验收沿负向路径端到端追踪后发现，删除或损坏 `science/preset.yml` 会让 discovery 把 `copyable` 默认回 true。这违反了仅复制创作承诺，因为派生 id 可以挂载可见工具，却拒绝每个 Science 操作。同一次 audit 把当前源码行为与 package prose 对照，发现 `tool-science` 仍错误声称工具 schema 全局注册。

本次修复把展示与策略分开。无效展示字段仍可忽略，但存在的 metadata document 必须是可读取、顶层为 map 的合法 YAML，且声明的 `copyable` 必须是布尔值。System root 还要求文件必须存在；user root 仍可省略。Discovery 会把每个元数据或组装失败转化为 `broken` 加 `copyable: false`，`copyComposition()` 则报告 broken 原因。Parser 与 discovery unit 覆盖各类无效形式，authoring unit 覆盖直接拒绝，CLI e2e 套件以三种策略相关形式损坏复制出的真实随附根目录。生成文档与 package 文档现在陈述同一规则，过期的全局 schema 限制也已删除。

## Domain port provenance

R4 是原创组装工作，不是移植。内置 `science` preset 的名单、配置值与中文元数据都由本 Note 直接决定，而非从 `omdsh-dev/dsh-science@fae091e1080e830bed8ad0456e4cbced29101b01` 复制而来；该 commit 只是关于下游名单/locale 长什么样的只读参考，本 Note 的替代方案一节已明确将它列为被否决的 provenance（整段失败的候选、缺少 R3 要求的 `stateHistoryLimit`、用直接 assembly snapshot 而非真实请求）。通用 `copyable` preset 元信息机制没有下游对应物，是 R4 原创，专门用于关闭 R1/R3 把 `ScienceModeRef.presetId` 绑定到字面 `science` id 所制造的那个具体风险。

## Overlay inventory update

| `delta_id` | 此前状态 | R4 状态 |
|---|---|---|
| `SCI-PRESET` | `deferred`（自 R0 起开放） | 在修复后的行为 candidate `cda69a9e5f` 上 `verified` |
| `SCI-CHARTS-OUTCOME` | `deferred` | 不变：`deferred` |
| `SCI-SETTINGS-SIDEBAR` | `deferred` | 不变：`deferred` |
| `DESKTOP-CARRIER` | `deferred` | 不变：`deferred` |
| 其余 overlay rows | 与 [R3 closure evidence](2026-08-16-dsh-science-v01-r3-science-tools.md) 中记录的一致 | 不变 |

## Protected-state preservation

`/Users/superjj/ccproj/DSHscience`（分支 `codex/science-v01-r3-science-tools-plan`）之外的任何 protected worktree 都未被 staged、cleaned、reset、checked out 或 repointed；原收口期间用于确认 pre-existing 行为的一次性 worktree 建在 `/tmp` 下并于当次 session 删除。最终修复 audit 没有执行 cleanup、reset、checkout、worktree 变更、环境变更、push、tag、PR、publish 或 release 操作。Build 与浏览器命令使用已配置的 Node 24 runtime 与隔离的 `/private/tmp` DSH home；tracked writes 仅限修复、测试、当前文档、目录与证据。

## Risks, unknowns, and deferred product decisions

- `rescope-vendor:check` 的 pre-existing 26-problem gap 仍然存在；R4 既不修复也不扩大它。
- pre-existing 的 8-clone `duplication` gap 仍然存在；R4 既不修复也不扩大它，且报告的 clone pair 中没有任何一个 R4 新增文件。
- `knip` 的 pre-existing 2-unused-file 报告（来自 R3 的 `examples/headless-agent` Science 测试 fixture）仍然存在；R4 不触碰这两个文件。
- 在任何未配置 `dsh-science-runtime` 行的 Host 上，preset 仍可被发现和选中——截至本记录，随附 Web Host 正是如此；`apps/cli/tests/web-agent-presets.e2e.ts` 已确认此类 Host 上首次真实 Science 请求会明确失败（`no Science Runtime is mounted (ctx.scienceRuntime)`），但没有任何 settings/sidebar 表层会提前告知用户这一点——`SCI-SETTINGS-SIDEBAR` 仍是那个会加入该能力的开放行。
- 真实 Python 与 R Science Runtime acceptance、chart/Outcome 发布、settings/sidebar 表层与 Desktop，仍然与 R0–R3 overlay inventory 中记录的一致：留给后续 slice 的开放工作。
