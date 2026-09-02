# Agent Note: 桌面端 Host 在上次绑定的端口上启动

Status: implemented

[English](2026-09-01-desktop-host-port-persistence.md) | 中文

## Problem

`apps/desktop/src/main.ts` 过去每次启动都用 `--port 0` 拉起 Host,导致 OS 每次都分配一个全新端口。端口一变,浏览器 origin 就跟着变,而浏览器端客户端状态在 `localStorage` 里是以 origin 为 key 持久化的——于是客户端 store 持久化的一切内容,在每一次启动时都会被悄悄丢弃,而不仅仅是崩溃或升级之后。用户能看到的症状,就是面板宽度之类的 UI 状态每次打开应用都会被重置。

通过阅读 `packages/client/*/src/**/stores.ts`,而不是凭猜测,确认了究竟哪些 store 真正选择了 `createSnapshotStore`/`defineStore` 的 `persist` 选项,一共六个:details panel 的宽度(`ui-layout`;sidebar 宽度被特意标记为 `transient`,不受影响)、当前 session 选中项(`runtime/sessions/service.ts`)、trajectory-duration 偏好(`ui-trajectory`)、workspace browser 的分组/排序/展开状态(`ui-workspace`)、per-session 的 chat draft 与 view/inspect 选择(`ui-conversation`),以及 Science artifact viewer 的已打开标签页与 library 状态(`ui-science`)。

## Decision

Host 现在会优先在它上一次成功绑定的端口上启动,该端口记录在 `<dshHome>/host-port.json`(`apps/desktop/src/host-port.ts`),写入方式沿用 `environment-binding.ts` 与 `custom-environment.ts` 各自 pointer 文件所用的同一个 `writeFileAtomic` 模式。`apps/desktop/src/host-launch.ts` 的 `launchHostOnRememberedPort` 会在每次启动前读取这份记录;首次启动尚无记录时,直接请求 `0`。

Host 在上报 bind 失败时,不会给这个 carrier 留下任何可与其他启动失败区分开的信号。`WebServer` 的 `[Service.init]`(`packages/host/webserver/src/index.ts`)在 `listen` 遇到 EADDRINUSE 时会让它的 Cordis fiber 失败,使 boot 在打印 readiness line(`dsh web: …`)之前就失败;`HostProcessSupervisor.start()`(`apps/desktop/src/host-process.ts`)看到的只是子进程在 readiness 之前退出——这与一个无关的 boot 错误具有相同的协议结果。carrier 现在会持久化有界且已脱敏的 stderr 供人诊断，但不会把自由格式诊断文本当作启动协议解析；参见 [Recoverable raster declarations and Desktop Host diagnostics](2026-09-02-raster-capture-recovery-and-host-diagnostics.zh.md)。因此 `launchHostOnRememberedPort` 不去诊断失败原因:在一个非零的记忆端口上启动失败,会被重试恰好一次,改用 OS 分配端口(`0`)。

之后被记住的端口,永远是从 ready 的 loopback URL 上读到的、Host 实际上报的端口,而不是当初请求的那个;这两者恰好在本方案要处理的 fallback 情形下不同——记住"请求过的端口"会导致永远记住一个不可用的端口。读写这份记录都不会阻塞或使启动失败:`readRememberedHostPort` 会把缺失、不可读或损坏的 `host-port.json` 退化为 `undefined`(即请求 OS 分配端口),而不是抛出;`writeRememberedHostPort` 在一次原本成功的启动之后写入失败时,只会记录日志并吞掉错误,而不会向外传播。这与 `environment-binding.ts`、`custom-environment.ts` 在文件损坏时 fail loud 的做法刻意不同:那两者守护的是一个正确性事实(session 绑定到哪个 environment),而 `host-port.json` 只守护一个体验层面的优化(origin 稳定性),因此退化除了丢掉这项优化之外没有任何代价。

## Alternatives considered

**固定写死一个端口。** 按设计要求被否决:它会把任何冲突——另一个进程占用了该端口,或已有一个 PaperMachine 实例在运行——变成一个没有 fallback 的硬失败,比原来的 bug 还糟。

**在决定是否重试之前,先区分 EADDRINUSE 与其他 Host boot 失败。** 目前从 carrier 这一侧做不到:Host 进程会在打印任何 carrier 信任的内容之前就退出,而一个失败的 Cordis fiber 产生的退出码并不专属于 listen 失败。在记忆端口上的任意启动失败都重试一次,是一个安全的超集——一个与端口无关的失败,在 `0` 上同样会失败,表现与本次改动之前完全一致。

**把受影响的 UI 状态从 `localStorage` 迁出,放进 settings service。** 这才是真正的长期方案,因为它连 fallback 启动也能保住状态,而不只是普通启动。本次特意排除在范围之外:它跨越 Problem 中列出的每一个 client package,本次改动都没有触碰。

## Consequences

普通启动会保持同一个 origin,上述六个持久化的 client store 因而能在应用重启后存活下来——这正是针对所报症状的可观察修复。偶尔一次 fallback 启动(另一个进程占着记忆端口,或两个实例发生竞争)仍会在那一次 session 中丢失这部分状态:这把缺陷范围从"每次启动"收窄到了"例外情况",而不是彻底清零,本笔记如实记录这部分残留丢失,而不是把这次修复夸大成完整方案。能彻底补上这个残留缺口的 settings-service 迁移仍是尚未排期的后续工作。

## Verification

`apps/desktop/tests/host-port.spec.ts` 覆盖了该记录的 parser、记忆端口的往返读写,以及在文件缺失、损坏、不可读时退化为 `undefined`、在目标不可写时吞掉写入失败。`apps/desktop/tests/host-launch.spec.ts` 覆盖了复用记忆端口且不发生 fallback 尝试、fallback-并记录(记住 Host 实际上报的端口,而不是当初请求的)、fallback 尝试本身也失败时把失败继续传播,以及记忆端口文件损坏时退化为 OS 分配端口。
