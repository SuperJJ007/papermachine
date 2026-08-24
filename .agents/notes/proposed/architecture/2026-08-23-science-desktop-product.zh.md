# Agent Note: Science 桌面产品组合与环境配备

Status: proposed

[English](2026-08-23-science-desktop-product.md) | 中文

## 问题

已经交付的 Science 能力是浏览器产品里可选择的 agent preset，而目标桌面产品是一套科研工作台，用户不应选择产品模式。全新的 macOS 用户在第一次分析前仍需安装 Node 与 pnpm、输入终端命令、访问浏览器 URL、手工准备 Conda prefix、编辑 settings 文件并设置环境变量。这些安装要求使现有功能组合无法成为面向不管理编程环境的科研者的双击即用产品。

桌面 carrier 还跨越多项已有的职责决定。Host 必须保留为独立 process，使它的故障与 process tree 不会拖垮 Electron。Web Client packages 必须继续作为唯一 UI 实现，但现有 GUI 架构把 HTTP 与浏览器信任交给 Web carrier，并为 Electron 预留 IPC fetch carrier。凭据属于 credentials provider，环境绑定属于 Science Runtime，durable sessions 位于 Harness home 下，process 清理属于现有 subprocess lifecycle。绕过任一持有方的壳都会形成第二套产品架构。

Science 与学科属于不同组合轴。Science 提供产品工作流、UI、Runtime 与 model-facing 分析能力。学科包提供 instructions、skills、产出惯例与环境声明。把 Science 本身当作可选 preset 会让产品轴成为可选项；把学科当作产品模式则会妨碍 session 在不更换桌面产品的前提下切换学科。

## 提案

交付 macOS 优先的 Electron 应用，其产品 bundle 恒定挂载完整 Science 组合。桌面应用不提供“Science 模式”选择器或 session-header 标识。通用 Harness deployments 保留现有的 `agentPreset === 'science'` 展示 fence，而桌面组合为每个 session 提供 Science identity。学科包继续作为可选择的 agent compositions，并可独立于产品 carrier 更换。

Electron 以 child process 启动 built Host，并把 `DSH_HOME` 设在 `~/.papermachine` 下（`apps/desktop/src/harness-home.ts`，解析于 OS user home directory 之下，而非 Electron 自身的 `userData`；参见[迁移 Harness home 的 Agent Note](../../implemented/bug-fix/2026-08-25-desktop-harness-home-space-free.zh.md)）。Host 以及每个 kernel 或 tool subprocess 继承显式 launch environment，而不是用户的 interactive shell。正常退出要求 Host dispose 其 Cordis tree；Electron 异常终止由既有 subprocess process-tree 清理以及检测残留 descendants 的桌面验收共同覆盖。Host crash 保留 Harness home，并在现有窗口内展示重启操作。

发布应用的目标是从 `file://` 加载 built Web Client，并使用 Client fetch carrier 的 Electron IPC 实现，不通过 loopback port 提供 UI，也不暴露浏览器 URL。该 IPC carrier 目前尚未实现：无论是否为 packaged 版本，当前每次构建都通过 OS 分配的端口启动 private-loopback Web carrier。`main.ts` 的 packaged 分支选择已暂存的 production Host closure，却运行与之相同、经由 `127.0.0.1` 提供服务的 `dsh --profile web` 进程，且 Electron Builder 会把该 closure 打进 DMG（`apps/desktop/electron-builder.yml` 中 `.stage/host` → `host` 的 resource 项）。因此 private-loopback Web carrier 同样是 packaged development carrier 的 transport，直至 IPC carrier 落地。这使 [GUI 分层决定](../../implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.zh.md)继续作为 transport ownership 的权威记录，因为 loopback launcher 是开发过渡桥梁，而非第二套 transport 实现。

## 产品组合

