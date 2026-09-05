# Agent Note: Windows 启动时先展示不支持页面，再谈下载

Status: implemented

[English](2026-09-05-windows-launch-shows-unsupported-page.md) | 中文

## Problem

在 Windows 上,Science kernel 根本无法运行:`startRun` 早已对 win32 硬性拒绝(kernel 通信依赖 POSIX FIFO 以及 `mkfifo`/`cat` 这两个二进制),而 Windows 后端的沙箱强制也只是部分实现。在这次修复之前,Windows 用户启动应用后仍会走完 onboarding、下载约 520 MB 的随包环境,结果之后每一次运行都会被拒绝([issue #14](https://github.com/SuperJJ007/papermachine/issues/14))。

[PR #17](https://github.com/SuperJJ007/papermachine/pull/17) 给 `openInitialSurface()` 加了一个 win32 判断,改为加载一个说明页面而不是启动 onboarding,但在首次启动时 `window` 此刻仍是 `undefined`——它要等到后面 `openOnboarding()`/`openWorkspace()` 内部才会被创建——所以 `window?.loadURL(...)` 是一次悄无声息的空操作,用户看到的是完全没有窗口。该 PR 的 README 措辞也声称支持 Linux,而本产品并不发布 Linux 版本;它为环境绑定阶段等价的 win32 拒绝新增的 `ScienceRuntimeError` 代码与消息,也和 `startRun` 已经用于同一平台缺口的代码对不上。

## Decision

`openInitialSurface()` 的 win32 分支现在先创建窗口——`window ??= createWindow('system')`,与 `boot()` 自身失败回退路径使用的写法相同——再加载 `unsupportedPlatformErrorPage()`。这里固定使用 `'system'`,而不是从持久化偏好中解析,是为了让这个平台判断永远不依赖 Harness home 是否可解析(例如路径含空格的 home 不应因此挡住这个页面)。`handleActivate()` 只要 `BrowserWindow.getAllWindows().length === 0` 就会再次调用 `openInitialSurface()`,因此 win32 上后续的 `activate` 重入会重新创建窗口并重新加载同一个页面,而不会抛出异常或打开 onboarding。

`unsupportedPlatformErrorPage()` 不再接收参数:它唯一的调用点本就已经处于 `process.platform === 'win32'` 分支之内,此前那个从未被使用的参数是死代码。页面文案明确说明:PaperMachine 在本版本中尚无法在 Windows 上运行 Python 或 R 分析、环境并未被下载、Windows 支持在路线图上、目前请改用 Mac——不提及 WSL2,因为它不是本产品测试或支持的路径。

`packages/science/science-runtime/src/environment.ts` 中 `prepareObservation`(经由 `bindEnvironment` 到达)里的 win32 拒绝,现在抛出与 `startRun` 已用于其自身 win32 拒绝相同的代码 `KERNEL_UNSUPPORTED_PLATFORM`,而不再是 `CONFINEMENT_UNAVAILABLE`。`CONFINEMENT_UNAVAILABLE` 继续专指某个受支持平台上沙箱确实不可用或强制等级不足的情形;把"这个平台完全不受支持"也归入这个代码,会让这两种失败在代码层面无法区分。

`README.md`/`README.zh.md` 的已知限制现在说明:分析运行支持 macOS(Apple 芯片与 Intel);已发布 Windows x64 安装包用于桌面载体,但 Science Runtime 目前尚无法在 Windows 上执行 Python 或 R,因为其内核通信依赖 POSIX FIFO 且 Windows 上的沙箱强制仅为部分实现,应用会在启动时说明这一点,而不是下载环境。两种语言都不再把 Linux 列为受支持的分析平台——本产品只发布 macOS 与 Windows 版本。

## Alternatives considered

- **win32 探测拒绝继续使用 `CONFINEMENT_UNAVAILABLE`。** 已否决:该代码在同一文件的其他地方已经表示"沙箱可用但强制等级不足"(例如含空格的 R `TMPDIR`、与可写根重叠的 prefix);把它挪用于"这个平台完全没有受支持的内核通信方式",会抹掉代码本应携带的区分,也会与 `startRun` 对同一平台缺口已经使用的 `KERNEL_UNSUPPORTED_PLATFORM` 不一致。
- **在展示 win32 页面之前先从 Harness home 解析窗口主题偏好。** 已否决:这个平台判断必须不论 home 是否可解析都成立,而 `boot()` 自身的失败回退路径早已确立:在还没有基于 home 的偏好可用时,回退到 `'system'`。
- **在错误页面中提及 WSL2 作为变通方案。** 已否决:WSL2 不是本产品构建、测试或支持的路径;提及它等于承诺了维护者并未认可的东西。
- **保留 README 中关于支持 Linux 的说法。** 已否决:Linux 此前已从本产品中砍掉,也从未有过发布版本;继续这样说会误导正在决定是否安装的读者。

## Consequences

Windows 上的启动——无论是首次启动还是之后没有任何打开窗口时的 `activate`——现在总会展示一个承载不支持页面的真实窗口,不会再悄无声息地停在完全没有窗口的状态。`unsupportedPlatformErrorPage()` 的签名少了一个此前从未被使用的参数。`bindEnvironment` 与 `startRun` 现在对 win32 host 使用同一个 `KERNEL_UNSUPPORTED_PLATFORM` 代码,调用方与测试因此可以仅凭代码区分"这里不受支持"与 `CONFINEMENT_UNAVAILABLE` 所表示的"这里强制得不够"。Windows 的内核通信与完整沙箱强制仍是未来工作(记录在 README 路线图中);这次改动只是让过渡期的行为如实反映这个缺口。已通过 `apps/desktop/tests/error-page.spec.ts` 与 `packages/science/science-runtime/tests/environment.spec.ts` 在 macOS 上验证;真实的 Windows 启动流程(窗口创建先于页面加载)尚未在 Windows 硬件上重新验证。
