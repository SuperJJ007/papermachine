# Agent Note: the win32 ACL sandbox runner invocation carries its own required env, not the caller's guess

Status: implemented

[English](2026-09-08-win32-acl-runner-electron-run-as-node.md) | 中文

## Problem

所有 Windows 上的 Science 任务都会超时。`packages/sandbox/sandbox-local/src/index.ts` 的 `windowsAclRunnerInvocation()` 会用 `process.execPath` 重新 exec 去运行 `@deepseek-ai/dsh-sandbox-windows-acl` 的 `runner`(一个 Node 脚本)——在桌面打包版上，`process.execPath` 就是 `PaperMachine.exe`，一个 Electron 二进制。每一个 spawn 该 argv 的调用点(science-runtime 的 `probeEnvironment`/`installEnvironment`/`kernelEnvironment`，全部是 `environmentBase: 'empty'`)给这次重新 exec 的环境里只有 `HOME`/`TMPDIR`/`PATH`/locale——从未包含 `ELECTRON_RUN_AS_NODE=1`。缺了这个变量，打包版二进制不会把 `runner` 当 Node 脚本执行，而是把自己启动成一个完整的第二桌面 App 实例(带自己的 gpu-process、network-service utility 进程和 renderer)——这一点已在一台真实的 Windows Server 2022 主机上通过两次独立的进程树复现确证：每次 science 探测 spawn 都会产生两棵完整的 App 形状进程树(不是单个 Node 子进程)，随后各自尝试拉起自己的 Host webserver——先试 `host-port.json` 记住的端口(与从未重启过的真 Host 相撞：`EADDRINUSE`)，失败后退回 OS 分配端口。`apps/desktop/src/main.ts:81` 与 `:341` 在它们自己对 `process.execPath` 的重新 exec 上(Host 启动与 watchdog 启动)早就设了 `ELECTRON_RUN_AS_NODE: '1'`；win32 ACL 沙箱这次重新 exec 是唯一没设它的调用点。这次探测本该 spawn 的真正 `python.exe`/`Rscript.exe` 从未运行：真正挂起的是那个幽灵实例，一直挂到 `DEFAULT_TIMEOUT_MS`(120000ms)，融合的 abort 信号才把整棵幽灵进程树杀掉——用户看到的两条完全相同的 `aborted before spawn: TimeoutReason: SCIENCE_RUNTIME_TIMEOUT after 120000ms`，是 `observePrepared()` 紧接着的下一个探测(`utf8`)撞上 `subprocess-local/spawn.ts` 的同步"已中止"前置检查，Python、R 各一条。`EADDRINUSE` 撞车本身发不发生取决于端口分配运气(一次复现撞了，另一次没撞)——这与最终结果无关，因为不论撞不撞车，science 任务都 100% 超时。

## Decision

`ConfinedArgv`(`packages/sandbox/sandbox/src/index.ts`)新增一个必填字段 `env: Readonly<Record<string, string>>`：所选后端的 runner 调用自身所需的环境变量条目，调用方必须在 spawn 前把它并到自身基础环境之上。`packages/sandbox/sandbox-local/src/index.ts` 的 win32 ACL 分支返回 `env: { ELECTRON_RUN_AS_NODE: '1' }`(`windowsAclRunnerInvocation()` 的内置产物形态和 tsx 源码启动形态都算，因为两者都重新 exec `process.execPath`)；每个 POSIX 分支，以及运维配置的 `runnerCommand` 覆盖，都返回 `env: {}`。每一个 confined-argv 的 spawn 点都把 `confined.env` 并在最后，让后端的要求在键冲突时胜出：science-runtime 的 `runProbe`/`runMicromambaInstall`/`KernelProcess.start`，bash-sandbox/pwsh-sandbox 的 `run()`/`start()`(并入 `spec.env`，它位于执行器自身受信的 `dshEnv` 层之下——这样做是安全的，因为 `dshEnv` 的类型只限定于受管的 `DSH_*` 键，不可能和 `ELECTRON_RUN_AS_NODE` 这类后端所需的键冲突)，以及 terminal-bash 的 PTY spawn(并入 `childEnvironment(...)` 的结果)。这个字段是必填而非可选，逼着每一个现有和未来的后端都显式给出答案(`{}` 也是一个合法、刻意的答案)，而不是让类型悄悄默认出一个空对象。

