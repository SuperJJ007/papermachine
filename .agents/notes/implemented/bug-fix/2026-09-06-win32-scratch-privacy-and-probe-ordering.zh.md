# Agent Note: 若干预先存在的缺陷曾在 win32 kernel 启动前就拦下了它

Status: implemented

[English](2026-09-06-win32-scratch-privacy-and-probe-ordering.md) | 中文

## Problem

[win32 kernel response-transport 变更](../feature/2026-09-05-win32-kernel-response-transport.zh.md)与[`minimumEnforcement` 变更](../architecture/2026-09-05-science-runtime-minimum-sandbox-enforcement.zh.md)原则上让 win32 上的 Science kernel spawn 变得可达，但一次真实 Windows 机器的验证运行显示新代码根本走不到那一步：若干预先存在、两次先前变更都未触及的缺陷，在任何 kernel process 能够启动之前就拦下了每一次 session、probe 和 kernel scratch 操作。

1. `scratch.ts` 的 `privateDirectory()` 要求每个 managed directory 满足 `(entry.mode & 0o077) === 0`。Node 在 win32 上的 `lstat` 返回的是合成的 mode bits，从不反映此前的 `chmod`：一个刚创建、刚 `chmod(0o700)` 过的 directory 仍会报告 `0o666`/`0o777`。这使得 `ensureSessionScratch`——因而每一次 session、probe、kernel scratch 操作——在 win32 上无条件地抛出 `... is not private`。
2. `environment.ts` 的 `prepareProbeAttempt` 在 `createProbeScratch` 真正把 directory 建到磁盘上之前，就先规划了 interpreter probe 的私有 directory(`planProbeScratch`)并对其做了 confine(`sandbox.confine()`，经由 `confineProbe`)——confinement 最早发生在拥有它的 Session scratch tree 甚至还不存在的时候(`prepareSessionScratch` 只在每个 `prepareObservation` 调用都 settle 之后才运行)。POSIX 的 sandbox backend 能容忍对一个尚不存在的 workspace root 做 confine；真实的 win32 ACL backend 不能——`materializeAclGrant`(`sandbox-local/src/index.ts`)会调用 `assertPrefixReadOnly` 的姊妹函数 `assertTempRootOutsideWorkspace`(`sandbox-windows-acl/src/path-boundary.ts`)，它会对 workspace root 做 `realpathSync.native`，随后再给它加一条 ACE——这两步都需要该 directory 已经存在。观察到的失败是 `bindEnvironment` 抛出的 `ENOENT ... realpath '...\probes\<uuid>'`。持久 kernel 的 spawn 路径不受影响：它的 policy root 是已经创建好的 session scratch root(`execution.ts`)，而不是一个尚未创建的 probe directory。
3. `kernel-transport-real.spec.ts` 的 `resolveRealInterpreter`/`resolveOnPath` 是纯 POSIX 的测试脚手架代码：硬编码的 `join(prefix, 'bin', 'python3' | 'Rscript')` executable 猜测、按 `:` 切分的 `PATH`，以及没有 `.exe` 处理。在 win32 上，无论缺陷 1 和 2 是否已修复，这个测试都永远找不到一个真实 interpreter 去对着它跑真实 driver 断言。

针对缺陷 1 的修复在真实 Windows 上做验证时，又暴露出同一根因的第四个、对称的实例：`scratch.ts` 的 `privateFile()` 对 managed regular file(owner marker JSON、一次 run 落盘的 source)携带着完全相同的 `(entry.mode & 0o077) === 0` 检查，而 Node 在 win32 上对 regular file 合成 mode bits 的方式与对 directory 完全一样。这在真机上使 `scratch.spec.ts` 的一些测试以 `... is not private` 失败，而这些测试本来期待的是另一个、故意注入的失败——这是掩盖了每个测试真实场景的连带失败，而不是场景本身的缺陷。

## Decision

