# Agent Note: win32 桌面端 provisioning 拿到 ambient environment，含空格的 Harness home 有了恢复页

Status: implemented

[English](2026-09-06-win32-desktop-provisioning-env-and-space-path.md) | 中文

## Problem

对桌面 carrier 的 Windows 改动（范围 `papermachine/main..main`，`apps/desktop` 及相关文件）做的一次静态审查，发现两个 P0 级别的缺口——两者都没有测试覆盖，也都没在真实设备上被报告过。

`buildProvisioningEnv`（`apps/desktop/src/provisioning.ts`）此前只允许通过 `PATH`/`HOME`/`TMPDIR`/`LANG`/`LC_*`/proxy 变量——一份纯 POSIX 形状的清单。在 win32 上，本应用 spawn 的 `micromamba.exe` 与 health-check interpreter 子进程拿不到 `SystemRoot`、`USERPROFILE`、`APPDATA` 或任何其他 Windows 系统变量。science-runtime 自己的 `kernel-process.ts` 早已撞上完全相同的问题，并用一份 `WIN32_AMBIENT_ENVIRONMENT_KEYS` 白名单修好了它，其文档写明一个没有这些变量的 win32 进程无法初始化 Winsock（`WinError 10106`）——这对 micromamba 的 TLS 包下载与 health-check interpreter 自身的网络请求都是风险。桌面端 provisioning 此前没有对应的处理。

另一个独立的问题：`boot()` 的第一次 Harness home 解析，在解析出的路径——默认是 `<osHomeDir>/.papermachine`——含有 ASCII 空格时，会抛出 `HarnessHomeSpaceError`，而 R 的 `TMPDIR` 探测（science-runtime 的 `environment.ts` 的 `prepareProbeAttempt`、`kernel-process.ts` 的 `KernelProcess.start`）无法容忍这一点。`classifyBootInstallLocationFailure` 此前把这个错误完全排除在恢复窗口路径之外，于是它会直接 rethrow 进 `app.exit(1)`：没有窗口，没有提示。专门为这个错误写的页面 `harnessHomeSpaceErrorPage` 的 `actions` 数组是空的，且在这条路径上根本够不到——它唯一的调用方是通用的 launch-error 页面，而 `boot()` 第一次解析里的失败永远走不到那里。一个主目录含空格的 Windows 账户（`C:\Users\John Smith`）每次启动都会撞上这个问题。

一轮实机测试在同一区域又发现了第三个缺口：打包在 `resources/bin/win32-x64/` 下、作为独立子进程 spawn 的 `micromamba.exe` 依赖 `vcruntime140.dll`/`msvcp140.dll`。Windows 的 DLL 搜索顺序从被 spawn 的可执行文件自己所在目录开始，而不是 Electron 所在目录；一台没装 Visual C++ Runtime 的裸机上，spawn 会以 `STATUS_DLL_NOT_FOUND` 失败。这一点此前只记录在 `.agents/tmp/` 下的一份临时任务文件里，任务完成即删。

对同一改动的一轮验收又发现了 `buildProvisioningEnv` 自身的两个后续缺陷，上面的测试都没能测出来，因为每个测试用的都是 POSIX 形状的键。第一，白名单里 `PATH` 的判断用的是精确字符串相等（`key === 'PATH'`），但 Node 在 Windows 上会保留系统环境变量键名原本的大小写，而 Windows 自己的 PATH 变量名是 `Path`，不是 `PATH`。在真实 Windows 上这个精确匹配什么都匹配不到，于是子进程的 `PATH` 里只剩上面那条里前置的 `dirname(process.execPath)`，Host 自己的 `System32` 等全部丢失——这个缺陷从 0.1.0 起就存在于每个 win32 构建里；`micromamba.exe` 与 health-check interpreter 全靠 `ComSpec` 限定或本来就是绝对路径才撑过去。第二，health check 此前直接用 Host 的 ambient `PATH` 跑 interpreter，而这不是产品自己的持久内核实际使用的 `PATH`：`kernel-process.ts`/`execution.ts` 会从环境 prefix 下一组固定、有序的子目录（`Library\mingw-w64\bin`、`Library\usr\bin`、`Library\bin`、`Scripts`、`bin`）构造 interpreter 的 `PATH`，因为 `Scripts\Rscript.exe` 的 conda launcher 与 R 自己的 DLL 解析都依赖 `Library\bin` 排在 ambient PATH 之前。health check 如果用和内核不同的 PATH 跑，就可能出现健康检查过了/没过与内核实际能不能启动这个 interpreter 互相脱节的情况。

## Decision

`buildProvisioningEnv` 现在接收 `{ platform, root }`，而不再只依赖 `process.env`。在 win32 上它额外会：

