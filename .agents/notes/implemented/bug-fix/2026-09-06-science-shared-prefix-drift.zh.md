# Agent Note：为共享 Conda prefix 在会话运行期间发生的漂移做逐次运行检测

状态：已实现

[English](2026-09-06-science-shared-prefix-drift.md) | 中文

## 问题

两个绑定到同一 profile 的 Science 会话共享磁盘上同一个 Conda prefix。会话 A 调用 `install_science_packages` 时对该 prefix 运行 micromamba，并把一条新的 `science/environment-bound` revision 追加到会话 A 自己的日志——但会话 B 的绑定，以及所有共享该 prefix 的其它会话，永远不会得知 prefix 已经在其脚下发生了变化。`bindEnvironment` 在会话有过任意一次 run 之后就拒绝重新绑定，因此会话 B 会永久卡在报告一份过期的 `condaHistorySha256`/`packagesSha256`/`bindingFingerprint` 上：`get_science_state` 和每一次 run 的结果都持续声称一个环境，而这个环境早已不是 `run_python`/`run_r` 实际执行所依据的那个（GitHub issue #15）。

## 决定

**漂移信号是对 `<prefix>/conda-meta/history` 的一次廉价、只读摘要计算，而不是新增一个事件类型。** `prefixHistoryDigest(canonicalPrefix)`（`packages/science/science-runtime/src/environment.ts`）定位、`lstat` 校验（是常规文件、不是符号链接）、读取并对这份 append-only 的 conda 事务日志做 SHA-256，全部通过与 `staticInterpreter` 自身历史检查共用的同一个私有 `readHistoryFile` 辅助函数完成——由构造保证是同一个函数，两处调用点因此不可能对同一份字节计算出不同的摘要。`prefixHistoryDigest` 从不抛出：文件缺失、是目录、是符号链接，或任何其它读取失败,统统折叠为 `undefined`,其 JSDoc 要求调用方把 `undefined` 当作"存在漂移"而不是"没有信号"来处理。这刻意比新增一个 `science/prefix-observed` 事件或文件系统监视更窄：`conda-meta/history` 是每一个 conda 变更方(`micromamba install`,以及用户自己对同一 prefix 手动执行的 `conda`/`micromamba` 调用)都保证会追加内容的那一份产物,因此比对它的摘要能捕捉到不论由哪个进程造成的漂移,代价只是每次 run 多一次 `stat`+`readFile`,而不是一次完整的重新探测。

**`startRun` 在每次 run 之前都做一次廉价的摘要检查,只有在真正不一致时才付出一次完整重新探测的代价。** `prefixDrifted(environment)` 把每种已绑定语言 prefix 的实时摘要,与会话当前已应用绑定中记录的 `condaHistorySha256` 做比较。一旦不一致(包括摘要现在解析为 `undefined` 的情况),就会走向与 `installPackages` 自身"重新探测并追加"步骤相同的 `reobserveAndMaybeRebind(session, profile, control, reason)` 辅助函数——现在这个函数被两处调用点共用,只用 `reason: 'install' | 'drift'` 做参数化区分。摘要一致时,`startRun` 除了这一次廉价的摘要读取之外不付出任何额外代价,其余流程与改动前完全一致。

**由漂移检查触发的重新探测,如果结果不是 `applied`,绝不落库。** `installPackages` 会无条件追加 `observeProfile` 返回的任何结果,包括一条 `invalid` revision,因为它汇报的是调用方主动要求的一次变更的结果。而由 `startRun` 内部触发的漂移检查不是这样:调用方要求的是执行代码,不是重新绑定。`bindEnvironment` 在会话有过任意一次 run 之后就拒绝重新绑定(`index.ts`),因此如果在这里追加一条 `invalid` revision,会让会话永久卡死,与本次修复要解决的原始 bug 效果相同,只是从"暂时性"变成了"永久性"。`reobserveAndMaybeRebind(..., 'drift')` 转而直接以 `ENVIRONMENT_NOT_READY` 拒绝本次 run,并保持会话最后一次已应用的 revision 不变,这样当 prefix 之后重新变得可用时(触发变更的会话完成了,或者一次手误编辑被撤销了),后续的 run 仍然可能成功。

