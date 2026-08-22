# Agent Note：持久化的按语言 kernel 取代一次性 Python/R 执行

Status: implemented

[English](2026-08-20-science-persistent-kernel.md) | 中文

## 问题

Claude Science 会让 interpreter 状态在同一 session 内跨越多次 `run_python`/`run_r` 调用而保持存活：变量、import 与 inline package 安装(`pip install`、`install.packages()`)会一直持续，直到 kernel 因 idle timeout、environment rebind 或 session 结束而终止。一次性、每次 run 都新建 process 的执行模型无法表达这一点：每次调用都从一个空白 interpreter 开始，用户会眼看着每一个更早的赋值在两次调用之间消失，也没有任何持久化事实记录过某个 kernel 曾经存在过或结束过。

用户配置的 Conda prefix 不能被假定包含任何 notebook-kernel 依赖，而 Runtime 也不会向 prefix 内安装任何东西。因此 kernel 必须在零新增依赖的前提下运行，处在与一次性 process 相同的 full-enforcement sandbox 之内，同时还要为模型与每一个后续读者提供一份持久化、可重放的记录：某个 kernel 何时启动、何时结束、因何结束，以及哪些 run 共享了它的内存。

## 决策

本笔记拥有 kernel process、其 wire protocol、其持久化生命周期词汇，以及每一项依赖 kernel 能跨越单次 run 存活的 runtime 行为。[Science Session 决策](../feature/2026-08-15-dsh-science-v01-r1-science-session.zh.md)继续拥有本笔记自身事件所遵循的持久化事件与 replay 机制；[Science Runtime 决策](../feature/2026-08-15-dsh-science-v01-r2-science-runtime.zh.md)继续拥有该折叠 service 的配置严格性、prefix 观测，以及本笔记扩展而非取代的 exact-Session lease 与 quarantine 机制——本笔记只取代了它关于一次性执行机制的那些段落，并已就地改写为指向这里。

### kernel process 与 wire protocol

一个 kernel 是每个 `(session, language)` 对应一个的长生命周期 confined subprocess：`kernel_python.py`，只用 Python 标准库，在 `python -B -u -X utf8` 下运行(不带 `-I`：去掉它是为了让 inline `pip install` 的 user-site 回退能在该 kernel 内被 import——见 [kernel 范围 inline install 的 Agent Note](2026-08-22-science-kernel-scoped-inline-installs.zh.md))；`kernel_r.R`，只用 base R(不用 `jsonlite`，与 R package-inventory probe 自身的 TSV 选择一致)，在 `Rscript --vanilla --encoding=UTF-8` 下运行。两者都作为包资产随包发布在 `packages/science/science-runtime/assets/` 下，由一个小模块相对其自身的 `import.meta.url` 解析，因此无论从 source 还是从 built 产物执行，解析结果都正确。两个 driver 都不需要 `ipykernel`/`IRkernel` 这类 notebook-kernel package——这是用户配置的 prefix 无法保证满足的假设——而 Jupyter 的 ZMQ transport 会与 sandbox 默认拒绝的网络策略冲突。每个 driver 都改为在一个持久化命名空间中执行 source(Python 中是一个 module-level 的 globals dict，R 中是通过 `source()` 作用于 global environment)。

协议由三条通道承载，全部位于 sandbox 的可写 scratch 或标准 stdio pipe 之内：host 把单行、以 tab 分隔的请求写入 kernel 的 stdin；driver 把单行响应写入一个 response FIFO，该 FIFO 由 host 在 spawn 之前用 POSIX `mkfifo` 可执行文件在 kernel 自己的 scratch 目录中创建(之所以用 FIFO，是因为 base R 既不能打开 Unix domain socket，也不能 `dup2` 一个文件描述符，而 sandbox 又彻底拒绝 TCP)；一次 run 的 stdout/stderr 会写入请求所命名的 per-run 捕获文件，而不是 kernel 自身的 stdio。source 按路径而非按值传递——host 会在提交前把该 run 精确的 UTF-8 source 写入 run directory，driver 则对该文件执行 `exec(compile(...))` 或 `source()`，复用的正是一次性 run 一直在用的那套 source-flush 机制。

