# Agent Note：win32 随包本地（app-local）带上 MSVC CRT，放在 micromamba.exe 同目录

状态：implemented

[English](2026-09-07-win32-micromamba-app-local-crt.md) | 中文

## 问题

2026-09-07 在阿里云一台裸 Windows Server 2022 实例（全新安装，无开发工具）上做实机冒烟：安装、启动 PaperMachine、进入 onboarding 都正常，但点击"下载并安装"约 45 秒后失败，报 `desktop provisioning: process stopped (3221225781)`。`3221225781` 是 Node 对 Windows `0xC0000135`（`STATUS_DLL_NOT_FOUND`）的十进制报告。那次运行设备自身的 `host.log`/主进程 stderr 采集记录了完整的一行：`Error occurred in handler for 'desktop:provision': Error: desktop provisioning: process stopped (3221225781)`。

根因：随包的 `resources/bin/win32-x64/micromamba.exe`（官方 `mamba-org/micromamba-releases` 2.9.0-0 win-64 二进制）动态链接 MSVC C/C++ 运行库，其导入表点名了 `vcruntime140.dll`、`vcruntime140_1.dll`、`msvcp140.dll`。裸机的 `System32` 里没有这些文件，本应用自己的 `resources/bin/win32-x64/` 目录——也就是 Windows DLL 搜索顺序最先查找的、可执行文件自己所在的目录——同样没有带。这是一个已知、至今未修的上游缺口：`mamba-org/mamba#2928`（2023-10 开）与 `#3957`（2025-05 开）。

2026-09-06 的一份静态审查 Agent Note（`2026-09-06-win32-desktop-provisioning-env-and-space-path.md`）已经从最初发现此退出码的临时任务文件里推理过这个问题，并给 win32 provisioning 子进程的 `PATH` 加了 `dirname(process.execPath)` 前置，前提是"Electron 可执行文件自己所在目录会随应用打包 `vcruntime140.dll`/`msvcp140.dll`"。这个前提从未在真实硬件上验证过，2026-09-07 的实机运行直接推翻了它：Electron 43 自己的应用目录里并不带这些 DLL，因为 Chromium 静态链接了自己的一份 CRT，而不依赖系统安装的版本。无论 DLL 问题如何，这个 `PATH` 前置本身也是无意义的——Windows 的 DLL 搜索顺序在查询 `PATH` 之前，先查被 spawn 的可执行文件自己所在的目录，所以把一个目录放上 `PATH` 从来就不会改变 `micromamba.exe` 能否解析自己的依赖。

同一天在云机已安装的应用上做的探针确认了真正的修复方式：把 conda-forge `vc14_runtime` 包里的 `vcruntime140.dll`、`vcruntime140_1.dll`、`msvcp140.dll` 拷贝进已安装应用的 `resources\bin\win32-x64\`（与 `micromamba.exe` 同目录）后，`micromamba.exe --version` 从 `0xC0000135` 失败变为正常输出 `2.9.0`——此时 `System32` 仍然没有这些 DLL 中的任何一个。这证实了 Windows 的 DLL 搜索顺序会在可执行文件旁边找到它们，不需要任何 `PATH` 条目、环境变量或系统级安装。

用户在本次改动开始前就已经拍板选用 app-local 方案，理由见下方"备选方案"：一个无法提权的 per-user 安装器不应该依赖一次机器级的 Visual C++ 可再发行组件安装；其他 conda 系桌面产品（包括 JupyterLab Desktop）出于同样原因，同样把 `vc14_runtime` 随包本地落地；Microsoft 自己的文档也支持这些 DLL 的本地（非注册表）部署方式。

## 决定

`apps/desktop/resources/micromamba.json` 的 `win32-x64` 条目新增一个 `runtime` 字段，锁定 conda-forge 的 `vc14_runtime-14.51.36247-habf1de7_41.conda`（`https://conda.anaconda.org/conda-forge/win-64/vc14_runtime-14.51.36247-habf1de7_41.conda`，SHA-256 `4e4cb599cdc41bf2109d1464c127b5bcbddf548ce3e322e612afb691338b48f8`——本次改动中已对照真实 URL 重新核验）以及要从中提取的 11 个包根目录 `*.dll` 文件名：`concrt140`、`msvcp140`、`msvcp140_1`、`msvcp140_2`、`msvcp140_atomic_wait`、`msvcp140_codecvt_ids`、`vcamp140`、`vccorlib140`、`vcruntime140`、`vcruntime140_1`、`vcruntime140_threads`。micromamba 本身只硬依赖其中 3 个；把整组（约 2.4 MB）一起带上，是为了防将来某个卫星 DLL 依赖冒出来，而不是去从某一版 micromamba 构建的导入表反推最小集合。

