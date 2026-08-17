# DSH Science v0.1 R6 settings 与 Details 收口证据

[English](2026-08-18-dsh-science-v01-r6-settings-details.md) | 中文

调查于 2026-08-18，平台 macOS 26.5.2（Darwin 25.5.0，arm64），Node v24.14.0，pnpm 11.7.0。Scope authority：[DSH Science v0.1 R6 settings and Details](../../.agents/notes/implemented/feature/2026-08-17-dsh-science-v01-r6-settings-details.md)。

## Outcome

R6 在分支 `codex/science-v01-rc7-rebaseline` 上关闭 `SCI-SETTINGS-SIDEBAR`，final head 为 `e125ce00327e4ffce9cc01f371b9068fd142dfcc`。R6a 与 R6b 已在基线迁移前的树上验收；R6c 的基线是 [rc.7 基线迁移](2026-08-17-dsh-science-v01-rc7-rebaseline.md) head `66344a2774feaad7ebd27e80f11e6386d8255317`（其本身经由纯文档性质的 R6c 规划提交与 R6c-0，从已验收的迁移后 head `24971d5f14c8b9dc692658a0bb1cab599a4ed526` 派生而来）。在分支的真实祖先关系中，有四个提交把 R6c-0b 一路带到 final head：`6a994ef4cbca968e15b4ef3d63f0f8e1bb2613e1`（R6c-0b）、`ef645eff0e3a1ab7c416202fe0b023a308ab6f8f`（settings 卡片 + 默认 Web Runtime row + R4/R5 修订）、`57af4a3702956b15875769bf2f5c774e59d68a74`（header action + Details entry），以及 `e125ce00327e4ffce9cc01f371b9068fd142dfcc`（装配级 browser/snapshot coverage + goldens，外加基于共享 primitives 的卡片 chrome）。`8558a65d77ab44f522039bf2624af93f241b7efa` **不是** final head 的祖先：`git branch --all --contains 8558a65d77` 不返回任何分支，reflog 把它记录为 `commit (amend)`——`e125ce0032` 是就地修补（amend）了 `8558a65d77`，而不是在其上继续提交，因此两者共享同一个父提交 `57af4a3702`。该 SHA 不携带任何独有证据：下文的完整 Web lane 与 keyless snapshot lane 都已直接在 final head 上重跑。源码趟的各项 gate 在 final head 上全绿；有人值守趟增加了一份真实 server 的 GIF、两次独立的真实 Python/R acceptance 运行，以及 packed Web verification，并公开披露了一项 GIF 覆盖缺口，而非将其隐藏。

## Exact identities

| Subject | Identity |
|---|---|
| R6c 基线 | `66344a2774feaad7ebd27e80f11e6386d8255317` |
| Final head | `e125ce00327e4ffce9cc01f371b9068fd142dfcc` |
| R6c-0b——settings scope 上的 secret-slot presence | `6a994ef4cbca968e15b4ef3d63f0f8e1bb2613e1` |
| R6c settings 卡片 + 默认 Web Runtime row + R4/R5 修订 | `ef645eff0e3a1ab7c416202fe0b023a308ab6f8f` |
| R6c header action + Details entry | `57af4a3702956b15875769bf2f5c774e59d68a74` |
| 已被修补取代的 SHA（不携带独有证据） | `8558a65d77ab44f522039bf2624af93f241b7efa`——不是 final head 的祖先（`git branch --all --contains` 不返回任何分支；reflog：`commit (amend)`）；已被下一行完全取代 |
| R6c 装配级 browser/snapshot coverage + goldens + 基于共享 primitives 的卡片 chrome | `e125ce00327e4ffce9cc01f371b9068fd142dfcc` |
| 更早已验收的一条线：R6a + R6b（迁移后身份） | `24971d5f14c8b9dc692658a0bb1cab599a4ed526` |
| 更早已验收的一条线：R6c-0（路径寻址的 `setPath`/`unsetPath`） | `76012736a12b3793e2eba2295fde512ad56ddb2d` |
| 真实 Python prefix | `/opt/miniconda3/envs/qwen` |
| 真实 R prefix | `/Users/superjj/.conda/envs/dsh-r-acceptance` |
| 隔离 DSH home（真实 acceptance） | `/Users/superjj/ccproj/dshscience-r6-acceptance-dsh-home`，mode `0700`，不在 `/tmp` 下 |
| GIF 产物 | `.playwright-mcp/r6c-science-settings-card.gif` |