Python 在文件描述符层级重定向一次 run 的输出(`os.dup2`)，因此 C 扩展与子进程的写入都会落入正确的捕获文件。R 只在 `sink()` 层级捕获：R 层面的 `print`/`cat`/`message` 输出会被正确归属，但 C 层面或子进程的写入会绕过 `sink()`，落入 kernel 自身长生命周期、有界的 stdout/stderr collector，永远不会归属回任何一次 run。当 driver 检测到自己无法完整恢复或归属某次 run 的捕获时，它的响应 frame 会携带一个降级标记，该 run 的 terminal event 则携带 `outputDegraded: true`；该 run 自身的 result 依然成立，只是其捕获的 tail 可能不完整。

两个 driver 都针对只有当 kernel 存活超过单次 run 才会显现的崩溃路径做了加固。Python 在每次重定向与恢复前后，把 `sys.stdout`/`sys.stderr` 重新绑定为 `closefd=False` 的包装对象，因此用户代码调用 `sys.stdout.close()` 不会杀死 kernel 自身的 I/O。R 在每次 push 之前记录 `sink.number()`，并把每次 pop 都包在 `tryCatch` 中展开，因此用户调用 `close(stdout())` 或不成对的 `sink()` 都不会打乱下一次 run 的输出路由。R 的中断处理与 Python 存在一处硬性的不对称：`tryCatch(interrupt = ...)` 能可靠捕获 `Sys.sleep()` 期间与 CPU 密集循环中送达的 `SIGINT`，因此 run 进行中的中断是安全的；但一次 idle 状态下的 `SIGINT` 要么直接杀死 R process，要么被闩锁并使紧接着的下一次 run 被误判为 interrupted——R 没有像 Python 那种"默认忽略、仅在 `exec` 期间生效"的 idle-safe handler。下文的中断规则正是为了让这个 idle 时段的隐患变得不可触达而存在。

每个 kernel 都在与一次性 process 所需相同的 `workspace-write` sandbox 策略下 spawn——full enforcement、prefix 只读、空的 subprocess environment base、owned `HOME`/`SCIENCE_STATE_DIR`——并在 kernel 的整个生命周期内保持，而不是每次 run 都重新套用；只有 `TMPDIR`/`SCIENCE_ARTIFACT_DIR` 是 driver 自己针对每个请求设置的 per-run 值，因为一个 process 要服务 kernel 整个生命周期内的每一次 run。

### 生命周期、epoch 与 kernel 终止

每个 `(session, language)` 至多存在一个 kernel——Python 与 R 的 kernel 可以共存——在第一次需要它的 run 上惰性启动。`kernelEpoch` 是一个跨两种语言严格单调的 session-local 计数器，从持久化 projection 自身的水位线分配，而不是仅存在于内存中的状态，因此它能在 Host 重启后存续；两次 run 共享同一个 epoch 就意味着共享了 kernel 的内存态，而一次 run 所命名的 epoch 若早于另一次，就说明它从未见过后者产生的结果。一个专门的 kernel-set registry 拥有每一个存活的 kernel，以精确的 `Session` object 为键，与既有的 per-operation lease registry 并行：run 仍然通过那个 lease 保持串行，与之前完全一样，但 kernel 是一项被持有的资源而非一次 operation，因此持有 kernel 本身不会让某个 session 的 lease 进入 busy 状态。

