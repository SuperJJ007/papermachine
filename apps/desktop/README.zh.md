# dsh-desktop

[English](README.md) | 中文

`@deepseek-ai/dsh-desktop` 是 Science 桌面产品的 macOS-first Electron carrier。它把现有 Web profile 作为独立 Host process 启动，把 `~/.papermachine` 指定为 Harness home（`DSH_HOME`），并在受限 BrowserWindow 内加载 Host 通过 OS 分配的 loopback URL。Harness home 由 `src/harness-home.ts` 解析，位于 OS user home directory 之下，刻意与 Electron 自身的 `userData` directory 相互独立（后者继续只保存 Electron 的 cookies、caches 等状态）：R 拒绝在其 scratch `TMPDIR` 中出现任何 ASCII space，而 macOS 的 `userData` 路径（`~/Library/Application Support/PaperMachine`）恰好含有一个空格，因此若 OS user home 本身的路径含有空格，解析会转而 fail loud。

全新的 home 会先打开 desktop onboarding，再进入 workspace。PaperMachine 完全拥有自己的 Python 与 R environment：onboarding 安装随应用发布的 `general` environment（或用户在高级编辑器中自定的 package 清单），绝不绑定机器上已有的 conda-family environment。安装完成后写入 `<dshHome>/environment-binding.json`，再打开 workspace；生成的 Host overlay 把已配备的 prefix 绑定到固定的 `science` Runtime profile，把随应用打包的 micromamba 可执行文件与 `install_science_packages` 所用的有序安装 channel 交给 Host，以 Science 作为 session default，移除通用 product-mode picker，禁用共享的 module-reload `hmr` 行，并把侧边栏/hero 的品牌 slot 从官方 occupant 换成 PaperMachine occupant。随后既有的 Models onboarding 继续作为唯一 API-key 写入方，并通过 credentials service 完成写入。详见下文“Onboarding 与 environment binding”。

## 开发

先构建仓库 Web artifacts，再运行：

```sh
pnpm --filter @deepseek-ai/dsh-desktop dev
```

development 需要当前机器对应的 pinned micromamba asset：

```sh
pnpm --filter @deepseek-ai/dsh-desktop fetch:micromamba darwin-arm64
```

Intel Mac 使用 `darwin-x64`。只有下载内容的 SHA-256 digest 与 `resources/micromamba.json` 一致时才会被接纳。

carrier 不会打开 system browser。外部 HTTPS links 交给操作系统，而 active Host origin 之外的其他 navigation 一律拒绝。Host 意外退出时 Harness home 保持不变，页面替换为 restart 操作。

## 进程生命周期

Host 拥有自己的 POSIX 进程组。Electron 正常退出时会发送 `SIGTERM`，使 Host 得以 dispose（资源释放）Cordis 及其子进程树，随后在限定宽限期后升级为 `SIGKILL`。一个同级的纯 Node 看门狗进程观察 Electron，并在 Electron 被强制终止时停止该 Host 进程组。

## Host 诊断日志

Electron 会把 Host 的 stderr 持久化到 `<dshHome>/logs/host.log`；Host 输出绝不会进入 renderer。随应用发布的 `resources/host.json` 使用 schema version 1，把 active file 限定为 5 MiB（`logMaxBytes`），并保留 2 个轮转文件（`logMaxRotatedFiles: 2`）。两个上限都是严格的 safe integer（`logMaxBytes` 为 1 KiB 至 50 MiB，保留轮转数为 1 至 20）；配置缺失、不可读、格式错误或带有多余字段都会使启动失败。任何一行写入磁盘前，writer 会替换 Host environment 中凭据类名称对应的精确值，以及常见的 bearer、API key、authorization、credential、password、secret、token 与 `sk-…` 形式。日志目录与文件会强制设为 `0700` 与 `0600` mode；非普通文件与 symlink 会被拒绝；按发布配置，轮转最多保留 `host.log`、`host.log.1` 与 `host.log.2`。单行若大于 active-file 上限，会替换成固定的省略标记，而不会保留无界 buffer 或写出凭据的一部分。

## Host 端口