## Verification matrix

| Layer | Command / scope | Result |
|---|---|---|
| 聚焦 `ui-science` | Vitest，`packages/client/ui-science/tests` | PASS——8 文件 / 103 测试，每个已改动 src 文件的语句/分支/函数/行覆盖率均为 100% |
| 聚焦 `ui-settings` scope spec | Vitest，`packages/client/ui-settings/tests/settings-scope.client.spec.ts`，于 `6a994ef4cb` | PASS——25 项测试 |
| Typecheck | `pnpm run typecheck` | PASS——exit 0 |
| Lint | `pnpm run lint` | PASS——exit 0 |
| Documentation | `pnpm run doc-sync` | PASS——29/29 gates |
| Cordis config | `pnpm run verify-cordis-config` | PASS——124 个配置文件 |
| Package invariants | `pnpm run verify-package-invariants` | PASS——224 个 companion |
| Whitespace | `git diff --cached --check` | PASS——干净 |
| Web lane，final head | `plugin-config.e2e.ts` | PASS——9/9 |
| Web lane，final head | `science-chart-outcome.e2e.ts` | PASS——2/2 |
| Web lane，final head | `science-preset.snapshot.ts` | PASS——1/1 |
| 完整 Web lane，final head | `pnpm run test:web`（先 `build`，再 `test:web:built`） | 1 文件失败 / 76 通过 / 1 跳过（共 78 文件）；5 测试失败 / 262 通过 / 7 跳过（共 274 测试）——全部 5 项失败都在 `smoke-real.e2e.ts`，无 flake——见 Disclosed inherited failures |
| Keyless snapshots，final head | `pnpm run test:snapshot` | 1 文件失败 / 11 通过（共 12 文件）；2 测试失败 / 117 通过 / 1 跳过（共 120 测试）——两项失败都在 `goal.snapshot.ts`——见 Disclosed inherited failures |
| Packaged artifacts | `pnpm run check:ci:artifacts` | PASS——5/5（build、publint、node-next types、built-package-invariants、built-bin smoke） |
| Packed payload | `@deepseek-ai/dsh-client-ui-science` | PASS——20 个条目，包括 `lib/client.js` 与全部五个新模块的声明；无 source 泄漏 |
| 真实 Python/R run 1 | `test:real-acceptance`，于 `e125ce0032`，隔离 home，两个 prefix | PASS——`python.status=PASS`，`r.status=PASS`，无 `prefixManifestDifferences` |
| 真实 Python/R run 2 | 同一命令、同一 candidate、同一 prefix、同一 home | PASS——`python.status=PASS`，`r.status=PASS`，无 `prefixManifestDifferences` |
| GIF | `.playwright-mcp/r6c-science-settings-card.gif` | 已录制——范围与已披露限制见下方 GIF evidence |

### Explicitly NOT-RUN

仓库范围的 `test:coverage`（改为上表中已验证的 per-file coverage）；`release:verify-packed-install` 与 packed installers（需要 registry 访问，本环境以约 18 KB/s 无法完成）；Desktop、signing、notarization、Authenticode、npm publication、Git tag、GitHub release、Git push、PR creation；Windows 与 Linux platform lanes（由 CI 拥有该矩阵）。

## GIF evidence

`.playwright-mcp/r6c-science-settings-card.gif`——1200×750，10.2 秒，168413 字节，4 个源帧。录制于 final head，服务器来自已构建的 tree（`apps/cli/lib/bin.js --profile web --port 3099`），使用全新的 `DSH_HOME`/`DSH_AGENTS_HOME`/workspace 与**默认** Web composition（无 overlay），由仓库声明版本 Playwright 1.61.1 驱动的 headless Chromium 完成，零 page error。它端到端展示了 settings 卡片：在同级中折叠、展开/未配置、两个 prefix 均已输入、保存后两个字段均读作 "Configured"、重新加载后输入为空（不回显已存路径），以及 restart-required。Host settings 文档收到的正是本证据 Verification matrix 与 implemented Note 都指名的那个两段式写入（`science-runtime:\n  science:\n    pythonPrefix: …\n    rPrefix: …`）。

