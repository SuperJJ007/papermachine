# Agent Note: Desktop usage telemetry: dual-write, no buffer

Status: implemented

[English](2026-09-01-desktop-usage-telemetry.md) | 中文

## Problem

PaperMachine 之前没有任何方式让 owner 看到安装是否成功、以及是否有人在持续使用。下载量已经由分发渠道计数，而不是由 app 本身计数，所以缺口具体在于：一次安装到底有没有真正完成，以及之后还有没有人持续启动它。`apps/desktop` 此前没有任何 telemetry 代码，Host 自身的 session telemetry（`apps/cli/src/profile-boot.ts`）是一个独立、不相关的开关，这个应用的 Electron main process 从未涉及它。

## Decision

三个只含元数据的事件，定义在 `src/telemetry.ts`：`app.launch`（每次进程启动一次）、`environment.installed`、`environment.install-failed`，两者都携带 package source（`tuna`/`ustc`/`official`，或自定义声明所选的 source）；installed 事件额外携带 `durationMs` 与 `environmentId`（`general`/`custom`）；failed 事件则携带失败前观察到的最后一个 `ProvisioningProgress.phase`，以及该次运行是否被取消。每个事件还携带新生成的 `eventId`、共享的匿名 id、ISO 时间戳、`appVersion`、`platform`、`arch`，以及 `schemaVersion: 1`。绝不包含 hostname、用户名、路径、package 清单或错误信息文本——错误文本可能带有路径，所以即使在失败事件里也被排除。

`ProvisioningProgress`（`provisioning.ts`）新增可选字段 `sourceId`，从 `solving`/`installing` 阶段开始填充当前（或一旦成功后，最终）被尝试的 source；`main.ts` 的 `startProvisioning` 在 progress 回调中追踪最新值，这样捕获到失败时才能报告运行到最后到底在尝试哪个 source。`AppliedEnvironment` 新增必填字段 `sourceId`，取自实际完成 prefix 创建的那次循环迭代——有序 source fallback（参见 [owns-its-environment 笔记](2026-09-01-desktop-owns-its-environment.zh.md)）意味着最终成功的 source 不一定是最初请求的那个。

匿名 id 就是 Host 自己的那个:`<dshHome>/.anonymous-user-id`,由 identity 插件（`packages/identity/anonymous-user-id/src/index.ts`）以 exclusive-create（`wx`）方式写入一行 `${uuid}\n`,并在遇到并发写入者或已存在的损坏文件时,先重读、再退化为普通覆盖写入。`apps/desktop/src/anonymous-id.ts` 重新实现了这套完全相同的算法,而不是直接依赖该 package——这与本应用已有的模式一致（`atomic-write.ts` 同样重新实现了 durable-write 逻辑,而不是依赖 `packages/`）,即在运行期不依赖 workspace 中的产品 package。真正的兼容性约定是磁盘格式本身,而不是共享代码:desktop 自己的首个 `app.launch` 在任何 Host 进程运行之前、onboarding 期间就会触发,因此它常常是这个 id 真正的创建时刻,之后启动的 Host 读到的正是 desktop 已经写好的文件。

Receiver 在构建期的 `resources/telemetry.json` 中配置（闭合 record,`schemaVersion: 1`,`endpoints: string[]`),由 `src/telemetry-config.ts` 解析,校验规则与 `environment-declaration.ts` 用于 conda channel URL 的严格 `https://` allowlist 完全相同——两者都被抽取进共享的 `src/https-url.ts`,而不是各自维护一份同样的 parser-boundary 正则。文件缺失或无法解析会抛出异常,经由 `main.ts` 的 `boot()` 表现为一次 loud 的启动失败（`app.exit(1)`),而不是悄悄禁用;`endpoints` 为空数组是有效且独立的 “telemetry 关闭” 状态。本版本发布时 `endpoints: []`。`TelemetryReporter.report` 用 `fetch` 把构建好的事件独立发送到每一个已配置的 endpoint,每次请求都带 5 秒的 `AbortSignal.timeout`,并各自包在自己的 try/catch 里,因此某一个 endpoint 的失败、非 2xx 响应或挂起都不会影响向另一个的投递,也不会阻塞调用方。`resolveTelemetryEndpoints` 会在 `DSH_TELEMETRY_DISABLED` 为任意非空值时把 `endpoints` 归约为 `[]`,与 `resolveTelemetryPatch` 对同一个变量的解释完全一致——现在同一个环境变量可以同时关闭两边的 telemetry。