**scratch 的物化发生在重新探测之前,而不是之后。** `startRun` 一旦检测到漂移就立即物化会话的 scratch 目录,并在本次 run 的其余过程中复用同一个 `scratchPreparation`,而不是先重新探测、等拿到新环境之后才物化 scratch。反过来的顺序会让一次探测或安装在没有 scratch 目录支撑的情况下运行,而它本应支撑的正是这次 run;也会重复 `materializeSessionScratch` 本已具备的幂等的"创建或校验"工作。

**桌面端的 `applied.json` 同步不在本次范围内。** 桌面端的准备(provisioning)链路会把一次已应用的环境 revision 镜像写入磁盘上的 `applied.json`,以便下次启动时跳过重新探测;本次改动不涉及这条路径。会话运行期间检测到的一次漂移会更新会话内存中/日志记录的绑定,但不会写 `applied.json`,因此跨会话漂移发生之后,桌面端下一次重启仍然会像改动前一样从头重新探测——这里没有引入新的过期风险,但也没有获得加速。是否应该让 `applied.json` 也感知一次并非由全新启动触发的重新绑定,是一个独立的产品问题,作为后续 issue 跟踪,而不是并入本次修复,因为它改变的是桌面端自己的磁盘约定,而不是 Runtime 的会话内行为。

**安装包依然不需要用户批准。** `install_science_packages`(`packages/science/tool-science/src/install.ts`)通过 `defineTool` 注册,只调用了 `requireDirectDispatch`;它不带任何 `tools/pre-execute` 或 `ctx.approval` 门禁,不同于仓库里为需要审批的工具准备的那套 seam(`packages/core/tools/README.md`)。这在本次改动之前就已经是事实,也不受本次改动影响:漂移修复让这个工具的跨会话副作用变得*可见*(每个其它会话都会在自己下一次 run 时得知这次变更,而不是悄悄过期),这削弱而不是加强了新增审批门禁的理由。这条决定——不需要审批——连同其理由一起记录在 `packages/science/tool-science/README.md` 中。

## 考虑过的替代方案

- **由每个变更方都追加一个新的 `science/prefix-observed` 事件,而不是做摘要比对。** 已否决:这要求每一个当前和未来会写入共享 prefix 的进程(micromamba,以及用户自己手动执行的 `conda`/`micromamba` 调用)都知道并追加一个 DSH 专有事件,而一次手动调用永远不会这样做。比对 `conda-meta/history` 自身的摘要不需要写入方的任何配合。
- **对 prefix 建立文件系统监视,只在会话开始时检查一次。** 因两点被否决:在绑定时建立一次的监视,会漏掉在监视建立之后、但在受影响的那次 run 本应由逐次检查捕捉到之前就已完成的变更;而每个会话都持有一个长期存活的监视句柄,会随并发绑定的会话数线性增多,却没有比"每次 run 做一次 stat"更多的收益。
- **在每次 `startRun` 都重新跑一遍完整的 `observeProfile` 探测,完全跳过廉价的摘要步骤。** 已否决:`observeProfile` 每次调用都会为每种已绑定语言各起一个真实子进程,这会让即使什么都没变的每一次 run 都多付出两次进程启动的代价——摘要检查存在的意义正是让常见的"无漂移"情形只花一次 `stat`+`readFile`。
- **让漂移检查也像 `installPackages` 一样,把重新探测得到的 `invalid` revision 落库。** 已否决:`bindEnvironment` 在会话有过任意一次 run 之后就拒绝重新绑定,这会把"prefix 现在正忙"这种暂时状态,变成一个永久死掉的会话——这正是本次修复要消除的那种失败模式本身。
- **先重新探测,只有在确认要重新绑定时才物化 scratch。** 已否决:这会让重新探测所驱动的探测或安装在没有 scratch 目录支撑的情况下运行,并且把 `materializeSessionScratch` 本已幂等的工作推迟到一个不管漂移前的路径是否已经创建过 scratch,都还要再跑一次的时间点。
- **把本次改动的范围扩大到:会话运行期间发生漂移时也刷新桌面端的 `applied.json`。** 在本次 PR 中已否决:这会改变桌面端自己的磁盘准备约定,这是一个独立于 Runtime 会话内漂移检测的决定,并入本次改动会把一个不相关的面耦合进这次修复的评审与回滚单元里。
- **把本次修复顺带做成给 `install_science_packages` 加一道审批门禁。** 已否决:该工具的审批状态在本次改动之前就已经是一个悬而未决、未被记录的问题;漂移修复让这个工具的副作用对其它会话变得可见,而不是让它变得更危险,因此这本身不足以构成新增门禁的理由。既有的"不需要审批"行为按原样记录并附上理由,而不是被改变。

