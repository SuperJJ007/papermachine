# dsh-desktop

[English](README.md) | 中文

`@deepseek-ai/dsh-desktop` 是 Science 桌面产品的 macOS-first Electron carrier。它把现有 Web profile 作为独立 Host process 启动，把 Electron `userData` directory 指定为 `DSH_HOME`，并在受限 BrowserWindow 内加载 Host 通过 OS 分配的 loopback URL。

全新的 home 会先打开 desktop onboarding，再进入 workspace。onboarding 扫描本机常规的 Anaconda/Miniconda/Miniforge/Mambaforge/Micromamba 安装位置与 `~/.conda/environments.txt`，寻找符合条件的 conda-family environment，全程不调用 terminal 或任何 conda 命令，并让用户分别绑定一个 Python environment 与一个 R environment——不会发生任何下载。绑定会针对每个所选 prefix 各自的 interpreter 重新校验，写入 `<dshHome>/environment-binding.json`，再打开 workspace；生成的 Host overlay 把所命名的 prefix 绑定到固定的 `science` Runtime profile，以 Science 作为 session default，移除通用 product-mode picker，并禁用共享的 module-reload `hmr` 行。随后既有的 Models onboarding 继续作为唯一 API-key 写入方，并通过 credentials service 完成写入。详见下文“Onboarding 与 environment binding”。

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

Detection（`src/detection.ts`）以一个正规、非 symlink 的 `conda-meta/history` 文件外加至少一个 `bin/python` 或 `bin/Rscript` ——与 Science Runtime 自身的 interpreter 检查所要求的 POSIX 布局相同——作为 prefix 合格与否的依据，并为合格的候选项展示来自受限、有超时的 `--version` probe 的 best-effort interpreter 版本。扫描某个 root 或校验某个候选项时发生的失败（不可读目录、symlink loop、结果是普通文件的 root）只会丢弃那一个 root 或候选项；detection 本身不会因文件系统状况而失败。onboarding 把候选项列在两个相互独立、各自单选的分组中——Python environments 与 R environments，每组都带一个明确的“不绑定”选项——因为真实机器上 Python 与 R 常常分属不同的 conda-family environment，而 `environment-binding.json` 的 `pythonPrefix`/`rPrefix` 本就是两个独立字段；同时具备两种 interpreter 的候选项会出现在两个分组里。每组会预选各自第一个合格的候选项。绑定时会针对每个所选 prefix 被选中所属的那个 interpreter 重新校验（`src/environment-binding.ts` 中的 `resolveBindRequest`），因为文件系统可能在 detection 与点击之间发生变化；只要任一所选 prefix 的重新校验失败，整次绑定就会被拒绝，而不会写入一个只有一半的结果。当完全没有候选项合格时，onboarding 会展示安装引导（安装 Anaconda，然后重新检测），取代候选列表。应用菜单的 "Rebind Environment…" 操作会先停止活跃的 Host，再重新打开 onboarding，供用户绑定不同的 environment。

## 环境声明

`resources/environments/*.json` 是闭合且只含数据的格式：schema version、学科 id 与 revision、支持的 macOS architectures、channels 与 packages、如实的容量字段、operation timeout，以及分别一个 Python 与 R health check。它不接纳 executable installation hook。每个 revision 直接安装在它发布所用的 prefix 路径下（`environments/<discipline>/<revision>`），因此每个 health check 都针对 `applied.json` 最终指向的那个确切路径运行——Conda/micromamba 安装不可重定位，在一个路径上验证却发布另一个路径无法证明任何事情。solve 失败、取消或 health check 失败，在全新配备或不同 revision 的配备下都不会改变此前的 `applied.json` pointer；而同一 revision 的原地修复路径会在触碰 prefix 之前先清空该 pointer（见下文），因此那里发生的失败会导致完全没有 applied revision。retry 会复用 micromamba 的 package cache，并在重新创建前清空未 ready 的 prefix 目录，因为没有匹配 `applied.json` 条目的 prefix 永远不算 ready。

社会科学声明包含 pandas、statsmodels、matplotlib、Altair、tidyverse、broom 与 modelr。更大的生物学声明加入 Scanpy、Biobase、DESeq2 与 GenomicRanges，并自行携带更长 timeout 与更高磁盘要求。

这一声明 schema、上述 transactional prefix 安装、其 health check，以及可恢复的同一 revision 原地修复路径（重新配备已 applied 的那个确切 revision 会先清空 applied pointer，再删除并重建 prefix，因此失败会留下如实的 not-ready 状态，而不是一个仍被标记为 current 的已损坏环境）均完整实现并测试覆盖，但在本版本中没有 onboarding 入口——onboarding 转而检测并绑定一个已有的 environment（见上文 Onboarding 与 environment binding）。此路径被保留，作为没有可用 conda-family environment 的机器的既定安装 fallback。

## DMG

`pnpm --filter @deepseek-ai/dsh-desktop package:mac` 会构建仓库、下载两个 pinned micromamba architectures、暂存无 symlink 的 production Host closure，并要求 Electron Builder 生成 arm64 与 x64 DMG。生成的 app 持有自身 Host、环境声明与 micromamba executable；Harness home 与 applied environments 保留在 application payload 外的 Electron `userData` 中。

## 限制

UI 仍在 private loopback 上使用 Web HTTP carrier。packaged `file://` 加 Electron IPC carrier、自动应用更新以及 Windows support 仍不在本次实现范围内。参见[桌面产品决定](../../.agents/notes/proposed/architecture/2026-08-23-science-desktop-product.zh.md)。