**已披露限制。** 该 GIF 不包含任何真实模型轮次，也未展示 session-header action 或 Details entry。能产生真实模型轮次的 composer 位于 workspace selection 之后，其随附的 `directory-picker-auto` row 在有显示器的机器上会解析为原生 macOS 文件夹对话框——无法无头驱动；而 `-browse` 变体会改变被测入口，而不是驱动已交付的那些入口。header action 与 Details entry 改由真实浏览器中的 `science-chart-outcome.e2e.ts`（2/2，见上方 Verification matrix）覆盖。GUI-change 规则对这两个表层的真实模型轮次 GIF 要求仍欠着，留给未来一轮。这一限制与下文 `smoke-real.e2e.ts` 的 onboarding-notice 拦截是两回事：本次录制自己的脚本会在触碰 workspace picker 之前先关闭 welcome notice，其探测也确认了此时 notice 已不在场，因此该 notice 从未在这里出现过——原生文件夹对话框才是这份 GIF 缺口的唯一原因。

## Disclosed inherited failures

记录为 FAIL/inherited，绝不记为 PASS：

| Check | Signature | Attribution |
|---|---|---|
| `rescope-vendor:check` | 26 个问题 | 与上游 rc.7 上同一检查的结果完全相同；属于既有问题，非本范围引入 |
| `verify-client-domain-graph` | 34 项发现 | 全部位于 `ui-input-trigger`/`ui-workspace`；本范围内改动的文件一个都不出现。归属 `check-all` 分组，不属于 `doc-sync` |
| `examples/acp-agent/tests/goal.snapshot.ts` | `expect(result.stderr).toBe('')` 收到 Node v24.14.0 的 `ExperimentalWarning: SQLite is an experimental feature` | 该测试自 rc.5 merge-base `47f943859b` 以来未变，整个范围内唯一的 `examples/acp-agent/cordis.yml` 改动只是注释，因此原因属于环境（Node 自身的 experimental-feature 警告），而非产品回归 |
| `apps/web/tests/smoke-real.e2e.ts` | Playwright 把 `getByRole('textbox', { name: 'Choose workspace' })` 解析到 composer 的只读 `<textarea aria-haspopup="menu" data-phase="inert">` 上；对它的点击被 `<div role="presentation">` 内的 `<div class="BdGIFa_copy">`（onboarding surface 的 welcome-notice 文案块）吞掉 | `packages/client/ui-primitives/src/OnboardingSurface.tsx` 及其 `.module.css` 与 rc.5 merge-base `47f943859b` 逐字节相同，因此该 surface 属于继承，非 R6 引入。该测试本身在任何地方都没有关闭 welcome notice 的动作（`Continue`/`notice` 都不出现在其中），且其 scaffold 每次都从全新 Harness home 起步，因此测试点击时 notice 总是在场。**修复归属其自身改动，刻意未并入 R6**：该测试必须在触碰 workspace picker 之前先关闭 welcome notice，正如本次收口自己的 GIF 脚本所做的那样；R6 不修它，因为这是一个继承自 rc.5 一线、与本范围任何文件无关的测试缺陷，应归属它自己的 candidate 及其自身证据 |
| `subagent-interrupt-ui.e2e.ts` | 在修补前证据轮次中出现过一次单测 flake | 当时不可复现：单独运行通过，且在另一次完整运行中也通过。在 final head 重跑完整 lane 时未再出现 |
| `background-job-list.e2e.ts` | 在修补前证据轮次中出现过一次单测 flake | 当时不可复现：单独运行通过，且在另一次完整运行中也通过。在 final head 重跑完整 lane 时未再出现 |

### Base-comparison attribution

基线迁移遗留的基线对照事项在源码归因层面而非执行层面收口：由于 276 条 lockfile insertions 把 `47f943859b` 与 final head 分隔开，未运行 rc.5 merge-base 上的分离 base worktree，因为同一棵树上的 checkout 只会让 rc.5 的 source code 对上 rc.7 解析出的依赖——这不是有效的对照；而本环境的 registry 访问（约 18 KB/s）无法在有限时间内安装一棵真正独立的 base 树。`goal.snapshot.ts` 改用文件身份论证归因：确切的被测文件自 rc.5 merge-base 以来未变，且没有任何 R6 范围内的改动触及它。`smoke-real.e2e.ts` 则用文件身份与交互机制的组合论证归因：`OnboardingSurface.tsx` 及其样式表与 rc.5 merge-base 逐字节相同，而失败的交互——一个未被关闭的 welcome notice 吞掉了原本要落在 workspace picker 上的点击——可追溯到该测试自身缺失的关闭步骤，没有任何 R6 范围内的改动触及它。两者都是本环境在没有可运行对照树的情况下所能给出的最有力归因。

