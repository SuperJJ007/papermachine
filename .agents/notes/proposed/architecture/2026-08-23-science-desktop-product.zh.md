# Agent Note: Science 桌面产品组合与环境配备

Status: proposed

[English](2026-08-23-science-desktop-product.md) | 中文

## 问题

已经交付的 Science 能力是浏览器产品里可选择的 agent preset，而目标桌面产品是一套科研工作台，用户不应选择产品模式。全新的 macOS 用户在第一次分析前仍需安装 Node 与 pnpm、输入终端命令、访问浏览器 URL、手工准备 Conda prefix、编辑 settings 文件并设置环境变量。这些安装要求使现有功能组合无法成为面向不管理编程环境的科研者的双击即用产品。

桌面 carrier 还跨越多项已有的职责决定。Host 必须保留为独立 process，使它的故障与 process tree 不会拖垮 Electron。Web Client packages 必须继续作为唯一 UI 实现，但现有 GUI 架构把 HTTP 与浏览器信任交给 Web carrier，并为 Electron 预留 IPC fetch carrier。凭据属于 credentials provider，环境绑定属于 Science Runtime，durable sessions 位于 Harness home 下，process 清理属于现有 subprocess lifecycle。绕过任一持有方的壳都会形成第二套产品架构。

Science 与学科属于不同组合轴。Science 提供产品工作流、UI、Runtime 与 model-facing 分析能力。学科包提供 instructions、skills、产出惯例与环境声明。把 Science 本身当作可选 preset 会让产品轴成为可选项；把学科当作产品模式则会妨碍 session 在不更换桌面产品的前提下切换学科。

## 提案

交付 macOS 优先的 Electron 应用，其产品 bundle 恒定挂载完整 Science 组合。桌面应用不提供“Science 模式”选择器或 session-header 标识。通用 Harness deployments 保留现有的 `agentPreset === 'science'` 展示 fence，而桌面组合为每个 session 提供 Science identity。学科包继续作为可选择的 agent compositions，并可独立于产品 carrier 更换。

Electron 以 child process 启动 built Host，并把 `DSH_HOME` 设在 `app.getPath('userData')` 下。Host 以及每个 kernel 或 tool subprocess 继承显式 launch environment，而不是用户的 interactive shell。正常退出要求 Host dispose 其 Cordis tree；Electron 异常终止由既有 subprocess process-tree 清理以及检测残留 descendants 的桌面验收共同覆盖。Host crash 保留 Harness home，并在现有窗口内展示重启操作。

发布应用的目标是从 `file://` 加载 built Web Client，并使用 Client fetch carrier 的 Electron IPC 实现，不通过 loopback port 提供 UI，也不暴露浏览器 URL。该 IPC carrier 目前尚未实现：无论是否为 packaged 版本，当前每次构建都通过 OS 分配的端口启动 private-loopback Web carrier。`main.ts` 的 packaged 分支选择已暂存的 production Host closure，却运行与之相同、经由 `127.0.0.1` 提供服务的 `dsh --profile web` 进程，且 Electron Builder 会把该 closure 打进 DMG（`apps/desktop/electron-builder.yml` 中 `.stage/host` → `host` 的 resource 项）。因此 private-loopback Web carrier 同样是 packaged development carrier 的 transport，直至 IPC carrier 落地。这使 [GUI 分层决定](../../implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.zh.md)继续作为 transport ownership 的权威记录，因为 loopback launcher 是开发过渡桥梁，而非第二套 transport 实现。

## 产品组合

desktop bundle 的 Runtime overlay（`apps/desktop/src/runtime-overlay.ts`）把 `agent-presets` 的 config `default` 设为 `science`，并禁用 `ui-agent-preset`（通用 preset 选择器行），因此全新 Harness home 中创建的 session 会挂载 shipped `science` preset，且没有可见的模式选择器。这一 settings-default 机制是已接受的过渡方案，而非被否决的替代方案：它复用既有的 preset-default seam，而不是新增一层独立于 preset 选择、直接插入 Science rows 的产品组合层。其已知限制是：`AgentPresets.defaultId` 会先读取热重载的用户 settings 值，再回退到 config default（`packages/preset/agent-presets/src/index.ts:192`），因此在该 overlay 生效之后写入的 settings 值仍可能为之后的 session 选中另一个 preset，桌面组合本身并不会阻止这一点。等到 packaged IPC carrier 取代 loopback development launcher 之后，独立于 preset 选择、且不受 settings override 影响的直接 Science-row 插入方案，仍是目标方向。preset 机制在其之下继续担任 session-scoped 的学科层：一份学科 composition 提供 persona、instructions、skills 与 environment-package identifier。第一个学科包是社会科学；生物学随后作为首个大型环境验证。

通用 CLI 与 Web profiles 保留当前组合与 Science fence。已有 shipped `science` preset 在那里继续可用，直至学科包替代其余 prompt 与 tool contribution。在迁移期间，desktop bundle 通过其 settings default 引导同一个 preset，而不是挂载重复 registrations。本笔记部分 supersede 了 [Science preset note](../../implemented/feature/2026-08-16-dsh-science-v01-r4-science-preset.zh.md) 中「Science 严格是 opt-in preset」的结论：该笔记继续负责通用 Web preset 选择、roster 与 durable Science identity，而桌面组合通过上述 settings-default 机制，把 `science` 设为其自身产品表层的 default。

## 环境配备