Host 会在它上一次成功绑定的端口上启动——该端口记录在 `<dshHome>/host-port.json`（`src/host-port.ts`）——而不是每次都请求一个全新的 OS 分配端口。浏览器端状态以 origin 为 key，而 OS 分配端口每次启动都会改变 origin，因而会悄悄丢弃客户端此前写入 `localStorage` 的所有内容。目前受影响的包括:侧边栏 details panel 的宽度、当前 session 选中项、trajectory-duration 偏好、workspace browser 的分组/排序/展开状态、per-session 的 chat draft 与 view 选择,以及 Science artifact viewer 的已打开标签页与 library 状态(`packages/client/*/src/**/stores.ts` 中任何通过 `defineStore`/`createSnapshotStore` 选择 `persist` 的 store);sidebar 自身宽度在上游被特意排除在持久化之外,不受此影响。跨普通启动保持 origin 稳定,就能保住上述全部状态。把这部分状态从 `localStorage` 迁移到 settings service 才是真正的长期方案——那样连 fallback 也能保住状态——但它跨越多个 client package,不在本次范围内。

Host 在上报 bind 失败时,不会给这个 carrier 留下任何可与其他启动失败区分开的信号:端口被占用和一个无关的启动错误,表现完全一样——都是子进程在打印 readiness line 之前就退出了。因此 `src/host-launch.ts` 的 `launchHostOnRememberedPort` 不去诊断失败原因——在记忆端口上启动失败(可能是另一个进程占用了它,也可能是已有一个 PaperMachine 实例在运行)会被重试一次,改用 OS 分配端口(`0`);之后被记住的是 Host 实际上报的端口,而不是当初请求的那个。`host-port.json` 缺失、不可读或损坏,会以同样的方式退化为 OS 分配端口,而不会阻塞或使启动失败。剩下的情形——偶尔一次 fallback 启动——仍会在那一次 session 中丢失上述状态;这只是把丢失范围从"每次启动"收窄到"例外情况",而不是彻底消除。

## Onboarding 与 environment binding

启动时的路由完全依据 `<dshHome>/environment-binding.json`（`src/environment-binding.ts`）：文件不存在是普通的首次运行，会打开 onboarding。文件解析失败、所命名的 prefix 已不存在，或所命名的 prefix 位于本应用自己的 provisioned environments root（`<dshHome>/desktop-environments/environments/`）之外，同样会路由到 onboarding 并带上醒目的状态提示——最后一种情况覆盖了本应用完全拥有自己环境之前写入的 binding，或任何其他外部 conda-family 安装，绝不会被悄悄保留。binding 有效则直接打开 workspace。binding 还记录本次安装成功所经由的 package source 的 id（`sourceId`）；缺少它的 binding 视为无效。下文“环境声明”中描述的学科包 `applied.json` pointer 在这条路由中不起任何作用。

Onboarding 只有一条路径：安装。PaperMachine 不提供绑定机器上已有 conda-family environment 的选项——由本应用配备并拥有的一个 environment 是唯一可复现的代码路径，因此首次运行不需要任何 conda 知识，向本应用拥有的 prefix 中安装 package 也可以自由重新求解，而不会危及用户自己的 Anaconda 安装。`src/interpreter-presence.ts` 的 `qualifyingInterpreters` 会在 `main.ts` 的 `bindProvisionedPrefix` 写入 binding 之前，按与 Science Runtime 自身 interpreter 检查相同的规则（一个正规、非 symlink 的 `conda-meta/history` 文件，外加至少一个 `bin/python` 或 `bin/Rscript`）重新校验刚刚配备好的 prefix——这是对 provisioning 刚刚跑过的同一组 health check、在即将写入的那个确切路径上做的一次纵深防御式复核。应用菜单的 "Change Environment…" 操作会在活跃 Host 继续服务当前 environment 时重新打开 onboarding。Onboarding 顶部显示已应用 environment 的 id、revision、`applied` 或 `stale` 状态及 prefix；"Keep current environment" 会通过重新启动 Host 返回 workspace。当 applied revision 与标准 declaration 一致时，主要操作显示为 "Reinstall"，并说明会再次下载标示的 520 MB。只有用户明确确认安装后，应用才会在 provisioning 可以修改 prefix 之前停止 Host。

