# Agent Note: Desktop Harness home moves off Electron `userData`

Status: implemented

[English](2026-08-25-desktop-harness-home-space-free.md) | 中文

## Problem

桌面 carrier 把 `DSH_HOME` 设为 `app.getPath('userData')`，在 macOS 上解析为 `~/Library/Application Support/DeepSeek Science`。science-runtime 的 R probe 与 R kernel 都会在其 scratch `TMPDIR` 含有任何 ASCII space 时拒绝运行（`packages/science/science-runtime/src/environment.ts:402`、`kernel-process.ts:340`），而 `Application Support` 本身就含有一个空格。于是每个 R kernel 在桌面端都会无条件失败，报出 `CONFINEMENT_UNAVAILABLE: R probe TMPDIR cannot contain an ASCII space`，与用户在 onboarding 中绑定的 conda-family environment 无关。

## Decision

`apps/desktop/src/harness-home.ts` 导出 `resolveHarnessHome(osHomeDir)`：把 Harness home 解析为 `<osHomeDir>/.papermachine`，若不存在则创建（mode `0700`），并在解析出的路径仍含有 ASCII space 时——即 OS user home 自身路径含有空格——抛出 `HarnessHomeSpaceError`，点名 R 的 `TMPDIR` 限制，并直白说明该应用无法从含空格的 home directory 运行 science kernels。`main.ts` 在此前每一处读取 `app.getPath('userData')` 的位置都改为调用它并传入 `app.getPath('home')`（而非 `userData`）：`launchHost`、`openInitialSurface`、`desktop:bind` IPC handler，以及 `desktop:provision` IPC handler 中的 `provisioner(...)` 调用。Electron 自身的 `userData` directory 仍只保存 Electron 拥有的状态（cookies、caches），本 package 中不再读取它。

`hostCommand` 通过先展开 `process.env`、再在展开之后设置 `DSH_HOME: dshHome` 来构建 Host 的启动环境，刻意覆盖桌面应用自身从其启动 shell 继承来的任何 `DSH_HOME`。environment binding、runtime overlay 与 provisioning 都已经以本次启动 `resolveHarnessHome` 的结果为键，必须有唯一一个已解析的 Harness home 在其中保持权威；若让继承来的 `DSH_HOME` 胜出，Host 就可能读取一个与 onboarding 刚写入的那个不同、未绑定的 home。

`resolveHarnessHome` 会先检查拼接出的字面路径（因此一个明显含空格的 OS home 会在不产生任何文件系统副作用的情况下失败），再创建目录，并对其 `realpath` 规范化后的形式重新检查——它也正是返回值。science-runtime 会从经 `realpath` 解析的规范化 Harness home 派生每一个 kernel 与 probe 的 scratch 路径（`scratch.ts` 的 `rootForSession`），因此仅有字面上不含空格的 `osHomeDir` 并不足够：一个自身是、或位于其下的 symlink、其真实目标含有空格的 OS home，原本会通过字面检查，直到后面在某个 kernel process 内部才会失败。

同一改动也为应用改名：`main.ts` 中的 `app.setName('DeepSeek Science')` 改为 `app.setName('PaperMachine')`，`electron-builder.yml` 的 `appId`/`productName`/`artifactName` 随之更新，因此全新安装的 `userData` 会迁移到 `~/Library/Application Support/PaperMachine`。这与上面对 Harness home 的修复相互独立——`DSH_HOME` 已完全不再读取 `userData`——在 pre-release stance 下无需任何迁移。

`HarnessHomeSpaceError` 拥有自己专属的错误页面（`harnessHomeSpaceErrorPage`，点名出问题的路径与 R 的限制），而非通用的 Host 错误页面：这是一次启动期配置失败，而非 Host crash，普通的 "Restart Host" 操作——会针对同一个不可用路径重新启动 Host——无济于事，因此被省略。共享的 `launchErrorPage(error)` 会在两种页面间做出选择，并在每一处 launch/startup catch 位置（`openWorkspace`、`restartHost`、`boot` 中的 `openInitialSurface` catch）使用；`onUnexpectedHostExit`（真正的 Host crash）仍直接使用带重启操作的通用页面。`desktop:bind`/`desktop:provision` IPC handler 仍旧只是拒绝其 `ipcMain.handle` promise，onboarding 中既有的 `bindSelected`/detection catch 分支已经会把它展示在状态行中——那里未新增任何 UI。

## Alternatives considered

**保留 `userData`，转而对 `TMPDIR` 解析中的空格做特殊处理。** 拒绝：空格出现在 Harness home 根目录本身，而不只是 kernel 的 scratch directory，因此每一个子路径（`environment-binding.json`、runtime overlay、`desktop-environments/`）都需要同样的绕过办法；而且该限制由 science-runtime 在两个文件中各自独立强制执行，并非本 package 拥有。

**让用户通过 Electron 的 `app.setPath('userData', ...)` 迁移 `userData`。** 拒绝：该调用必须在 `app.whenReady()` 之前、且在 Electron 读取自身由 `userData` 派生出的日志与缓存路径之前执行，会把 Electron 自身的状态目录与 Harness home 纠缠在一起而毫无益处——二者是彼此无关、只是恰好共享过同一个值的概念。

**为旧的、根植于 `userData` 的 home 添加兼容读取。** 在 pre-release stance 下拒绝：目前尚无外部使用者，迁移垫片只会让这条含空格的路径继续作为需要维护的代码路径存活下去。

## Consequences

每个新的桌面安装都会无条件获得一个 space-free 的 Harness home（普通 macOS 账户下即 `~/.papermachine`），因此 R kernels 可以运行。若用户自己的 home directory 路径本身含有空格，桌面端仍然无法运行 science kernels；应用会在原本会在 kernel process 内部悄然失败的那个点上 fail loud，并点名该限制。Pre-release：此前位于 `~/Library/Application Support/DeepSeek Science`（以及更早、在那之前的 `DSH Desktop`）下的每用户状态按设计被遗留——不再有任何代码读取它，也没有编写迁移代码。在发布本改动的这台机器上，`settings.yaml`、`environment-binding.json`，以及若存在的 `profiles/`、`sessions/` directories 已从旧的 `DeepSeek Science` 位置手动复制到 `~/.papermachine/`，这只是一次性的本地操作，不会为任何其他安装自动执行。

## Verification

`apps/desktop/tests/harness-home.spec.ts` 覆盖：解析出的路径为 `<home>/.papermachine` 且不含空格、目录被实际创建、对同一个 home 重复解析是幂等的、当 home directory 自身字面路径含有空格时会拒绝（抛出 `HarnessHomeSpaceError`）且不创建任何内容，以及一个自身字面路径不含空格、但是指向含空格真实目标的 symlink 的 home directory 同样会被拒绝，从而钉住 `realpath` 复检。`apps/desktop/tests/no-userdata-regression.spec.ts` 会静态扫描每一个 `apps/desktop/src/**/*.ts` 文件（先剥离注释），检查是否存在存活的 `getPath('userData')` 调用，一旦该调用重新出现即失败，直接为原始缺陷设防。`apps/desktop/tests/host-lifecycle.spec.ts` 及 `apps/desktop` 套件的其余部分保持不变并继续通过，因为它们直接用 fixture commands 演练 `HostLifecycle`，而不经过 `main.ts` 那个依赖 Electron 的组合层。
