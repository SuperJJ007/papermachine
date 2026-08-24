# dsh-desktop

[English](README.md) | 中文

`@deepseek-ai/dsh-desktop` 是 Science 桌面产品的 macOS-first Electron carrier。它把现有 Web profile 作为独立 Host process 启动，把 Electron `userData` directory 指定为 `DSH_HOME`，并在受限 BrowserWindow 内加载 Host 通过 OS 分配的 loopback URL。

全新的 home 会先打开 desktop 持有的设置页面，再进入 workspace。用户选择社会科学或生物学 package，查看声明的下载量与磁盘需求，并可在 micromamba 流送进度时取消或重试。provisioner 只有在 Python 与 R 都验证通过后才以原子方式发布 prefix。生成的 Host overlay 把该 prefix 绑定到固定的 `science` Runtime profile，以 Science 作为 session default，并移除通用 product-mode picker。随后既有的 Models onboarding 继续作为唯一 API-key 写入方，并通过 credentials service 完成写入。

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

## 环境声明

`resources/environments/*.json` 是闭合且只含数据的格式：schema version、学科 id 与 revision、支持的 macOS architectures、channels 与 packages、如实的容量字段、operation timeout，以及分别一个 Python 与 R health check。它不接纳 executable installation hook。solve 失败、取消或 health check 失败都不会改变此前的 `applied.json` pointer；retry 会复用 package cache 与 partial prefix。

社会科学声明包含 pandas、statsmodels、matplotlib、Altair、tidyverse、broom 与 modelr。更大的生物学声明加入 Scanpy、Biobase、DESeq2 与 GenomicRanges，并自行携带更长 timeout 与更高磁盘要求。

## DMG

`pnpm --filter @deepseek-ai/dsh-desktop package:mac` 会构建仓库、下载两个 pinned micromamba architectures、暂存无 symlink 的 production Host closure，并要求 Electron Builder 生成 arm64 与 x64 DMG。生成的 app 持有自身 Host、环境声明与 micromamba executable；Harness home 与 applied environments 保留在 application payload 外的 Electron `userData` 中。

## 限制

UI 仍在 private loopback 上使用 Web HTTP carrier。packaged `file://` 加 Electron IPC carrier、自动应用更新以及 Windows support 仍不在本次实现范围内。参见[桌面产品决定](../../.agents/notes/proposed/architecture/2026-08-23-science-desktop-product.zh.md)。