## 环境声明

`resources/environments/*.json` 是闭合且只含数据的格式：schema version、学科 id 与 revision、支持的 macOS architectures、一份有序的 package source 列表、packages、如实的容量字段、operation timeout，以及分别一个 Python 与 R health check。它不接纳 executable installation hook。每个 revision 直接安装在它发布所用的 prefix 路径下（`environments/<discipline>/<revision>`），因此每个 health check 都针对 `applied.json` 最终指向的那个确切路径运行——Conda/micromamba 安装不可重定位，在一个路径上验证却发布另一个路径无法证明任何事情。solve 失败、取消或 health check 失败，在全新配备或不同 revision 的配备下都不会改变此前的 `applied.json` pointer；而同一 revision 的原地修复路径会在触碰 prefix 之前先清空该 pointer（见下文），因此那里发生的失败会导致完全没有 applied revision。retry 会复用 micromamba 的 package cache，并在重新创建前清空未 ready 的 prefix 目录，因为没有匹配 `applied.json` 条目的 prefix 永远不算 ready。

本版本发布单一声明 `general`：Python 分析栈（NumPy、SciPy、pandas、Matplotlib、seaborn、statsmodels、scikit-learn）、研究数据实际到达时所用的文件格式（openpyxl 读 Excel、pyreadstat 读 SPSS 与 Stata、PyArrow 读 Parquet），以及 R 栈（tidyverse、haven、broom、modelr、lme4、survey、srvyr、data.table、jsonlite）。ggplot2 随 tidyverse 一同到位，且是必需而非可选：kernel 的 R chart capture 直接调用它（`packages/science/science-runtime/assets/chart_ggplot2.R`）。学科声明与它并列增加；一个 prefix 同时承载两种 interpreter，因此配备好的 environment 会把 `pythonPrefix` 与 `rPrefix` 绑定到同一路径。

`general` 的 package 从三个源下载，按顺序作为完整且相互独立的 `micromamba create` 尝试执行，而不是合并成一份被搜索的 channel 清单：TUNA 镜像、USTC 镜像，然后是官方的 `conda.anaconda.org` channel。任何一个源失败都会被完全放弃，下一个源会在重新清空的 prefix 上重试，并复用共享的 micromamba package cache；确认面板会说明当前正在尝试哪个源。当系统时区为 `Asia/Shanghai` 或某个首选系统语言为中文时，确认面板默认选中 TUNA 镜像（`src/source-selection.ts`，完全根据 locale 设置决定，从不做网络探测），否则默认官方 channel；用户可以在确认之前从三者中任选一个，该选择会成为上述回退顺序中的第一次尝试。同一套有序回退会延续到 workspace 中：Host overlay 的 `science-runtime` 行把 `micromambaPath` 设为随应用打包的可执行文件，把 `installChannels` 设为各个随应用发布的源的 channel URL、并从已绑定的源开始排列，因此 `install_science_packages` 会先尝试环境本身所来自的镜像，再依次尝试其余的源，每一次都是完整且相互独立的 `micromamba install` 尝试。完整原理见 [environment-ownership Agent Note](../../.agents/notes/implemented/feature/2026-09-01-desktop-owns-its-environment.zh.md)。

用户自行编写的 package 集合（`src/custom-environment.ts`）作为另一个声明以 `custom` 为 id 发布，经由同一个 parser 构建，因此用户键入的 package token 在抵达 solver argv 之前，面对的校验与随应用发布的声明完全一致。它携带与随应用发布声明相同的有序 source 列表；它的 revision 为 `YYYY.MM.<package 集合排序后的 digest>`，特意不把 source 纳入该 digest，因为 source 描述的是包从哪里来，而不是最终环境里有哪些包。未改动的 package 集合保留自己的 prefix，跨启动仍为 `current`；改动过的集合则配备到属于自己的 prefix。该声明持久化到 `<dshHome>/desktop-environments/custom.json` 并在启动时重新读取；没有它，`resolveDisciplineStatus` 会把一个可用的自定义安装报为 `unknown-discipline`，每次启动都退回 onboarding。