每个学科包携带 versioned environment declaration，其中命名支持的平台、micromamba environment lock 或明确的 channels 与 packages、磁盘空间提示以及 health checks。声明不含 executable hooks。桌面 provisioning service 校验声明，使用应用内嵌的 micromamba executable 安装到应用持有的 environment directory，把结构化进度流送到 onboarding UI，并且只在两个 interpreter health checks 都通过后发布 applied Science environment revision。

provisioning 在声明的 environment revision 上可恢复且具备事务性。失败或取消的 solve 继续以此前 applied revision 为权威；重试可以复用 micromamba package cache，但绝不把 partial prefix 标为 ready。网络 channels 与可选 mirrors 属于已校验配置，因为不同 deployment 的可达性不同。社会科学声明提供包含 pandas、statsmodels、matplotlib 与 Altair 的 Python，以及 base R 与首批 tidyverse 统计 packages。生物学声明提供后续 Bioconductor 验证集，并通过声明字段提高 provisioning timeout 与磁盘提示，而不是使用 plugin constants。

Runtime 继续持有 interpreter execution 与 revision rebinding。Provisioning 只创建并验证 prefixes，随后调用 Runtime 持有的 binding operation。[persistent-kernel 决定](../../implemented/architecture/2026-08-20-science-persistent-kernel.zh.md)继续负责在新的 applied environment revision 出现后结束 stale kernel。

## 首启向导与凭据

全新的 Harness home 在 session workspace 前打开 onboarding。用户选择学科包、输入或跳过 DeepSeek API key、查看所需下载大小并开始 provisioning。key 通过现有 writable credentials provider 以 `DEEPSEEK_API_KEY` 写入；它绝不进入 desktop settings、logs、renderer persistence、command arguments 或 crash diagnostics。跳过 key 后应用仍可使用，并在 session 需要 inference 时展示现有 model-configuration 引导。

Onboarding state 只在 Harness home 下记录非机密进度与所选学科。完成条件是已验证的 environment revision，而不是仅仅关闭 window。失败步骤展示失败对象、安全修复方式、retry 以及经过 secrets redaction 的 diagnostics。重新安装或升级应用会复用 Harness home；如果声明 revision 与 health checks 仍匹配，就不会重复 provisioning。

## 分发

macOS 应用使用 plain Node 语义下的 built `lib/` 与 Web artifacts 构建；source launchers 与 tsx 不进入 package。Electron Builder 为两种受支持的 macOS architectures 生成 DMG。

更新 metadata 发布到带 artifact checksums 的 static feed。更新可以替换 application code 与内嵌 micromamba executable，但绝不替换 Harness home 或 applied environments。Windows 不属于首发范围，并需要独立的 distribution 与 process-tree acceptance 决定。

## 交付切片

D1 至 D5 均已在 `apps/desktop` 中落地。D1 交付了 Electron carrier、独立 Host lifecycle、应用持有的 Harness home、development launch、crash restart 与 residual-process tests。D2 交付了内嵌 micromamba asset pipeline、declaration schema、社会科学 provisioning service、progress 与 retry UI，以及 Python/R health acceptance。D3 交付了 onboarding、credential-provider writes、学科选择，以及上文「产品组合」所述的 settings-default Science composition。D4 交付了 DMG packaging 与 update metadata。D5 交付了生物学声明及其更大的 timeout、capacity、cancellation 与 recovery behavior。

每个 slice 都从限定该 slice 范围的 implementation brief 开始，只有通过 package tests、在 model 或 product output 改变时提供 assembled keyless snapshot，并同步 docs 与 Agent Note 之后才算落地。还有三项属于 outstanding attended evidence——需要有人在真实硬件上运行并记录的验证，而非尚未实现的 slice：一次针对真实网络 package 源的 micromamba provisioning 实跑、一次在全新 macOS 账户上的真实 DMG 安装与首启 onboarding，以及一次验证 preload 能在 built、已签名应用的 `sandbox: true` 下加载的 packaged-preload smoke test。Downloads 与 real-provider checks 始终作为显式 evidence rows，绝不从 source tests 推断。

## 考虑过的替代方案

**继续把 Science 作为用户选择的 preset，不设桌面专属 default。** 这保留当前浏览器机制，却让桌面产品的定义性工作流成为可选项，并向科研者暴露实现选择。

**在 production 里通过隐藏 loopback URL 加载 Web carrier。** 它可作为有用的开发过渡，但在已有 IPC carrier extension point 的产品里保留了 HTTP serving、browser trust 与 local port，也违背已有 GUI transport ownership 决定。

**在 Electron main process 内运行 Host。** 这减少一个 process，却耦合 Cordis、model、kernel 与 Electron failures，也无法独立重启 Host。

**使用 Tauri。** 对于已经用 Node 与 Web technologies 实现 Host 与 UI 的产品，更小的壳不足以抵消第二套 Rust/WebView toolchain 与 compatibility matrix。

**通过用户管理的 Conda 安装 Python 与 R。** 这保留当前 Runtime input，却无法满足零终端、零 Conda 的产品验收，也让环境可复现性依赖 host machine。

**把 API key 存在 desktop preferences。** 这会复制 credentials provider，并形成一条具有不同 redaction 与 permission behavior 的 secret persistence path。

## 验收标准

- 在全新的受支持 Mac 上，用户安装 DMG、完成 onboarding、使用社会科学包分析本地 dataset、创建 Python 与 R charts 并导出 artifact，全程无需终端、Conda 知识或 browser URL。
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