kernel 会因一组封闭原因之一而终止，在每一处被消费的地方都被穷尽地 switch 处理：`idle`(idle timer 触发，且自上次重置以来再无 run)、`session-end`(所属 session 已 detach)、`environment-rebound`(该 kernel 语言存在更新的 applied environment revision)、`run-escalation`(一次被中断但未被证明的 run 使 kernel 状态未知)、`protocol`(driver 违反了 wire protocol)、`crash`(process 在未观察到协议违反的情况下无指令退出)，以及 `service-disposed`(Runtime 自身关闭)。每条终止路径都会在 process 存活时先发送一次协作式退出请求，随后套用 Runtime 其余部分早已用于 process teardown 的同一套限时等待/`terminate()`/限时等待/最终静止保留的升级流程；同 ID 的后继 session 会保持 quarantine，直到此前那个生命周期拥有过的每一个 kernel 都被证明已经静止，复用的是既有的 quarantine 机制而非另建一套。两个同 ID 的 registry entry 并发竞速 spawn 时，最终仍只会得到唯一一个存活且可获取的 kernel：落败一方自己的 kernel 会走过完全相同的协作式退出/静止路径，而不会在 kernel-set 的 teardown 纪律之外以未注册状态继续运行。idle timer 在每次 run 完成时重置，并在 run 进行的整个窗口内——从 kernel 获取直到该 run 自身的 terminal 提交——被 disarm，因此它永远不可能在 run 进行中触发并杀死一个正忙的 kernel。

### 持久化事件与 fold 的关系集合

一个 `SessionEventMap` 成员，`science/kernel-state`，携带一次完整的 kernel 生命周期转移：`kernelEpoch`、`language`、`state: 'started' | 'exited'`、`reason`(当且仅当 exited 时存在)、`startedAt`(当且仅当 exited 时存在——即所匹配的 `started` fact 自身的 `at`)、`environmentRevision`、`environmentFingerprint`、`at`。两个方向复用同一个 shape 而非一对 started/terminal，因为一条 kernel-state fact 从不重复自己更早那次转移已经固定下来的字段——只有一处刻意的例外。`exited` 方向会重述 `startedAt`，使一个已关闭 kernel 自身的记录永远不丢失其起始时间；如果没有它，读者就无法仅凭这条已关闭的记录回答"这个 kernel 存活了多久"——这是锚定基于 epoch 的状态连续性的自然溯源问题。fold 会断言这个被重述的值等于所匹配的 `started` fact 自身的 `at`，从而把一次错误的重述变成 decode 阶段的拒绝，而不是一次静默的 projection 不一致。

fold 把一条 `exited` fact 与其对应的 open `started` fact 关联起来时，用到的不只是 `kernelEpoch`/`language` 查找：`environmentRevision` 与 `environmentFingerprint` 必须精确匹配，这与 run terminal 自身"terminal 记录绝不就地改写其 start-owned provenance"的 identity 规则相呼应。`kernel.at` 从不超过所在 fold 事件自身的时间，以及 `exited.at >= started.at`，都作为区间事实被强制校验，与已经施加在 run terminal 上的同一类检查一致。`started` 方向额外要求一条 run 早已断言的 environment 关系——该 kernel 的 `environmentRevision`/`environmentFingerprint` 必须能解析到该语言最新的 applied binding——而 `exited` 方向则刻意不受这条"最新 revision"要求的约束，因为一次 `environment-rebound` 退出合法地命名的是一个已经被更新版本取代的 revision；它的身份改由 started-fact 匹配来钉住，而不是靠"是否最新"。

`ScienceRunIdentity` 携带一个必填的 `kernelEpoch`，命名执行该 run 的 kernel 实例——这是让读者或模型自身能够分辨哪些 run 共享过内存的溯源骨架：两次 run 共享同一个 epoch 就意味着共享了状态，而一次 run 的 epoch 若与更早一次不同，就说明它从未见过后者。fold 会拒绝一次命名了从未启动、已经退出，或与其所声称的 kernel 记录 provenance 不一致的 epoch 的 run。

replay 会为在 session 的 end-seed 边界仍处于 `started` 的任何 kernel 派生出一条 interrupted kernel 记录，与一次未匹配的 running run 的处理方式相呼应——Host 重启之后，任何 kernel 都不会被呈现给读者或模型为"正在运行"。这也覆盖了唯一没有 durable `exited` fact 可供派生的路径：在所属 session 已经 detach 之后再结束一个 kernel，其目标是一份永远不会被发布或持久化的内存中 log；因此把该 kernel 为每一个后续读者恢复为 interrupted，正是 replay 的职责。

