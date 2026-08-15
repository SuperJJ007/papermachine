# DSH Science v0.1 R0 RC5 基线收口记录

[English](2026-08-15-dsh-science-v01-r0-rc5-baseline-closure.md) | 中文

调查与收口日期为 2026-08-15。本记录负责 R0 accepted identity 与 closure 结果；[已归档的 R0 scope](../../.agents/notes/archived/process/2026-08-15-dsh-science-v01-r0-release-baseline-scope.md)是冻结的 procedure 与 decision snapshot。本记录只取代[初步 macOS 记录](2026-08-15-dsh-science-v01-r0-rc5-baseline.md)的验收结论；后者仍负责其 macOS FAIL 与适配安装诊断。

## 结论

R0A 在 `73c0e9c004157798682759e7d5b0280b9ec913c3` 验收。R0B 已检查的产品输入固定为 `948693150e2fe8a9d38fbb1e125a2a106d9488ee`。Accepted R0B head 是一个 parent 为 `948693150e2fe8a9d38fbb1e125a2a106d9488ee` 的单一 closure commit；它最后同时修改 canonical scope triplet 与本 evidence triplet，且为 `codex/science-v01-rc5-baseline` 的 branch tip。

官方原文 packed-install 命令已经在 exact adopted source commit 对应的官方 `Release (dsh)` workflow、其声明的 `ubuntu-24.04` 平台上 PASS。Closure commit 的 final documentation 与 Git-scope rows 也 PASS，因此 R0B 已验收。基线中不存在 Science 或 Desktop 实现。

## 精确身份

