# DSH Science v0.1 R0 RC5 基线身份与检查记录

[English](2026-08-15-dsh-science-v01-r0-rc5-baseline.md) | 中文

调查时间为 2026-08-15，平台为 macOS 26.5.2（Darwin 25.5.0，arm64），Node v24.14.0，pnpm 11.7.0。范围 authority：[已实施的 R0 决定](../../.agents/notes/implemented/process/2026-08-15-dsh-science-v01-r0-release-baseline-scope.md)。后续 [closure 记录](2026-08-15-dsh-science-v01-r0-rc5-baseline-closure.md)负责最终验收结论和 workflow 平台复核；本记录保留初步 macOS 观测。

## 调查所得身份

官方 [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness) 源码的提交为 `47f943859bef60e4160492346772ded9b24f765a`，树对象为 `f904efab9ef435201d6ba4da88a34d6366568272`，提交时间为 2026-08-13T19:38:46+08:00（"Merge pull request #2519 from deepseek-harness/feat/npm-public"）。该提交下的 `package.json` 记载 `name: "@deepseek-ai/dsh-root"`、`version: "0.1.0-rc.5"`、`license: "MIT"`、`engines.node: "^22.19.0 || >=24.0.0"`、`packageManager: "pnpm@11.7.0"`。该提交对象在本次调查开始前已存在于本仓库本地对象库中（未发生 fetch；local 与 remote-tracking branch refs 保持不变）。

另行观测到的 npm 制品 `@deepseek-ai/dsh@0.1.0-rc.6`（registry 标记为 `latest`/`next`，发布时间 `2026-08-13T12:35:03.812Z`，完整性摘要 `sha512-brpZfED7ieRa2PQ5tUxMhHrM1pb2CmKFVM/f6yMULBDMicahk+Z2OsHgTwTDnoiZm23Ftu9rQz0NN4pflaoJcg==`，无 `gitHead`）仅作记录以防止被误替代身份。它未被采用，未映射到任何公开 commit/tag/tree，且不属于 v0.1 范围。

## R0 基线候选

| 切片 | 分支 | Worktree | HEAD | 父提交链 |
|---|---|---|---|---|
| R0A | `codex/science-v01-r0a-governance-closure` | `/Users/superjj/ccproj/dshscience-r0a-governance-closure` | `73c0e9c004157798682759e7d5b0280b9ec913c3`（树 `c53d3a9274ebf3f5986be5f42224f724c0324a91`） | `e5e8b29b435f67e0a5dde5e2132580966e78b27b`（当前下游 `main` tip）← `50ff1552ca8ed138ecd162b52c46856e8493e0fb` ← `73c0e9c004157798682759e7d5b0280b9ec913c3` |
| R0B 初步候选 | `codex/science-v01-rc5-baseline` | `/Users/superjj/ccproj/dshscience-r0b-rc5-baseline` | `948693150e2fe8a9d38fbb1e125a2a106d9488ee`（tree `35062cb234e05176fa83132253ea797634700a1a`） | `47f943859bef60e4160492346772ded9b24f765a`（官方 RC5，无下游历史祖先）← `3751f6fcc497e9e23385f69a0d5f3cfdbaac5a6e` ← `922d60421a8a6a2983f27de266a02d3d7c5af3b3` ← `3ca64b38867fe78792a4d95ff3ba39e26444db82` ← `948693150e2fe8a9d38fbb1e125a2a106d9488ee` |