run→epoch 引用不变量、run terminal 的 `outputDegraded?: true` 字段，以及 kernel-state 事件本身，都是对一个本已 required-on-read 的事件流的新增，因此一个不认识它们的构建版本会拒绝读取包含 kernel 执行的 session，而不是静默地重建出一个不完整的结果。这种拒绝正是每个事件的 `ignorable` 标记所要让其可以安然承受、而无需一次结构性格式升级的场景——参见 [session log 版本决策](2026-08-10-session-log-version-mechanism.zh.md)：该标记默认是 required，一个不认识或不兼容的 required 事件会拒绝整次读取，而这正是"某个字段改变了执行 provenance 的理解方式"时应有的失败模式。整个交付过程中 `SESSION_FORMAT_VERSION` 保持在 `0`：这里的每一处改动都只是 required-on-read 事件上的词汇增长，从未触及 log 的 header、envelope 或 surface mechanism。私有 projection 自身的缓存格式是另一个层级更低、代价更小的版本号，受 session-projection registry 自身规则治理(只要序列化的 state shape 或 fold 语义变化就升版)；它的值是 `8`，随 fold 自身 shape 每次变化而独立递增——先是为了首次携带 kernel list 与 epoch watermark，再随上文关系集合每一次被加固而各自递增一次。

### 中断优先的控制与 taint-retirement

每次 run 仍然携带一个受配置的 per-run timeout 限定的 operation control。在 abort(取消或超时)时，Runtime 会向 kernel process 发送 `SIGINT`，并等待一个固定的宽限窗口(与 Runtime 其余部分早已用于 process-tree 结算的同一个常量)，看 kernel 是否回应它捕获了这次中断。如果是，kernel 就证明了自己干净地恢复并继续存活；该 run 自身的 terminal 完全由触发 abort 的原因决定(`cancelled` 或 `timed-out`)，绝不会因 kernel 的命运而改写。如果 kernel 反而正常结束了这次 run(它自己的代码抢在中断之前完成，或者捕获并吞掉了中断)，或者没有在宽限窗口内回应，它的状态就不再可信：具体到 R，一次 idle 状态下的 `SIGINT` 可能杀死 process，也可能闩锁一个陈旧的中断，从而误判紧接着的下一次 run。Runtime 会在该 run 结算之后结束这个 kernel——一次尽力而为的协作式退出请求、与别处相同的静止升级流程，以及一条 `kernel-state(exited, reason: 'run-escalation')` fact——该语言的下一次 run 会启动一个全新的 epoch。

Runtime 只在 run 进行中才会发送 `SIGINT`：每一条 idle 路径的终止(idle timeout、environment rebind、session 结束、service disposal)都始终使用协作式退出请求，因此 R 的 idle 时段中断隐患永远没有机会触发。正因为这正是让该隐患变得不可触达的原因，retirement 决策与 idle timer 的重新武装都必须在 run 结算的每一条退出路径上存活，包括该 run 自身的 terminal 提交本身被拒绝的那一条：二者都从 run 自身的结果出发、在一个始终会执行的作用域内派生，因此一个 Runtime 已经判定不可信的 kernel 永远不会被留下来供下一次复用，一个挺过了中断的 kernel 也永远不会因为一次无关的提交失败而让它的 idle timer 永久处于 disarm 状态。

一个在 run 进行中无指令死亡、且从未被发送过中断的 kernel，会让该 run 以 `failed` 状态结算，携带一个专门的 kernel-death failure code 与一条 `kernel-state(exited, reason: 'crash')` fact；一次 run 中途的协议破坏会以同一个 failure code、但 `protocol` 这个 kernel-state 原因结算该 run。

### package 常驻性与向 provisioning 的移交

