# dsh-desktop

[English](README.md) | 中文

`@deepseek-ai/dsh-desktop` 是 Science 桌面产品的 macOS-first Electron carrier。它把现有 Web profile 作为独立 Host process 启动，把 `~/.papermachine` 指定为 Harness home（`DSH_HOME`），并在受限 BrowserWindow 内加载 Host 通过 OS 分配的 loopback URL。Harness home 由 `src/harness-home.ts` 解析，位于 OS user home directory 之下，刻意与 Electron 自身的 `userData` directory 相互独立（后者继续只保存 Electron 的 cookies、caches 等状态）：R 拒绝在其 scratch `TMPDIR` 中出现任何 ASCII space，而 macOS 的 `userData` 路径（`~/Library/Application Support/PaperMachine`）恰好含有一个空格，因此若 OS user home 本身的路径含有空格，解析会转而 fail loud。

全新的 home 会先打开 desktop onboarding，再进入 workspace。onboarding 扫描本机常规的 Anaconda/Miniconda/Miniforge/Mambaforge/Micromamba 安装位置与 `~/.conda/environments.txt`，寻找符合条件的 conda-family environment，全程不调用 terminal 或任何 conda 命令，并让用户分别绑定一个 Python environment 与一个 R environment。本机没有可绑定的环境并不是死路：onboarding 同时提供下载随应用发布的 `general` environment，以及在同一份 package 清单之上的高级编辑入口。绑定会针对每个所选 prefix 各自的 interpreter 重新校验，写入 `<dshHome>/environment-binding.json`，再打开 workspace；生成的 Host overlay 把所命名的 prefix 绑定到固定的 `science` Runtime profile，以 Science 作为 session default，移除通用 product-mode picker，并禁用共享的 module-reload `hmr` 行。随后既有的 Models onboarding 继续作为唯一 API-key 写入方，并通过 credentials service 完成写入。详见下文“Onboarding 与 environment binding”。

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

启动时的路由完全依据 `<dshHome>/environment-binding.json`（`src/environment-binding.ts`）：文件不存在是普通的首次运行，会打开 onboarding；文件解析失败或所命名的 prefix 已不存在，同样路由到 onboarding，但会带上醒目的状态提示；binding 有效则直接打开 workspace。下文“环境声明”中描述的学科包 `applied.json` pointer 在这条路由中不起任何作用。

Detection（`src/detection.ts`）以一个正规、非 symlink 的 `conda-meta/history` 文件外加至少一个 `bin/python` 或 `bin/Rscript` ——与 Science Runtime 自身的 interpreter 检查所要求的 POSIX 布局相同——作为 prefix 合格与否的依据，并为合格的候选项展示来自受限、有超时的 `--version` probe 的 best-effort interpreter 版本。扫描某个 root 或校验某个候选项时发生的失败（不可读目录、symlink loop、结果是普通文件的 root）只会丢弃那一个 root 或候选项；detection 本身不会因文件系统状况而失败。onboarding 把候选项列在两个相互独立、各自单选的分组中——Python environments 与 R environments，每组都带一个明确的“不绑定”选项——因为真实机器上 Python 与 R 常常分属不同的 conda-family environment，而 `environment-binding.json` 的 `pythonPrefix`/`rPrefix` 本就是两个独立字段；同时具备两种 interpreter 的候选项会出现在两个分组里。每组会预选各自第一个合格的候选项。绑定时会针对每个所选 prefix 被选中所属的那个 interpreter 重新校验（`src/environment-binding.ts` 中的 `resolveBindRequest`），因为文件系统可能在 detection 与点击之间发生变化；只要任一所选 prefix 的重新校验失败，整次绑定就会被拒绝，而不会写入一个只有一半的结果。当完全没有候选项合格时，已检测环境这一节整体隐藏，安装这条路径成为唯一入口。应用菜单的 "Rebind Environment…" 操作会先停止活跃的 Host，再重新打开 onboarding，供用户绑定不同的 environment。

## 环境声明

`resources/environments/*.json` 是闭合且只含数据的格式：schema version、学科 id 与 revision、支持的 macOS architectures、channels 与 packages、如实的容量字段、operation timeout，以及分别一个 Python 与 R health check。它不接纳 executable installation hook。每个 revision 直接安装在它发布所用的 prefix 路径下（`environments/<discipline>/<revision>`），因此每个 health check 都针对 `applied.json` 最终指向的那个确切路径运行——Conda/micromamba 安装不可重定位，在一个路径上验证却发布另一个路径无法证明任何事情。solve 失败、取消或 health check 失败，在全新配备或不同 revision 的配备下都不会改变此前的 `applied.json` pointer；而同一 revision 的原地修复路径会在触碰 prefix 之前先清空该 pointer（见下文），因此那里发生的失败会导致完全没有 applied revision。retry 会复用 micromamba 的 package cache，并在重新创建前清空未 ready 的 prefix 目录，因为没有匹配 `applied.json` 条目的 prefix 永远不算 ready。

本版本发布单一声明 `general`：Python 分析栈（NumPy、SciPy、pandas、Matplotlib、seaborn、statsmodels、scikit-learn）、研究数据实际到达时所用的文件格式（openpyxl 读 Excel、pyreadstat 读 SPSS 与 Stata、PyArrow 读 Parquet），以及 R 栈（tidyverse、haven、broom、modelr、lme4、survey、srvyr、data.table、jsonlite）。ggplot2 随 tidyverse 一同到位，且是必需而非可选：kernel 的 R chart capture 直接调用它（`packages/science/science-runtime/assets/chart_ggplot2.R`）。学科声明与它并列增加；一个 prefix 同时承载两种 interpreter，因此配备好的 environment 会把 `pythonPrefix` 与 `rPrefix` 绑定到同一路径。

用户自行编写的 package 集合（`src/custom-environment.ts`）作为另一个声明以 `custom` 为 id 发布，经由同一个 parser 构建，因此用户键入的 package token 在抵达 solver argv 之前，面对的校验与随应用发布的声明完全一致。它的 revision 为 `YYYY.MM.<该集合排序后的 digest>`：未改动的集合保留自己的 prefix，跨启动仍为 `current`；改动过的集合则配备到属于自己的 prefix。该声明持久化到 `<dshHome>/desktop-environments/custom.json` 并在启动时重新读取；没有它，`resolveDisciplineStatus` 会把一个可用的自定义安装报为 `unknown-discipline`，每次启动都退回 onboarding。

## DMG

`pnpm --filter @deepseek-ai/dsh-desktop package:mac` 会构建仓库、下载两个 pinned micromamba architectures、暂存无 symlink 的 production Host closure，并要求 Electron Builder 生成 arm64 与 x64 DMG。生成的 app 持有自身 Host、环境声明与 micromamba executable；Harness home 与 applied environments 保留在 `~/.papermachine` 下，既在 application payload 之外，也在 Electron `userData` 之外。

## 限制

UI 仍在 private loopback 上使用 Web HTTP carrier。packaged `file://` 加 Electron IPC carrier、自动应用更新以及 Windows support 仍不在本次实现范围内。参见[桌面产品决定](../../.agents/notes/proposed/architecture/2026-08-23-science-desktop-product.zh.md)。
