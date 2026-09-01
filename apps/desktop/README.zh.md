# dsh-desktop

[English](README.md) | 中文

`@deepseek-ai/dsh-desktop` 是 Science 桌面产品的 macOS-first Electron carrier。它把现有 Web profile 作为独立 Host process 启动，把 `~/.papermachine` 指定为 Harness home（`DSH_HOME`），并在受限 BrowserWindow 内加载 Host 通过 OS 分配的 loopback URL。Harness home 由 `src/harness-home.ts` 解析，位于 OS user home directory 之下，刻意与 Electron 自身的 `userData` directory 相互独立（后者继续只保存 Electron 的 cookies、caches 等状态）：R 拒绝在其 scratch `TMPDIR` 中出现任何 ASCII space，而 macOS 的 `userData` 路径（`~/Library/Application Support/PaperMachine`）恰好含有一个空格，因此若 OS user home 本身的路径含有空格，解析会转而 fail loud。

全新的 home 会先打开 desktop onboarding，再进入 workspace。PaperMachine 完全拥有自己的 Python 与 R environment：onboarding 安装随应用发布的 `general` environment（或用户在高级编辑器中自定的 package 清单），绝不绑定机器上已有的 conda-family environment。安装完成后写入 `<dshHome>/environment-binding.json`，再打开 workspace；生成的 Host overlay 把已配备的 prefix 绑定到固定的 `science` Runtime profile，以 Science 作为 session default，移除通用 product-mode picker，并禁用共享的 module-reload `hmr` 行。随后既有的 Models onboarding 继续作为唯一 API-key 写入方，并通过 credentials service 完成写入。详见下文“Onboarding 与 environment binding”。

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

## Onboarding 与 environment binding

启动时的路由完全依据 `<dshHome>/environment-binding.json`（`src/environment-binding.ts`）：文件不存在是普通的首次运行，会打开 onboarding。文件解析失败、所命名的 prefix 已不存在，或所命名的 prefix 位于本应用自己的 provisioned environments root（`<dshHome>/desktop-environments/environments/`）之外，同样会路由到 onboarding 并带上醒目的状态提示——最后一种情况覆盖了本应用完全拥有自己环境之前写入的 binding，或任何其他外部 conda-family 安装，绝不会被悄悄保留。binding 有效则直接打开 workspace。下文“环境声明”中描述的学科包 `applied.json` pointer 在这条路由中不起任何作用。

Onboarding 只有一条路径：安装。PaperMachine 不提供绑定机器上已有 conda-family environment 的选项——由本应用配备并拥有的一个 environment 是唯一可复现的代码路径，因此首次运行不需要任何 conda 知识，向本应用拥有的 prefix 中安装 package 也可以自由重新求解，而不会危及用户自己的 Anaconda 安装。`src/interpreter-presence.ts` 的 `qualifyingInterpreters` 会在 `main.ts` 的 `bindProvisionedPrefix` 写入 binding 之前，按与 Science Runtime 自身 interpreter 检查相同的规则（一个正规、非 symlink 的 `conda-meta/history` 文件，外加至少一个 `bin/python` 或 `bin/Rscript`）重新校验刚刚配备好的 prefix——这是对 provisioning 刚刚跑过的同一组 health check、在即将写入的那个确切路径上做的一次纵深防御式复核。应用菜单的 "Change Environment…" 操作会先停止活跃的 Host，再重新打开 onboarding，供用户安装一个不同的（或修复后的）environment。

## 环境声明