inline 安装不需要任何 Runtime 代码：它们会改变存活的 kernel process 及其可写缓存，并在该 kernel 终止的那一刻消失，纯粹是因为 kernel 是一个真实的持久化 process。environment 级别的安装——通过 micromamba 或任何其他机制产生一个新的 applied environment revision——是另一条工作线的职责；本 Runtime 只实现了那条工作线所依赖的规则：一旦某个语言存在更新的 applied revision，该语言的下一次 run 就会以 `environment-rebound` 结束过时的 kernel，并针对新 revision 启动一个全新的 epoch，无论该 revision 是如何产生的。

这条规则是真实且可验证的，即便还没有生产方：只要该 session 当下没有 run 正在进行，Science Session 的 fold 早已能接纳一个取代更早 revision 的 applied environment revision——这一点通过直接向 durable log 追加一条更新的 revision 并观察 fold 层面的 rebind 得到了验证。真正缺失的是调用方：只要 session 存在任何 run，`bindEnvironment` 自身就仍然会拒绝再次调用，这是一道比 fold 所要求的更严格、且归本 Runtime 所有的 guard。一个 provisioning 实现只需在已存在 run 之后再次调用 `bindEnvironment` 就能触达 `environment-rebound`；因此解除这道 guard——而不是构建新的 fold 层面支持——是让一次真实的 rebind 能经由产品 API 触达所需要做的全部工作。

### 配置、平台范围与错误

两个配置字段治理 kernel 时序，均为可从 `cordis.yml` 更改的、经校验的 safe integer：一个默认 1,800,000ms(30 分钟，与 Claude Science 自身文档记载的默认值一致；范围 60,000–86,400,000)的 idle timeout，以及一个默认 30,000ms(范围 1,000–600,000)的 spawn-to-ready 截止时限。既有的 per-run timeout 保留其含义，并被 fuse 进一次新 kernel 的 spawn 之中：调用方自身的 operation signal 会被送入 spawn 的 `READY` 等待，因此一次 spawn 会以调用方自身的截止时限与 spawn-to-ready 截止时限两者中先触发的那一个为界。交给 subprocess 能力的 spawn spec 本身则刻意不携带 signal，因此该 kernel process 会比启动它的这一次 run 存活得更久。protocol 常量——frame grammar、protocol 版本，以及那个共享的宽限窗口——保持固定：它们描述的是 wire protocol 本身，而不是一个部署层面的选择。

kernel 执行要求 POSIX(一个 FIFO、`SIGINT`，以及 `mkfifo` 这个可执行文件)：仅限 darwin 与 linux。一次 run 会在任何 scratch 或 process 工作之前，就在其他一切平台上以一个专门的 unsupported-platform code 做 pre-publication 拒绝——这与 Claude Science 自身的平台覆盖范围一致，后者本就不提供原生 Windows build。仅为 Windows 保留一个每次 run 都重新 spawn 的 fallback 的方案被拒绝了：与其维护两种持久化语义不同的执行模型，不如坚持一个诚实划定边界的单一执行模型。

拒绝码覆盖了 kernel 自身的各类失败模式：一个专门的 start-failure code，对应 spawn、handshake 或 start 时刻 confinement 的失败，其消息以任务词汇命名语言与 cause class——没有任何 FIFO、stdin、subprocess 或 transport 相关的术语会出现在面向模型或用户的消息中。driver 报告的一次 error 响应会让 run 以 `failed` 状态结算，并携带一个 execution-failure code，彻底取代了一次性模型基于 exit code/signal 的 failure code：一次 kernel run 没有属于自己的 per-run exit code 或 signal，因此 `ScienceRunTerminal` 不携带任何这类字段，面向模型的 run 工具 schema、result 渲染与 state 摘要都与这种缺席保持一致，而不会去宣传一个 kernel run 永远填不了的字段。同一 session 上的 kernel-set 冲突，表现为与 operation lease 冲突相同的那个 busy-session 拒绝；一次 kernel epoch allocator 的 regression 若真的到达调用方——这在正常操作下不应发生——则表现为一次 infrastructure-failure 拒绝。

## 已考虑的替代方案

