# Agent Note: 内核 stdin 的 EPIPE 处理与如实上报的安装超时

Status: implemented

[English](2026-09-03-science-kernel-stdin-error-and-install-timeout.md) | 中文

## 问题

实机验收暴露了 `science-runtime` 的两个缺陷。第一个(9.3)是 `KernelProcess` 构造函数从未为所生成内核的 `stdin` 管道附加 `'error'` 监听器。`subprocess-local` 的裸管道 stdio 没有为该流提供自己的批处理模式监听器,因此一次与内核关闭竞争的写入——最常见的是 `performEnd` 在进程已在退出时发送的 EXIT 消息——会以无监听器的异步 EPIPE 形式出现,Node 会将其转为未捕获异常,导致 Host 崩溃。第二个(8.1)是 `install_science_packages` 用与普通内核调用相同的通用 `timeoutMs` 来限定一次可能耗时数分钟的 micromamba 求解;当截止时间触发、而此时 `OperationControl.cause` 已经锁定为 `'timeout'` 时,`runMicromambaInstall` 会将一个实际上已在宽限窗口内以 exit 0 退出的进程也上报为 `timed-out`,而且每次成功安装都会无条件追加一个新的环境版本、并告知模型该变更"下次运行生效",即便重新运行其实并未安装任何新内容——这会让看到超时的模型重试一次其实已经落地的安装,从而无谓地重启内核。

## 决策

`KernelProcess` 为内核的整个生命周期向 `this.stdin` 附加一个 `'error'` 监听器,与既有的 FIFO 监听器并列;两者都经由共享的 `onStreamError(source, error)` 处理,该函数在 `exitSettled` 之后是空操作,否则会以命名出问题流的 `KernelProtocolError` 调用 `failProtocol`。`performEnd` 自身 EXIT 写入外层的 `catch {}` 从来就只覆盖同步抛出;本次修复所处理的异步 EPIPE 由新监听器捕获,而非该 catch 块,代码注释现已如实说明这一点。

`installPackages` 现在用新增的 `installTimeoutMs` 配置字段(默认 900_000 毫秒,上限 3_600_000 毫秒)来预留其 `OperationControl`,而不再使用共享的 `timeoutMs`(上限 600_000 毫秒);桌面端 overlay 将其设为 3_600_000 毫秒,与 Host 自身为 micromamba 工作给出的置备时限一致。`runMicromambaInstall` 现在先检查进程是否已完成、无信号、以 exit 0 结束,再检查 `control.cause`:即便 control 早已锁定 `'timeout'`,一次在截止时间的 SIGTERM 宽限窗口内完成的求解仍判定为 `success`;只有未能成功完成的进程才会依据该 cause 被判定为 `timed-out` 或 `cancelled`。一次成功运行之后,`installPackages` 会重新观测环境,并用新增的 `sameInstalledBinding` 检查将观测结果与当前绑定比较——它把 `sameObservation` 既有的指纹比较(身份:种类、可执行文件、版本)与显式的 `packagesSha256` 比较组合起来,因为 `bindingFingerprint` 本身就刻意排除了包哈希。若无变化,则针对当前版本上报 `status: 'success'` 且不追加新版本;若有变化,则一如既往追加新版本。两条分支现在都返回一个模型可读的 `environmentChanged: boolean` 字段,`tool-science` 的 `formatInstallResult` 仅在其为真时渲染"已应用……下次运行生效",为假时渲染"未变化……不会重启内核",并新增一条 `timed-out` 分支,告知模型环境可能已部分或全部写入,建议先检查状态或尝试导入包,再决定是否重试,且至多重试一次。

## 考虑过的替代方案

**用 try/catch 包裹每一次 `stdin.write` 调用,而非使用流监听器。** 被拒绝:管道损坏时 `write` 的失败是通过 `'error'` 事件异步呈现的,而非 `write` 本身的同步抛出,因此调用点的 try/catch 无法观测到它。