`main.ts` 在 `boot()` 早期、Harness home 解析完成后（这是生成匿名 id 所需要的）立刻构造一个 `TelemetryReporter`,并在那里上报 `app.launch`,不等待其完成（`void telemetry.report(...)`）。`startProvisioning` 读取同一个 module-level 的 reporter 来上报每次 provisioning 运行的结果。`resources/onboarding.html` 用与页面其余部分相同的双语风格声明:app 会上报匿名使用统计,并且这可以被关闭;本版本不发布任何开关 UI。

## Alternatives considered

- **单一 endpoint、客户端在多个镜像间做 failover。** 拒绝:owner 明确说明的目的是比较 Cloudflare Worker 与阿里云香港函数在中国大陆的可达性,这要求每个 receiver 都能看到自己独立、完整的、来自每一个能连上它的用户的事件流——一个做 failover 的客户端只会上报给最先应答的那个 endpoint,恰好隐藏了 owner 想要的那个信号。
- **直接依赖 `@deepseek-ai/dsh-anonymous-user-id`,而不是重新实现其文件格式。** 拒绝:`apps/desktop` 在运行期不依赖 `packages/`（其 `package.json` 只有 `devDependencies`),而这个应用的 Electron main process 并不属于该 package 面向的、由 Cordis 组合而成的 Host。重新实现同一套读写算法,既保住了这条边界,又能保证两个进程就同一个文件达成一致。
- **离线重试队列或缓冲发送。** 本版本拒绝:这会为一个价值在于整体趋势、而非完整普查的指标功能,新增一种持久化格式、一条 replay 路径和一个增长上限。一个在启动时离线的用户,那一天就是不被计入——这里明确写出这是一个接受的、刻意的缺口,而不是隐含的。
- **在设置面板里加一个关闭 telemetry 的开关。** 本版本拒绝:任务范围是一句诚实的 onboarding 提示,外加已有的 `DSH_TELEMETRY_DISABLED` 环境变量,而不是新增设置 UI。这句提示陈述的是一条真实、已经可用的关闭路径（环境变量),而不是对未来某个开关的承诺。

## Consequences

owner 现在可以从两个独立的 receiver 看到安装是否成功（`environment.installed`/`environment.install-failed`,按 source 与 phase 拆分）以及活跃使用情况（`app.launch`),如果将来需要合并,还能通过 `eventId` 互相对齐,同时没有任何事件携带内容、文件路径、hostname 或用户名——“错误文本可能带有路径” 正是 `environment.install-failed` 上报结构化的 `phase` 枚举值、而不是底层错误 message 的原因。接受的代价是悄悄的漏计:任何离线、网络被墙,或运行时关闭了 telemetry 的用户,那次 session 都会贡献零个事件,且没有队列能在之后补上。`resources/telemetry.json` 发布时 `endpoints: []`,意味着无论 `DSH_TELEMETRY_DISABLED` 这个开关是什么状态,今天这个构建都不会发送任何东西,直到 owner 填好两个 receiver 的 URL 并出一个新构建——按照任务里 “如实发布” 的要求,这是有意为之,不是 bug。

## Verification

`tests/telemetry-config.spec.ts` 覆盖 `endpoints: []`、三个 shipped 风格的 URL、拒绝非 `https` 及带 shell 元字符/空白的 endpoint（一次 parser-boundary 检查）、未知字段、错误的 `schemaVersion`,以及随应用发布的 `resources/telemetry.json` 本身。`tests/anonymous-id.spec.ts` 覆盖文件缺失时按 identity package 精确的 `${uuid}\n` 格式创建、复用一个已存在的合法 id、在已存在损坏文件的情况下重新生成并持久化一个新 id（与该 package 的重读再覆盖 fallback 一致）,以及重复调用之间的稳定性。`tests/telemetry.spec.ts` 覆盖三种事件各自精确的字段集合、向每个已配置 endpoint 的双发投递、一个失败或挂起的 endpoint 不影响向其余 endpoint 的投递、也不阻塞正在等待其余 endpoint 的调用方、`DSH_TELEMETRY_DISABLED` 开关（包括任意非空值都会关闭,与 Host 的解释一致),以及即使所有 endpoint 都失败,`report` 也从不 reject。`tests/provisioning.spec.ts` 新增覆盖:在有序 fallback 循环中,`AppliedEnvironment.sourceId` 与 `ProvisioningProgress.sourceId` 命名的是实际成功的那个 source（不一定是最先尝试的那个）。