**采用一个兼容 Jupyter 的 kernel(`ipykernel`/`IRkernel` over ZMQ)。** 已拒绝：用户配置的 prefix 不能被假定包含这两个 package 中的任何一个，Runtime 按设计也不会向 prefix 内安装东西，而 ZMQ 的 transport 会与 sandbox 默认拒绝的网络策略冲突。一个零依赖的 stdlib/base-R driver 不需要这两条假设中的任何一条。

**用 Unix domain socket 而非 stdin 加 FIFO 来传递协议。** 已拒绝：base R 既不能打开、也不能 `dup2` 一个 Unix domain socket，而 sandbox 又彻底拒绝 TCP；FIFO 则是一个 Python 的 `open()` 调用与 base R 的 `fifo()` 都能触达、且不需要任何新能力的普通文件系统路径。

**用一个 process 服务所有语言，或所有 session。** 已拒绝：单个 process 无法同时承载两种不同的语言 interpreter，而把多个 session 路由进同一个 process，会把生命周期与隔离方面的推理从持久化事件流搬进临时拼凑的 in-process state。

**abort 时直接杀死，从不中断。** 已拒绝：这会在第一次超时或取消时就丢弃此前的每一个变量，比它所取代的一次性模型更差而非更好——Claude Science 文档记载的对齐要求，只要 kernel 自身能证明它已经恢复，状态就必须在一次被中断的 run 之后继续存活。

**按语言分别处理 R 的 idle-interrupt 隐患，而不是用一条统一的 taint-retirement 规则。** 已拒绝：这会要求 host 对 interpreter 之间一种真实存在的行为差异建模，而不是套用一条规则——只在 run 进行中才发送 `SIGINT`——这条规则从构造上就让该差异对两种语言都变得无关紧要，host 无需按语言分支。

**把一个 kernel 的 started/exited 转移表示成两个不同的事件类型。** 已拒绝：与 run 不同，一条 kernel-state fact(除了那一处刻意的 `startedAt` 重述之外)从不重复自己更早那次转移已经固定的字段；第二个事件类型不会携带任何这个共享 shape 尚未涵盖的字段。

**让 provisioning 工作线同时拥有 environment-rebound 的 fold 规则与 `bindEnvironment` 的 guard。** 已拒绝：durable log 中的可表达性与"谁来调用 `bindEnvironment`"无关。提前构建并验证好 fold 层面的规则，意味着 provisioning 工作线自身的工作缩减为"再调用一次既有 operation"，而不是"发明一次新的持久化转移"。

## 后果

变量、import 与 inline package 的效果会跨越 `run_python`/`run_r` 调用而存活，与 Claude Science 文档记载的行为完全一致，其代价是：在一个 kernel 的整个生命周期内，每次 run 都会额外多提交至少一条持久化 session event，而 Runtime 会为每个活跃语言持有一个存活的 subprocess，时长取决于 idle timeout 允许的范围，而不再只持续一次 run 的时长。

R 的输出捕获仍然只在 sink 级别：C 层面与子进程的写入会绕过 `sink()`，落入 kernel 自身有界、不被归属的 collector，而不是产生它们的那次 run；与 Python 重定向对齐的 file-descriptor 级别捕获尚未实现。一个 kernel 真实的操作系统 process 状态不会针对 Host 崩溃做对账——replay 总会告诉模型与每一个后续读者，一个在最后一次被观察到的 session 边界上仍处于打开状态的 kernel 并未在运行，但 Runtime 不会进一步核实该 interpreter process 在那次重启前后到底做了什么。这两处缺口在本次交付中都被接受；二者都是各自独立、可日后补上的对账流程，而不是对上文事件或 fold 规则的改动。这两处缺口，连同上文的 provisioning 移交，一并记录在 `packages/science/science-runtime/README.md` 的"已知限制"中。

environment-rebound 规则是真实且可持久化验证的——只要没有 run 正在进行，一个更新的 applied revision 就能干净地折叠——但在 provisioning 工作线解除 `bindEnvironment` 自身"首次 run 之后"的这道 guard 之前，它无法经由任何已发布的产品路径触达；在那之前，只有直接向 log 追加才能验证 fold 层面的这一行为。