`.conda` 是一个 zip 容器（条目 stored、不压缩），里面装着 `pkg-<name>.tar.zst`（包文件本体，zstd 压缩的 tar）与 `info-<name>.tar.zst`（本仓库用不上的元数据）；`vc14_runtime` 的包里还带了一份 `Library/bin/<name>` 的根目录文件副本，给 POSIX 风格的 conda 环境用——刻意不提取这份副本，因为只有根目录那份会落在 `micromamba.exe` 旁边。新增的、有单测覆盖的模块 `apps/desktop/scripts/conda-package.ts` 用 fflate 的 `unzipSync`（在本工作区其他地方已经是这个确切版本的间接依赖，这里加为 desktop 的直接 devDependency）、Node 内置的 `zlib.zstdDecompressSync`（本仓库 `^22.19 || >=24` 的 engines 范围内都有，不引入新依赖）、以及 `tar-stream`（新增 devDependency：仍在积极维护，为这一次提取步骤手写 tar 解析会重新做一遍维护中的库已经做对的事——头部解析、PAX 扩展）来解包。`extractCondaPackageFiles` 返回请求文件的字节，或者点名每一个缺失文件后抛错；`writeCondaPackageFiles` 先提取，再把每个文件写到 `.download` 后缀的临时路径后才 rename 到位，所以缺文件会在写入任何东西之前就抛错，失败的调用会让目标目录保持原样。`scripts/fetch-micromamba.ts`——本仓库的约定把这类构建期工具放在 `src/` 之外，因为 `src/` 会被打进 Electron 包——下载并用 SHA-256 校验这个 `.conda` 文件，然后调用 `writeCondaPackageFiles` 写进 `resources/bin/win32-x64/`，与它原有的、对 `micromamba.exe` 本身的下载校验并列。非 win32 目标不受影响：`darwin-arm64`/`darwin-x64` 的 `asset.runtime` 是 `undefined`。

`electron-builder.yml` 顶层的 `extraResources` 不再把整个 `resources/bin` 目录整体打包——此前 Windows 安装器里会莫名其妙带上两份 macOS `micromamba` 二进制，和它自己的 `micromamba.exe` 以及现在的 11 个伴随 DLL 挤在一起。`mac`/`win` 平台段各自新增一条 `extraResources`，只点名 `resources/bin/darwin-${arch}` / `resources/bin/win32-${arch}`，落地到 `to: bin/<platform>-${arch}`——正是 `src/main.ts` 的 `micromambaPath()` 本来就期望的目录布局。本次改动通过阅读 `app-builder-lib` 26.15.3 自己的 `macroExpander.js` 与 `fileMatcher.js` 源码确认了两件事：平台专属 `extraResources` 的 `from`/`to` 支持 `${arch}` 宏展开（`FileMatcher` 的构造函数对 `from` 和 `to` 都做宏展开），以及该平台的列表会与顶层列表合并、而不是替换掉它（`getFileMatchers` 对同一个 `extraResources` 键，先后对顶层配置和平台专属配置都调用 `addPatterns`）——不只是靠源码阅读，本次改动还真的跑了一次 mac 的 `--dir` 构建和一次 win32 的 `electron-builder` 调用，分别产出了预期的 `bin/darwin-arm64/` 与 `bin/win32-x64/` 目录布局（具体命令与输出见"后果"一节）。

`buildProvisioningEnv`（`src/provisioning.ts`）整段删掉了 `dirname(process.execPath)` 这个 `PATH` 前置及其现已证伪的 JSDoc 说法——app-local 的 DLL 让它变得没有必要（DLL 搜索顺序本来就会先查可执行文件自己所在目录），而且它从一开始就只是一句错误的说法，没有真正起作用。`runProvisioningProcess` 现在会通过新导出的 `describeWin32MissingCrtExit`，把 win32 子进程的退出码 `3221225781` 翻译成一条双语的、可操作的消息——点名可执行文件、说明缺失的依赖、保留原始的十进制与十六进制错误码供诊断，并附上 `https://aka.ms/vc14/vc_redist.x64.exe` 作为万一 app-local DLL 仍然缺失时用户可以手动尝试的后备方案链接（本应用不运行也不随包携带这个安装器）。其他退出码与其他平台的消息都不受影响；这个检查只在 `process.platform === 'win32'` 时激活，而这只有在这段代码真的跑在 win32-x64 上时才为真。`onboarding.ts` 另外剥掉了 Electron `ipcRenderer.invoke` 的包装（`Error invoking remote method '<channel>': Error: <message>`）后再显示 provisioning 失败——实机证据（`issues.md` 里采集到的、一次不相关的 provisioning 失败报出的 `Error invoking remote method 'desktop:provision-custom':`）显示这层包装此前会原样出现在页面上，所以现在翻译后的 CRT 消息（或任何其他 provisioning 错误）都能干净地显示出来。