**仅依据 `control.cause` 判定 `timed-out`,把冗余重试问题留给提示词引导解决。** 被拒绝:工具结果本身已经具备如实说明"未发生变化"所需的全部事实;仅靠措辞引导重试,既不会上报上一次运行的静默成功,也无法阻止模型凭直觉重启内核。

**仅用 `sameObservation` 检测无操作安装。** 被拒绝,配套测试表明它检测不出包变化:`sameObservation` 比较的是 `bindingFingerprint`,其自身的 JSDoc 就明确排除了 `packagesSha256`(身份与实际安装了什么包是独立的,这是有意设计)。检测冗余安装需要显式使用包哈希,并与指纹的身份检查组合。

**给 `installPackages` 一个硬编码在 `install.ts` 里的专属超时常量。** 按照"不在插件中硬编码可调参数"的约定被拒绝:随部署变化的时长是经校验的 `Config` 字段,而非源码常量;`installTimeoutMs` 走的是与 `timeoutMs` 相同的 `resolveConfig`/`assertKnownKeys` 路径。

## 后果

内核 stdin 管道在关闭期间或之后关闭,不再导致 Host 崩溃;`end()` 仍会 resolve,若有调用方仍在等待一次活跃操作,失败会经由既有的 `failProtocol` 路径呈现,而不是变成未捕获异常。`install_science_packages` 现在最多可运行一小时才会被判定超时,而不是共享的、以分钟计的 `timeoutMs`;一次恰好在截止时间触发后完成的运行会被如实上报为成功,而不是虚假的超时。模型在一次确属冗余的安装后重试,会看到 `environmentChanged: false` 且没有新版本,因此第二次相同的安装不会再重启内核;模型在一次真正超时后重试,会被告知环境可能已部分写入,应先验证再重试。三处既有的伪造测试基座——`science-runtime` 的 `ControlledSubprocess.packagesOutput`、共享的 Python/R 前缀伪造件,以及 headless-agent 的 `prepareScienceFixture`——此前无论"安装"调用做了什么,都返回静态包清单,因此针对它们编写的测试在不知情的情况下一直在测试冗余安装路径;现在三者都改为依据伪造安装器写入的标记文件来决定伪造输出,受影响的那一份 keyless snapshot 基线(`stream-json.expected.jsonl`)也已相应刷新。

## 测试

`kernel-process.spec.ts` 新增了对携带与不携带真实 `Error` 的 stdin 流错误的分类覆盖、对与 `performEnd` 自身 EXIT 写入竞争的 EPIPE 形态 stdin 错误绝不会变成未捕获异常的覆盖(通过监视 `process.on('uncaughtException', …)`),以及对内核已退出后到达的 stdin 错误被忽略的覆盖;该文件全部 48 个测试通过,改动代码行分支覆盖率 100%。`install.spec.ts` 新增一个用例:一次零退出码、无信号的落定在截止时间已将 `control.cause` 设为 `'timeout'` 之后才发生,断言结果仍为 `success`;全部 37 个测试通过,`install.ts` 语句/分支/函数/行覆盖率均为 100%。`environment.spec.ts` 新增了 `installTimeoutMs` 配置边界覆盖(默认值、最小值、最大值、拒绝非法值,以及与 `timeoutMs` 自身边界的相互独立),并将 `installPackages` 的成功测试拆分为清单确实发生变化的用例(`environmentChanged: true`,追加新版本)与冗余用例(`environmentChanged: false`,不追加新版本);全部 84 个测试通过。`tool-science.spec.ts` 覆盖了 `formatInstallResult` 的两种措辞与新增的 `timed-out` 引导文案,并重写了安装工具的成功测试,改为安装一个伪造环境中原本不存在的包;全部 140 个测试通过。

## 遗留事项

`packages/extensions/tool-cordis/src/api-catalog.ts` 中 `installPackages` 目录条目的文本已更新以匹配条件式版本追加行为,但本次改动未为其单独编写测试覆盖;它与 `tool-science.spec.ts` 已覆盖的 `tool-science` schema 保持一致。