desktop bundle 的 Runtime overlay（`apps/desktop/src/runtime-overlay.ts`）把 `agent-presets` 的 config `default` 设为 `science`，并禁用 `ui-agent-preset`（通用 preset 选择器行），因此全新 Harness home 中创建的 session 会挂载 shipped `science` preset，且没有可见的模式选择器。这一 settings-default 机制是已接受的过渡方案，而非被否决的替代方案：它复用既有的 preset-default seam，而不是新增一层独立于 preset 选择、直接插入 Science rows 的产品组合层。其已知限制是：`AgentPresets.defaultId` 会先读取热重载的用户 settings 值，再回退到 config default（`packages/preset/agent-presets/src/index.ts:192`），因此在该 overlay 生效之后写入的 settings 值仍可能为之后的 session 选中另一个 preset，桌面组合本身并不会阻止这一点。等到 packaged IPC carrier 取代 loopback development launcher 之后，独立于 preset 选择、且不受 settings override 影响的直接 Science-row 插入方案，仍是目标方向。preset 机制在其之下继续担任 session-scoped 的学科层：一份学科 composition 提供 persona、instructions、skills 与 environment-package identifier。第一个学科包是社会科学；生物学随后作为首个大型环境验证。

通用 CLI 与 Web profiles 保留当前组合与 Science fence。已有 shipped `science` preset 在那里继续可用，直至学科包替代其余 prompt 与 tool contribution。在迁移期间，desktop bundle 通过其 settings default 引导同一个 preset，而不是挂载重复 registrations。本笔记部分 supersede 了 [Science preset note](../../implemented/feature/2026-08-16-dsh-science-v01-r4-science-preset.zh.md) 中「Science 严格是 opt-in preset」的结论：该笔记继续负责通用 Web preset 选择、roster 与 durable Science identity，而桌面组合通过上述 settings-default 机制，把 `science` 设为其自身产品表层的 default。

## Electron 下的 config-only HMR

桌面 Runtime overlay 除了沿用 web bundle 自身对 `hmr` 行（`id: hmr`）的禁用之外，也显式禁用它，这样即便日后 web bundle 重新启用该行，桌面组合依然保持正确。该行并不是一次已复现的 dev Host 崩溃的成因——该崩溃里 readiness 行先打印出来，随后进程在 `@deepseek-ai/cordis-plugin-hmr` 上死掉：真正失败的 entry 是 launcher 自身的 config-only HMR fallback（`apps/cli/src/profile-boot.ts`），只要组合中没有 `hmr` service 就会自动挂载它，以保持 `cordis.patch.yml` 可热重载。这个 fallback 需要与 HMR 自身 constructor 相同的 Node internals 访问能力——`--expose-internals` 或可用的 `node-addon-require-builtin`——而 Electron 的 forked Node 完全不具备，因为其内嵌的 V8 build 缺少 `node-addon-require-builtin` 所需的 symbol。`profile-boot.ts` 的 `canMountConfigHmr` 现在用同一项能力检查来判断是否挂载该 fallback，在不可用时只写一条 stderr 提示并跳过，而不是让 Host 崩溃；这种情况下该次运行不再具备 `cordis.patch.yml` 的实时热重载。复现的崩溃退出码是 1：一次 readiness 之后的 fatal loader-entry failure，本就会经由 Node 的 top-level-await module-evaluation 路径以非零码退出，因此无需再为退出码单独修复。

## 环境配备

v1 onboarding 不再经过本节：它改为检测并绑定机器上已有的 conda-family 环境（见下文「首启向导与凭据」）。本节所述的 declaration schema、事务性 prefix 安装、health checks、可恢复性，以及 `desktop:provision`/`desktop:cancel-provisioning` 这两个 IPC handlers，在本版本中仍然完整实现并保留测试，只是没有可从 UI 触达的入口；这条路径被保留为未来版本中面向没有可用 conda-family 环境的用户的安装 fallback。

每个学科包携带 versioned environment declaration，其中命名支持的平台、micromamba environment lock 或明确的 channels 与 packages、磁盘空间提示以及 health checks。声明不含 executable hooks。桌面 provisioning service 校验声明，使用应用内嵌的 micromamba executable 安装到应用持有的 environment directory，把结构化进度流送到 onboarding UI，并且只在两个 interpreter health checks 都通过后发布 applied Science environment revision。

