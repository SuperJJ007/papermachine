# Agent Note: Windows launch no longer shows the unsupported-platform page

Status: implemented

[English](2026-09-06-windows-launch-block-removed.md) | 中文

## Problem

[PR #17](https://github.com/SuperJJ007/papermachine/pull/17) 给 `openInitialSurface()`(`apps/desktop/src/main.ts`)加了一个 win32 分支,总是加载 `unsupportedPlatformErrorPage()` 而不进入 onboarding,因为当时 `startRun`/`prepareObservation` 会在任何内核能够 spawn 之前就硬性拒绝 win32:持久化内核的 response transport 依赖 POSIX FIFO,而 Windows 沙箱强制永远只报告 `'partial'`。这个拦截在落地时是针对一个真实缺口的临时止血,不是永久的产品立场——当时代码库根本没有任何受支持的方式在 Windows 上运行 Science 内核。

这个缺口后来已经补上。[win32 内核 response transport 改动](../feature/2026-09-05-win32-kernel-response-transport.zh.md)把 FIFO transport 换成了回环 TCP 通道,并移除了两处 win32 preflight 拒绝。[`minimumEnforcement` 改动](../architecture/2026-09-05-science-runtime-minimum-sandbox-enforcement.zh.md)让部署方可以通过显式配置接受一个报告 `'partial'` 的沙箱,而 `apps/desktop` 的 `runtime-overlay.ts` 正是对 `platform: 'win32-x64'` 这样配置的。[scratch 隐私与 probe 排序修复](2026-09-06-win32-scratch-privacy-and-probe-ordering.zh.md)补上了八处既有缺陷(mode-bit 隐私检查、probe confinement 排序、测试脚手架的 POSIX 假设、一个无法 fsync 的目录句柄、一个只支持 shebang 的假沙箱 runner、被 CRLF 转写的捕获文件,以及 kernel-spawn 的 `minimumEnforcement` 转发缺口)——这些缺陷是在 transport 与配置层工作让 win32 内核 spawn 原则上可达之后,一次真实 Windows Server 2022 实机跑测才逐一暴露出来的。[R locale 与 probe-argv 修复](2026-09-06-win32-r-locale-and-ascii-probe-argv.zh.md)补上了 R 专属的最后一个阻断点(`CHILD_LOCALES.win32` 与非 ASCII probe argv)。这些改动全部落地之后,同一台实机端到端跑通了 Python 与 R 内核——spawn、运行、取消、同内核状态保持——全部经由真实的回环 transport。本 Note 撤掉的桌面层拦截,是最后一处仍在告诉 Windows 用户"这个产品做不到"而它实际已经做到的地方。

## Decision

**`openInitialSurface()` 里的 win32 分支与 `unsupportedPlatformErrorPage()` 被直接删除,而不是藏在一个开关后面。** win32 启动现在走与其他平台完全相同的 `resolveEnvironmentBindingStatus` → onboarding/workspace 路径;`handleActivate()` 不需要改动,因为它本来就只是再调用一次 `openInitialSurface()`。`README.md`/`README.zh.md` 的已知限制与路线图部分已改为如实陈述 Windows 上实际仍存在的差异(见下),不再写"尚无法执行 Python 或 R"。

**以下 Windows 专属限制仍然成立,本 Note 不改变它们:**

- Windows 沙箱强制只限制文件写入(`minimumEnforcement: 'partial'`);macOS 强制 `'full'`(见 `science-runtime/README.md` 的 Confinement and environment 一节)。
- `interrupt()` 在 win32 上是空操作,因此取消或超时一个运行总会结束该内核并丢失它持有的所有变量;macOS 上的中断通常能保住内核(见 `science-runtime/README.md` 的 "win32 interrupt loses kernel state")。
- win32 内核执行的实机验证目前只有一次针对真实 Conda 解释器的人工验证,尚无可重复的 CI 门禁;本仓库的 CI 里没有任何一处会 spawn 真实的 win32 内核(见 `science-runtime/README.md` 的 "win32 kernel execution's real-hardware evidence")。

## Alternatives considered

**保留一个配置开关,以便 Windows 出现回归时重新显示不支持页面。** 已否决:这个产品不需要维护"这个平台不受支持"这样一种状态——出现回归应该被当作 bug 去修或去回退,而一个从不在 CI 中被执行的开关本身就是一个潜在缺陷。直接回退这次提交,比留着一个会悄悄腐坏的开关更简单也更诚实。

**在桌面层首启 onboarding 于真实 Windows 硬件上重新验证之前,先保留这个拦截。** 已否决:这个拦截当初的适用范围是"内核完全跑不起来",而这个前提现在已经不成立;下面提到的首启 onboarding 未在实机复验这个缺口,是一个打包/人工 QA 任务,不构成继续告诉用户"一个已经能用的能力不存在"的理由。

## Consequences

Windows 用户的首次启动现在会进入 onboarding,绑定完成后可以运行 Python 与 R 分析,与内核通信及沙箱配置改动已经在 runtime 一侧实现的能力在桌面侧对齐。`apps/desktop/tests/error-page.spec.ts` 去掉了 `unsupportedPlatformErrorPage` 的 describe 块。`pnpm vitest run apps/desktop` 与 `pnpm tsc -b tsconfig.host.json` 均通过。

这次改动没有在 Windows 硬件上验证真实的首启 onboarding 窗口序列——此前几份 Note 引用的实机验证,只确认了内核执行(spawn/运行/取消/状态保持)。打包后在 Windows 上的一次真实首启验证仍是待办,与上面其他实机缺口一样:靠人工,不在 CI 门禁之内。