## DMG

`pnpm --filter @deepseek-ai/dsh-desktop package:mac` 会构建仓库、下载两个 pinned micromamba architectures、暂存无 symlink 的 production Host closure，并要求 Electron Builder 生成 arm64 与 x64 DMG。生成的 app 持有自身 Host、环境声明与 micromamba executable；Harness home 与 applied environments 保留在 `~/.papermachine` 下，既在 application payload 之外，也在 Electron `userData` 之外。

## 随应用内置的默认 skill

DMG 内置三个默认 Science skill——`scientific-visualization`、`statistical-analysis`、`scientific-writing`——以只读方式 vendor 在 `resources/skills/` 下，来自上游仓库 `K-Dense-AI/scientific-agent-skills`（确切 commit 与 license 见 `resources/skills/SOURCES.md`）。Electron Builder 的 `extraResources` 会把该目录原样暂存到 `process.resourcesPath/skills`，在 asar 归档之外。生成的 Host overlay 中 `skill-filesystem` 这一行（`src/runtime-overlay.ts`）把该路径挂载为一个隔离的、global-scope 的 skill provider（`bundledSkillDir`、`includeDefaultRoots: false`，因此它不发现任何其他内容）。

用户自己的同名 skill 会胜出。`science` agent preset 自身的 `skill-filesystem` 行仍在 preset 自己的 scope layer 中发现 project、custom 与 `~/.papermachine/skills` 这些 root，而 `dsh-skill` 的 registry 解析同名冲突时优先按最近的 scope layer 判定——preset 的 layer 比这一行内置 skill 所在的 global layer 更近，因此无论两个 root 各自的 discovery rank 如何，它总会遮蔽同名的内置 skill。新增一个 skill 或覆盖一个内置 skill，只需把 `<name>/SKILL.md`(或 `<name>.md`)放到 `~/.papermachine/skills` 下即可；`resources/skills` 下无需任何改动，从上游重新拷贝内置集合也绝不会碰到用户自己的 skill。

## 使用统计（telemetry）

PaperMachine 上报三个只含元数据、绝不含内容的事件：`app.launch`（每次进程启动一次）、`environment.installed`、`environment.install-failed`（一次 provisioning 运行的 package source、耗时或最后阶段，以及是否被取消）。每个事件都带有新生成的 `eventId`、与 Host identity 插件共享的匿名 id（`<dshHome>/.anonymous-user-id`；desktop 自己的首个 `app.launch` 会在任何 Host 运行之前先发生，此时 `src/anonymous-id.ts` 会按该插件的确切格式创建这个文件）、时间戳、`appVersion`、`platform`、`arch`，以及 `schemaVersion: 1`——不含 hostname、路径、package 清单或错误文本。

Receiver 在构建期的 `resources/telemetry.json` 中配置（`schemaVersion: 1`，`endpoints: string[]`，元素为 `https://` URL；由 `src/telemetry-config.ts` 解析，文件缺失或格式错误会 loud 报错，而不是悄悄禁用）。每个已配置的 endpoint 都独立收到每一个事件——没有 failover、没有重试队列、没有离线缓冲。本版本发布时携带一个 endpoint，即已部署的 Cloudflare Worker（`apps/telemetry-receivers`）；空数组 `endpoints: []` 是有效且独立的 “telemetry 关闭” 状态，未来某个版本可以选择改用它。将 `DSH_TELEMETRY_DISABLED` 设为任意非空值——与 Host 自身 session telemetry 使用的开关及其解释完全相同（`resolveTelemetryPatch`，`apps/cli/src/profile-boot.ts`）——会让什么都不发送。

## 限制

UI 仍在 private loopback 上使用 Web HTTP carrier。packaged `file://` 加 Electron IPC carrier、自动应用更新以及 Windows support 仍不在本次实现范围内。参见[桌面产品决定](../../.agents/notes/proposed/architecture/2026-08-23-science-desktop-product.zh.md)。