- 透传一份 `WIN32_AMBIENT_ENVIRONMENT_KEYS` 清单（`SystemRoot`、`windir`、`SystemDrive`、`ComSpec`、`PATHEXT`、`USERPROFILE`、`APPDATA`、`LOCALAPPDATA`、`PROGRAMDATA`、`NUMBER_OF_PROCESSORS`、`PROCESSOR_ARCHITECTURE`)——这是 science-runtime `kernel-process.ts` 里同一份清单的复制，而不是 import：本应用不能依赖 science-runtime，后者作为独立的 Host 进程被打包进产物，而不是本 carrier 链接的一个库。复制就有两份清单悄悄走散的风险，因此 `provisioning.spec.ts` 直接读取 `kernel-process.ts` 的源码文本（不做跨包 import）并断言两份清单一致，沿用的是 `interpreter-presence.ts` 的布局表对照 science-runtime `environment.ts` 时已经确立的同一模式（这一先例见 min-sandbox-enforcement 与 package-cache 两篇 Note）。
- 把 `TEMP`/`TMP` 指向 `provisioningScratchTempDir(root)`（`<root>/tmp`，位于 provisioner root 之下），而不是转发 Host 自己的 ambient temp 目录。Python 的 `tempfile` 与 R 的 `tempdir()` 在 win32 上都不查 `TMPDIR`，所以 `TEMP`/`TMP` 不设置时会退到 `GetTempPath()`，而它在 `TEMP`/`TMP`/`USERPROFILE` 全部缺失时会解析到 Windows 目录（普通用户不可写）——这正是本应用自己此前那份白名单造成的状态。provisioner root 本身已经排除了 ASCII 空格（它派生自的 Harness home 会在 `harness-home.ts` 里拒绝空格），所以这个 scratch 目录不需要再单独检查就继承了这条保证。
- 把 `dirname(process.execPath)`（Electron 可执行文件自己所在目录，其中带有随应用打包的 `vcruntime140.dll`/`msvcp140.dll`）前置到子进程的 `PATH`，这样单独 spawn 的 `micromamba.exe` 就能通过 Windows 自己的搜索顺序找到这些 DLL，即便是在一台没装 Visual C++ Runtime 的裸机上。

`SECRET_ENV_PATTERN` 的凭据剥离先于以上逻辑运行，不受影响——上面列出的固定 win32 键都不是凭据形状。

这两个后续缺陷各在自己的位置修复。`buildProvisioningEnv` 现在改为对 `source` 自身的键做大小写不敏感的扫描来找到 ambient 的 `PATH` 值（`key.toUpperCase() === 'PATH'`），而不是靠白名单循环里的精确匹配；并且始终把结果写回统一的 `PATH` 键，绝不使用来源键自身的大小写（`Path`）——libuv 对 Windows 子进程的环境块本就大小写不敏感处理，一个 `PATH` 键就够了，也避免同一个环境块里同时出现 `PATH` 和 `Path`。非 win32 平台不受影响：大小写不敏感查找与统一输出键只在已有的 `win32-` 分支内运行。第二，`buildProvisioningEnv` 新增一个可选的 `win32HealthCheckPrefix`；传入时，它会把这个 prefix 自己的 `WIN32_HEALTH_CHECK_PATH_SUBDIRECTORIES`（复制自 `execution.ts` 的 `WINDOWS_PATH_SUBDIRECTORIES`——`''`、`Library\mingw-w64\bin`、`Library\usr\bin`、`Library\bin`、`Scripts`、`bin`，用 `path.win32.join` 拼到 prefix 上，复制而非 import 的原因与 `WIN32_AMBIENT_ENVIRONMENT_KEYS` 相同）前置到 `PATH`，位置在 `dirname(process.execPath)` 之后、ambient `PATH` 之前。只有 health-check 的调用点会传入 `win32HealthCheckPrefix`；`micromamba create` 的调用点不传，因为那个子进程是往 prefix 里安装，而不是从 prefix 里跑 interpreter，让它依赖 prefix 里尚未生成的子目录为时过早。`provisioning.spec.ts` 用锁定 `WIN32_AMBIENT_ENVIRONMENT_KEYS` 对照 `kernel-process.ts` 的同一种方式，锁定了 `WIN32_HEALTH_CHECK_PATH_SUBDIRECTORIES` 与 `execution.ts` 源码文本的一致性。