provisioning 在声明的 environment revision 上可恢复且具备事务性。每个 revision 发布到自己的 prefix 路径（`environments/<discipline>/<revision>`），每个 health check 都针对这一确切路径运行——Conda/micromamba 安装会把 install-time 的 prefix 写死进 shebang 与 interpreter home 变量，因此在一个路径上通过的 check 无法证明另一个发布路径的任何事情。失败或取消的 solve，在全新配备或不同 revision 的配备下继续以此前 applied revision 为权威；下文所述的同一 revision 原地修复路径会在触碰 prefix 之前先清空该 pointer，因此那里发生的失败会导致完全没有 applied revision。重试会复用 micromamba package cache，并在重新创建前清空未 ready 的 prefix 目录，因为没有匹配 `applied.json` 条目的 prefix 目录永远不算 ready。网络 channels 与可选 mirrors 属于已校验配置，因为不同 deployment 的可达性不同。社会科学声明提供包含 pandas、statsmodels、matplotlib 与 Altair 的 Python，以及 base R 与首批 tidyverse 统计 packages。生物学声明提供后续 Bioconductor 验证集，并通过声明字段提高 provisioning timeout 与磁盘提示，而不是使用 plugin constants。

学科一旦应用并非永久固定：启动时会将 applied revision 与同一学科 id 的 shipped declaration 比对，不一致就路由回 onboarding 重新配备更新的 revision。为与当前 applied revision 不同的 revision 配备时，在新 revision 本身被应用之前绝不会触碰当前 applied 的 prefix。重新配备当前已 applied 的那个确切 revision 则是原地修复：会先清空 pointer，再删除并重建 prefix，因此中途失败会留下如实的 not-ready 状态，而不是一个仍被标记为 current 的已损坏环境。应用菜单提供一个操作，可按需重新打开 onboarding，让用户配备另一个学科包或修复当前这个；以这种方式进入 onboarding 会先停止活跃的 Host，否则存活的 Host（及其 persistent kernel）会继续运行在修复动作即将删除的 prefix 上。

Runtime 继续持有 interpreter execution 与 revision rebinding。Provisioning 只创建并验证 prefixes；rebinding 通过写入的 `science-runtime` Cordis patch overlay（`apps/desktop/src/runtime-overlay.ts`）完成，该 overlay 命名新 applied 的 prefix，并在随后的 Host 重启时生效。[persistent-kernel 决定](../../implemented/architecture/2026-08-20-science-persistent-kernel.zh.md)继续负责在新的 applied environment revision 出现后结束 stale kernel。

## 首启向导与凭据

全新的 Harness home 在 session workspace 前打开 onboarding。onboarding 会检测机器上已有的 conda-family 环境，并让用户分别独立绑定一个 Python environment 与一个 R environment，而不是通过 micromamba 下载并安装环境（该 fallback 见上文「环境配备」，已保留但没有入口）。检测（`apps/desktop/src/detection.ts`）扫描传统安装根目录——Anaconda、Miniconda、Miniforge、Mambaforge 与 Micromamba 各自的 per-user 默认 prefix，加上两个常见的系统级 Miniconda/Anaconda 位置与 Homebrew Cask miniconda prefix，每个根目录连同其 `envs/*` 子目录——并解析 `~/.conda/environments.txt`，全程不调用终端或任何 conda 命令；一个 prefix 只要拥有一份 regular 的 `conda-meta/history` 文件，以及 `bin/python`、`bin/Rscript` 中至少一个，就算合格，这与 `staticInterpreter`（science-runtime）要求的 POSIX 目录结构一致，合格的候选项会附带一次经过环境变量过滤、带超时限制的 `--version` 探测得到的 best-effort 解释器版本。onboarding 把候选项呈现为两个相互独立、各自单选的分组——Python environments 与 R environments，每组都带一个明确的「不绑定」选项——因为真实机器上 Python 与 R 常常分属不同的 conda-family environment，而 `environment-binding.json` 的 `pythonPrefix`/`rPrefix` 字段本就相互独立；同时具备两种解释器的候选项会出现在两个分组里，每组各自预选自己的第一个合格候选项。绑定时会针对每个所选 prefix 被选中所属的那个解释器重新校验（`apps/desktop/src/environment-binding.ts` 中的 `resolveBindRequest`），因为文件系统可能在检测与点击之间发生变化；只要任一所选 prefix 的重新校验失败，整次绑定就会被拒绝，而不会写入一个只有一半的结果，之后才写入 `<dshHome>/environment-binding.json`（`pythonPrefix` 与/或 `rPrefix`，原子写入，权限 0600）并打开 workspace。当检测完全没有发现任何合格环境时，onboarding 会展示安装引导（前往 anaconda.com 安装 Anaconda）与一个重新检测操作，取代原先的学科选择。桌面 onboarding 不采集 DeepSeek API key：在桌面 onboarding 内录入凭据仍是待办工作。workspace 已经加载的现有 Web Client model-configuration UI 仍是唯一的 writer，通过 credentials provider 以 `DEEPSEEK_API_KEY` 写入；它绝不进入 desktop settings、logs、renderer persistence、command arguments 或 crash diagnostics。跳过 key 配置后应用仍可使用，并在 session 需要 inference 时展示同一份引导。