**`privateDirectory()` 与 `privateFile()` 都在 win32 上跳过 POSIX mode-bit 检查，保留各自的 directory/file/symlink kind 检查。** 二者都接受一个 `platform: NodeJS.Platform = process.platform` 参数(与 `kernel-transport.ts` 中 `selectKernelTransportKind` 已经使用的带默认值参数形状相同)，这样测试就能强制走任一分支，而不必去 mock 全局的 `process.platform`。win32 上的隐私本来就不是靠 POSIX mode bits 保证的——它来自 Harness home 继承的 user-profile ACL，加上 ACL sandbox 自身的 per-session SID(`dsh-sandbox-windows-acl`)，而这两者即便在此变更之前，这两个检查也都从未真正观察过。`packages/science/science-runtime/README.md`/`README.zh.md` 在既有的 mode-0700/mode-0600 描述旁边明确写出了这一点。

**probe confinement 从"规划时刻"移到了"目录创建时刻"。** `prepareProbeAttempt` 现在只规划一次 probe 尝试的 directory，并构建其三个未经 confine 的原始 argv 数组(`version`/`utf8`/`packages`)；它不再对任何东西做 confine。`observePrepared` 在 `createProbeScratch` 把该次尝试的 directory 真正落盘之后、在运行这三个 probe 之前，立刻对全部三个做 confine(`confineProbeAttempt`，顺序与旧代码 confine 它们的顺序完全一致，即 version/utf8/packages，从而保留了所有依赖 `confine()` 调用次数或顺序的既有测试)。这一改动在所有平台上都是对称的——没有 win32-only 分支——因为并不是只有真实 win32 ACL sandbox 才受益于 policy 的 `workspaceRoot` 在 confine 时刻已经存在；POSIX backend 只是恰好容忍了旧的、更弱的顺序。既有的、包裹 `createProbeScratch` 那个 directory 的每次尝试 `try`/`finally`(`removeProbeScratch`)本就覆盖了 probe 运行失败的情形；把 confinement 挪进同一个 `try` block 意味着一次 confinement 失败(`CONFINEMENT_UNAVAILABLE`、被 mock 出来的 `SandboxUnavailableError`，或任何其他 `confine()` 抛出)会被同一个 `finally` 捕获，刚创建的 probe directory 会像以前一样被移除——没有新增的泄漏路径，这一确切属性由一个新测试钉住：它的 fake sandbox 的 `confine()` 会断言 `existsSync(policy.workspaceRoot)`。

这次重排带来一个可以接受的二阶后果，而非缺陷：以前，一次 probe confinement 失败发生在 `prepareObservation` 期间，严格早于 `prepareSessionScratch` 运行，所以拥有它的 Session 在磁盘上的 tree 根本从未被创建过。现在 confinement 发生在 `observePrepared` 内部，而它总是在 `prepareSessionScratch` 之后运行，于是一次 confinement 失败回滚的是一个确实被创建过的 owning Session tree(`rollbackSessionScratch`，既有机制)，而不是磁盘上什么都没留下。`environment.spec.ts` 中受影响的两处断言(sandbox 报告的 `'partial'` 低于配置的最低要求；一个被 mock 出来的 `SandboxUnavailableError`)已更新为检查这个确切 Session 的 scratch root 与 marker 已经消失——这与 `environment.spec.ts` 中既有的"rolls back newly owned Session scratch when a retry cannot obtain full confinement"测试对一次 confinement 失败(即便在此变更之前，它也发生在 `prepareSessionScratch` 之后)所使用的断言形状完全一致。

**真实 driver 测试的 interpreter 发现方式现在与产品自身的解析方式一致。** `environment.ts` 的 `executableCandidate`(每一处静态检查和 probe 检查早已在用的、按平台区分的 `EXECUTABLE_LAYOUTS` 查找)被导出，使得 `kernel-transport-real.spec.ts` 可以用与 `bindEnvironment` 相同的方式定位一个已绑定 prefix 的 interpreter，而不是用硬编码的、纯 POSIX 的猜测。`resolveOnPath` 现在用 `node:path` 的 `delimiter` 切分 `PATH`，并在 win32 上给裸命令名追加 `.exe`。当没有 `environment-binding.json` 中的 prefix 可用时，PATH 兜底解析出的 interpreter 的 `canonicalPrefix` 推导方式是：从已解析出的 executable 向上走，找到最近的、携带 `conda-meta/history` 的祖先 directory，而不是假设一个固定的路径段数——这样即便某个 Conda 构建的 R 把 `Rscript.exe` 放在 `Lib\R\bin\x64\Rscript.exe` 而非 `WINDOWS_LAYOUT` 自己假设的 `Scripts\Rscript.exe`，也依然稳健，且不需要为那个备用位置单独写特例：一个 bound prefix 若其 `executableCandidate` 猜测落空，就会落入这同一套基于 PATH 的解析，它会找到真实文件，并推导出正确的 Conda prefix，无论该文件实际藏在多深的目录之下。