R0A 与 R0B 是两条历史互不相关的独立分支（`e5e8b29...` 与 `47f943...` 无共同祖先；左右各自独有提交数为 `12,293/17`）。R0B 直接以 `git worktree add -b codex/science-v01-rc5-baseline <path> 47f943859bef60e4160492346772ded9b24f765a` 在官方提交上创建；未对 R0A、下游治理 worktree、`main`、Phase 3 或 R-probe 分支执行任何 rebase、merge 或 cherry-pick。R0A 的两个提交接受了 `/private/tmp/dshscience-science-v01-architecture-governance`（分支 `codex/science-v01-architecture-governance`）这一 dirty 治理 worktree 中经审查的一个子集；R0B 的证据路由提交在确认所涉文件的治理前 blob 哈希在 `main` 与 RC5 之间完全一致后，以直接复制文件内容的方式移植同一批内容，而非 cherry-pick 或 merge。R0A 中接受的发行/MVP 决策记录（`.agents/notes/proposed/architecture/2026-08-15-dsh-science-desktop-distribution-reconnaissance.*` 及修订后的 `.agents/notes/proposed/feature/2026-08-12-science-mode-core-mvp.*`）属于下游谱系的治理收敛成果，刻意未被带入 R0B：它们是 Science/Desktop 产品架构决策，R0B 自身的预期路径表未列出它们，且 RC5 中并不存在供其描述的 `packages/science/*` 目录树。

## 最小验证矩阵

以下每项结果均绑定到命令运行时刻的 R0B 当前提交。本初步记录在 `948693150e2fe8a9d38fbb1e125a2a106d9488ee` 收尾；后续 closure 记录负责 final-head identity 与 protected-state 验收。

| 层级 | 命令 | 结果 |
|---|---|---|
| 工具链/安装 | `pnpm install --frozen-lockfile` | PASS —— 1,203 条 lockfile 记录，无违规；两条良性 `WARN Failed to create bin at .../examples/node_modules/.bin/...` 提示，对应的演示用 bin 仅在 `pnpm run build` 后才存在 `lib/bin.js` |
| 文档（聚焦检查） | `pnpm run verify-doc-budgets`、`verify-md-links`、`verify-agent-note-format`、`verify-agent-note-classification`、`verify-translation-pairing` | PASS —— 12/12 受预算约束文档达标；1,897 个文件/链接均可解析；542/542 条 Agent Note 符合格式；937/937 对双语内容一致 |
| 文档（完整门禁） | `pnpm run doc-sync` | PASS —— 28/28 个 gate，耗时 44.96 秒 |
| 文档（空白字符） | `git diff --check 47f943...HEAD` | PASS —— R0B 完整 diff 中无空白字符错误 |
| Standard 源码 | `pnpm exec vitest run apps/cli/tests/source-launch.compat.spec.ts` | PASS —— 2/2 个测试 |
| Standard 源码（Web 组合） | `pnpm exec vitest run --config vitest.e2e.config.ts apps/cli/tests/web-agent-presets.e2e.ts` | PASS —— 30/30 个测试，未使用任何真实 provider 凭证；发现的前置条件：该套件通过构建产物 `lib/` 解析包，因此仅在下方 Standard 构建层运行过一次之后才能通过 |
| Standard 构建 | `pnpm run check:ci:artifacts` | PASS —— 5/5 个 gate（build、publint、node-next-types、built-package-invariants、built-bin smoke），耗时 34.42 秒 |
| Standard 构建（已构建 CLI 冒烟测试） | `DSH_REQUIRE_BUILT_CLI_SMOKE=1 pnpm exec vitest run apps/cli/tests/lazy-search-startup.compat.spec.ts`（不重新构建） | PASS —— 1/1 个测试 |
| 发行家族打包（版本检查） | `pnpm run release:verify --family dsh` | PASS —— family `dsh`，221 个成员，版本 `0.1.0-rc.5` |
| 发行家族打包（dsh） | `pnpm run release:pack --family dsh --out <worktree 外部>/npm` | PASS —— 221 个 tarball |
| 发行家族打包（vendor） | `pnpm run release:pack --family vendor --out <worktree 外部>/npm-vendor` | PASS —— 9 个 tarball |
| 发行家族打包（Landlock） | `pnpm --dir native/landlock-run run build:ts`，随后 `pnpm --dir native/landlock-run/packages/entry pack --pack-destination <worktree 外部>/npm-landlock` | PASS —— 1 个 tarball，`verify-entry-lib` 确认已构建的 `lib/` 存在 |
| 已安装 CLI 身份（官方命令原文） | `pnpm run release:verify-packed-install --family dsh --from <npm> --from <npm-vendor> --from <npm-landlock>` | **在本 macOS arm64 主机上 FAIL；该行为并非由 R0B 文档 diff 引入，也不足以证明 workflow 平台结果。** 经三次独立宿主层重试仍确定性复现（直接重试；关闭 agent 沙箱；安装 CMake 后重试）。脚本的 `npm install --omit=optional` 连带省略了 `koffi` 的 `@koromix/koffi-darwin-arm64` 可选预编译二进制，迫使其通过 CMake 从源码构建；该构建在本机 Mach-O/arm64 工具链上链接失败（缺少 N-API 符号）。同一批 tarball 在允许可选依赖时可安装。R0 未修改 `koffi`、发行 workflow 或依赖来规避此问题 |
| 已安装 CLI 身份（改动过安装参数，同一批 tarball） | 将同样的 231 个打包 tarball 安装进另一个隔离的临时消费者目录，环境变量（`DSH_HOME`/`DSH_AGENTS_HOME`/`DSH_TELEMETRY_DISABLED`）完全一致，但不带 `--omit=optional`（673 个包，退出码 `0`）；`node <consumer>/node_modules/@deepseek-ai/dsh/lib/bin.js --version` | PASS —— 报告 `0.1.0-rc.5`，与打包身份完全一致 |
| 打包后 Standard Web 就绪性 | 在同一改动过参数的消费者目录中，按照 `scripts/publish-npm-baseline.ts` 中确切的 PTY 探测逻辑（`POSIX_WEB_PROBE`）运行 `node <consumer>/node_modules/@deepseek-ai/dsh/lib/bin.js web --host 127.0.0.1 --port 0`：等待 `dsh web: http://127.0.0.1:`，发送 `SIGTERM`，要求退出码为 `0` | PASS —— 到达 `http://127.0.0.1:50914`，收到 `SIGTERM` 后以 `0` 退出 |
| 受保护状态 | 重新记录每一个既有 worktree/ref（`main`、`origin/main`、治理、Phase 3、R-probe、task、Grok worktree） | PASS —— 每一个都与其入口快照完全一致；入口数值见范围记录中的受保护 worktree 表 |
| 身份与范围（初步） | `git rev-parse HEAD HEAD^{tree}`；`git merge-base --is-ancestor 47f943... HEAD`；`git diff --name-status 47f943...HEAD`；`git status --porcelain=v2 --branch` | 初步候选为 `948693150e2fe8a9d38fbb1e125a2a106d9488ee`；accepted-head 解析和最终范围检查由 closure 记录负责 |

