# Agent Note: The same-id conflict test's tracked-stdin fixture dropped `KernelProcess`'s own `stdin.on` call

Status: implemented
Archived: 2026-09-10

[English](2026-09-07-kernel-set-conflict-fixture-stdin-listener.md) | 中文

## 问题

`kernel-set.spec.ts` 的 `discards the losing kernel through EXIT/quiesce after a same-id byId conflict, never leaving it running unregistered` 测试确定性失败(在空闲机器上复现 3/3,每次约 3 秒):`expect(fulfilled).toHaveLength(1)` 看到的是空数组。两个并发的 `acquire()` 调用都被拒绝了——预期的败者按设计以 `KernelSetConflictError` 拒绝,但预期的胜者却在 `KernelProcess` 的构造函数里(`kernel-process.ts:320`)抛出了 `TypeError: this.stdin.on is not a function`。

测试自身的 `wrapTrackingKernelSpawns` 辅助函数(2026-09-06 在 `2dd0ad1a7b` 中随本测试一起加入)会给每个被追踪的 spawn 的 handle 替换一个伪造的 `stdin` 对象,只暴露 `write`(用来统计 `EXIT` 帧):

```ts ignore-check
const trackedStdin = {
  write: (chunk: string) => { ... return realStdin.write(chunk) },
} as unknown as NonNullable<SubprocessHandle['stdin']>
```

`KernelProcess` 的构造函数自 2026-09-03(`5719e6c597`,比这个 fixture 早三天)起就无条件调用 `this.stdin.on('error', ...)`,用来捕获同步 `write()` 的 try/catch 观察不到的异步 EPIPE。这个 fixture 从未考虑到这个已经存在的调用:任何经由被包装的 subprocess 生成的真实内核都会在自己的构造函数里崩溃,与该测试本要验证的同 id 冲突逻辑无关。`KernelSet` 真正的冲突检测与丢弃行为(`syncBusyRegistration`、`discardUnregisteredKernel`)从未出错——出错的是 fixture 伪造的 `stdin`。

## 决定

`trackedStdin` 现在也把 `on` 原样转发给真实 stdin,与被追踪的 `write` 并列:

```ts ignore-check
const trackedStdin = {
  on: (event: string, listener: (...args: unknown[]) => void) => realStdin.on(event, listener),
  write: (chunk: string) => { ... return realStdin.write(chunk) },
} as unknown as NonNullable<SubprocessHandle['stdin']>
```

没有改动任何产品代码,也没有放松任何断言:测试自身的三处断言(`fulfilled`/`rejected` 的数量、`rejected[0]?.reason` 是 `KernelSetConflictError`、`spawnCount()` 达到 2、`exitWriteCount()` 达到 1、胜者的内核能执行一次真实的 run、`disposeAll()` 干净地 settle)全部未变,现在全部通过,原因是胜者的内核终于能够正常构造了。

## 考虑过的替代方案

- **对真实 `stdin` 做展开、只覆盖 `write`**(`{ ...realStdin, write: tracked }`)。已否决:`Writable` 的 `on`/`write` 等方法挂在其原型链上(`EventEmitter.prototype`),不是流实例自身的可枚举属性,对流实例做一次普通对象展开会悄悄丢掉它们——这会重现 fixture 原本那个缺失 `on` 的一模一样的失败。
- **放松测试,不要求胜者真正构造出一个 `KernelProcess`**(例如给胜者换一个假的 process)。已否决:这个测试的全部意义就在于通过真实的 `KernelProcess`/`KernelSet` 连线来断言真实的 subprocess/EXIT 帧行为(`spawnCount`、`exitWriteCount`、胜者执行一次真实 run)——伪造胜者会让测试不再覆盖这个缺陷所在的真实构造路径。

## 后果

该测试现在确定性通过(目标用例重跑 5/5;`kernel-set.spec.ts` 全文件以及 `packages/science/science-runtime` 整个套件不受影响)。`wrapTrackingKernelSpawns` 对 stdin 的替换现在与 `wrapWithUnprovenQuiescence` 已有的模式一致:除了要拦截的部分,其余原样转发。

验证这次修复时观察到一个独立的、预先存在的 flake:`lifecycle.spec.ts` 的 `quarantines a same-ID successor until an in-flight run's lease settles` 只在全套件并发负载下失败(单独运行 3/3 都通过),伴随一个 `settlePublishedKernelRun`(`index.ts:2043`)里无关的未处理 rejection。此项不在本任务范围内——不是本任务书三处门禁债之一,也不像本次修复的测试那样能在单独运行时复现。