Readiness 完全由 `environment-binding.json` 决定；桌面 onboarding 不保留其他 state file，上文「环境配备」所述学科包的 `applied.json` pointer 在这条路由判断中不起任何作用。启动时会解析该 binding 文件，并确认其中列出的每个 prefix 在磁盘上仍然存在；文件不存在属于普通首次运行，而无法解析或指向已消失 prefix 的文件，则会带着醒目的状态信息路由回 onboarding，而不是被悄悄当作首次运行处理。检测或绑定失败时，状态栏会替换为失败操作的错误信息；带 secrets redaction 的 diagnostics 入口仍是待办工作。重新安装或升级应用会复用 Harness home；如果 `environment-binding.json` 已经指向一个仍然有效的 prefix，就不会重复检测或绑定。

## 分发

macOS 应用使用 plain Node 语义下的 built `lib/` 与 Web artifacts 构建；source launchers 与 tsx 不进入 package。Electron Builder 为两种受支持的 macOS architectures 生成 DMG。

更新 metadata 发布到带 artifact checksums 的 static feed。更新可以替换 application code 与内嵌 micromamba executable，但绝不替换 Harness home 或 applied environments。Windows 不属于首发范围，并需要独立的 distribution 与 process-tree acceptance 决定。

## Electron 主进程启动顺序

在 Electron 43.4.1 / macOS 26.5.2 arm64 上，ESM 主进程入口里若有一个 top-level `await`，其恢复依赖 Electron native signal——`await app.whenReady()`，或是等待由 `app.once('ready', …)` listener resolve 的 promise——就永远不会恢复；该进程不会 spawn 任何 renderer，也永远不会打开 window。同一个 promise 上非 top-level 的 `.then()` continuation 可以正常恢复，由 Node timer 或 microtask 驱动的 top-level await 也能正常恢复。`main.ts` post-ready 的启动逻辑（application menu、IPC handlers、初始 window，以及 `activate`/`before-quit`/`window-all-closed` listeners）运行在一个 `boot()` function 里，由 `app.whenReady().then(boot)` 调用，并附带一个 `.catch`，在启动失败时记录日志并调用 `app.exit(1)`，让启动失败大声退出而不是悄无声息地挂起。该入口的防御规则：绝不在依赖 Electron native signal 的 promise 上放置 top-level `await`；改用 `.then()` 驱动该 continuation。

## 交付切片

D1 至 D5 均已在 `apps/desktop` 中落地。D1 交付了 Electron carrier、独立 Host lifecycle、应用持有的 Harness home、development launch、crash restart 与 residual-process tests。D2 交付了内嵌 micromamba asset pipeline、declaration schema、社会科学 provisioning service、progress 与 retry UI，以及 Python/R health acceptance。D3 交付了 onboarding（学科选择与 provisioning）、上文「环境配备」所述的启动 revision 比对与用于重新配备或更换学科的应用菜单操作，以及上文「产品组合」所述的 settings-default Science composition。桌面 onboarding 内的 credential-provider key 录入仍是待办工作，期间由现有 Web Client model-configuration UI 继续担任唯一的 `DEEPSEEK_API_KEY` writer。D4 交付了 DMG packaging 与 update metadata。D5 交付了生物学声明及其更大的 timeout、capacity、cancellation 与 recovery behavior。

每个 slice 都从限定该 slice 范围的 implementation brief 开始，只有通过 package tests、在 model 或 product output 改变时提供 assembled keyless snapshot，并同步 docs 与 Agent Note 之后才算落地。onboarding 之后被重做：从「学科选择 + micromamba provisioning」改为「检测并绑定已有的 conda-family 环境」（见上文「首启向导与凭据」）；保留下来的 micromamba 路径在本版本中不再需要单独的 attended evidence，因为它没有可从 UI 触达的入口。还有四项属于 outstanding attended evidence——需要有人在真实硬件上运行并记录的验证，而非尚未实现的 slice：一次在全新 macOS 账户上、针对已有 Anaconda（或等价物）安装的真实检测并绑定首次运行、一次在全新 macOS 账户上的真实 DMG 安装与首启 onboarding、一次验证 preload 能在 built、已签名应用的 `sandbox: true` 下加载的 packaged-preload smoke test，以及确认 packaged watchdog 在 Electron 内嵌 Node 下 `import.meta.main` 确实为真——没有自动化测试覆盖这条生产环境的入口判断，若其值为 undefined，watchdog 会悄无声息地什么也不做。Downloads 与 real-provider checks 始终作为显式 evidence rows，绝不从 source tests 推断。

