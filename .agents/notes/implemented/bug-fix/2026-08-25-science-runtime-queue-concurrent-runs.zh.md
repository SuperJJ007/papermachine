# Agent Note: Science Runtime queues a second concurrent run instead of rejecting it

Status: implemented

[English](2026-08-25-science-runtime-queue-concurrent-runs.md) | 中文

## Problem

一次真实的桌面会话中，模型在同一个 assistant step 里同时发出了 `run_python` 和 `run_r`（"Let me run a quick Python and R sanity check in parallel"）。Python 在 1.4 秒内完成；`run_r` 的工具结果却是 `Error: Science Runtime operation was cancelled`，且完全没有对应的 `science/run-started` 事件。追踪会话日志（`r` 语言的 `science/kernel-state` 已经有了 scratch 目录却没有 `resp.fifo`，说明 `KernelProcess.start` 已经开始又被中止)后,还原出了完整链路: `run_python`/`run_r` 都没有声明 `isConcurrencySafe` 分类器,所以工具调度器(`packages/core/agent-loop/src/tool-calls.ts`)把它们当作两个互斥屏障来处理——`run_r` 的派发,以及它自己对 `ScienceRuntime.startRun` 的调用,要等到 `run_python` 的完整结果提交后才会开始。在这次会话里,一个独立到达的 `session.cancel` RPC(`packages/host/apiproxy/src/api-proxy.ts`,`kind: 'user'`)恰好在 `run_r` 刚开始的内核启动过程中赢得了竞争。

这种互斥调度本身是正确且刻意为之的:`run_python`/`run_r` 会直接对会话做持久变更(`science/run-started`/`science/run-finished`),而并行工具调用的安全契约(`packages/core/tools/src/index.ts` 的 `isConcurrencySafe`,参见 [并行工具调用 Agent Note](../feature/2026-07-10-parallel-tool-call-execution.zh.md))要求返回 `true` 的分类器承诺其调用体不直接变更父级持有的状态——文件写入和 bash 保持互斥的原因与此相同。会话日志自身的 fold 也在硬性强制"一个会话里同一时刻只能有一个 Science run 在运行"(`packages/science/science-session/src/transition.ts` 的 `applyRunStarted`),因此跨语言的真正并发内核*执行*在不改动持久化格式的前提下并不可行。

但进一步排查这次交互后,发现了一个真实、独立的缺陷——无论这次事故本身是否是一次正当的外部取消:`ScienceRuntime` 的 `LeaseRegistry`(`packages/science/science-runtime/src/lifecycle.ts`)是一个不排队的、会话级互斥锁。任何在另一个 Runtime 操作已经持有同一 Session 租约期间到达 `startRun`(或 `bindEnvironment`/`annotateArtifact`)的调用方都会立刻收到 `RUNTIME_BUSY` 拒绝(`packages/science/science-runtime/tests/run.spec.ts` 中原来的 `rejects a second concurrent run with RUNTIME_BUSY` 测试,现已重写)——而不是排队等待轮到自己。一个真正并发到达的第二个 `startRun` 调用——无论来自重试、第二个发起方,还是未来的调度改动——会被直接拒绝,而不是在第一个让出之后获得一次真正的机会。

## Decision

`ScienceRuntime.startRun` 现在调用新增的私有方法 `reserveQueued(session, signal)`,而不再直接调用 `reserve`。`reserveQueued` 在循环中重试 `reserve`;遇到 `RUNTIME_BUSY` 时,它通过新增的 `LeaseRegistry.blocking(session)` 访问器读取正在阻塞的租约,并等待该租约自身的 `settlement` promise(与调用方的 `signal` 中止事件竞速)后再重试。每次重试都会构造一个全新的 `OperationControl`,因此排队中的调用方自身的操作截止时间是从它真正取得租约那一刻开始计算的,而不是从它开始排队时算起。排队期间 `signal` 中止,或 Runtime 在排队期间开始销毁,都会立即拒绝——分别报告 `OPERATION_CANCELLED` 或 `SERVICE_DISPOSING`——且不会构造任何 `OperationControl` 或触碰任何租约,因此一个仅仅在排队中就被取消或被抢占的调用方永远不会启动任何东西。