`.github/workflows/desktop-release.yml` 的 Windows job 在既有的 micromamba 冒烟检查之后新加一步，断言 `micromamba.json` 的 `win32-x64.runtime.files` 里列出的每个 DLL 名字都存在于 `resources/bin/win32-x64/` 下。冒烟检查本身的 `--version` 通过并不能证明 app-local 的这些 DLL 起作用：CI runner 自己的 `System32` 已经带了系统安装的 CRT，即便 app-local 的 DLL 集合是空的或坏的，`micromamba.exe` 在那台机器上照样能跑起来。

这些 DLL 是 Microsoft 自己构建的 Visual C++ 2015-2022 Runtime，由 conda-forge 以 `LicenseRef-MicrosoftVisualCpp2015-2022Runtime` 许可分发——Microsoft 自己的可再发行组件条款允许把这个运行库里的这些文件随第三方应用一起再分发，本次改动做的正是这件事。

## 备选方案

- **内嵌官方 `vc_redist.x64.exe`，安装时运行它。** 拒绝：这个安装器需要提权，而本应用的 Windows 安装器刻意做成 per-user、不提权（`electron-builder.yml` 的 `perMachine: false`），就是为了不在未签名安装器已有的 SmartScreen 警告之上再加一个 UAC 提示。从一个不提权的安装器里跑一个需要提权的子安装器，会给本应用的安装路径同时加上 UAC 提示和第二个安装器自己的失败面。
- **静态链接 micromamba 的 CRT。** 拒绝：本仓库直接消费官方 `mamba-org/micromamba-releases` 二进制，而不是从源码构建 micromamba，也没有官方发布的静态链接 win-64 构建。
- **依赖 `dirname(process.execPath)` 的 `PATH` 前置（2026-09-06 笔记的原始修复）。** 已被实机证伪（见"问题"一节）；不以任何形式保留——让探针奏效的那个 DLL 搜索顺序事实（先查可执行文件自己所在目录，再查 `PATH`）本身就意味着，即便 Electron 目录当初真的带了这些 DLL，`PATH` 条目也从来不可能是真正起作用的那个原因。
- **只提取 micromamba 导入表点名的 3 个 DLL。** 拒绝：同一个包里完整的 11 个文件加起来约 2.4 MB，整组带上省得将来还要针对某一版 micromamba 构建的导入表重新推导最小集合（并重新验证它仍然是最小的）。

## 后果

`apps/desktop/tests/conda-package.spec.ts` 针对测试内自行合成的 fixture `.conda` 文件（用 fflate 的 `zipSync` 包一个用 `tar-stream` 自己的 `pack()` 构建、再经 `zlib.zstdCompressSync` 压缩的 tar）对 `extractCondaPackageFiles`/`writeCondaPackageFiles` 做了单测，覆盖：只提取列表内的根目录文件、忽略列表内名字的 `Library/bin/` 副本、列表内缺文件时抛错、以及 `writeCondaPackageFiles` 失败调用会让目标目录保持为空而不是留下半成品文件。`apps/desktop/tests/provisioning.spec.ts` 更新了所有此前预期 `dirname(process.execPath)` 作为首段的 `buildProvisioningEnv`/`DesktopEnvironmentProvisioner` PATH 断言，并为 `describeWin32MissingCrtExit` 新增了覆盖（确切的退出码、消息内容、以及其他任何退出码都返回 `undefined`）。`apps/desktop/tests/onboarding.spec.ts` 为 IPC 包装剥离新增了覆盖。`apps/desktop/tests` 全部（本次改动时共 27 个文件 312 个测试）在 macOS 上跑通。

本次改动自己的自动化流程在这次会话里被真实跑过，不只是单测：`pnpm --filter @deepseek-ai/dsh-desktop run fetch:micromamba win32-x64` 针对真实的锁定 URL 真的跑了一遍，从真实的 `vc14_runtime` 包里下载并校验了真实的 `micromamba.exe` 和全部 11 个真实 DLL 到 `resources/bin/win32-x64/`（文件大小与包自身根目录列表逐一对上，这一点是在本应用代码之外，直接用 `unzip`/`tar`/`zstd` 检查下载下来的 `.conda` 文件核实的）。为了确认 `electron-builder.yml` 平台专属 `extraResources` 的产出布局，本次改动还跑了一次等价于 `pnpm --filter @deepseek-ai/dsh-desktop run package:win` 的构建，以及一次 `mac --dir` 构建（具体命令、产出路径与安装器 SHA-256/大小记录在本任务自己的结果一节，这里不重复）。

本次改动**没有**做到的事：本次改动的任何代码都没有被装到或跑在真实 Windows 设备上过。促成这次修复的 `0xC0000135` 失败与 DLL 拷贝探针都是真实设备证据，但发生在本次改动之前（2026-09-07 的阿里云冒烟测试与同一天的人工拷贝探针，都早于本次改动的任何一次提交）；本次改动自己打出来的安装包——从一开始就带着 app-local DLL，而不是事后拷进去的——本身还没有在那台或任何其他 Windows 设备上跑过。这项真机确认被明确排除在本次改动范围之外（留给后续任务），本次改动过程中也不得把应用上传到云测试机。