## 后果

每一次 `run_python`/`run_r` 调用现在都会为每种已绑定语言对 `conda-meta/history` 多付出一次 `stat`+`readFile`,发生在既有的 `assertIdleAppliedEnvironment` 与 scratch/profile 相关工作之前。共享 prefix 在会话运行期间发生漂移的会话,其下一次 run 要么在一次不可见的重新绑定之后成功(内核重启,原因是 `environment-rebound`,与 `run_python`/`run_r` 为其它所有重启原因已经使用的措辞完全一致),要么在 prefix 当前不可用时以 `ENVIRONMENT_NOT_READY` 响亮失败——绝不会针对一份过期绑定悄悄继续执行。`conda-meta/history` 只记录 conda/micromamba 的事务:在产品之外对共享 prefix 手动执行的 `pip install` 或 `install.packages()`,不属于 conda 自身的事务日志,不会被这一机制检测到;这一缺口记录在 `packages/science/science-runtime/README.md` 的 Known Limitations 中,替换了它此前"按 run 而非按 import 检测"这条说明的旧版本。

## 测试

`packages/science/science-runtime/tests/environment.spec.ts` 覆盖 `prefixHistoryDigest`:内容不变时摘要稳定、内容变化后摘要不同、history 文件缺失、history 是目录;同时保留了既有 `staticInterpreter` 的 TOCTOU 覆盖,做法是把这次重构拆分出的 `stat` mock 与 `identityStat` 故障挡位一并纳入共用夹具。`packages/science/science-runtime/tests/drift.spec.ts`(新增)针对 `tests/harness.ts` 的夹具驱动真实的 `startRun` 调用,并在两次调用之间在磁盘上改写 `conda-meta/history`:覆盖 Python 侧漂移触发重新绑定并以严格递增的 epoch 和 `environment-rebound` 结束原因重启内核;对 R-only profile 重复同样的用例,以确认确实经过了 `selectBinding` 的语言选择;覆盖无漂移时不重新绑定、不重启(epoch 不变);覆盖漂移之后 prefix 变得不可用时以 `ENVIRONMENT_NOT_READY` 拒绝,同时断言没有追加新的 `science/environment-bound` 事件(即 B8 的回归锁);以及 history 是目录时走的是与"文件缺失"相同的漂移路径,而不是抛出未分类异常。`packages/science/tool-science/tests/tool-science.spec.ts` 新增一条基于真实 prefix 改写的测试,证明 `formatRunResult` 输出的 `kernel restarted (environment re-bind)` 一行,在"漂移由别的会话安装引发"时同样出现,而不只出现在此前已覆盖的"手动追加的 rebind"场景中。无密钥的 `science-tools` headless 快照(`examples/headless-agent`)不受影响:其夹具只在绑定时写入一次 `conda-meta/history`,此后从未改写,因此绑定时记录的摘要与 `startRun` 此后每次读到的摘要在整个场景中始终相等,该场景里已经录制的 `environment re-bind` 措辞依然只来自 `installPackages` 自身的 revision 递增——该测试已实际运行并通过,作为证据。