## 考虑过的替代方案

**继续把 Science 作为用户选择的 preset，不设桌面专属 default。** 这保留当前浏览器机制，却让桌面产品的定义性工作流成为可选项，并向科研者暴露实现选择。

**在 production 里通过隐藏 loopback URL 加载 Web carrier。** 它可作为有用的开发过渡，但在已有 IPC carrier extension point 的产品里保留了 HTTP serving、browser trust 与 local port，也违背已有 GUI transport ownership 决定。

**在 Electron main process 内运行 Host。** 这减少一个 process，却耦合 Cordis、model、kernel 与 Electron failures，也无法独立重启 Host。

**使用 Tauri。** 对于已经用 Node 与 Web technologies 实现 Host 与 UI 的产品，更小的壳不足以抵消第二套 Rust/WebView toolchain 与 compatibility matrix。

**每次 onboarding 都通过内嵌 micromamba 配备 Python 与 R。** 这是最初的 v1 方案，且仍完整实现并保留测试（见上文「环境配备」），但一次全新的多 GB 下载与安装，会与目标科研者大多已经通过 Anaconda 或实验室统一管理的 Conda 安装重复；v1 改为检测并绑定已有安装，这条路径被保留为未来版本中面向没有可用 conda-family 环境的用户的 fallback。绑定用户自行管理的环境，也让环境可复现性依赖 host machine 自身的 Conda 安装，而不是一份 pinned declaration——这是当前 v1 方案的已知取舍，而非被否决的替代方案。

**把 API key 存在 desktop preferences。** 这会复制 credentials provider，并形成一条具有不同 redaction 与 permission behavior 的 secret persistence path。

## 验收标准

- 在已经装有 conda-family 环境（Anaconda、Miniconda 或等价物）的受支持 Mac 上，用户安装 DMG、通过检测并绑定该环境完成 onboarding、分析本地 dataset、创建 Python 与 R charts 并导出 artifact，全程无需终端或 browser URL。在完全没有 conda-family 安装的受支持 Mac 上，onboarding 的安装引导面板会指引用户安装 Anaconda 并重新检测；原提案中的零安装验收被推迟到上文「环境配备」所述的 micromamba fallback。
- 每个 desktop session 都有 Science product composition，而所选学科可独立替换。
- Host crash 可以在不丢失 sessions 的情况下重启；正常退出与 forced-quit acceptance 均不留下 Host、kernel 或 tool descendants。
- provisioning 在 network、disk、cancellation 与 health-check failures 后可以恢复或重试，且不会发布 partial environment revision。
- DeepSeek API key 只通过 credentials provider 存储，并且不会出现在 logs、settings、renderer storage、arguments 与 packaged defaults 中。
- packaged code 使用 built artifacts，UI 使用 Electron IPC carrier，release evidence 分别证明 DMG installation、update-metadata verification 与 clean-account behavior。
- 生物学包可配备可用的 Bioconductor baseline，并验证已记录的 large-environment capacity 与 timeout behavior。

## 风险

Electron 与科学环境会显著增加下载和安装体积。环境声明与 onboarding 必须如实展示磁盘与网络估算，update code 也不得无界重复 immutable caches。

不同地区访问 conda-forge 与 Bioconductor 的可达性不同。mirror configuration 可以改善可达性，但接受任意 channels 会扩大 software-supply-chain trust decision，因此必须继续向用户明确展示。

forced termination 可以绕过 cooperative Cordis disposal。各平台的 process-group behavior 不同，所以 macOS acceptance 必须观察实际 descendants，而不是从 Electron 或 Host exit code 推断清理。

从 shipped Science preset 过渡到 desktop-owned rows 可能产生重复 tool 与 projection registrations。desktop bundle 必须分别证明其完整组合以及 generic Web profile，而且 shared package 不得从 process globals 推断 desktop carrier。