`resources/environments/*.json` 是闭合且只含数据的格式：schema version、学科 id 与 revision、支持的 macOS architectures、一份有序的 package source 列表、packages、如实的容量字段、operation timeout，以及分别一个 Python 与 R health check。它不接纳 executable installation hook。每个 revision 直接安装在它发布所用的 prefix 路径下（`environments/<discipline>/<revision>`），因此每个 health check 都针对 `applied.json` 最终指向的那个确切路径运行——Conda/micromamba 安装不可重定位，在一个路径上验证却发布另一个路径无法证明任何事情。solve 失败、取消或 health check 失败，在全新配备或不同 revision 的配备下都不会改变此前的 `applied.json` pointer；而同一 revision 的原地修复路径会在触碰 prefix 之前先清空该 pointer（见下文），因此那里发生的失败会导致完全没有 applied revision。retry 会复用 micromamba 的 package cache，并在重新创建前清空未 ready 的 prefix 目录，因为没有匹配 `applied.json` 条目的 prefix 永远不算 ready。

本版本发布单一声明 `general`：Python 分析栈（NumPy、SciPy、pandas、Matplotlib、seaborn、statsmodels、scikit-learn）、研究数据实际到达时所用的文件格式（openpyxl 读 Excel、pyreadstat 读 SPSS 与 Stata、PyArrow 读 Parquet），以及 R 栈（tidyverse、haven、broom、modelr、lme4、survey、srvyr、data.table、jsonlite）。ggplot2 随 tidyverse 一同到位，且是必需而非可选：kernel 的 R chart capture 直接调用它（`packages/science/science-runtime/assets/chart_ggplot2.R`）。学科声明与它并列增加；一个 prefix 同时承载两种 interpreter，因此配备好的 environment 会把 `pythonPrefix` 与 `rPrefix` 绑定到同一路径。

`general` 的 package 从三个源下载，按顺序作为完整且相互独立的 `micromamba create` 尝试执行，而不是合并成一份被搜索的 channel 清单：TUNA 镜像、USTC 镜像，然后是官方的 `conda.anaconda.org` channel。任何一个源失败都会被完全放弃，下一个源会在重新清空的 prefix 上重试，并复用共享的 micromamba package cache；确认面板会说明当前正在尝试哪个源。当系统时区为 `Asia/Shanghai` 或某个首选系统语言为中文时，确认面板默认选中 TUNA 镜像（`src/source-selection.ts`，完全根据 locale 设置决定，从不做网络探测），否则默认官方 channel；用户可以在确认之前从三者中任选一个，该选择会成为上述回退顺序中的第一次尝试。完整原理见 [environment-ownership Agent Note](../../.agents/notes/implemented/feature/2026-09-01-desktop-owns-its-environment.zh.md)。

用户自行编写的 package 集合（`src/custom-environment.ts`）作为另一个声明以 `custom` 为 id 发布，经由同一个 parser 构建，因此用户键入的 package token 在抵达 solver argv 之前，面对的校验与随应用发布的声明完全一致。它携带与随应用发布声明相同的有序 source 列表；它的 revision 为 `YYYY.MM.<package 集合排序后的 digest>`，特意不把 source 纳入该 digest，因为 source 描述的是包从哪里来，而不是最终环境里有哪些包。未改动的 package 集合保留自己的 prefix，跨启动仍为 `current`；改动过的集合则配备到属于自己的 prefix。该声明持久化到 `<dshHome>/desktop-environments/custom.json` 并在启动时重新读取；没有它，`resolveDisciplineStatus` 会把一个可用的自定义安装报为 `unknown-discipline`，每次启动都退回 onboarding。

## DMG

`pnpm --filter @deepseek-ai/dsh-desktop package:mac` 会构建仓库、下载两个 pinned micromamba architectures、暂存无 symlink 的 production Host closure，并要求 Electron Builder 生成 arm64 与 x64 DMG。生成的 app 持有自身 Host、环境声明与 micromamba executable；Harness home 与 applied environments 保留在 `~/.papermachine` 下，既在 application payload 之外，也在 Electron `userData` 之外。

## 限制

UI 仍在 private loopback 上使用 Web HTTP carrier。packaged `file://` 加 Electron IPC carrier、自动应用更新以及 Windows support 仍不在本次实现范围内。参见[桌面产品决定](../../.agents/notes/proposed/architecture/2026-08-23-science-desktop-product.zh.md)。