## Alternatives considered

- **把 `privateFile()` 中完全相同的 `0o077` 检查留到另一次独立变更里再改。** 一旦真实 Windows 运行给出直接证据，就拒绝了这个选项：`privateFile()` 触发的是与 `privateDirectory()` 完全相同的 win32 合成 mode bits 事实，走的还是 Fix 1 本就要解决的同一批调用路径(`ensureOwner`、`rollbackSessionScratch`)——把它推迟，只会让 marker 文件写入在 win32 上继续坏着，而理由仅仅是人为地把一个已经诊断清楚、单一根因的缺陷拆成两截。
- **在 `prepareProbeAttempt`/`observePrepared` 内部加一个 win32-only 分支，而不是无条件地把 confinement 挪到目录创建之后。** 拒绝：POSIX backend 同样没有"先于目录存在就做 confine"的正确性理由——旧顺序之所以能跑通，只是因为 POSIX backend 恰好容忍了它，而不是因为那本来就是正确的顺序。对所有平台使用同一种顺序更简单，也省去了本需要单独测试矩阵的平台条件分支。
- **让真实 driver 测试的 `canonicalPrefix` 依据 `EXECUTABLE_LAYOUTS` 的固定路径段数推导(例如在 win32 上从 `Rscript.exe` 固定向上取两次 `dirname()`)。** 拒绝：真实 Conda-forge R 构建的实际磁盘深度(`Lib\R\bin\x64\Rscript.exe`，三段)并不匹配 `WINDOWS_LAYOUT` 自身假设的两段(`Scripts\Rscript.exe`)，所以固定段数会为这个测试恰好需要跑通的那台机器推导出错误的 prefix。向上走到最近的 `conda-meta/history` 对任意深度都是正确的，也与 `staticInterpreter` 自身识别 Conda prefix 的方式一致。

## Consequences

`ensureSessionScratch`、`bindEnvironment` 的 probe 路径，以及 `KernelProcess.start()` 的 confinement 现在能在 win32 上继续推进，而不是在任何 scratch 或 process 工作之前就失败——这些都是一次真实 Windows Server 2022 验证运行发现的、预先存在的阻断项，此前 `main` 上已有的 transport 与 `minimumEnforcement` 工作已不再是限制因素。`packages/science/science-runtime/src/**/*.ts` 的逐文件覆盖率保持 100%(新增测试：`scratch.spec.ts` 针对同一个、真实的、权限设置错误的 directory 或 file，分别对 `privateDirectory()` 与 `privateFile()` 演练"POSIX mode-bit 被拒绝"和"win32 mode-bit 被跳过"两条分支；`environment.spec.ts` 新增一个 fake sandbox，其 `confine()` 会断言其 `workspaceRoot` 已经存在，从而直接证明新顺序，而不仅仅是通过"没有失败"来间接证明)。`kernel-transport-real.spec.ts` 中每一条关于"找不到可用 interpreter 时应自我跳过"的断言均未改变；改变的只是它如何去定位一个可用 interpreter。

在真实 Windows Server 2022 机器上确认(关键事实；完整细节见验证用的 PR/会话)：`packages/science/science-runtime/tests` 整个套件中剩余的失败，绝大多数由 `#!/bin/sh` fake-interpreter 测试脚手架(`tests/harness.ts`)造成，那是纯 POSIX 的测试脚手架，不在此变更范围内，也不是产品缺陷；`kernel-transport-real.spec.ts` 针对真实绑定的 Conda prefix，Python 和 R 都真正运行(而非跳过)并通过；一个真实的端到端脚本——真实 `LocalSandboxProvider` 自动选中 `windows-acl`、`minimumEnforcement: 'partial'`——完成了 `bindEnvironment` 并记录 `sandboxEnforcement: 'partial'`，跑通了 Python 和 R，证明了同一 kernel 上的状态持久性，并演练了 response-transport Agent Note 中已记录的 win32 interrupt-loses-kernel-state 路径。