`startRun` 对环境的读取以及它自身对"已有运行中的 run"的持久化检查,从租约保留之前移到了之后:它们现在读取的是租约真正获批那一刻的**最新**投影,而不是排队前的快照,因为一个排队等待过另一个 run 的调用方,轮到自己时手上的状态早已过时。持久化的"已有运行中的 run"检查(`projection.runs.some(status === 'running')`)依然会立即抛出 `RUNTIME_BUSY` 而不是排队——如果在租约已经空闲的情况下还遇到这个检查,说明这是一个在 Host 重启、Session 重新挂载之前的崩溃遗留下来的孤立 run,而不是 `reserveQueued` 已经解决的进程内竞争;这种情况没有什么可等待的。

`bindEnvironment` 和 `annotateArtifact` 未作改动:它们依然调用普通的 `reserve` 并立即拒绝 `RUNTIME_BUSY`。它们是罕见的、会话级的操作(绑定只在任何 run 存在之前发生一次;annotate 只是元数据操作),不是这次修复要解决的 run 与 run 之间的竞争。

## Alternatives considered

**把 `run_python`/`run_r` 标记为 `isConcurrencySafe`。** 已否决:它们会直接对持久化的会话状态做变更(`science/run-started`/`-finished`),而并行工具调用的安全契约把 `true` 保留给调用体不直接变更父级持有状态的工具——bash 和文件写入保持互斥的原因与此相同。这样做还会让两个同语言的调用去竞争 fold 自身"每个 Session 同一时刻只允许一次内核获取"的约束(`kernel-set.ts` 模块文档:`KernelSet.acquire` 假定同一时刻每个 Session 最多只有一次调用在进行中)。

**把租约按 (Session, 语言) 分别作用域,让 Python 和 R 真正并发执行。** 已否决:`transition.ts` 的 `applyRunStarted` 在 fold 层面硬性强制"一个会话里同一时刻只能有一个 Science run 在运行",且与语言无关——这是一个持久化的结构性不变量,而不是内存中调度产生的副作用。放松它属于持久化会话日志格式的改动,超出本次修复的范围。

**保留 `RUNTIME_BUSY` 立即拒绝,只是改进它的提示信息。** 已否决:本次任务的目标是让"真正并发到达的一对调用都能得到结果";即便拒绝信息更清晰,依然剥夺了第二个调用方本应在第一个让出后获得的那次机会。

## Consequences

一个针对同一 Session 真正并发到达的第二个 `ScienceRuntime.startRun`(或与 `bindEnvironment` 相邻的调用)现在会排队并获得一次真正的尝试,而不是被直接拒绝——这与 `run_python`+`run_r` 在同一个 step 中一起发出的场景一致。这次事故本身的取消是一次正当的外部 `session.cancel`,不受此次修复影响——一个在工具调度器已经放行之后被取消的调用方,依然会正确观察到这次取消,只是现在如果取消到达时它还在排队,就完全不会触碰任何租约,更加干净。在当前 `run_python`/`run_r` 仍然是互斥工具调度分类的前提下,`reserveQueued` 的循环在实际中很少真正重试(调度器已经把它们的派发完全序列化了):这次修复的价值在于补上了那些直接绕过该调度器、或并发到达 Runtime 的调用方的缺口,也为未来的调度改动留出余地。

## Verification

`packages/science/science-runtime/tests/run.spec.ts`:`'queues a second concurrent run for the same session instead of rejecting or cancelling it'`(由原先那个断言 RUNTIME_BUSY 拒绝的测试重写而来)不等待第一个调用便驱动两个 `startRun` 调用,并断言两者都成功落定;`'cancels a queued run cleanly, without ever spawning a kernel, when its own signal aborts before its turn arrives'` 固定了租约获取前的取消路径;`'rejects a queued run with SERVICE_DISPOSING, without acquiring a lease, once the Runtime begins disposing while it waits'` 固定了销毁路径;`'lets a Python and R run issued together (Promise.all, no await between them) both complete rather than cancelling whichever is second'` 通过伪造的 Python 和 R 内核端到端驱动了真实的跨语言场景。`packages/science/science-runtime/tests/lifecycle.spec.ts` 新增了对 `LeaseRegistry.blocking()` 的直接覆盖,涵盖精确 Session 映射和同 ID 隔离映射两条查找路径。`packages/science/science-runtime/tests/harness.ts` 新增了 `authorizeConcurrentRuns`,它追加的是一次真实 assistant step 同时发出两个调用时会产生的、共享的一次 `step/start`/`request/header` 加上每种语言各自的 `tool/call` 事实(现有的 `authorizeRun` 每次调用都会开启新的 turn,不适合"一起发出的两个调用"这种场景)。
