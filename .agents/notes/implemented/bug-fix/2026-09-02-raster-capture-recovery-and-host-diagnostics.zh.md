# Agent Note: 可恢复的栅格声明与 Desktop Host 诊断

Status: implemented

[English](2026-09-02-raster-capture-recovery-and-host-diagnostics.md) | 中文

## 问题

默认的声明式栅格策略会刻意跳过写入它的那次 run 未在 `raster_artifacts` 中指名的 PNG，但模型可见结果此前只会指出遗漏。即使文件仍留在已保留的 run 输出中，后续 `annotate_artifact` 调用也只会报告未知 artifact。两种结果都没有说明可直接执行的恢复方式，因此模型可能反复调用 annotation，却始终无法登记 PNG。

Desktop 在启动 Host 后会丢弃其 stderr。因此捕获、图表抽取、provider 与 boot 诊断在失败后都不可用；若不设上限、不做脱敏就持久化原始 stderr，又可能泄漏凭据并无限增长。

## 决策

### 通过重新运行生产代码恢复未声明的栅格图

本方案扩展 [`rasterCapture: 'declared'` 策略](../feature/2026-08-27-artifact-identity-stability-and-raster-capture-policy.zh.md)，但不改变其默认值。每次 `run_python` 或 `run_r` 都会获得一个新的私有 artifact 目录，因此后续一次空 run 看不到也无法捕获上次 run 的 PNG。跳过栅格图的结果现在会给出对应语言的工具、精确的 `raster_artifacts` 数组，以及必须重新运行写出该文件的代码这一要求。

当 `annotateArtifact` 无法从 session projection 解析逻辑名时，它会使用捕获遍历既有的安全路径规则，从新到旧检查各个保留 run 的 artifact 目录。找到同名合格 PNG 时，只有 `ARTIFACT_NOT_FOUND` 消息会改变：它会指示调用方重新运行写出代码、声明该路径，然后再次 annotation。这项诊断只读取路径元数据，从不读取或导入文件字节、改变 project artifact store，或改变 annotation 只操作元数据的含义。诊断遍历失败或不可用时，会退回普通的未知 artifact 错误。

### 持久化有界且已脱敏的 Desktop Host stderr

Electron carrier 会通过串行轮转 writer 把 Host stderr 写到 `<dshHome>/logs/host.log`。`resources/host.json` 是严格、带版本的配置，包含经过校验的 `logMaxBytes` 与 `logMaxRotatedFiles` 字段；随应用发布的值保留一个 5 MiB active file 和两个编号轮转文件。目录与文件均为私有；symlink 与非普通文件会被拒绝；整行在落盘前脱敏；大于 active-file 上限的一行会改写成固定省略标记。脱敏覆盖 Host environment 中凭据类名称对应的精确值，以及常见的 bearer、API key、authorization、credential、password、secret、token 与 `sk-…` 形式。

日志始终是运维诊断信息，不是应用协议，也不会进入 renderer。启动与端口 fallback 仍只依赖 readiness line 和退出状态；自由格式 stderr 从不改变启动决策。

启动失败或异常退出结果不再依赖 stderr drain 先行结束才能被报告：该 drain 只在管道写完（EOF）时才算完成，而继承了 Host stderr 文件描述符的孙进程(以 `stderr: 'inherit'` 派生的 subagent 进程)可能在 Host 自身已退出后仍长期占住该管道。`HostProcessSupervisor` 的退出处理让 drain 与一个有界等待(`EXIT_LOG_DRAIN_TIMEOUT_MS`,`apps/desktop/src/host-process.ts`)赛跑,无论哪方先完成都会继续,因此即使有孙进程存活,启动失败也仍会及时 reject,而不是让 Electron 停在一个没有错误页的空白窗口上。错误页本身(`apps/desktop/src/error-page.ts`)现在会在每次渲染失败时,在消息旁给出已解析的 `<dshHome>/logs/host.log` 路径,使遇到不透明退出码的设备测试者无需了解 Harness home 目录结构也能找到日志。

## 考虑过的替代方案

**通过后续一次空 run 捕获上次 run 的 PNG。** 否决，因为按 run 隔离的 artifact 目录有意明确输出所有权。复用旧目录会削弱该所有权，并把登记 run 未生产的字节归给它。

**从 `annotate_artifact` 导入文件。** 否决，因为 annotation 只策展已提交版本的元数据。暗中新增内容版本会把生产与策展合并到同一工具调用下，并掩盖生产者溯源。

**把 Desktop overlay 改为 `rasterCapture: 'always'`。** 留待用户裁决。它不再依赖模型声明，但也会把自查图与 debug render 接纳进 project library。保持 `'declared'` 延续既有的噪音控制策略，而新的结果与 annotation 诊断让恢复步骤可直接执行。

**持久化原始 stderr，或只保留带 Science 前缀的行。** 原始输出不安全且无界；只筛选 Science 会漏掉诊断 Host 为何无法 ready 所需的 boot 与 provider 失败。有界脱敏能够保留跨子系统诊断，同时不暴露已知凭据格式。

## 后果

未声明的 PNG 在一次新的 run 真正写出并声明它之前，仍不会进入 artifact store。即时 run 结果与后续 annotation 尝试都会告诉模型如何执行该 run，keyless Science snapshot 也记录这段恢复文本。本方案不改变 session event、SDK 字段、图表捕获判别字段或 UI 状态。

Desktop 失败后会在 Harness home 中留下有界的诊断记录。轮转与脱敏是确定且经过测试的，但脱敏无法证明已经识别所有可能的 secret 格式；Host 组件仍不得打印凭据。随应用发布的 Host 配置缺失或无效时会使启动失败，而不是静默取消上限。

supersession audit 发现 [Desktop Host launches on its last bound port](2026-09-01-desktop-host-port-persistence.zh.md) 中有一条陈旧陈述：stderr 现在会为诊断而保留。该笔记的端口与 readiness 决策仍适用，因此继续保持 active，并更新这条陈述以链接到本文。此前的栅格策略笔记同样继续作为为何默认采用声明式捕获的权威；本文只增加恢复行为，不取代它。
