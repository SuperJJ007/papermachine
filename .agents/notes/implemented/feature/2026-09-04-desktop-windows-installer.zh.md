# Agent Note：桌面 carrier 交付 Windows 安装包

Status: implemented

[English](2026-09-04-desktop-windows-installer.md) | 中文

## 问题

`apps/desktop` 之下的每一层早已能在 Windows 上运行。science-runtime 带有按平台划分的 interpreter 布局表（`environment.ts` 的 `EXECUTABLE_LAYOUTS`：`win32` 下是 `python.exe` 与 `Scripts/Rscript.exe`），Host 的进程处理也已按 `win32` 分支处理 detached 启动、进程组信号与存活探测。只有 carrier 本身拒绝运行：`desktopPlatform()` 在任何非 darwin 平台上抛错，`DesktopPlatform` 只列出两个 macOS 组合，`resources/micromamba.json` 只钉住两份 macOS 资产，`electron-builder.yml` 只声明 `mac` target，`qualifyingInterpreters` 只查找 `bin/python` 与 `bin/Rscript`。

产品负责人没有 Windows 设备，因此这次移植无法用 macOS 版那样的方式验收——在它最终运行的机器上。

## 决定

`DESKTOP_PLATFORMS`（`src/environment-declaration.ts`）是本 carrier 交付的 platform-architecture 组合的唯一清单，`DesktopPlatform` 由它派生。`win32-x64` 与两个 macOS 组合并列。声明解析器的平台校验、`isDesktopPlatform`（`desktopPlatform()` 与 `fetch:micromamba` 拒绝未知 target 时都用它），以及随应用交付的 `general.json` 声明，全部读取这一份清单，因此新增一个 target 是一行改动，其余部分由测试套件负责钉住。

Windows-on-ARM 刻意不作为 target：conda-forge 的 `win-arm64` subdir 没有 `r-base`，而 x64 安装包在该平台上通过模拟运行。

`micromambaExecutableName` 负责命名随包携带的二进制——`win32-` 开头的 target 下是 `micromamba.exe`——因为 fetch 脚本与 `main.ts` 的运行期查找必须对同一个名字达成一致，而 Windows 拒绝执行没有扩展名的映像。`resources/micromamba.json` 增加钉住的 `win-64` 资产及其校验和，fetch 脚本落盘前先校验。

`qualifyingInterpreters`（`src/interpreter-presence.ts`）通过一张按平台选择的布局表解析两个 interpreter，该表镜像 science-runtime 的那张。carrier 无法直接 import 它：拥有该表的 Host 是被 stage 进安装包的独立进程。这份镜像是重复的事实，之所以接受，是因为另一条路是让 carrier 为两个路径片段依赖一个 Host 侧的包；两边都写了指向对方的注释。

遥测在 envelope 的两个独立字段里分别上报平台与架构，因此 `main.ts` 通过 `TELEMETRY_TARGETS`——一个覆盖闭合联合类型的 `Record`——把 `DesktopPlatform` 映射成这一对值：新增 target 却没有决定如何上报，会直接构建失败。

`electron-builder.yml` 增加 x64 NSIS target。安装包是 per-user 的（`perMachine: false`）：未签名的 per-machine 安装包会在 SmartScreen 警告之上再叠一个 UAC 提权提示，而本应用只在用户 home 之下写入。`write-update-metadata.ts` 接受安装包扩展名作为参数，知道每个平台一次完整构建应当产出哪些架构，并拒绝产出不足的运行——这正是原先硬编码的「expected one arm64 and one x64 DMG」所承载的不变量，现在按平台分别陈述。

`.github/workflows/desktop-release.yml` 在 dispatch 时构建两个平台，并把产物收进同一个 **draft** release。draft 不创建自己的 tag，且对仓库写者之外不可见，因此一次构建可以被产出、下载、检查再删除，不留任何公开痕迹——正是这一点让「交付一个尚无人在 Windows 设备上跑过的 target」是安全的。

## 考虑过的替代方案

**在现有 `ci.yml` 上加一个 Windows job。** 它的 Windows 作业指向 `dsh-windows-2025-16core` 与 `dsh-win-ci` 自托管池——这些 runner 标签只在上游组织内部可解析。一个同样要在个人 fork 里可用的 release workflow，用的是 GitHub 托管的 `windows-latest`。

**直接发布而不是留草稿。** 已发布的 release 在仓库转公开的那一刻即可见，其 tag 也会立即创建。留草稿把这两个决定都交回到一个正在查看产物的人手里。

## 后果

Windows 安装包已能构建，carrier 自身的测试也在 Windows runner 上运行，但尚无 Windows 设备验收过任何一版。`apps/desktop/README.md` 陈述了这条限制，产品 README 也仍然把 macOS 列为受支持平台：这项声明改变的依据是设备验收，而不是一次构建成功。

`package:win` 需要一个接受 `&&` 串联与前置环境变量赋值的 shell——Windows 上是 Git Bash，不是 PowerShell。workflow 因此设置 `shell: bash`。

`apps/desktop/tsconfig.json` 现在包含 `scripts`，此前没有任何 compiler face 检查它们。把它们纳入检查后，立刻发现了 `write-update-metadata.ts` 第一版参数处理里一个真实的窄化缺陷。

## 验证

`pnpm vitest run --root . apps/desktop/tests` —— 既有 224 个测试,外加四个新测试:随应用交付的声明支持每一个会构建安装包的平台、manifest 为其中每一个都钉住了带校验和的资产、未交付的平台 id 被拒绝,以及 Windows 二进制被命名为 `.exe`。

`node --import tsx/esm apps/desktop/scripts/fetch-micromamba.ts win32-x64` 下载了钉住的资产、匹配了记录的摘要并写出 `micromamba.exe`；`file` 报告为 `PE32+ executable (console) x86-64, for MS Windows`。

workflow 的 Windows 作业在打包之前会运行 carrier 测试并执行取回的 `micromamba.exe --version`，因此架构错误或不可执行的资产会在被埋进安装包之前失败。

第一次 dispatch 的运行立刻就回本了。它的 Windows 作业让两个从未在 POSIX 之外跑过的 carrier 测试失败：`stopProcessGroup` 的假 `ChildProcess` 只带了 `pid`，Windows 分支要调用的 `child.kill(signal)` 没有这个方法；environment-binding 那个测试断言 `0o600`，而该平台的权限存在 ACL 而不是 mode bits 里，`stat` 对任何可写文件都报 `0o666`。两者都改在测试上，不在产品上。它的 macOS 作业则在仓库级 `tsc -b tsconfig.host.json` 中因 V8 内存耗尽而中止：托管 macOS runner 是一台 7 GB 的机器，Node 把 old-space 定在其大约一半，因此 workflow 现在设置 `NODE_OPTIONS=--max-old-space-size=6144`。