### 验收标准缺口

范围记录要求通过最小验证矩阵中的官方原文命令证明已安装 CLI 身份。该命令在本机因上述原因失败；R0B 文档内容没有引入该行为。改动安装参数的验证使用同一批 tarball，确认依赖图可解析且 CLI 版本正确，但因未带 `--omit=optional`，不能证明另一平台上的官方参数组合。本初步记录保留该历史缺口；closure 记录在不修改 `koffi`、发行 workflow 或任何依赖的前提下，单独验证 release workflow 平台。

`koffi` 是通用依赖（`packages/fs/fs-local`、`packages/host/directory-picker-native`、`packages/sandbox/sandbox-windows-acl`、`packages/session/session-persistence-jsonl`），并非 Landlock 专属，因此本初步记录没有假定问题仅存在于 macOS。此观测时点尚未验证 Ubuntu 行为；后续 workflow 平台结论由 closure 记录负责。

### 明确标记为 NOT-RUN

真实 provider/模型调用、需要 `DEEPSEEK_API_KEY` 的 `test:e2e`、真实 Python/R 执行、Windows Wine 诊断、浏览器交互验收、Desktop/Electron 构建、安装器、更新器、代码签名、公证（notarization）、Authenticode、npm 发布以及发行标签验证，对 R0 而言均为 **NOT-RUN**。本记录中没有任何命令对上述任一项做出结论。

## Overlay 清单