| 对象 | 精确身份 | 证据结论 |
|---|---|---|
| 官方源码 | `https://github.com/deepseek-ai/deepseek-harness.git@47f943859bef60e4160492346772ded9b24f765a`；tree `f904efab9ef435201d6ba4da88a34d6366568272`；根 `package.json` 为 `@deepseek-ai/dsh-root`、`0.1.0-rc.5`、`MIT`、Node `^22.19.0 || >=24.0.0`、pnpm `11.7.0` | 采用的不可变源码 |
| 官方源码 archive | GitHub API tarball endpoint `https://api.github.com/repos/deepseek-ai/deepseek-harness/tarball/47f943859bef60e4160492346772ded9b24f765a`；13,745,620 bytes；SHA-256 `ce0f276905132b73faf7a4d91d6a2d878eeecca1750e0c99aeb192cda727b8ef`；顶层目录 `deepseek-ai-deepseek-harness-47f9438/`；8,618 entries | 2026-08-15 下载、`gzip -t`、metadata 提取和 checksum PASS |
| 官方 workflow | [`Release (dsh)` run `31701562303`](https://github.com/deepseek-ai/deepseek-harness/actions/runs/31701562303)，job [`94451698870`](https://github.com/deepseek-ai/deepseek-harness/actions/runs/31701562303/job/94451698870)；push event；`head_sha` `47f943859bef60e4160492346772ded9b24f765a`；`.github/workflows/release.yml`；2026-08-13T12:45:35Z 开始、12:52:19Z 完成 | Primary exact-SHA `ubuntu-24.04` build、pack 与官方原文 packed-install evidence |
| R0A | 分支 `codex/science-v01-r0a-governance-closure`；head `73c0e9c004157798682759e7d5b0280b9ec913c3`；tree `c53d3a9274ebf3f5986be5f42224f724c0324a91`；下游 `e5e8b29b435f67e0a5dde5e2132580966e78b27b` 后接 `50ff1552ca8ed138ecd162b52c46856e8493e0fb`、`73c0e9c004157798682759e7d5b0280b9ec913c3` | 已接受治理子集，不属于 R0B ancestry |
| R0B 已检查内容 | `948693150e2fe8a9d38fbb1e125a2a106d9488ee`；tree `35062cb234e05176fa83132253ea797634700a1a`；直接 ancestry `47f943859bef60e4160492346772ded9b24f765a` → `3751f6fcc497e9e23385f69a0d5f3cfdbaac5a6e` → `922d60421a8a6a2983f27de266a02d3d7c5af3b3` → `3ca64b38867fe78792a4d95ff3ba39e26444db82` → `948693150e2fe8a9d38fbb1e125a2a106d9488ee` | source/build/packed 检查使用的精确产品输入 tree |
| R0B accepted head | `f9bb7b4a91afe1cf69568184ff093fa9a8bd52f9`；tree `541637a9401577f9beab7caf026a539583469c0b`；sole parent `948693150e2fe8a9d38fbb1e125a2a106d9488ee`；subject `docs(evidence): close RC5 release baseline` | 精确的 accepted closure commit |
| 已观察 npm 制品 | `@deepseek-ai/dsh@0.1.0-rc.6`；integrity `sha512-brpZfED7ieRa2PQ5tUxMhHrM1pb2CmKFVM/f6yMULBDMicahk+Z2OsHgTwTDnoiZm23Ftu9rQz0NN4pflaoJcg==`；未观察到 `gitHead` | 仅为 source-unmapped 观测；未采用且不等于 RC5 |
| Science overlay | `https://github.com/omdsh-dev/dsh-science.git`；下表逐行列出完整 SHA 与路径 | 仅证明下游来源 |
| Desktop 制品 | 无 | 不存在 Desktop build/runtime/installer/signing/release 证据 |

官方源码 archive 只作为数据下载和检查，未安装或执行其中代码。R0B build 使用同一官方 commit 所根植的本地 Git tree。

## 输入继承与允许的 closure diff

产品输入检查运行于 `948693150e2fe8a9d38fbb1e125a2a106d9488ee`。Accepted closure commit 只允许修改以下逻辑记录：

- 把 `.agents/notes/proposed/process/2026-08-15-dsh-science-v01-r0-release-baseline-scope.{md,zh.md,i18n.yaml}` 移到对应 `implemented/process/` 路径，并把 pair 改写为已实施 Decision；
- 新增 `docs/evidence/2026-08-15-dsh-science-v01-r0-rc5-baseline-closure.{md,zh.md,i18n.yaml}`；
- 修正 `docs/evidence/2026-08-15-dsh-science-v01-r0-rc5-baseline.{md,zh.md,i18n.yaml}` 的链接和验收措辞，但保留其历史命令结果。

`git diff --name-status 948693150e2fe8a9d38fbb1e125a2a106d9488ee..HEAD` 不得出现其他路径。`git diff --exit-code 948693150e2fe8a9d38fbb1e125a2a106d9488ee..HEAD -- package.json pnpm-lock.yaml packages apps vendor native .github/workflows` 必须退出 `0`。这些检查证明源码、package、lockfile、app、native 与 release-workflow 输入逐字节等同于 checked-content commit，但不允许继承以已改文档为输入的结果。

## 验证矩阵

| 层级 | 平台与命令 | 结果与限制 |
|---|---|---|
| 工具链/frozen install | macOS 26.5.2 arm64；Node `v24.19.0`；pnpm `11.7.0`；`pnpm install --frozen-lockfile` | checked content PASS；exit `0`；依赖图未改变 |
| Standard source launch | macOS；`pnpm exec vitest run apps/cli/tests/source-launch.compat.spec.ts` | PASS，1 file、2 tests |
| Standard build/artifact | macOS 非 `/tmp` R0B worktree；`pnpm run check:ci:artifacts` | PASS，5/5：build、publint、built-package invariants、NodeNext consumer types、built-bin smoke；19.25 s |
| Standard Web composition | 同一 built tree；`pnpm exec vitest run --config vitest.e2e.config.ts apps/cli/tests/web-agent-presets.e2e.ts` | PASS，30/30；未用真实 provider credential |
| 聚焦 built CLI | 同一 built tree；`DSH_REQUIRE_BUILT_CLI_SMOKE=1 pnpm exec vitest run apps/cli/tests/lazy-search-startup.compat.spec.ts` | PASS，1/1 |
| macOS 官方原文 packed install | 初步记录中的原样 `pnpm run release:verify-packed-install --family dsh --from ...` | 历史 FAIL：`--omit=optional` 移除了 koffi arm64 prebuilt，fallback source link 失败。该行为不是 R0B 文档 diff 引入，且未证明 workflow 平台结果 |
| macOS 适配安装与 Web | 初步记录中的同一批 231 tarballs；安装时不带 `--omit=optional`，运行 installed `--version` 与 `POSIX_WEB_PROBE` | PASS：installed version `0.1.0-rc.5`；Standard Web 到达 loopback readiness 并退出 `0`。只作为诊断，不替代官方原文命令 |
| Workflow 平台 release pack | 官方 `Release (dsh)` run `31701562303`，exact `head_sha` `47f943859bef60e4160492346772ded9b24f765a`；`.github/workflows/release.yml` 声明 `runs-on: ubuntu-24.04`、Node major `24`、immutable install、`release:verify --family dsh`、build、dsh/vendor/Landlock pack | PASS：所有命名 step 均成功；日志报告 family dsh、221 members、version `0.1.0-rc.5`、221 个 dsh tarballs 与 9 个 vendor tarballs；加上 Landlock entry 后安装集合为 231 |
| Workflow 平台 installed CLI identity | 同一 run/job；官方原文 `pnpm run release:verify-packed-install --family dsh --from dist/npm --from dist/npm-vendor --from dist/npm-landlock` | PASS：step 13 成功；日志报告安装 231 个 tarballs，且 `installed @deepseek-ai/dsh reports 0.1.0-rc.5` |
| 本地 Ubuntu replay 诊断 | 从 checked content 的干净 `git archive` 执行 `docker buildx build --progress plain --load --network host --platform linux/amd64 ...` | 产品层为 `NOT-RUN`：exact 官方 workflow evidence 找到后，在 apt package acquisition 阶段停止冗余传输准备；容器内未运行 repository install/build/pack 命令，也不继承其结果 |
| 最终文档 | Accepted head；聚焦 Agent Note、classification、pairing 与 reasoning-leakage 检查；`pnpm run doc-sync`；`pnpm run lint`；`git diff --check 47f943859bef60e4160492346772ded9b24f765a..HEAD` | PASS；closure tree 上全部 repository documentation gates、lint、pair/link integrity、prose recall review 与 whitespace checks 成功；exact command output 随 accepted head 报告 |
| 最终 Git scope | Accepted head；ancestry、sole parent、逻辑记录 allowlist、protected-state 对比与 clean status | PASS：官方 RC5 是 ancestor，sole parent 为 checked content，三个授权逻辑 triplet 恰好形成 12 个 physical paths，product/release inputs 不变，受保护输入一致，worktree clean |

`/tmp` closure worktree 中的 `check:ci:artifacts` 曾在两个 built-bin lifecycle tests 上产生非验收 FAIL。同一 checked-content commit 在必需的非 `/tmp` R0B worktree 中运行同一命令后 PASS，因此验收只采用非临时 worktree 结果。

## 完整 overlay inventory

除非列出更严格状态，以下每行相对 RC5 均为 `not-started`。历史下游测试只证明 provenance，不证明 RC5 port。

### 身份与归属

| `delta_id` | Owner | `source_identity` | RC5 target | Classification | `port_status` |
|---|---|---|---|---|---|
| `GEN-SESSION-REGISTRY` | DSH Science maintainers；通用 Session/projection owners | `omdsh-dev/dsh-science@e5e8b29b435f67e0a5dde5e2132580966e78b27b`；`packages/core/session/src/known-event-types.ts`、`packages/session/session-projection/**` 及下游 Session refactor 触及的 persistence/query consumers | `47f943859bef60e4160492346772ded9b24f765a`；通用 known-event 与 projection registration APIs | `generic` | 只在 R1 `mapping`；R0 未移植代码 |
| `SCI-SESSION` | DSH Science maintainers；`science-session` | `omdsh-dev/dsh-science@e5e8b29b435f67e0a5dde5e2132580966e78b27b`；`packages/science/science-session/**`；实现历史起于 `26b3d5013c1fc216ab8ee13d7bec903183cfdf90`，包含 `66becdbd97a8284ed3b226686840d19a1e436284` | RC5；新 `packages/science/science-session` capability | `Science-owned` | `not-started`；R1 唯一产品 slice |
| `GEN-RUNTIME-CONTEXT` | DSH Science maintainers；`agent-loop` owner；需 upstream review | `omdsh-dev/dsh-science@0a940733e80d57c70245134bf260012f9be29114`，tests 在 `e5e8b29b435f67e0a5dde5e2132580966e78b27b` 修正；`packages/core/agent-loop/src/agent.ts`、loop/resume tests 与 README | RC5 `packages/core/agent-loop` request-context restoration | `upstream-candidate` | `deferred`，直到 model-visible Science consumer 需要 |
| `SCI-RUNTIME` | DSH Science maintainers；`science-runtime` | `omdsh-dev/dsh-science@e5e8b29b435f67e0a5dde5e2132580966e78b27b`；`packages/science/science-runtime/**`；provider 历史包含 `bf4be838066576dc005822428e259673b049e048` | RC5；Science runtime capability 与 local Conda provider composition | `Science-owned` | `deferred`，直到 `SCI-SESSION` 验收 |
| `SCI-R-PROBE` | DSH Science maintainers；`science-runtime` environment owner | `omdsh-dev/dsh-science@b15f1ef42e92b72ad1b53412966408415f669a18`；`environment.ts` 与聚焦 tests/docs | `SCI-RUNTIME` 后的 RC5 R version discovery | `Science-owned` | `deferred`；保持独立 evidence identity |
| `FS-READONLY` | 通用 filesystem maintainers；需 upstream review | `omdsh-dev/dsh-science@8c7d5e01e3876b0c645f13f20ada8cf7add0c356`；`packages/fs/tool-fs/src/{config,index,read-only}.ts`、metadata、tests/docs | RC5 `packages/fs/tool-fs` read-only plugin entry | `upstream-candidate` | `candidate`；Phase 3 整体未接受 |
| `FS-READONLY-LOAD-FIX` | 通用 filesystem maintainers；需 upstream review | `omdsh-dev/dsh-science@0073f6e0a11cd3444564cd1add5a252c70200b64`；read-only loader、metadata、lockfile 与 tests | RC5 `packages/fs/tool-fs`；依赖 `FS-READONLY` | `upstream-candidate` | `candidate`；与 feature SHA 分列 |
| `SCI-TOOLS` | DSH Science maintainers；`tool-science` | `omdsh-dev/dsh-science@27c96d8e8b2431814fe70a2e94fe8feeaf207b63`；`packages/science/tool-science/**` 及直接归属的 composition/docs | RC5 model-facing Science tool Consumer | `Science-owned` | `candidate`；Phase 3 整体 acceptance 为 FAIL |
| `SCI-PRESET` | DSH Science maintainers；CLI preset composition | `omdsh-dev/dsh-science@fae091e1080e830bed8ad0456e4cbced29101b01`；`apps/cli/config/agent-presets/science/**`、Science fixture/snapshot 与 Web preset composition | RC5 CLI/Web Science preset | `Science-owned` | `candidate`；Phase 3 整体 acceptance 为 FAIL |
| `SCI-CHARTS-OUTCOME` | DSH Science product/visualization owners | 无 implementation SHA；仅有产品需求 | Future RC5 chart rendering 与 Outcome Consumer | `Science-owned` | `not-started` |
| `SCI-SETTINGS-SIDEBAR` | DSH Science product/client owners | 无 implementation SHA；仅有产品需求 | Future RC5 settings projection、settings card、Science sidebar/client | `Science-owned` | `not-started` |
| `DESKTOP-CARRIER` | DSH Science Desktop/release owners | 无 implementation SHA 或第一方 Desktop artifact | Future Desktop carrier，承载已接受的 Standard 与 Science Web composition | `Desktop-owned` | `not-started` |

### 依赖、测试、证据与处置

| `delta_id` | Dependencies | 必需测试与证据层 | 当前证据与 disposition |
|---|---|---|---|
| `GEN-SESSION-REGISTRY` | RC5 known-event、projection registration、persistence/query APIs | 聚焦 registration/persistence/replay；build/package invariants；packed/runtime/Desktop/release 不适用 | 仅历史下游状态。R1 先 mapping；只移植 RC5 缺失的最小通用支持，并在独立有用时 propose upstream |
| `SCI-SESSION` | `GEN-SESSION-REGISTRY` | Per-file 100% unit coverage；fold/invariant/projection/checkpoint/durability/replay；typecheck/build/publint；real Python/R、Desktop、release 不适用 | 仅历史下游 tests。R1 单独 port 或 rewrite；发现 Runtime/tools/preset 泄漏即 hard stop |
| `GEN-RUNTIME-CONTEXT` | RC5 agent-loop request/resume lifecycle | 聚焦 loop/resume、typecheck/build、source-launch composition；published path 用到时再做 packed；real-runtime/Desktop/release 不适用 | 仅历史 commit/tests。Session 后重新评估；按 RC5 APIs propose upstream 或 rewrite |
| `SCI-RUNTIME` | `SCI-SESSION`；RC5 sandbox/subprocess/shell/session APIs | Lifecycle/unit/loader composition；source/build/packed；干净 exact-SHA real Conda Python/R acceptance；本层 Desktop/release 不适用 | 仅历史下游 infrastructure。Session 后移植并重跑全部 RC5/runtime evidence，不继承 Phase 2 PASS |
| `SCI-R-PROBE` | `SCI-RUNTIME`；real Conda R `Rscript` | Environment unit 与独立 machine-readable real R exact-SHA acceptance；Desktop/release 不适用 | `b15f1ef...` 只有历史 real-runtime evidence。随 Runtime 移植后重跑，不推断 RC5 PASS |
| `FS-READONLY` | RC5 FS service/tool interfaces | Unit config/tool、built read-only entry e2e、typecheck/build/publint、packed root import；real-runtime/Desktop/release 不适用 | 仅 candidate provenance。Science tool Consumer 确有需要时单独 port 或 propose upstream |
| `FS-READONLY-LOAD-FIX` | `FS-READONLY`；RC5 package resolution | Valid/invalid loader、built e2e、package/lockfile review、build/hygiene | 仅 candidate provenance。只有 RC5 mapping 复现 load 问题时应用，否则 reject 为 obsolete |
| `SCI-TOOLS` | `SCI-RUNTIME`、`GEN-RUNTIME-CONTEXT`，以及证明必要的两个 FS row | Unit/invariant、agent-loop composition、built root import、typecheck/build/publint；首个 runnable composition 同时添加 keyless preset snapshot；验收前 real Python/R command evidence | Phase 3 whole-candidate acceptance 与 hygiene 均为 FAIL。依赖接受后按小 slice rewrite/port，不整体采用候选 |
| `SCI-PRESET` | 已接受的 `SCI-TOOLS` 与 `SCI-RUNTIME` | Keyless CLI snapshot、Standard/Science Web composition、browser replay fixtures、source/build/packed Web；provider e2e 保持 key-gated | Phase 3 whole-candidate acceptance 为 FAIL。Tools 接受后再 port，并重跑全部 composition evidence |
| `SCI-CHARTS-OUTCOME` | 已接受 tools/preset，及 model-visible result/renderer ownership 产品决定 | Unit/render/snapshot、assembled app、accessibility/browser；carrier 存在后做 packed Web/Desktop；signing/release 更晚 | 无实现或证据。先做产品决定再实现，不从 generic chart 支持推断 |
| `SCI-SETTINGS-SIDEBAR` | 已接受 Runtime，及 prefix/settings projection/navigation ownership 产品决定 | Client unit、API/projection、keyless browser/snapshot、packed Web；Desktop runtime 更晚 | 无实现或证据。先决定 settings-card 与 sidebar 语义 |
| `DESKTOP-CARRIER` | 已接受 Standard/Science Web composition，以及 branding/bundle/signing/update 决定 | Desktop build、installed runtime、installer/updater、macOS signing/notarization、Windows Authenticode/platform matrix；publication/release 分层 | 无 source/artifact。共享 Web 验收后才开始；全部 Desktop/release 层为 `NOT-RUN` |

## 受保护状态零干扰

下列路径与 refs 是只读输入。最终比较必须复现 closure 前记录的相同 head、branch/detached 状态和 tracked/untracked 状态；本任务创建的 closure worktree 不在受保护清单内。

| 受保护 worktree/ref | Entry identity 与状态 |
|---|---|
| `/Users/superjj/ccproj/DSHscience`；`main` | `e5e8b29b435f67e0a5dde5e2132580966e78b27b`；clean；`origin/main@0be28653be115622c554dae3f00105c2305b9c02`；local ahead 2 |
| `/private/tmp/dshscience-science-v01-architecture-governance` | `codex/science-v01-architecture-governance@e5e8b29b435f67e0a5dde5e2132580966e78b27b`；11 tracked modifications、11 untracked paths |
| `/Users/superjj/.codex/worktrees/24b6/DSHscience` | detached `e5e8b29b435f67e0a5dde5e2132580966e78b27b`；本 R0 closure 任务前 clean |
| `/Users/superjj/.codex/worktrees/7e1d/DSHscience` | `codex/fix-science-r-version-probe@b15f1ef42e92b72ad1b53412966408415f669a18`；clean |
| `/Users/superjj/.codex/worktrees/8489/DSHscience` | detached Phase 3 `fae091e1080e830bed8ad0456e4cbced29101b01`；clean |
| `/Users/superjj/.codex/worktrees/8942/DSHscience` | detached `e5e8b29b435f67e0a5dde5e2132580966e78b27b`；clean |
| `/Users/superjj/.codex/worktrees/e229/DSHscience` | detached `e5e8b29b435f67e0a5dde5e2132580966e78b27b`；clean |
| `/Users/superjj/.grok/worktrees/ccproj-dshscience/2026-08-13-a6c14eca` | detached `9e1086777a0eb1c9429e7877deb88387bf52459b`；54 tracked modifications、31 untracked paths |
| `/Users/superjj/ccproj/dshscience-r0a-governance-closure` | `codex/science-v01-r0a-governance-closure@73c0e9c004157798682759e7d5b0280b9ec913c3`；clean |
| `/Users/superjj/ccproj/dshscience-r0b-rc5-baseline` 在 accepted-head fast-forward 前 | `codex/science-v01-rc5-baseline@948693150e2fe8a9d38fbb1e125a2a106d9488ee`；clean；检查全部通过后只允许把该分支 fast-forward 到 accepted closure commit |

R0 不对任何受保护 worktree 执行 stage、clean、reset、delete 或 repoint。Canonical R0B branch 只在验收后 fast-forward。本任务创建的 closure worktree 随后可移除，因为 accepted commit 仍由 canonical branch 引用；获授权的 remote publication 单独验证。未提交的失败状态仍默认保留供检查。

## 生命周期与 supersession 审计

只有在同一 accepted closure commit 中满足 entry/exit/hard-stop，R0 scope pair 才从 `proposed/process` 移到 `implemented/process`，并改写为当前 Decision 与 Consequences。初步 evidence 仍作为日期化历史并链接本记录；其 macOS FAIL 不被改写。Stable architecture docs 不接收易变 SHA、platform、branch 或 check result。

Implemented doc-tier 与 npm release-sequence notes 保持 active，因为它们分别负责 evidence routing 与 packing mechanics。Proposed Science MVP、Desktop distribution、artifact-first notes 保持 active，因为 R0 没有实施或 reject 其剩余产品决定。没有相关 active note 符合 archive/delete 条件，也不编辑 archived note。

## 风险、未知项与延后产品决定

- RC5 在 v0.1 开发期间有意累积一次迁移成本。后续迁移必须选择精确的届时官方源码并重放每个 accepted inventory row，不继承 RC5 evidence。
- Phase 3 代码只作 provenance，不是 accepted stack。若 RC5 mapping 带入无关 candidate 变更或仍保留 whole-candidate FAIL，后续 slice 必须停止。
- Desktop 名称、bundle identifier、signing identity、update feed、packaging target 与 release channel 是真实产品/发行决定，但不阻塞 R0 或 R1 Session。
- 外部 Python/R prefix 的 settings-card 语义、Science navigation owner、chart/Outcome presentation 与 post-v0.1 target SHA 延后到所属 slice。
- 固定首版不需要 RC6 source mapping。安全或 build-blocking upstream 事件通过独立 change control 处理，不做顺手 rebase。

## 明确 NOT-RUN

真实 provider/model、需 key 的 e2e 或 snapshot recording、真实 Python/R、Windows Wine、浏览器交互验收、Science composition、Desktop/Electron/Tauri build/runtime、installer、updater、signing、notarization、Authenticode、npm publication、Git tag、release job、PR creation 与迁移最新版均为 `NOT-RUN`。验收后经明确授权的 repository push 只发布 Git refs，不证明上述任何层。

## 唯一下一步

唯一的下一项实现由 [RC5 上的 R1 Science Session](../../.agents/notes/implemented/feature/2026-08-15-dsh-science-v01-r1-science-session.md)约束：把 `omdsh-dev/dsh-science@e5e8b29b435f67e0a5dde5e2132580966e78b27b` 中边界明确的 `GEN-SESSION-REGISTRY` 前置项与 `SCI-SESSION` mapping、port 并验收到 accepted R0B line。其余 inventory rows 均保持 deferred。