## Review

上述每一项已披露 failure 都可追溯到与本范围无关的三类原因之一：一个已确认与上游 rc.7 结果集合相同的既有 signature（`rescope-vendor:check`）、一个把确切原因追溯到 rc.5 一线且没有任何 R6 范围改动触及的文件身份或交互机制论证（`goal.snapshot.ts`、`smoke-real.e2e.ts`），或一个在修补前证据轮次中只出现过一次、当时单独运行与第二次完整运行都不复现、且在 final head 重跑完整 lane 时也未再出现的单测 flake（`subagent-interrupt-ui.e2e.ts`、`background-job-list.e2e.ts`）。`verify-client-domain-graph` 的 34 项发现全部落在本范围触碰过的每一个文件之外。没有任何 fixture 被手改，也没有任何 expectation 被放宽以换取一次干净运行。

R6 implemented Note 对 proposed note 计划所做的六处更正——写入路径坐标、R6c-0b 检查点、卡片 chrome 归属、Details-entry 缩略图加载、Runtime row-id 归属，以及 R4/R5 交叉链接重新指向——在本轮中都各自独立地对照已交付 source 得到确认：`packages/science/science-runtime/src/settings.ts` 的 `base: config.profiles`、`packages/settings/settings/src/redact.ts` 从 section root 起算的遍历、`packages/client/ui-science/src/client/ScienceSettingsCard.tsx` 基于 primitives 的 chrome 与手写 disclosure header、`packages/client/ui-science/src/client/science-attachment-loader.ts` 基于 `ISession.readAttachment` 的 stateless loader，以及 `vendor/include/src/index.ts` 中 `applyEntryPatches` 的 name-mismatch 跳过逻辑。

## Overlay inventory update

| `delta_id` | Prior status | R6 status |
|---|---|---|
| `SCI-SETTINGS-SIDEBAR` | `deferred` | `verified`，于 `e125ce00327e4ffce9cc01f371b9068fd142dfcc` |
| Remaining overlay rows | 与 [rc.7 基线迁移证据](2026-08-17-dsh-science-v01-rc7-rebaseline.md) 中记录的一致 | 不变 |

## Protected-state preservation

`/Users/superjj/ccproj/DSHscience`（分支 `codex/science-v01-rc7-rebaseline`）之外没有任何 worktree 被 stage、clean、reset、checkout 或重新指向。隔离的真实 acceptance DSH home（`/Users/superjj/ccproj/dshscience-r6-acceptance-dsh-home`）是一个全新的、mode `0700`、位于 `/tmp` 之外的目录，仅供两次真实 Python/R acceptance 运行使用。没有执行任何 push、tag、PR、publish 或 release 操作。

## Risks, unknowns, and deferred product decisions

- Session-header action 与 Details entry 没有真实模型轮次 GIF；`science-chart-outcome.e2e.ts` 改在真实浏览器中覆盖它们的行为，该 GIF 缺口留给未来一轮，而非被悄悄关闭。
- `apps/web/tests/smoke-real.e2e.ts` 的 onboarding-notice 拦截是一个继承自 rc.5 一线的测试缺陷：该测试在任何地方都没有关闭 welcome notice 的动作，其 scaffold 每次都从全新 Harness home 起步。它的修复被刻意排除在 R6 之外，归属它自己的改动及其自身证据。
- `rescope-vendor:check` 的 26 项既有问题与 `verify-client-domain-graph` 的 34 项发现仍未解决，且与本范围无关；两者都不归 R6 负责修复。
- 真实 Python/R acceptance 只证明已配置 interpreters 与 Runtime lifecycle，不证明 plotting-library availability、scientific correctness、Desktop packaging、installer behavior、signing、notarization 或 release readiness。
- Desktop、packed installers、signing、notarization、publication、tag、push 与 PR creation 均无 R6 证据，保持 `NOT-RUN`。