R0 仅为以下各行播种记录，不移植任何一行；除另有说明外，每一行的 `port_status` 均为 `not-started`。按范围记录中定义的完整 schema（`owner`/`dependencies`/`tests`/`evidence`/`disposition` 等字段）将在各条 delta 各自开始移植时补齐。

| Delta | 来源 | 分类 | R0 状态与最早归属者 |
|---|---|---|---|
| 通用 runtime-context 修复 | `0a940733e80d57c70245134bf260012f9be29114` 及测试修正 `e5e8b29b435f67e0a5dde5e2132580966e78b27b`，`packages/core/agent-loop` | `upstream-candidate` | 已在下游 `main` 实现；尚无 RC5 映射或检查；在面向模型可见的 Science 工具之前必须完成，但不在 R0 之前必须完成 |
| Science Session 域 | `e5e8b29...`，`packages/science/science-session` 及其通用投影/事件依赖 | `Science-owned` | 仅在下游集成；R1 的唯一下一切片 |
| Science Runtime | `e5e8b29...`，`packages/science/science-runtime`；R-probe 修正 `b15f1ef42e92b72ad1b53412966408415f669a18` 单独保留 | `Science-owned` | 已在下游集成的基础设施，`b15f1ef...` 处另有单独接受的真实 runtime 证据；仅在 Science Session 之后移植，并在 RC5 上重新验证 |
| 只读文件系统入口 | `8c7d5e01e3876b0c645f13f20ada8cf7add0c356` 与 `0073f6e0a11cd3444564cd1add5a252c70200b64` | `upstream-candidate` | 仅存在于 Phase 3 候选；整个候选未被接受；延后至其 Consumer 需要时 |
| Science 工具 Consumer | `27c96d8e...`，`packages/science/tool-science` | `Science-owned` | 仅为候选；继承了 Phase 3 的 hard stop；需要 Runtime 与 runtime-context 修复 |
| 内置 Science 预设 | `fae091e1080e830bed8ad0456e4cbced29101b01`，Science 预设/配置/快照相关路径 | `Science-owned` | 仅为候选；whole-candidate acceptance 为 FAIL；需要已接受的工具与组合证据 |
| 图表与 Outcome | 无实现 SHA | `Science-owned` | `not-started`；在工具/预设之后 |
| 设置与 Science 侧边栏/client | 无实现 SHA | `Science-owned` | `not-started`；需先有产品决策与投影 API |
| Desktop 载体 | 无实现 SHA 或第一方制品 | `Desktop-owned` | `not-started`；仅在共享的 Web Standard 与 Web Science 组合通过之后 |

R0A 中接受的发行/MVP 治理决策（`2026-08-15-dsh-science-desktop-distribution-reconnaissance.*`、修订后的 `2026-08-12-science-mode-core-mvp.*`）为上表中 Science-owned 与 Desktop-owned 各行未来的归属者提供依据，但它们本身不构成 overlay 行：它们不携带任何实现 SHA，也不移植任何代码。

## 推断

RC5 自身的治理/文档基础设施（`.agents/notes/`、`docs/AGENTS.md`、`scripts/doc-budgets.manifest.json`、`scripts/translation-pairing.manifest.json`、`scripts/project-doc-site.spec.ts`）与下游 `main` 在 architecture-governance worktree 编辑之前的相应路径逐字节一致——已在移植前通过比对 git blob 哈希确认。这正是 R0A 的证据路由提交内容能够未经修改直接适用于 R0B 的原因：尽管两条分支彼此不共享任何提交历史,但对于这些特定文件而言,双方在本次调查开始时都处于同一份未被编辑过的上游状态。

## 未验证与超出范围事项

在本初步记录形成时，官方提交的 GitHub 源码归档 SHA-256 尚未计算，因为该 commit object 已存在于本地。后续 archive 下载和 checksum 由 closure 记录负责。未进行 RC6 源码映射或兼容性审计。真实 provider、真实 Python/R、Desktop、安装器、签名、公证与发布就绪状态均未知，上述 PASS 不隐含这些结论。后续版本若无自身的精确身份重跑，不得继承本记录中的结果。