`classifyBootInstallLocationFailure`（`apps/desktop/src/install-location.ts`）现在返回一个区分 kind 的 `BootInstallLocationFailure`（`{ kind: 'space', error }` 或 `{ kind: 'unavailable-pointer', target }`），而不是一个裸的 target 字符串。`HarnessHomeSpaceError` 无论是否有 pointer 生效都会分类为 `'space'`，`boot()` 会把它路由到新增的 `showHarnessHomeSpaceRecoveryWindow`，而不是继续 rethrow。这个窗口的页面现在提供"选择其他安装位置"，跑的是与 onboarding 的 `desktop:choose-install-location` 完全相同的目录选择器/校验/pointer 写入/relaunch 流程（提取进了共享的 `runChooseInstallLocationFlow`）；当重新选择的位置本身也不可用时（比如同样含空格），会用一个新增的拒绝原因重新加载同一个页面，而不是丢失原始错误。"退出"动作仍然保留。这次修复刻意**不**放宽 ASCII 空格限制本身：这条限制的存在是因为 R 的 `tempdir()`/内核 `TMPDIR` 确实无法在含空格路径下运行（见上面链接的 science-runtime），不是本 carrier 自己校验发明出来的；这次修复给用户一条走出坏默认值的路，而不是想办法让那个坏默认值继续能用。

vcruntime DLL 这个缺口，除了上面的 `PATH` 前置之外，本次改动没有别的代码修复（尚未在真实硬件上验证——见 Consequences）；把它记录在这里，是为了不让最初发现它的那份临时任务文件成为这个事实唯一存在的地方。

## Alternatives considered

- **在 win32 上把桌面进程完整的 `process.env` 转发给 provisioning 子进程。** 拒绝：`buildProvisioningEnv` 的白名单存在的目的，正是让导出到桌面进程自身环境里的凭据不会泄漏进原样转发给 renderer 的安装器输出；只在一个平台上转发全部变量，会让 win32 provisioning 比 darwin 明显更不安全，而这和真正要解决的 Winsock/temp 路径问题毫无关系。
- **把 `vcruntime140.dll`/`msvcp140.dll` 与随应用打包的 `micromamba.exe` 放在同一目录下发布。** 本次未采用：需要实机确认 `PATH` 前置是否已经能解析到这些 DLL（Electron 自己所在目录理应带有它们，因为 Electron 本身就是一个有同样依赖的原生二进制），而直接打包可再分发 DLL 是一个比本次修复范围更大的打包决定。记录为设备测试证明 `PATH` 前置不够用时的后备方案。
- **把 `requireNoAsciiSpace` 从拒绝改成只警告。** 直接拒绝：这正是仓库流程规则禁止的"未经同意削弱用户/模型可见能力"模式，而且这条限制不是本 carrier 自己发明、可以自行放宽的东西——R 的内核与 TMPDIR 探测会独立于桌面 carrier 做了什么，拒绝一个含空格的 scratch 路径。

## Consequences

`provisioning.spec.ts` 覆盖了 `buildProvisioningEnv` 在 win32 上的新增行为（ambient 键的存在/缺失、`TEMP`/`TMP` 指向 scratch 目录、`PATH` 首段是 `dirname(process.execPath)`、凭据键仍被剥离）以及 darwin 上行为不变，全部可以在 macOS 上跑通（该模块的 `platform: 'win32-x64'` 分支无需真实 Windows 主机即可被覆盖）。它还覆盖了这两个后续缺陷：一个只有 `Path` 键（没有 `PATH`）的 win32 来源，仍然会产生一个携带该值、`dirname(process.execPath)` 排最前、且不留下多余 `Path` 键的 `PATH` 输出；health-check 调用点的 `PATH` 会在 `dirname(process.execPath)` 与 ambient `PATH` 之间携带该 prefix 的六个子目录、顺序与 `execution.ts` 一致；`micromamba create` 调用点的 `PATH` 完全不携带任何 prefix 子目录；还有一个端到端的 `DesktopEnvironmentProvisioner.provision` 测试断言 health-check 的子进程（`python.exe`、`Scripts\Rscript.exe`）会收到这条同样有序的 `PATH`，而 `micromamba.exe` 这个 create 子进程不会。`install-location.spec.ts` 与 `error-page.spec.ts` 覆盖了 `classifyBootInstallLocationFailure` 的新路由逻辑和 `harnessHomeSpaceErrorPage` 新增的动作/拒绝原因渲染。

以上都尚未在真实 Windows 硬件上验证过。`.agents/tmp/2026-09-06-windows-followups/windows-device-checklist.md`（临时文件，任务完成即删）现在除已有条目外，还追踪：

- 一个主目录含空格的 Windows 账户：确认恢复页会打开（而不是无声退出），"选择其他安装位置"能端到端走通（写入 pointer、重启），再次选一个同样含空格的路径会停留在页面上并显示更新后的原因，而不是写入 pointer。
- `micromamba create` 与 Python/R health check 在现在已经填充的 ambient environment 下真的能启动——这是修好与之无关的 #20/#11 interpreter-layout 缺陷之后的下一个失败点（见 package-cache 这篇 Agent Note）。
- 仅靠这次的 `PATH` 前置，是否已经能让一台没装 Visual C++ Runtime 的裸 Windows Server 主机上、独立 spawn 的 `micromamba.exe` 解析到 `vcruntime140.dll`/`msvcp140.dll`，还是仍然需要直接打包这些 DLL（见 Alternatives）。