这个 env 需求放在 seam 的返回值上，而不是塞进 science-runtime 内部：选择重新 exec `process.execPath` 是 win32 ACL 后端自己的决定，science-runtime、bash-sandbox 或任何其他消费方都没有参与这个决定，因此这个决定所需要的环境也该由该后端自己声明——这和 `denialSignatures`/`runnerFailureRules` 已经在做的事情是同一种 capability-seam 拆分：这两个字段本来就承载着调用方自己无从得知的、后端所有的分类事实。

## Alternatives considered

- **让 science-runtime 读取 `process.env.ELECTRON_RUN_AS_NODE` 并透传。** 否决：这会让一个本应与平台、Electron 无关的通用包(science-runtime，进而牵连 dsh-subprocess/dsh-sandbox-local)去了解"自己的 `process.execPath` 可能是一个 Electron 二进制"这件事——而这本该是 win32 ACL 后端自己的事实，是它自己决定要重新 exec `process.execPath` 的。而且这只能修好 science-runtime 一处：bash-sandbox、pwsh-sandbox、terminal-bash 都走同一个 seam 去做限制，它们同样没有理由去猜一个 Electron 专属的环境变量，下一次它们在 Windows 上跑受限命令时，同样会各自起出幽灵 App 实例。
- **直接把 `ELECTRON_RUN_AS_NODE: '1'` 硬编码进 `windowsAclRunnerInvocation()` 自己的 spawn 调用里。** 不适用：`sandbox-local` 自己并不 spawn runner——`confine()` 只把 argv 返回给调用方，由调用方用自己的 subprocess seam(带着自己的 stdio、取消机制和进程树生命周期)去 spawn。这个后端根本没有自己的 spawn 调用可以把这个变量硬编码进去；它必须通过返回值把这个需求传回去。
- **给 `ConfinedArgv.env` 一个 `{}` 默认值(可选字段)而不是必填。** 按本仓库"显式优先于隐式"的约定否决：一个带隐式空默认值的可选字段，正是这次修复要在类型的其他地方消除的那种"调用方猜测"。必填字段逼着每一个后端实现(现有的和未来的)显式给出答案，包括每个 POSIX 分支和 `runnerCommand` 覆盖上那个刻意的 `{}`。

## Consequences

science-runtime、bash-sandbox、pwsh-sandbox、terminal-bash 里每一个 confined-argv 的 spawn 点现在都会并入 `confined.env`；未来任何一个 `.confine()` 消费方在通往真正 spawn 调用的路上把这个字段弄丢，就会给自己重新引入这个 bug。`apps/desktop/src/main.ts` 额外加了单实例锁作为纵深防御(`app.requestSingleInstanceLock()`，拿不到锁就直接 `app.quit()`，`second-instance` 事件里聚焦已有窗口)：有了 env 修复之后，win32 ACL runner 的调用根本不会走到 `main.ts` 的 app 代码(`ELECTRON_RUN_AS_NODE=1` 让打包版二进制以纯 Node 方式运行，不会启动 Electron 的 app 生命周期)，所以这把锁只防住"用户真的多开一个 app 实例"，或者未来某次 `process.execPath` 重新 exec 又忘了带这个 env 变量的回归——它本身并不能修好一个缺失的环境变量，因为一个被锁挡住的幽灵实例在退出之前同样不会把 `runner` 当 Node 执行。Windows 实机复验是另一个仍待完成的独立步骤(这次修复只随附单元测试覆盖，符合 win32 无 CI 的测试政策)。
